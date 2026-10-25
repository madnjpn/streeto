package net.streeto.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.BitmapFactory;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** Channel setup and the visible activity notifications for FCM. */
public final class NativeNotifications {

    public static final String PREFS = "streeto_notifications";
    public static final String KEY_ENABLED = "enabled";
    public static final String CHANNEL_ACTIVITY = "streeto_activity";

    private NativeNotifications() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel activity = new NotificationChannel(
                CHANNEL_ACTIVITY,
                context.getString(R.string.notify_channel_activity),
                NotificationManager.IMPORTANCE_DEFAULT);
        activity.setDescription(context.getString(R.string.notify_channel_activity_desc));
        manager.createNotificationChannel(activity);
    }

    public static boolean allowed(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, false) && allowed(context) && !channelBlocked(context);
    }

    /** The activity channel can be blocked separately from the app toggle. */
    public static boolean channelBlocked(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ACTIVITY);
        return channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE;
    }

    public static void setEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    /** Post one alert; data comes from a data-only FCM message. */
    public static void show(Context context, String title, String body, String url, String tag) {
        if (!allowed(context)) return;
        createChannels(context);

        String path = url != null && url.startsWith("/") && !url.startsWith("//")
                ? url
                : "/notifications";
        String key = (tag != null ? tag : "streeto") + path;
        int id = Math.abs(key.hashCode());
        if (id == 0) id = 1;

        Intent intent = new Intent(context, MainActivity.class)
                .putExtra(MainActivity.EXTRA_PATH, path)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                context,
                id,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ACTIVITY)
                .setSmallIcon(R.drawable.streeto_mark)
                .setLargeIcon(BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher))
                .setContentTitle(title == null || title.isEmpty()
                        ? context.getString(R.string.notify_activity_title)
                        : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SOCIAL);

        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException ignored) {
            /* permission was revoked between checks */
        }
    }

    public static void cancelAll(Context context) {
        NotificationManagerCompat.from(context).cancelAll();
    }
}
