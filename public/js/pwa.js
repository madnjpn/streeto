/*
 * PWA bootstrap: register the offline shell and expose the current display
 * mode to CSS. The Android WebView is a native shell, so it keeps its own
 * navigation and does not use the browser service worker.
 */
const nativeShell = Boolean(window.StreetNative);
const standalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

document.documentElement.classList.toggle('native-shell', nativeShell);
document.documentElement.classList.toggle('is-standalone', standalone);

if (!nativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* offline support is an enhancement; the site still works */
    });
  });
}
