import { t } from './i18n.js';

const form = document.querySelector('[data-near-form]');
const button = document.querySelector('[data-near-locate]');
const status = document.querySelector('[data-near-status]');
const lat = document.querySelector('[data-near-lat]');
const lng = document.querySelector('[data-near-lng]');

if (form && button && lat && lng) {
  button.addEventListener('click', () => {
    if (!navigator.geolocation) {
      if (status) status.textContent = t('This browser does not support location.');
      return;
    }
    button.disabled = true;
    if (status) status.textContent = t('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        lat.value = String(position.coords.latitude.toFixed(6));
        lng.value = String(position.coords.longitude.toFixed(6));
        form.submit();
      },
      () => {
        button.disabled = false;
        if (status) status.textContent = t('Location permission was denied. You can search by city instead.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}
