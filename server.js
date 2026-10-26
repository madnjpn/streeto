import config from './src/config.js';
import { app } from './src/app.js';
import { migrate } from './src/db.js';
import { validateConfig } from './src/config.js';
import { startAutoBackup } from './src/lib/backup.js';
import { startPtiRefresh } from './src/lib/pti-refresh.js';
import { startGarageAlerts } from './src/lib/garage-alerts.js';
import { startMailJobs } from './src/lib/mail-jobs.js';
import * as presence from './src/lib/presence.js';import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';

const { maplibre } = validateConfig();

// Apply any migrations that shipped since the last boot.
const fresh = migrate();
if (fresh.length) console.log(`[db] new migrations applied: ${fresh.join(', ')}`);

// Initialize config table for dynamic settings.
import { run } from './src/db.js';
run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);

// Snapshot the database every few hours so the admin always has a
// recent restore point. Set BACKUP_INTERVAL_MS=0 to switch it off.
if (config.backupIntervalMs > 0 && !config.isTest) {
  startAutoBackup();
}

// Keep every member's technical-inspection snapshot current. Adding a
// vehicle or build already checks pti.ge immediately; this daily sweep
// covers plates whose result has gone stale since (and lapsed inspections).
if (config.ptiLookup && !config.isTest) {
  startPtiRefresh();
}

// Fines and inspection alerts run every 12 hours. The fines lookup is a
// headless browser, so it starts a little later than the web server.
if (!config.isTest) {
  startGarageAlerts();
}

// The letters the site sends on its own: the inspection reminder and the
// weekly digest. Each one is only sent once, and a member can turn the
// digest off in their settings.
if (!config.isTest) {
  startMailJobs();
}

// Load SSL certificates. A Cloudflare Origin CA certificate (origin.pem)
// wins over the local self-signed one, because that is the certificate
// Cloudflare expects to see on the origin.
const certCandidates = [
  { name: 'Cloudflare Origin CA', cert: 'origin.pem', key: 'origin-key.pem' },
  { name: 'local self-signed', cert: 'cert.pem', key: 'key.pem' },
];

let httpsOptions = null;
let certName = null;
for (const candidate of certCandidates) {
  const certPath = path.join(config.certDir, candidate.cert);
  const keyPath = path.join(config.certDir, candidate.key);
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    httpsOptions = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    certName = candidate.name;
    break;
  }
}

const useHttps = Boolean(httpsOptions);

// In production the session cookie is marked Secure, so a plain-HTTP origin
// would accept the login and then never send the cookie back - the user
// would be bounced back to the login page with no error anywhere. Fail loudly
// instead of serving a site that cannot be logged into.
if (config.isProd && !useHttps) {
  throw new Error(
    'No TLS certificate found. Put a Cloudflare Origin CA certificate in ' +
      'certs/origin.pem and its key in certs/origin-key.pem (or run ' +
      '"npm run cert" for a local self-signed pair), then start again.',
  );
}

// The HTTPS server, or a plain HTTP one when no certificate is available
// (Cloudflare can be set to "Flexible" and talk HTTP to the origin).
const httpsServer = useHttps
  ? createHttpsServer(httpsOptions, app)
  : createServer(app);

// Also create HTTP server for redirecting HTTP to HTTPS.
// The redirect target is the configured public host, never the Host header -
// a forged Host would turn this into an open redirect.
const httpServer = createServer((req, res) => {
  const publicHost = (() => {
    if (config.publicUrl) {
      try {
        return new URL(config.publicUrl).host;
      } catch {
        /* fall through */
      }
    }
    return `${config.host}:${config.port}`;
  })();
  const url = `https://${publicHost}${req.url}`;
  res.writeHead(301, { Location: url });
  res.end();
});

// Socket.IO for real-time chat. Sessions are shared with Express via the
// same cookie, so we can identify the user on connect.
const io = new Server(httpsServer, {
  cors: { origin: false },
  transports: ['websocket', 'polling'],
});

// expose io on app so routes can emit
app.set('io', io);

// Minimal auth: read the session cookie and look up the user. We re-use
// the express session store by importing it.
import session from 'express-session';
import { SqliteStore } from './src/lib/session-store.js';
const sessionMiddleware = session({
  name: 'streeto.sid',
  secret: config.sessionSecret,
  store: new SqliteStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
});

io.use((socket, next) => {
  const req = socket.request;
  sessionMiddleware(req, {}, () => {
    const userId = req.session?.userId || req.session?.passport?.user;
    // loadUser sets req.user; here we just store the session user id
    socket.data.userId = userId || null;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  if (!userId) return;
  socket.join(`user:${userId}`);
  // Track who is online so the friends list can show a live dot.
  presence.addOnline(userId);
  socket.on('typing', ({ conversationId, to }) => {
    if (to) socket.to(`user:${to}`).emit('typing', { conversationId, from: userId });
  });
  socket.on('disconnect', () => {
    presence.removeOnline(userId);
  });
});

const server = httpsServer.listen(config.port, config.host, () => {
  console.log('');
  console.log(`  ${config.siteName} - ${config.tagline}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  local:    ${useHttps ? 'https' : 'http'}://localhost:${config.port}`);
  if (config.publicUrl) console.log(`  public:   ${config.publicUrl}`);
  console.log(`  env:      ${config.env}`);
  console.log(`  tls:      ${useHttps ? certName : 'disabled (plain HTTP)'}`);
  console.log(`  proxy:    ${config.trustProxy ? 'trusting X-Forwarded-*' : 'direct'}`);
  console.log(`  database: ${config.dbPath}`);
  console.log(`  uploads:  ${config.uploadDir}`);
  console.log(`  backups:  ${config.backupDir} (every ${Math.round(config.backupIntervalMs / 3600000)}h)`);
  console.log(`  pti.ge:   ${config.ptiLookup ? `checks on save, sweep every ${Math.round(config.ptiScanHours)}h` : 'disabled'}`);
  console.log(`  maps:     ${maplibre ? 'MapLibre GL + OpenFreeMap (3D buildings, offline assets OK)' : 'MapLibre GL MISSING - run npm install'}`);
  console.log(`  realtime: Socket.IO enabled`);
  console.log('');
});

// The plain-HTTP listener only exists to bounce visitors to HTTPS. It is
// off by default and switched on with HTTP_PORT=80 in production.
const httpPort = config.httpPort || (config.isProd ? 80 : config.port === 443 ? 80 : config.port + 1);
if (httpPort !== config.port) {
  httpServer.listen(httpPort, config.host, () => {
    console.log(`  HTTP redirect: http://localhost:${httpPort} -> https://localhost:${config.port}`);
  });
} else {
  httpServer.close();
}

const shutdown = (signal) => () => {
  console.log(`\n[server] ${signal} received - closing.`);
  httpsServer.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));

export default server;