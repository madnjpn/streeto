/* STREETO - browser push notification helpers. */

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission() {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/** Register the service worker and store the push subscription. */
export async function ensurePushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const vapidRes = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
    if (!vapidRes.ok) return null;
    const { publicKey } = await vapidRes.json();
    if (!publicKey) return null;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    // Post even an existing subscription so the server can refresh which
    // browser/device it belongs to (Android Chrome can then yield to the
    // native app while desktop browsers keep their own notifications).
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return sub;
  } catch {
    return null;
  }
}

/**
 * Ask for permission and subscribe. Must be called from a click/tap:
 * browsers only allow the permission prompt during a user gesture.
 */
export async function requestPushSubscription() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const sub = await ensurePushSubscription();
  return sub ? { ok: true } : { ok: false, reason: 'subscribe-failed' };
}

/** Remove the browser subscription and tell the server to forget it. */
export async function disablePushSubscription() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    /* nothing to turn off */
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
