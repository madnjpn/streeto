import fs from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import config from '../config.js';
import * as devices from '../models/devices.js';

/**
 * Firebase Cloud Messaging for the Android shell.
 *
 * The service-account JSON is a server secret. It is read from
 * FIREBASE_SERVICE_ACCOUNT (raw JSON or base64) or from the file at
 * FIREBASE_SERVICE_ACCOUNT_PATH (default: firebase-service-account.json,
 * git-ignored). Without it the app still works; only FCM is disabled.
 */
let initialized = false;
let messaging = null;

function loadAccount() {
  const raw = String(config.firebaseServiceAccount || '').trim();
  if (raw) {
    try {
      if (raw.startsWith('{')) return JSON.parse(raw);
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (error) {
      console.warn('[fcm] FIREBASE_SERVICE_ACCOUNT is not valid JSON/base64:', error.message);
      return null;
    }
  }

  try {
    if (!fs.existsSync(config.firebaseServiceAccountPath)) return null;
    return JSON.parse(fs.readFileSync(config.firebaseServiceAccountPath, 'utf8'));
  } catch (error) {
    console.warn('[fcm] could not read the service account:', error.message);
    return null;
  }
}

function ensureMessaging() {
  if (initialized) return messaging;
  initialized = true;
  const account = loadAccount();
  if (!account) {
    console.warn('[fcm] disabled - no Firebase service account configured');
    return null;
  }
  try {
    if (!getApps().length) initializeApp({ credential: cert(account) });
    messaging = getMessaging();
    console.log('[fcm] ready');
  } catch (error) {
    console.warn('[fcm] could not initialize:', error.message);
    messaging = null;
  }
  return messaging;
}

const badToken = (error) =>
  [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
  ].includes(error?.code);

/** Send a data-only FCM message to every Android installation of a user. */
export async function sendToUser(userId, payload = {}) {
  const service = ensureMessaging();
  if (!service) return;

  const tokens = devices.forUser(userId).map((row) => row.token).filter(Boolean);
  if (!tokens.length) return;

  const data = {
    title: String(payload.title || 'STREETO').slice(0, 200),
    body: String(payload.body || '').slice(0, 500),
    url: String(payload.url || '/notifications').slice(0, 500),
    tag: String(payload.tag || 'streeto').slice(0, 100),
  };

  try {
    const result = await service.sendEachForMulticast({
      tokens,
      data,
      android: {
        priority: 'high',
        ttl: 60 * 60 * 1000,
      },
    });
    const stale = [];
    result.responses.forEach((response, index) => {
      if (!response.success && badToken(response.error)) stale.push(tokens[index]);
    });
    if (stale.length) devices.removeMany(stale);
  } catch (error) {
    /* A failed push must never fail the request that caused it. */
    console.warn('[fcm] send failed:', error.message);
  }
}

export const ready = () => Boolean(ensureMessaging());

export default { sendToUser, ready };
