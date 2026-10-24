package net.streeto.app;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Receives data-only FCM messages and turns them into activity alerts. */
public class StreetoMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        DeviceRegistrar.onNewToken(this);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        // While the member is in the app the site already shows the badge;
        // do not buzz on top of it.
        if (MainActivity.isForeground) return;

        Map<String, String> data = message.getData();
        String title = data.get("title");
        String body = data.get("body");
        String url = data.get("url");
        String tag = data.get("tag");

        if ((title == null || title.isEmpty()) && message.getNotification() != null) {
            title = message.getNotification().getTitle();
        }
        if ((body == null || body.isEmpty()) && message.getNotification() != null) {
            body = message.getNotification().getBody();
        }
        if (title == null || title.isEmpty()) {
            title = getString(R.string.notify_activity_title);
        }

        NativeNotifications.show(this, title, body, url, tag);
    }
}
