/*
   STREETO versions and update check.

   Runs on every page: paints the footer with the web version and the
   installed (or latest) Android version. Inside the app it asks
   /api/app/version once per load and offers an update when a newer APK
   is being served. Choosing "Update now" uses the native downloader in
   the Android shell; older shells simply open the APK URL, which the
   WebView hands to the browser.
*/

import { t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const pageWebVersion = $('meta[name="streeto-web-version"]')?.content || '';
const uaVersion = (navigator.userAgent.match(/StreetoApp\/([0-9]+(?:\.[0-9]+)*)/i) || [])[1] || '';

/** The native bridge, when this is a shell that has one. */
function readNativeVersion() {
  try {
    if (window.StreetNative && typeof window.StreetNative.getVersion === 'function') {
      const data = JSON.parse(window.StreetNative.getVersion());
      if (data && data.versionName) {
        return {
          versionName: String(data.versionName),
          versionCode: Number(data.versionCode) || 0,
        };
      }
    }
  } catch {
    /* not in the app, or an older shell without the bridge */
  }
  return null;
}

const native = readNativeVersion();
const installed = native || (uaVersion ? { versionName: uaVersion, versionCode: 0 } : null);
const inApp = Boolean(installed);

let release = null;
let webLatest = '';
let inflight = null;

function parts(value) {
  return String(value || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
}

function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchVersion() {
  const response = await fetch(`/api/app/version?_=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data || data.ok === false || !data.android) throw new Error('Bad version response');
  release = data.android;
  webLatest = data.web?.version || '';
  return data;
}

function loadVersion() {
  if (!inflight) inflight = fetchVersion().finally(() => { inflight = null; });
  return inflight;
}

function hasUpdate() {
  if (!inApp || !release || release.available === false) return false;
  if (native && installed.versionCode > 0 && release.versionCode > 0) {
    return release.versionCode > installed.versionCode;
  }
  return compareVersions(release.versionName, installed.versionName) > 0;
}

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function paintFooter() {
  setText('[data-footer-web-version]', `v${pageWebVersion || webLatest || '—'}`);
  const app = $('[data-footer-app-version]');
  if (!app) return;
  if (inApp) {
    app.textContent = `v${installed.versionName}`;
    app.title = t('Installed app version');
  } else if (release) {
    app.textContent = `v${release.versionName}`;
    app.title = t('Latest Android app');
  }
}

function paintSettings() {
  const currentRow = $('[data-app-current-row]');
  const current = $('[data-app-current]');
  if (currentRow && current) {
    currentRow.hidden = !inApp;
    current.hidden = !inApp;
    if (inApp) current.textContent = `v${installed.versionName}`;
  }
  if (release) {
    const latest = $('[data-app-latest]');
    if (latest) latest.textContent = `v${release.versionName}`;
  }
  setText('[data-web-version]', `v${pageWebVersion || webLatest || '—'}`);
}

function setStatus(text, tone = '') {
  const el = $('[data-update-status]');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function revealSettingsUpdate() {
  const button = $('[data-update-now-settings]');
  if (button) button.hidden = false;
  const reload = $('[data-reload-now]');
  if (reload) reload.hidden = true;
}

function updateUrl() {
  const url = release?.url || '/downloads/STREETO-android.apk';
  try {
    return new URL(url, location.origin).href;
  } catch {
    return url;
  }
}

function startUpdate() {
  const url = updateUrl();
  try {
    if (window.StreetNative && typeof window.StreetNative.downloadAndInstall === 'function') {
      const result = window.StreetNative.downloadAndInstall(url, release?.sha256 || '');
      if (result === 'permission') {
        setStatus(t('Allow installs for STREETO, then tap Update again.'));
        return;
      }
      if (result === 'failed') {
        setStatus(t('Could not start the update. Try again.'), 'error');
        return;
      }
      setStatus(t('Downloading the update…'), 'ok');
      return;
    }
  } catch {
    /* fall through to the browser */
  }
  // An older shell: the WebView's download listener opens the APK in the
  // browser, where the user can install it.
  window.location.href = url;
}

function showBanner() {
  const banner = $('[data-update-banner]');
  if (!banner || !release || !hasUpdate()) return;
  try {
    if (sessionStorage.getItem('streetoUpdateDismissed') === release.versionName) return;
  } catch {
    /* private mode */
  }
  const text = $('[data-update-banner-text]');
  if (text) {
    text.textContent = t('A new version of STREETO is available: v{version}.', {
      version: release.versionName,
    });
  }
  banner.hidden = false;
  document.body.classList.add('has-update-banner');
}

$$('[data-update-now]').forEach((button) => {
  button.addEventListener('click', () => startUpdate());
});

$$('[data-update-now-settings]').forEach((button) => {
  button.addEventListener('click', () => startUpdate());
});

$$('[data-update-dismiss]').forEach((button) => {
  button.addEventListener('click', () => {
    if (release) {
      try {
        sessionStorage.setItem('streetoUpdateDismissed', release.versionName);
      } catch {
        /* private mode */
      }
    }
    const banner = $('[data-update-banner]');
    if (banner) banner.hidden = true;
    document.body.classList.remove('has-update-banner');
  });
});

const reloadButton = $('[data-reload-now]');
if (reloadButton) {
  reloadButton.addEventListener('click', () => location.reload());
}

const checkButton = $('[data-check-updates]');
if (checkButton) {
  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    setStatus(t('Checking…'));
    try {
      await loadVersion();
      paintFooter();
      paintSettings();

      if (hasUpdate()) {
        setStatus(t('Update available: v{version}.', { version: release.versionName }));
        revealSettingsUpdate();
        showBanner();
      } else if (inApp) {
        setStatus(
          t("You're on the latest version (v{version}).", { version: installed.versionName }),
          'ok',
        );
      } else if (webLatest && pageWebVersion && compareVersions(webLatest, pageWebVersion) > 0) {
        setStatus(t('A new web version is available. Reload the page to get it.'));
        if (reloadButton) reloadButton.hidden = false;
      } else {
        setStatus(
          t('The web version is up to date (v{version}).', {
            version: pageWebVersion || webLatest || '—',
          }),
          'ok',
        );
      }
    } catch {
      setStatus(t('Check failed. Try again.'), 'error');
    } finally {
      checkButton.disabled = false;
    }
  });
}

paintFooter();
paintSettings();

if (inApp) {
  loadVersion()
    .then(() => {
      paintFooter();
      paintSettings();
      if (hasUpdate()) {
        revealSettingsUpdate();
        showBanner();
      }
    })
    .catch(() => {
      /* offline or an old server - the installed version still shows */
    });
}
