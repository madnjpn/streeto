import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the project root. */
export const ROOT = path.resolve(__dirname, '..');

const toBool = (value, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const toNum = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

// Load .env if present. Node ships this, so no dotenv dependency is needed.
// In production the live settings come from --env-file=.env.production, and
// the development file is deliberately NOT read, so it can never leak into
// the live site.
try {
  if (!isProd) process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* no .env file - fall back to defaults below */
}

export const config = {
  env,
  isProd,
  isTest,
  port: toNum(process.env.PORT, 3000),
  /** Plain-HTTP port. 0 disables it. In production this is where the
   *  "redirect to HTTPS" listener lives (usually 80). */
  httpPort: toNum(process.env.HTTP_PORT, 0),
  host: process.env.HOST || '0.0.0.0',
  siteName: process.env.SITE_NAME || 'STREETO',
  /** Public-facing tagline used in the UI and page titles. */
  tagline: 'Underground street racing network',

  /** The address the site is reached on, e.g. https://streeto.net.
   *  Used for absolute links and for the certificate's host name. */
  publicUrl: String(process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  /** Trust X-Forwarded-* headers. Turn this on when a proxy (Cloudflare,
   *  nginx, a tunnel) sits in front of the app, so req.ip is the real
   *  visitor and not the proxy. */
  trustProxy: toBool(process.env.TRUST_PROXY, isProd),

  sessionMaxAgeMs: toNum(process.env.SESSION_MAX_AGE_MS, 1000 * 60 * 60 * 24 * 30),
  sessionSecret: process.env.SESSION_SECRET || '',

  dbPath: path.resolve(ROOT, process.env.DB_PATH || 'data/streeto.db'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'uploads'),
  /** Public URL path that uploaded media is served from. */
  uploadUrl: process.env.UPLOAD_URL || '/uploads',

  /** Where the admin console keeps its database snapshots. */
  backupDir: path.resolve(ROOT, process.env.BACKUP_DIR || 'data/backups'),
  /** How often the server snapshots the database on its own (default 6h). */
  backupIntervalMs: toNum(process.env.BACKUP_INTERVAL_MS, 1000 * 60 * 60 * 6),
  /** How many automatic snapshots to keep before pruning the oldest. */
  backupKeep: toNum(process.env.BACKUP_KEEP, 24),

  maxUploadMb: toNum(process.env.MAX_UPLOAD_MB, 25),

  /** Whole lari one US dollar buys - the reference rate used to convert
   *  prices between GEL and USD. Override with USD_TO_GEL. */
  usdToGel: toNum(process.env.USD_TO_GEL, 2.7),

  /** Annual technical inspection lookup (pti.ge). Turn off for offline tests. */
  ptiLookup: toBool(process.env.PTI_LOOKUP, true),
  ptiBaseUrl: process.env.PTI_BASE_URL || 'https://pti.ge/',
  ptiTimeoutMs: toNum(process.env.PTI_TIMEOUT_MS, 4000),
  /** Owner pages refresh a stored result after this many hours. */
  ptiRefreshHours: toNum(process.env.PTI_REFRESH_HOURS, 24),
  /** Background sweep that refreshes every member's stale plates. */
  ptiScanHours: toNum(process.env.PTI_SCAN_HOURS, 24),

  /** Google Gemini API key for certificate OCR. Get from https://aistudio.google.com/apikey */
  geminiApiKey: process.env.GEMINI_API_KEY || '',


  /** Gemini model used for certificate OCR. */
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  /** How long we wait for a Gemini OCR reply (ms). */
  geminiTimeoutMs: toNum(process.env.GEMINI_TIMEOUT_MS, 60000),

  /** Firebase Cloud Messaging (Android). The service account JSON stays
   *  outside version control; the path is relative to the project root. */
  firebaseServiceAccountPath: path.resolve(
    ROOT,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'firebase-service-account.json',
  ),
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT || '',

  /** MapLibre GL is served straight out of node_modules so the map works
   *  offline. It draws the vector basemap with 3D buildings. */
  maplibreDir: path.resolve(ROOT, 'node_modules', 'maplibre-gl', 'dist'),

  /**
   * Mail. Password recovery goes out through one Gmail account over SMTP.
   * MAIL_PASS is a Google App Password, not the account password: Gmail
   * refuses the account password for SMTP since 2022.
   *   Google Account -> Security -> 2-Step Verification -> App passwords
   * With no password the reset form says so instead of promising a letter.
   */
  mail: {
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: toNum(process.env.MAIL_PORT, 465),
    secure: toBool(process.env.MAIL_SECURE, true),
    user: String(process.env.MAIL_USER || '').trim(),
    pass: String(process.env.MAIL_PASS || '').replace(/\s+/g, ''),
    from: process.env.MAIL_FROM || 'STREETO <streeto.official@gmail.com>',
    replyTo: process.env.MAIL_REPLY_TO || '',
    /** How long a reset link stays good, in minutes. */
    resetMinutes: toNum(process.env.MAIL_RESET_MINUTES, 60),
    /** Keep letters in data/mail-capture/ instead of sending them. */
    capture: toBool(process.env.MAIL_CAPTURE, false),
  },

  /** Web Push (VAPID) keys. Generated via `npx web-push generate-vapid-keys`. */
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@streeto.local',

  /** Certificate files for the HTTPS listener. A Cloudflare Origin CA
   *  certificate (certs/origin.pem) wins over the local self-signed one. */
  certDir: path.resolve(ROOT, process.env.CERT_DIR || 'certs'),
};

// Fail loudly rather than silently signing cookies with a guessable value.
if (!config.sessionSecret) {
  if (isProd) {
    throw new Error(
      'SESSION_SECRET is required when NODE_ENV=production. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  config.sessionSecret = 'streeto-dev-secret-do-not-use-in-production';
}

if (config.sessionSecret.length < 16) {
  throw new Error('SESSION_SECRET must be at least 16 characters long.');
}

export const validateConfig = () => ({
  maplibre: fs.existsSync(path.join(config.maplibreDir, 'maplibre-gl.js')),
});

export default config;
