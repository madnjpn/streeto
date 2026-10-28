/**
 * Service wrapper for the live server.
 *
 * The scheduled task / systemd unit / launchd agent starts this file. It
 * keeps stdout and stderr in data/logs/server.log so the desktop control
 * panel can show what happened, while the real server keeps running as
 * the same process.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG_DIR = process.env.STREETO_LOG_DIR
  ? path.resolve(ROOT, process.env.STREETO_LOG_DIR)
  : path.join(ROOT, 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const MAX_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(LOG_DIR, { recursive: true });
try {
  if (fs.statSync(LOG_FILE).size > MAX_BYTES) {
    fs.rmSync(`${LOG_FILE}.1`, { force: true });
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  }
} catch {
  /* first start or no permission to rotate - appending is still fine */
}

const log = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const out = process.stdout.write.bind(process.stdout);
const err = process.stderr.write.bind(process.stderr);

const write = (stream) => (chunk, encoding, callback) => {
  const enc = typeof encoding === 'string' ? encoding : undefined;
  const cb = typeof encoding === 'function' ? encoding : callback;
  try {
    stream.write(chunk, enc);
  } catch {
    /* a full disk must not take the app down */
  }
  // In a foreground debugging run, keep the terminal useful too.
  if (!process.env.STREETO_SERVICE && process.stdout.isTTY) {
    try { out(chunk, enc); } catch { /* ignore */ }
  }
  if (typeof cb === 'function') cb();
  return true;
};

process.stdout.write = write(log);
process.stderr.write = write(log);

console.log(`--- STREETO started ${new Date().toISOString()} (pid ${process.pid}) ---`);

try {
  await import('../server.js');
} catch (error) {
  console.error('[service] server failed to start:', error?.stack || error);
  process.exitCode = 1;
}

process.on('exit', () => {
  console.log(`--- STREETO stopped ${new Date().toISOString()} (pid ${process.pid}) ---`);
  try { log.end(); } catch { /* already closed */ }
});
