import { t } from './i18n.js';
import {
  ensurePushSubscription,
  pushSupported,
  pushPermission,
  requestPushSubscription,
  disablePushSubscription,
} from './push.js';

const bridge = window.StreetNative;
const native = Boolean(bridge && typeof bridge.notificationsEnabled === 'function');

const enableBtn = document.querySelector('[data-push-enable]');
const disableBtn = document.querySelector('[data-push-disable]');
const stateEl = document.querySelector('[data-push-state]');
const statusEl = document.querySelector('[data-push-status]');
const noteEl = document.querySelector('[data-push-note]');

let busy = false;

const PROMPT_KEY = 'streeto.notificationPromptAt';
const PROMPT_DAYS = 14;

function paint(state, message) {
  if (stateEl) stateEl.textContent = state;
  if (statusEl) statusEl.textContent = message || '';
  if (enableBtn) enableBtn.hidden = state === t('Enabled');
  if (disableBtn) disableBtn.hidden = state !== t('Enabled');
  if (noteEl) noteEl.hidden = !native;
  updatePrompt(state);
}

function removePrompt() {
  document.querySelector('.notif-prompt')?.remove();
}

function promptDismissed() {
  try {
    const at = Number(localStorage.getItem(PROMPT_KEY)) || 0;
    return Date.now() - at < PROMPT_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function updatePrompt(state) {
  const enabled = state === t('Enabled');
  const blocked = state === t('Blocked') || state === t('Not supported');
  if (enabled || blocked || location.pathname === '/settings' || promptDismissed()) {
    removePrompt();
    return;
  }
  if (!native && (!pushSupported() || pushPermission() === 'denied')) {
    removePrompt();
    return;
  }
  if (document.querySelector('.notif-prompt')) return;

  const prompt = document.createElement('div');
  prompt.className = 'notif-prompt';
  prompt.setAttribute('role', 'status');

  const text = document.createElement('div');
  text.className = 'notif-prompt__text';
  const title = document.createElement('strong');
  title.textContent = t('Turn on notifications');
  const copy = document.createElement('span');
  copy.textContent = t('Get messages, friend requests, comments and activity while STREETO is closed.');
  text.append(title, copy);

  const actions = document.createElement('div');
  actions.className = 'notif-prompt__actions';
  const enableCta = document.createElement('button');
  enableCta.type = 'button';
  enableCta.className = 'btn btn--primary btn--sm';
  enableCta.textContent = t('Enable notifications');
  enableCta.addEventListener('click', () => enable());
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn btn--ghost btn--sm';
  later.textContent = t('Not now');
  later.addEventListener('click', dismissPrompt);
  actions.append(enableCta, later);

  prompt.append(text, actions);
  document.body.append(prompt);
}

function dismissPrompt() {
  try {
    localStorage.setItem(PROMPT_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
  removePrompt();
}

function nativeEnabled() {
  try {
    return Boolean(bridge.notificationsEnabled());
  } catch {
    return false;
  }
}

async function refresh() {
  if (busy) return;

  if (native) {
    const on = nativeEnabled();
    paint(on ? t('Enabled') : t('Disabled'), on ? t('Notifications are on.') : t('Notifications are off.'));
    return;
  }

  if (!pushSupported()) {
    paint(t('Not supported'), t('This browser does not support notifications.'));
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.hidden = true;
    return;
  }

  const permission = pushPermission();
  if (permission === 'denied') {
    paint(t('Blocked'), t('Notifications are blocked. Allow them in your browser settings.'));
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.hidden = true;
    return;
  }

  if (enableBtn) enableBtn.disabled = false;
  let sub = null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    sub = await reg?.pushManager.getSubscription();
  } catch {
    sub = null;
  }
  if (sub) paint(t('Enabled'), t('Notifications are on.'));
  else paint(t('Disabled'), t('Notifications are off.'));
}

async function enable() {
  if (busy) return;
  busy = true;
  if (enableBtn) enableBtn.disabled = true;
  try {
    if (native) {
      const result = String(bridge.enableNotifications() || '');
      if (result === 'requested') {
        paint(t('Disabled'), t('Allow notifications in the system prompt.'));
        // The native permission dialog is asynchronous; refresh once it
        // has had time to close so the prompt disappears after a grant.
        setTimeout(refresh, 1400);
        setTimeout(refresh, 3200);
      } else if (result === 'enabling') {
        paint(t('Disabled'), t('Turning on notifications…'));
        // The token is registered in the background; keep checking until
        // the native side confirms the server has the installation.
        setTimeout(refresh, 1800);
        setTimeout(refresh, 4000);
        setTimeout(refresh, 8000);
      } else if (result === 'denied') {
        paint(t('Blocked'), t('Notifications are blocked. Allow them in your phone settings.'));
      } else {
        paint(t('Enabled'), t('Notifications are on.'));
      }
      return;
    }

    const result = await requestPushSubscription();
    if (result.ok) paint(t('Enabled'), t('Notifications are on.'));
    else if (result.reason === 'denied') {
      paint(t('Blocked'), t('Notifications are blocked. Allow them in your browser settings.'));
    } else if (result.reason === 'unsupported') {
      paint(t('Not supported'), t('This browser does not support notifications.'));
    } else {
      paint(t('Disabled'), t('Could not enable notifications. Try again.'));
    }
  } finally {
    busy = false;
    if (enableBtn) enableBtn.disabled = false;
  }
}

async function disable() {
  if (busy) return;
  busy = true;
  if (disableBtn) disableBtn.disabled = true;
  try {
    if (native) {
      bridge.disableNotifications();
    } else {
      await disablePushSubscription();
    }
    // Do not immediately nag the member who just turned them off.
    try {
      localStorage.setItem(PROMPT_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    await refresh();
  } finally {
    busy = false;
    if (disableBtn) disableBtn.disabled = false;
  }
}

if (native) {
  refresh();
} else if (pushPermission() === 'granted') {
  // Already allowed: keep the server subscription fresh without prompting.
  ensurePushSubscription().catch(() => {});
  refresh();
} else {
  refresh();
}

enableBtn?.addEventListener('click', enable);
disableBtn?.addEventListener('click', disable);

// Leaving the account should not leave the phone subscribed to it.
document.querySelectorAll('form[action="/logout"]').forEach((form) => {
  form.addEventListener('submit', () => {
    if (!native) return;
    try {
      bridge.disableNotifications();
    } catch {
      /* the session is ending anyway */
    }
  });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
window.addEventListener('focus', refresh);
