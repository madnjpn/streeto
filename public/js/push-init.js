import { ensurePushSubscription } from './push.js';
if (document.body?.dataset?.authed === '1') {
  ensurePushSubscription().catch(() => {});
}