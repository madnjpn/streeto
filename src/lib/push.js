import webpush from 'web-push';
import config from '../config.js';
import * as pushSubs from '../models/push.js';

let configured = false;
function ensureConfigured() {
  if (configured) return !!config.vapidPublicKey && !!config.vapidPrivateKey;
  configured = true;
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    return true;
  }
  return false;
}

export async function sendToUser(userId, payload) {
  if (!ensureConfigured()) return;
  const subs = pushSubs.forUser(userId);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        pushSubs.unsubscribe(sub.endpoint);
      }
    }
  }
}

export default { sendToUser };