/*
 * PWA bootstrap: register the offline shell and expose the current display
 * mode to CSS. The Android WebView uses the same in-page tab bar as the PWA
 * and iOS, so it is deliberately not treated as a separate visual mode.
 */
const nativeShell = Boolean(window.StreetNative);
const standalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

document.documentElement.classList.toggle('is-standalone', standalone);

// The launch screen is only painted when the inline <head> script marked this
// as the first standalone page of the session. Keep it up for at least the
// length of the Android splash, then fade it out.
if (document.documentElement.classList.contains('pwa-booting')) {
  const startedAt = Number(window.__streetoPwaSplashAt) || Date.now();
  const finishSplash = () => {
    const wait = Math.max(0, 1400 - (Date.now() - startedAt));
    window.setTimeout(() => {
      document.documentElement.classList.add('pwa-ready');
      window.setTimeout(() => {
        document.documentElement.classList.remove('pwa-booting', 'pwa-ready');
      }, 340);
    }, wait);
  };
  if (document.readyState === 'complete') finishSplash();
  else window.addEventListener('load', finishSplash, { once: true });
}

if (!nativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* offline support is an enhancement; the site still works */
    });
  });
}
