/**
 * RockAuto Service Client
 *
 * A Node.js client for the RockAuto microservice.
 * Provides the same interface as the old rockauto.js but calls the Python service.
 */

const SERVICE_URL = process.env.ROCKAUTO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT = 20000; // 20 seconds

/**
 * Make a request to the RockAuto service.
 * @param {string} endpoint - API endpoint (e.g., '/makes', '/parts/...')
 * @param {object} params - Query parameters
 * @returns {Promise<any>} - Response data
 */
async function request(endpoint, params = {}) {
  const url = new URL(`${SERVICE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'accept': 'application/json',
        'user-agent': 'STREETO/1.0 (rockauto-service client)',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RockAuto service error ${res.status}: ${text}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('RockAuto service timeout');
    }
    throw error;
  }
}

/** Get all makes. */
export async function makes() {
  const data = await request('/makes');
  return data.makes || [];
}

/** Get years for a make. */
export async function years(make) {
  const data = await request(`/years/${encodeURIComponent(make.toUpperCase())}`);
  return data.years || [];
}

/** Get models for a make and year. */
export async function models(make, year) {
  const data = await request(`/models/${encodeURIComponent(make.toUpperCase())}/${year}`);
  return data.models || [];
}

/** Get engines for a vehicle. */
export async function engines(make, year, model) {
  const data = await request(`/engines/${encodeURIComponent(make.toUpperCase())}/${year}/${encodeURIComponent(model.toUpperCase())}`);
  return data.engines || [];
}

/** Get categories for a vehicle. */
export async function categories(make, year, model, engine) {
  const data = await request(
    `/categories/${encodeURIComponent(make.toUpperCase())}/${year}/${encodeURIComponent(model.toUpperCase())}/${encodeURIComponent(engine)}`
  );
  return data.categories || [];
}

/** Get parts for a vehicle and category. */
export async function parts({ make, year, model, engine, category, subcategory }) {
  const data = await request(
    `/parts/${encodeURIComponent(make.toUpperCase())}/${year}/${encodeURIComponent(model.toUpperCase())}/${encodeURIComponent(engine)}/${encodeURIComponent(category)}`,
    subcategory ? { subcategory } : {}
  );
  return data.parts || [];
}

/** Search parts by number, name, or keyword. */
export async function searchParts(query) {
  if (!query || !query.trim()) return [];
  const data = await request('/search', { q: query.trim() });
  return data.parts || [];
}

/** Health check. */
export async function healthCheck() {
  try {
    const data = await request('/health');
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/** Get service status. */
export async function getStatus() {
  try {
    return await request('/status');
  } catch {
    return { service: 'rockauto-service', auth: 'unknown', client_initialized: false };
  }
}

export default {
  makes,
  years,
  models,
  engines,
  categories,
  parts,
  searchParts,
  healthCheck,
  getStatus,
};