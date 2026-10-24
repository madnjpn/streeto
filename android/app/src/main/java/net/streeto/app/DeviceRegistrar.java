package net.streeto.app;

import android.content.Context;
import android.util.Log;
import android.webkit.CookieManager;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Registers, refreshes and removes this installation's FCM token. */
public final class DeviceRegistrar {

    private static final String TAG = "StreetoFcm";
    private static final String ENDPOINT = "https://streeto.net/api/push/device";

    private DeviceRegistrar() {}

    /** Obtain the current FCM token and send it to the logged-in server. */
    public static void register(Context context) {
        Context app = context.getApplicationContext();
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener((task) -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                Log.w(TAG, "could not obtain the FCM token", task.getException());
                return;
            }
            String token = task.getResult();
            new Thread(() -> {
                if (post(app, token, false)) {
                    NativeNotifications.setEnabled(app, true);
                }
            }, "streeto-fcm-register").start();
        });
    }

    /** Tell the server to forget this token, then delete it locally. */
    public static void unregister(Context context) {
        Context app = context.getApplicationContext();
        NativeNotifications.setEnabled(app, false);
        NativeNotifications.cancelAll(app);
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener((task) -> {
            if (!task.isSuccessful() || task.getResult() == null) return;
            String token = task.getResult();
            new Thread(() -> post(app, token, true), "streeto-fcm-unregister").start();
            FirebaseMessaging.getInstance().deleteToken();
        });
    }

    /** Refresh the server copy on launch when the member already opted in. */
    public static void registerIfEnabled(Context context) {
        if (NativeNotifications.isEnabled(context)) register(context);
    }

    /** Called by FirebaseMessagingService when the token rotates. */
    public static void onNewToken(Context context) {
        if (NativeNotifications.isEnabled(context)) register(context);
    }

    private static boolean post(Context context, String token, boolean remove) {
        HttpURLConnection connection = null;
        try {
            String cookies = CookieManager.getInstance().getCookie("https://streeto.net");
            if (cookies == null || !cookies.contains("streeto.sid=")) return false;

            URL url = new URL(remove ? ENDPOINT + "/remove" : ENDPOINT);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Cookie", cookies);
            connection.setRequestProperty("x-requested-with", "fetch");
            connection.setRequestProperty("User-Agent", "StreetoApp/Android");

            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("platform", "android");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
            return connection.getResponseCode() == 200;
        } catch (Exception error) {
            Log.w(TAG, "could not update the FCM token", error);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
