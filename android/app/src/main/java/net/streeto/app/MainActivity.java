package net.streeto.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;

/**
 * STREETO in a native shell.
 *
 * The whole web app is served from https://streeto.net: the shell keeps
 * the cookies, handles file uploads (gallery or camera), grants the map
 * its GPS position, and sends everything that is not STREETO to the
 * browser.
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL = "https://streeto.net/";
    private static final int REQ_FILE = 1001;
    private static final int REQ_LOCATION = 1002;

    private WebView webView;
    private ProgressBar progress;
    private SwipeRefreshLayout refresh;

    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);

        applyInsets();
        bindViews();
        configureWebView();
        bindBackButton();

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** Keep the page below the status bar and above the keyboard. */
    private void applyInsets() {
        View root = findViewById(R.id.root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return insets;
        });

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    private void bindViews() {
        webView = findViewById(R.id.webview);
        progress = findViewById(R.id.progress);
        refresh = findViewById(R.id.refresh);

        refresh.setColorSchemeColors(0xFF1FE0FF);
        refresh.setProgressBackgroundColorSchemeColor(0xFF07080B);
        refresh.setOnRefreshListener(() -> webView.reload());
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " StreetoApp/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                refresh.setRefreshing(false);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
                progress.setProgress(newProgress);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                    String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }
                geoCallback = callback;
                geoOrigin = origin;
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                        },
                        REQ_LOCATION);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                Intent content;
                try {
                    content = params.createIntent();
                    content.addCategory(Intent.CATEGORY_OPENABLE);
                } catch (Exception ignored) {
                    content = new Intent(Intent.ACTION_GET_CONTENT);
                    content.setType("*/*");
                    content.addCategory(Intent.CATEGORY_OPENABLE);
                }

                Intent chooser = Intent.createChooser(content, getString(R.string.choose_file));
                Intent camera = cameraIntent();
                if (camera != null) {
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                }

                try {
                    startActivityForResult(chooser, REQ_FILE);
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    cameraUri = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException ignored) {
                /* nothing can open it */
            }
        });
    }

    /** A camera target for the upload chooser, or null when unavailable. */
    private Intent cameraIntent() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File photo = File.createTempFile("streeto-", ".jpg", dir);
            cameraUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", photo);

            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.addFlags(
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return camera;
        } catch (Exception ignored) {
            cameraUri = null;
            return null;
        }
    }

    private void bindBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
    }

    /** Keep STREETO in the app; hand everything else to the phone. */
    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();

        if (("http".equals(scheme) || "https".equals(scheme))
                && (host.equals("streeto.net") || host.endsWith(".streeto.net"))) {
            return false;
        }

        try {
            if ("intent".equals(scheme)) {
                startActivity(Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME));
            } else {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            }
        } catch (Exception ignored) {
            /* no app for this link */
        }
        return true;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void showOffline() {
        progress.setVisibility(View.GONE);
        refresh.setRefreshing(false);
        String html = "<html><head><meta name='viewport' "
                + "content='width=device-width,initial-scale=1'>"
                + "<style>body{background:#07080b;color:#e8eef7;font-family:sans-serif;"
                + "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"
                + "text-align:center}a{display:inline-block;margin-top:18px;padding:12px 22px;"
                + "border-radius:999px;background:#1fe0ff;color:#06121a;text-decoration:none;"
                + "font-weight:700}</style></head><body><div><h2>"
                + getString(R.string.offline_title) + "</h2><p>"
                + getString(R.string.offline_text) + "</p><a href='" + START_URL + "'>"
                + getString(R.string.retry) + "</a></div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_LOCATION) return;
        boolean granted = hasLocationPermission();
        if (geoCallback != null) {
            geoCallback.invoke(geoOrigin, granted, false);
            geoCallback = null;
            geoOrigin = null;
        }
        if (!granted) {
            Toast.makeText(this, R.string.location_denied, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data == null || (data.getData() == null && data.getClipData() == null)) {
                if (cameraUri != null) result = new Uri[]{cameraUri};
            } else if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) {
                    result[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }

        fileCallback.onReceiveValue(result);
        fileCallback = null;
        cameraUri = null;
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
