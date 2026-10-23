/**
 * Check that this machine is ready to serve the site in production.
 *
 *   node scripts/prod-check.mjs
 *
 * It reads .env.production (the file the live server uses) and never changes
 * anything - it only reports what still has to be done.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env.production'));
} catch {
  /* no .env.production file - fall back to the development one */
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    /* neither file */
  }
}

const problems = [];
const notes = [];

const ok = (label) => console.log(`  ok    ${label}`);
const warn = (label) => { console.log(`  warn  ${label}`); notes.push(label); };
const bad = (label) => { console.log(`  FAIL  ${label}`); problems.push(label); };

/* ── environment ─────────────────────────────────────────────────── */
console.log('\nenvironment');
if (process.env.NODE_ENV === 'production') ok('NODE_ENV=production');
else bad('NODE_ENV is not "production" (set it in .env)');

const secret = process.env.SESSION_SECRET || '';
if (!secret) bad('SESSION_SECRET is not set');
else if (secret.length < 32) bad(`SESSION_SECRET is only ${secret.length} characters - use at least 32`);
else if (secret === 'streeto-dev-secret-do-not-use-in-production') bad('SESSION_SECRET is still the development default');
else ok(`SESSION_SECRET is set (${secret.length} characters)`);

const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
if (!publicUrl) bad('PUBLIC_URL is not set (e.g. https://streeto.net)');
else if (!/^https?:\/\//.test(publicUrl)) bad(`PUBLIC_URL must start with http:// or https:// (got "${publicUrl}")`);
else ok(`PUBLIC_URL = ${publicUrl}`);

const trust = String(process.env.TRUST_PROXY || '').toLowerCase();
if (['1', 'true', 'yes', 'on'].includes(trust)) ok('TRUST_PROXY is on (needed behind Cloudflare)');
else warn('TRUST_PROXY is off - rate limits would see the proxy IP, not the visitor');

/* ── ports ───────────────────────────────────────────────────────── */
console.log('\nports');
const port = Number(process.env.PORT || 3000);
const httpPort = Number(process.env.HTTP_PORT || 0);

const free = (p) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.once('listening', () => srv.close(() => resolve(true)));
  srv.listen(p, '0.0.0.0');
});

if (await free(port)) ok(`port ${port} is free`);
else bad(`port ${port} is already in use - is the server already running?`);

if (httpPort && httpPort !== port) {
  if (await free(httpPort)) ok(`port ${httpPort} (HTTP redirect) is free`);
  else bad(`port ${httpPort} is already in use`);
} else {
  warn('HTTP_PORT is not set - plain HTTP requests will not be redirected to HTTPS');
}

/* ── certificates ────────────────────────────────────────────────── */
console.log('\ncertificates');
const certDir = path.join(ROOT, process.env.CERT_DIR || 'certs');
const originCert = path.join(certDir, 'origin.pem');
const originKey = path.join(certDir, 'origin-key.pem');
const localCert = path.join(certDir, 'cert.pem');
const localKey = path.join(certDir, 'key.pem');

if (fs.existsSync(originCert) && fs.existsSync(originKey)) {
  ok('Cloudflare Origin CA certificate found (certs/origin.pem)');
} else if (fs.existsSync(localCert) && fs.existsSync(localKey)) {
  warn('only the local self-signed certificate is present - Cloudflare SSL mode must be "Full", not "Full (strict)"');
} else {
  bad('no certificate found - run "npm run cert" or install a Cloudflare Origin CA certificate');
}

/* ── storage ─────────────────────────────────────────────────────── */
console.log('\nstorage');
for (const [label, dir] of [
  ['data', path.join(ROOT, process.env.DB_PATH || 'data/streeto.db')],
  ['uploads', path.join(ROOT, process.env.UPLOAD_DIR || 'uploads')],
]) {
  const target = label === 'data' ? path.dirname(dir) : dir;
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.accessSync(target, fs.constants.W_OK);
    ok(`${label} directory is writable (${path.relative(ROOT, target)})`);
  } catch (err) {
    bad(`${label} directory is not writable: ${err.message}`);
  }
}

/* ── cloudflare ddns ─────────────────────────────────────────────── */
console.log('\ndynamic DNS');
const ddnsReady = ['CF_API_TOKEN', 'CF_ZONE_ID', 'CF_DNS_NAME']
  .filter((key) => process.env[key]);
if (ddnsReady.length === 3) ok('Cloudflare DDNS is configured (npm run ddns)');
else warn(`Cloudflare DDNS is not configured (missing: ${['CF_API_TOKEN', 'CF_ZONE_ID', 'CF_DNS_NAME'].filter((k) => !process.env[k]).join(', ')})`);

/* ── result ──────────────────────────────────────────────────────── */
console.log('');
if (problems.length) {
  console.log(`${problems.length} problem(s) must be fixed before going live:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Everything checks out.');
if (notes.length) {
  console.log('\nWorth a look:');
  for (const n of notes) console.log(`  - ${n}`);
}
process.exit(0);
