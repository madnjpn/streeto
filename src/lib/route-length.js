const EARTH_KM = 6371;
const ROAD_FACTOR = 1.25; // roads are longer than straight line
const OSRM_BASE = process.env.ROUTE_API || 'https://router.project-osrm.org/route/v1/driving';

/** The great-circle distance between two points, in kilometres. */
export function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ask the routing engine for the driving route between two points. */
async function osrmRoute(start, end, overview) {
  const url = `${OSRM_BASE}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=${overview}&alternatives=false&steps=false&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`routing error ${res.status}`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error('no route');
    return route;
  } finally {
    clearTimeout(timer);
  }
}

/** The road distance between two points, in kilometres. */
export async function routeDistanceKm(start, end) {
  const straight = haversineKm(start.lat, start.lng, end.lat, end.lng);
  try {
    const route = await osrmRoute(start, end, 'false');
    if (!Number.isFinite(route.distance)) throw new Error('no distance');
    return { km: route.distance / 1000, source: 'road' };
  } catch {
    return { km: straight * ROAD_FACTOR, source: 'straight' };
  }
}

/**
 * The road geometry between two points, as GeoJSON coordinates
 * ([lng, lat] pairs). Falls back to a straight line when the routing
 * engine is unreachable, so the map always has something to draw.
 */
export async function routeGeometry(start, end) {
  const straight = {
    coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
    source: 'straight',
  };
  try {
    const route = await osrmRoute(start, end, 'full');
    const coordinates = route.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('no geometry');
    return { coordinates, km: route.distance / 1000, source: 'road' };
  } catch {
    return {
      ...straight,
      km: haversineKm(start.lat, start.lng, end.lat, end.lng) * ROAD_FACTOR,
    };
  }
}

const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';
const OPEN_TOPO_API = 'https://api.opentopodata.org/v1/srtm90m';
const ELEVATION_MAX_POINTS = 100;

/** Pick at most `max` points, evenly spread, keeping both ends. */
function samplePoints(coordinates, max) {
  if (coordinates.length <= max) return coordinates;
  const step = (coordinates.length - 1) / (max - 1);
  const picked = [];
  for (let i = 0; i < max; i += 1) {
    picked.push(coordinates[Math.round(i * step)]);
  }
  return picked;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The height at each sampled point. OpenTopoData is asked first (it
 * has its own quota); Open-Meteo is the fallback when it is busy.
 */
async function elevationsFor(coordinates) {
  try {
    const locations = coordinates.map(([lng, lat]) => `${lat},${lng}`).join('|');
    const data = await fetchJson(`${OPEN_TOPO_API}?locations=${locations}`, 10000);
    const results = data?.results;
    if (Array.isArray(results) && results.length === coordinates.length
        && results.every((row) => Number.isFinite(row?.elevation))) {
      return results.map((row) => row.elevation);
    }
    throw new Error('opentopodata answer incomplete');
  } catch {
    const lats = coordinates.map((point) => point[1]).join(',');
    const lngs = coordinates.map((point) => point[0]).join(',');
    const data = await fetchJson(`${ELEVATION_API}?latitude=${lats}&longitude=${lngs}`);
    if (!Array.isArray(data.elevation) || data.elevation.length !== coordinates.length) {
      throw new Error('no elevations');
    }
    return data.elevation.map((value) => (Number.isFinite(value) ? value : 0));
  }
}

/**
 * The route with its elevations: the sampled road line, the height at
 * each point, and the climb/descent totals. When the elevation service
 * is unreachable the route is still returned, without a profile.
 */
export async function routeProfile(start, end) {
  const route = await routeGeometry(start, end);
  const coordinates = samplePoints(route.coordinates, ELEVATION_MAX_POINTS);

  let elevations = null;
  try {
    elevations = await elevationsFor(coordinates);
  } catch {
    elevations = null;
  }

  if (!elevations) {
    return { ...route, coordinates, elevations: null, gain: null, loss: null, min: null, max: null };
  }

  let gain = 0;
  let loss = 0;
  for (let i = 1; i < elevations.length; i += 1) {
    const delta = elevations[i] - elevations[i - 1];
    if (delta > 0) gain += delta;
    else loss -= delta;
  }

  return {
    ...route,
    coordinates,
    elevations,
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: Math.round(Math.min(...elevations)),
    max: Math.round(Math.max(...elevations)),
  };
}

export default { haversineKm, routeDistanceKm, routeGeometry, routeProfile };
