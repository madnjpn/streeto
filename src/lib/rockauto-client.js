/**
 * Toggle between built-in RockAuto client and external service.
 *
 * Set ROCKAUTO_SERVICE_URL in .env to use the external service.
 * Leave unset to use the built-in Node.js client (rockauto.js).
 */

import { config } from '../config.js';

const USE_SERVICE = Boolean(process.env.ROCKAUTO_SERVICE_URL);
const SERVICE_URL = process.env.ROCKAUTO_SERVICE_URL || 'http://localhost:8001';
const TIMEOUT = 20000; // 20 seconds

let client = null;

async function loadBuiltinClient() {
  const mod = await import('./rockauto.js');
  return mod.default;
}

async function loadServiceClient() {
  const mod = await import('./rockauto-service.js');
  return mod.default;
}

async function initClient() {
  if (USE_SERVICE) {
    try {
      client = await loadServiceClient();
      // Test the service
      await client.healthCheck();
      console.log('[rockauto] Using external service at', SERVICE_URL);
      return;
    } catch (err) {
      console.warn('[rockauto] External service unavailable, falling back to built-in client:', err.message);
    }
  }
  // Fallback to built-in
  client = await loadBuiltinClient();
  console.log('[rockauto] Using built-in client');
}

// Initialize immediately
initClient().catch((err) => {
  console.error('[rockauto] Failed to initialize client:', err);
});

/** Get the active RockAuto client. */
export async function getClient() {
  if (!client) {
    await initClient();
  }
  return client;
}

/** Check if using external service. */
export function isUsingService() {
  return USE_SERVICE;
}

/** Get service URL if using service. */
export function getServiceUrl() {
  return USE_SERVICE ? SERVICE_URL : null;
}

export default {
  getClient,
  isUsingService,
  getServiceUrl,
};