/**
 * Street-name search and reverse geocoding.
 *
 * Uses OpenStreetMap's Nominatim, which is free and needs no API key.
 * Their usage policy requires a descriptive User-Agent, at most one
 * request per second and caching - all handled here. If the machine is
 * offline the calls simply fail and the UI falls back to "drop the pin
 * and type the street name yourself".
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org';
const UA = 'STREETO/0.1 (car enthusiast community app; self-hosted demo)';

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes
const MIN_INTERVAL = 1100; // Nominatim asks for <= 1 request/second

let queueTail = Promise.resolve();
let lastCall = 0;

/** Serialise outbound calls and keep them at least MIN_INTERVAL apart. */
function schedule(task) {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, lastCall + MIN_INTERVAL - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return task();
  });
  // Keep the chain alive even when a task rejects.
  queueTail = run.catch(() => {});
  return run;
}

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key, value) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

async function call(url, key) {
  const hit = cached(key);
  if (hit) return hit;

  const value = await schedule(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  remember(key, value);
  return value;
}

/** Search a street name, venue or city. Returns a normalised list. */
export async function searchPlaces(query, { limit = 6 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 3) return [];

  const url =
    `${ENDPOINT}/search?format=jsonv2&addressdetails=1&limit=${Math.min(limit, 10)}` +
    `&q=${encodeURIComponent(q)}`;
  const rows = await call(url, `s:${q.toLowerCase()}:${limit}`);

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    name: row.name || String(row.display_name || '').split(',')[0],
    label: row.display_name,
    lat: Number(row.lat),
    lng: Number(row.lon),
    type: row.type,
    category: row.category,
  }));
}

/** Turn GPS coordinates into a street address. */
export async function reverseGeocode(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const url = `${ENDPOINT}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${la}&lon=${ln}`;
  const row = await call(url, `r:${la.toFixed(5)},${ln.toFixed(5)}`);
  if (!row || !row.display_name) return null;

  const address = row.address || {};
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  return {
    name: row.name || street || String(row.display_name).split(',')[0],
    label: row.display_name,
    lat: la,
    lng: ln,
  };
}

export default { searchPlaces, reverseGeocode };
