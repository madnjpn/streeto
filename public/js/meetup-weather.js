/* ══════════════════════════════════════════════════════════════════
   STREETO — expected weather under a meetup map

   On the host form the strip follows the date, the category and the
   chosen spot. On a saved meetup it reads the data attributes the
   server wrote and asks once.

   A forecast is used when the date is near; otherwise the same day of
   a recent year is shown as "typical weather for this date".
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

const WEATHER = {
  0: ['Clear', '\u2600\uFE0F'],
  1: ['Mostly clear', '\uD83C\uDF24\uFE0F'],
  2: ['Partly cloudy', '\u26C5'],
  3: ['Overcast', '\u2601\uFE0F'],
  45: ['Fog', '\uD83C\uDF2B\uFE0F'],
  48: ['Fog', '\uD83C\uDF2B\uFE0F'],
  51: ['Drizzle', '\uD83C\uDF26\uFE0F'],
  53: ['Drizzle', '\uD83C\uDF26\uFE0F'],
  55: ['Drizzle', '\uD83C\uDF26\uFE0F'],
  56: ['Freezing drizzle', '\uD83C\uDF27\uFE0F'],
  57: ['Freezing drizzle', '\uD83C\uDF27\uFE0F'],
  61: ['Rain', '\uD83C\uDF27\uFE0F'],
  63: ['Rain', '\uD83C\uDF27\uFE0F'],
  65: ['Rain', '\uD83C\uDF27\uFE0F'],
  66: ['Freezing rain', '\uD83C\uDF27\uFE0F'],
  67: ['Freezing rain', '\uD83C\uDF27\uFE0F'],
  71: ['Snow', '\uD83C\uDF28\uFE0F'],
  73: ['Snow', '\uD83C\uDF28\uFE0F'],
  75: ['Snow', '\uD83C\uDF28\uFE0F'],
  77: ['Snow grains', '\uD83C\uDF28\uFE0F'],
  80: ['Showers', '\uD83C\uDF26\uFE0F'],
  81: ['Showers', '\uD83C\uDF26\uFE0F'],
  82: ['Showers', '\uD83C\uDF27\uFE0F'],
  85: ['Snow showers', '\uD83C\uDF28\uFE0F'],
  86: ['Snow showers', '\uD83C\uDF28\uFE0F'],
  95: ['Thunderstorm', '\u26C8\uFE0F'],
  96: ['Thunderstorm with hail', '\u26C8\uFE0F'],
  99: ['Thunderstorm with hail', '\u26C8\uFE0F'],
};

const cache = new Map();
const pending = new Map();

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function render(host, data) {
  host.replaceChildren();
  if (!data || !data.ok) {
    host.hidden = true;
    return;
  }

  const [label, icon] = WEATHER[data.code] || ['', '\uD83C\uDF21\uFE0F'];
  const parts = [];
  if (label) parts.push(t(label));
  if (data.precip != null && data.precip !== '') {
    parts.push(data.precipUnit === '%'
      ? t('{n}% rain', { n: data.precip })
      : t('{n} mm rain', { n: data.precip }));
  }

  const badge = el('span', 'meetupweather__icon', icon);
  badge.setAttribute('aria-hidden', 'true');

  const body = el('div', 'meetupweather__body');
  const temps = (data.max != null && data.min != null) ? `${data.max}\u00B0 / ${data.min}\u00B0` : '';
  body.appendChild(el('strong', 'meetupweather__temp', temps || t('Expected weather')));
  body.appendChild(el('span', 'meetupweather__desc', parts.join(' \u00B7 ')));

  const note = el('span', 'meetupweather__note muted', t('Forecast for this date'));

  host.append(badge, body, note);
  host.hidden = false;
}

async function load(host, lat, lng, at) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)},${String(at).slice(0, 10)}`;
  if (cache.has(key)) {
    render(host, cache.get(key));
    return;
  }

  // The form may show two hosts (the badge in the map and the strip
  // below it) - they share one request.
  let request = pending.get(key);
  if (!request) {
    request = (async () => {
      try {
        const res = await fetch(
          `/api/weather?lat=${lat}&lng=${lng}&at=${encodeURIComponent(at)}`,
          { credentials: 'same-origin', headers: { 'x-requested-with': 'fetch' } },
        );
        return await res.json();
      } catch {
        return { ok: false };
      }
    })();
    pending.set(key, request);
    request.finally(() => pending.delete(key));
  }

  const data = await request;
  cache.set(key, data);
  render(host, data);
}

const num = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

function setupForm(host) {
  const form = host.closest('form');
  if (!form) return;

  const startsAt = form.querySelector('[name="starts_at"]');
  const category = form.querySelector('[name="category"]');
  const latField = form.querySelector('[name="lat"]');
  const lngField = form.querySelector('[name="lng"]');
  const routeLatField = form.querySelector('[name="route_start_lat"]');
  const routeLngField = form.querySelector('[name="route_start_lng"]');
  const routeEndLatField = form.querySelector('[name="route_end_lat"]');
  const routeEndLngField = form.querySelector('[name="route_end_lng"]');

  let timer = 0;
  let request = 0;

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const at = String(startsAt?.value ?? '').trim();
      if (!at) {
        host.hidden = true;
        return;
      }

      // Touge: the weather is for the start of the run. When only the
      // finish is set, use that.
      const isTouge = category?.value === 'touge';
      let lat = null;
      let lng = null;
      if (isTouge) {
        lat = num(routeLatField?.value) ?? num(routeEndLatField?.value);
        lng = num(routeLngField?.value) ?? num(routeEndLngField?.value);
      } else {
        lat = num(latField?.value);
        lng = num(lngField?.value);
      }
      if (lat === null || lng === null) {
        host.hidden = true;
        return;
      }

      const mine = ++request;
      await load(host, lat, lng, at);
      if (mine !== request) return; // a newer choice won
    }, 450);
  };

  startsAt?.addEventListener('change', refresh);
  startsAt?.addEventListener('input', refresh);
  category?.addEventListener('change', refresh);
  form.addEventListener('streeto:pin', refresh);
  form.addEventListener('streeto:route', refresh);
  refresh();
}

function setupFixed(host) {
  const lat = num(host.dataset.lat);
  const lng = num(host.dataset.lng);
  const at = String(host.dataset.at ?? '').trim();
  if (lat === null || lng === null || !at) return;
  load(host, lat, lng, at);
}

document.querySelectorAll('[data-meetup-weather]').forEach((host) => {
  if (host.hasAttribute('data-form-weather')) setupForm(host);
  else setupFixed(host);
});
