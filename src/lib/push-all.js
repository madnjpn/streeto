import { sendToUser as sendWeb } from './push.js';
import { sendToUser as sendFcm } from './fcm.js';

/**
 * Fan a notification out to every channel a member has:
 * browser Web Push subscriptions and Android FCM installations.
 * Both are best-effort; a failed channel never fails the request.
 */
export function pushToUser(userId, payload) {
  sendWeb(userId, payload).catch(() => {});
  sendFcm(userId, payload).catch(() => {});
}

export default { pushToUser };
