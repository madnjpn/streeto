import { t } from './i18n.js';

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const installButtons = [...document.querySelectorAll('[data-install-app]')];
const status = document.querySelector('[data-install-status]');
const iosPanel = document.querySelector('[data-install-ios]');
const otherPanel = document.querySelector('[data-install-other]');
const installedPanel = document.querySelector('[data-install-done]');

const setStatus = (message) => {
  if (status) status.textContent = message;
};

const showInstalled = () => {
  installButtons.forEach((button) => { button.hidden = true; });
  if (iosPanel) iosPanel.hidden = true;
  if (otherPanel) otherPanel.hidden = true;
  if (installedPanel) installedPanel.hidden = false;
};

if (standalone) showInstalled();
else if (isIOS) {
  if (iosPanel) iosPanel.hidden = false;
  if (otherPanel) otherPanel.hidden = true;
} else {
  if (iosPanel) iosPanel.hidden = true;
  if (otherPanel) otherPanel.hidden = false;
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installButtons.forEach((button) => { button.hidden = false; });
  setStatus(t('The browser can install STREETO directly.'));
});

installButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    if (!deferredPrompt) {
      setStatus(t('Use the browser menu and choose "Install app" or "Add to Home screen".'));
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    if (choice?.outcome === 'accepted') showInstalled();
    else setStatus(t('Installation was cancelled. You can try again from the browser menu.'));
  });
});

window.addEventListener('appinstalled', showInstalled);
