package net.streeto.app;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/**
 * STREETO in a native shell.
 *
 * The whole web app is served from https://streeto.net: the shell keeps
 * the cookies, handles file uploads (gallery or camera), grants the map
 * its GPS position, and sends everything that is not STREETO to the
 * browser.
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL_BASE = "https://streeto.net";
    private static final String START_URL = START_URL_BASE + "/";
    private static final int REQ_FILE = 1001;
    private static final int REQ_LOCATION = 1002;
    private static final int REQ_NOTIFICATIONS = 1003;
    private static final int REQ_CAMERA = 1004;

    /** Extra used by notifications to open a specific page in the shell. */
    public static final String EXTRA_PATH = "net.streeto.app.OPEN_PATH";
    /** FCM messages stay quiet while the site is already on screen. */
    public static volatile boolean isForeground = false;

    private WebView webView;
    private ProgressBar progress;
    private SwipeRefreshLayout refresh;

    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private PermissionRequest cameraPermissionRequest;

    private static final String UPDATE_FILE = "streeto-update.apk";
    private long updateDownloadId = -1;
    private String updateSha256 = "";
    private BroadcastReceiver updateReceiver;
    private boolean updateReceiverRegistered = false;

    private View splash;
    private ImageView splashMark;
    private TextView splashWord;
    private TextView splashSite;
    private View splashLine;
    private ObjectAnimator splashPulse;
    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    private long splashStartedAt;
    private boolean splashHidden;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);

        applyInsets();
        bindViews();
        startSplash();
        configureWebView();
        bindBackButton();

        NativeNotifications.createChannels(this);
        DeviceRegistrar.registerIfEnabled(this);

        if (savedInstanceState == null) {
            webView.loadUrl(startUrl(getIntent()));
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** Page requested by a notification, or the normal start page. */
    private String startUrl(Intent intent) {
        String path = intent != null ? intent.getStringExtra(EXTRA_PATH) : null;
        if (path != null && path.startsWith("/") && !path.startsWith("//")) {
            return START_URL_BASE + path;
        }
        return START_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String path = intent != null ? intent.getStringExtra(EXTRA_PATH) : null;
        if (webView != null && path != null && path.startsWith("/") && !path.startsWith("//")) {
            webView.loadUrl(START_URL_BASE + path);
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
        splash = findViewById(R.id.splash);
        splashMark = findViewById(R.id.splashMark);
        splashWord = findViewById(R.id.splashWord);
        splashSite = findViewById(R.id.splashSite);
        splashLine = findViewById(R.id.splashLine);

        refresh.setColorSchemeColors(0xFF1FE0FF);
        refresh.setProgressBackgroundColorSchemeColor(0xFF07080B);
        refresh.setOnRefreshListener(() -> webView.reload());
    }

    /** Play the launching animation once, while the first page loads. */
    private void startSplash() {
        splashStartedAt = SystemClock.uptimeMillis();

        splashMark.setAlpha(0f);
        splashMark.setScaleX(0.82f);
        splashMark.setScaleY(0.82f);
        splashWord.setAlpha(0f);
        splashWord.setTranslationY(dp(12));
        splashSite.setAlpha(0f);
        splashSite.setTranslationY(dp(8));
        splashLine.setAlpha(0f);
        splashLine.setScaleX(0f);

        splashMark.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(650)
                .setInterpolator(new OvershootInterpolator(0.55f))
                .start();
        splashWord.animate()
                .alpha(1f)
                .translationY(0f)
                .setStartDelay(220)
                .setDuration(520)
                .setInterpolator(new DecelerateInterpolator())
                .start();
        splashLine.animate()
                .alpha(1f)
                .scaleX(1f)
                .setStartDelay(460)
                .setDuration(520)
                .setInterpolator(new DecelerateInterpolator())
                .start();
        splashSite.animate()
                .alpha(1f)
                .translationY(0f)
                .setStartDelay(680)
                .setDuration(460)
                .setInterpolator(new DecelerateInterpolator())
                .start();

        // A quiet pulse while a slow page is still loading.
        splashPulse = ObjectAnimator.ofFloat(splashLine, View.ALPHA, 0.3f, 1f);
        splashPulse.setDuration(1100);
        splashPulse.setStartDelay(1200);
        splashPulse.setRepeatCount(ValueAnimator.INFINITE);
        splashPulse.setRepeatMode(ValueAnimator.REVERSE);
        splashPulse.setInterpolator(new AccelerateDecelerateInterpolator());
        splashPulse.start();

        // Never trap the user behind the splash if the page never reports back.
        splashHandler.postDelayed(this::hideSplash, 10_000);
    }

    /** Fade the splash out once the first page is ready (minimum 1.2 s). */
    private void hideSplash() {
        if (splashHidden || splash == null) return;
        splashHidden = true;

        long elapsed = SystemClock.uptimeMillis() - splashStartedAt;
        long delay = Math.max(0, 1200 - elapsed);
        splashHandler.postDelayed(() -> {
            if (splashPulse != null) {
                splashPulse.cancel();
                splashPulse = null;
            }
            splash.animate()
                    .alpha(0f)
                    .setDuration(320)
                    .setInterpolator(new AccelerateInterpolator())
                    .withEndAction(() -> splash.setVisibility(View.GONE))
                    .start();
        }, delay);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
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
        settings.setUserAgentString(settings.getUserAgentString() + " StreetoApp/" + versionName());

        // Version reporting and the in-app updater. Only streeto.net pages
        // are ever loaded in this WebView; everything else goes to the
        // browser, so the bridge is not exposed to arbitrary sites.
        webView.addJavascriptInterface(new UpdateBridge(), "StreetNative");

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
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // Every new page starts with pull-to-refresh available. The
                // chat page turns it off while a conversation is expanded.
                if (refresh != null) {
                    refresh.setRefreshing(false);
                    refresh.setEnabled(true);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                refresh.setRefreshing(false);
                CookieManager.getInstance().flush();
                if (url != null && !url.startsWith("about:")) hideSplash();
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
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsVideo = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                            wantsVideo = true;
                            break;
                        }
                    }
                    if (!wantsVideo) {
                        request.deny();
                        return;
                    }
                    if (hasCameraPermission()) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                        return;
                    }
                    if (cameraPermissionRequest != null) {
                        cameraPermissionRequest.deny();
                    }
                    cameraPermissionRequest = request;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[]{Manifest.permission.CAMERA},
                            REQ_CAMERA);
                });
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

    /** The small JS bridge used by the site's update check. */
    private class UpdateBridge {
        @JavascriptInterface
        public String getVersion() {
            try {
                JSONObject json = new JSONObject();
                json.put("versionName", versionName());
                json.put("versionCode", versionCode());
                return json.toString();
            } catch (Exception ignored) {
                return "{\"versionName\":\"" + versionName() + "\",\"versionCode\":" + versionCode() + "}";
            }
        }

        /**
         * Turn the native pull-to-refresh gesture off while the web chat is
         * expanded, so vertical drags scroll the conversation instead.
         */
        @JavascriptInterface
        public void setPullToRefresh(final boolean enabled) {
            runOnUiThread(() -> {
                if (refresh == null) return;
                refresh.setEnabled(enabled);
                if (!enabled) refresh.setRefreshing(false);
            });
        }

        /**
         * Download and open the signed APK. Returns "started", "permission"
         * when the user must allow installs from STREETO first, or "failed".
         */
        @JavascriptInterface
        public boolean notificationsEnabled() {
            return NativeNotifications.isEnabled(MainActivity.this);
        }

        @JavascriptInterface
        public String enableNotifications() {
            if (NativeNotifications.isEnabled(MainActivity.this)) return "enabled";

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_NOTIFICATIONS));
                return "requested";
            }

            if (!NativeNotifications.allowed(MainActivity.this)) {
                runOnUiThread(MainActivity.this::openNotificationSettings);
                return "denied";
            }

            NativeNotifications.setEnabled(MainActivity.this, true);
            DeviceRegistrar.register(MainActivity.this);
            return "enabled";
        }

        @JavascriptInterface
        public void disableNotifications() {
            runOnUiThread(() -> DeviceRegistrar.unregister(MainActivity.this));
        }

        @JavascriptInterface
        public String downloadAndInstall(String url, String sha256) {
            if (!isUpdateUrl(url)) return "failed";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(MainActivity.this::openInstallPermission);
                return "permission";
            }
            runOnUiThread(() -> startUpdateDownload(url, sha256));
            return "started";
        }
    }

    private boolean isUpdateUrl(String url) {
        try {
            Uri uri = Uri.parse(url == null ? "" : url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            return "https".equals(scheme)
                    && (host.equals("streeto.net") || host.endsWith(".streeto.net"));
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openInstallPermission() {
        Toast.makeText(this, R.string.update_allow_installs, Toast.LENGTH_LONG).show();
        try {
            startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())));
        } catch (ActivityNotFoundException ignored) {
            /* the installer will ask on its own */
        }
    }

    private void openNotificationSettings() {
        Toast.makeText(this, R.string.notify_permission_denied, Toast.LENGTH_LONG).show();
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            } else {
                intent = new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getPackageName()));
            }
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            /* no settings screen on this device */
        }
    }

    private void startUpdateDownload(String url, String sha256) {
        if (!isUpdateUrl(url)) {
            Toast.makeText(this, R.string.update_failed, Toast.LENGTH_SHORT).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getPackageManager().canRequestPackageInstalls()) {
            openInstallPermission();
            return;
        }

        try {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) throw new IllegalStateException("no downloads directory");
            File target = new File(dir, UPDATE_FILE);
            if (target.exists()) target.delete();

            DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("no download manager");

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle(getString(R.string.update_download_title))
                    .setDescription(getString(R.string.update_download_text))
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(
                            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(
                            this, Environment.DIRECTORY_DOWNLOADS, UPDATE_FILE);

            updateSha256 = sha256 == null ? "" : sha256.trim().toLowerCase();
            updateDownloadId = manager.enqueue(request);
            registerUpdateReceiver();
        } catch (Exception error) {
            Toast.makeText(this, R.string.update_failed, Toast.LENGTH_SHORT).show();
        }
    }

    private void registerUpdateReceiver() {
        if (updateReceiverRegistered) return;
        updateReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != updateDownloadId) return;
                installUpdate(id);
            }
        };
        ContextCompat.registerReceiver(
                this,
                updateReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                ContextCompat.RECEIVER_EXPORTED);
        updateReceiverRegistered = true;
    }

    private void installUpdate(long id) {
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) return;

        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                Toast.makeText(this, R.string.update_failed, Toast.LENGTH_SHORT).show();
                return;
            }
        } catch (Exception error) {
            Toast.makeText(this, R.string.update_failed, Toast.LENGTH_SHORT).show();
            return;
        }

        File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apk = dir == null ? null : new File(dir, UPDATE_FILE);
        if (apk == null || !apk.isFile()) {
            Toast.makeText(this, R.string.update_failed, Toast.LENGTH_SHORT).show();
            return;
        }

        if (!updateSha256.isEmpty()) {
            String actual = sha256(apk);
            if (!actual.equalsIgnoreCase(updateSha256)) {
                apk.delete();
                Toast.makeText(this, R.string.update_corrupt, Toast.LENGTH_LONG).show();
                return;
            }
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
        } catch (Exception error) {
            Toast.makeText(this, R.string.update_open_failed, Toast.LENGTH_LONG).show();
        }
    }

    private static String sha256(File file) {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder out = new StringBuilder(64);
            for (byte b : digest.digest()) out.append(String.format("%02x", b & 0xff));
            return out.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    private String versionName() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName == null ? "1.0" : info.versionName;
        } catch (Exception ignored) {
            return "1.0";
        }
    }

    private int versionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return (int) PackageInfoCompat.getLongVersionCode(info);
        } catch (Exception ignored) {
            return 0;
        }
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

    private boolean hasCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
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
        hideSplash();
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS) {
            if (NativeNotifications.allowed(this)) {
                NativeNotifications.setEnabled(this, true);
                DeviceRegistrar.register(this);
                Toast.makeText(this, R.string.notify_enabled, Toast.LENGTH_SHORT).show();
            } else {
                Toast.makeText(this, R.string.notify_permission_denied, Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode == REQ_CAMERA) {
            if (cameraPermissionRequest != null) {
                if (hasCameraPermission()) {
                    cameraPermissionRequest.grant(
                            new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    cameraPermissionRequest.deny();
                }
                cameraPermissionRequest = null;
            }
            return;
        }
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
        isForeground = false;
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        splashHandler.removeCallbacksAndMessages(null);
        if (splashPulse != null) {
            splashPulse.cancel();
            splashPulse = null;
        }
        if (updateReceiverRegistered && updateReceiver != null) {
            try {
                unregisterReceiver(updateReceiver);
            } catch (Exception ignored) {
                /* already gone */
            }
            updateReceiver = null;
            updateReceiverRegistered = false;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
