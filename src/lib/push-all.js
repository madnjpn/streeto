import { sendToUser as sendWeb } from './push.js';
import { sendToUser as sendFcm } from './fcm.js';
import { pushAllowed } from './notification-prefs.js';

/**
 * Fan a notification out to every channel a member has:
 * browser Web Push subscriptions and Android FCM installations.
 * Both are best-effort; a failed channel never fails the request.
 *
 * Payloads that carry a category respect the member's per-category
 * preference. The in-app activity row is stored separately and is never
 * suppressed by this check.
 */
export function pushToUser(userId, payload) {
  if (payload?.category && !pushAllowed(userId, payload.category)) return;
  sendWeb(userId, payload).catch(() => {});
  sendFcm(userId, payload).catch(() => {});
}

export default { pushToUser };
