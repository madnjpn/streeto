-- Remember which kind of browser owns a Web Push subscription. Android
-- Chrome subscriptions can then be skipped when the native app has an
-- active FCM token, while desktop browsers keep their notifications.
ALTER TABLE push_subscriptions ADD COLUMN platform TEXT;
