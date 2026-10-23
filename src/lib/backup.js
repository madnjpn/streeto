import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { all, db, get } from '../db.js';

/**
 * Database snapshots for the admin console.
 *
 * A snapshot is a *complete, consistent* copy of the SQLite database
 * produced with `VACUUM INTO`, which works while the app keeps writing
 * (unlike copying the .db file, which would miss the write-ahead log).
 *
 * Restoring swaps the data back in place, table by table, inside one
 * transaction - no server restart, no file juggling. Sessions and the
 * migration ledger are deliberately left alone so the admin stays
 * logged in and the schema version is not rolled backwards.
 */

export const BACKUP_DIR = config.backupDir;

const SAFE_NAME = /^streeto-[0-9]{8}T[0-9]{6}\.[0-9]{3}Z(-auto)?\.db$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Tables a restore must not touch. */
const SKIP_TABLES = new Set(['sessions', '_migrations']);

export function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Fixed-width UTC stamp so filenames sort chronologically as strings. */
const stamp = () => new Date().toISOString().replace(/[-:]/g, '');

/** Quote a path for a SQL string literal. */
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** Resolve a backup name to an on-disk file, refusing anything unsafe. */
export function resolveBackup(name) {
  const base = path.basename(String(name ?? ''));
  if (!SAFE_NAME.test(base)) return null;
  const file = path.join(BACKUP_DIR, base);
  return fs.existsSync(file) ? file : null;
}

const describe = (name) => {
  const file = path.join(BACKUP_DIR, name);
  const stat = fs.statSync(file);
  return {
    name,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    auto: name.includes('-auto'),
  };
};

/** Every snapshot on disk, newest first. */
export function listBackups() {
  ensureDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => SAFE_NAME.test(name))
    .sort((a, b) => (a < b ? 1 : -1))
    .map(describe);
}

let busy = false;
export const isBusy = () => busy;

/** Write a snapshot. Throws if one is already running. */
export function createBackup({ auto = false } = {}) {
  if (busy) throw Object.assign(new Error('A backup is already running.'), { status: 409 });
  ensureDir();

  let name = `streeto-${stamp()}${auto ? '-auto' : ''}.db`;
  let file = path.join(BACKUP_DIR, name);
  // Two snapshots inside the same millisecond are vanishingly rare, but
  // VACUUM INTO refuses to overwrite, so nudge the name until it is free.
  let n = 1;
  while (fs.existsSync(file)) {
    name = `streeto-${stamp()}${auto ? '-auto' : ''}-${n}.db`;
    file = path.join(BACKUP_DIR, name);
    n += 1;
  }

  busy = true;
  try {
    db.exec(`VACUUM INTO ${sqlString(file)}`);
  } finally {
    busy = false;
  }

  const info = describe(name);
  if (auto) prune(config.backupKeep);
  return info;
}

/** Keep only the newest `keep` automatic snapshots. Manual ones are kept. */
export function prune(keep = config.backupKeep) {
  const autos = listBackups().filter((b) => b.auto);
  for (const stale of autos.slice(Math.max(keep, 1))) {
    try {
      fs.rmSync(path.join(BACKUP_DIR, stale.name), { force: true });
    } catch {
      /* a locked file will be retried on the next backup */
    }
  }
}

const columnsOf = (schema, table) =>
  all(`PRAGMA ${schema}.table_info("${table}")`).map((row) => row.name);

const copyableTables = () => {
  const rows = all(
    `SELECT name FROM main.sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  const backupNames = new Set(
    all(
      `SELECT name FROM restored.sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ).map((row) => row.name),
  );

  return rows
    .map((row) => row.name)
    .filter((name) => IDENT.test(name) && !SKIP_TABLES.has(name) && backupNames.has(name));
};

/**
 * Replace the live data with the contents of a snapshot.
 * Returns { tables, restored } - the number of tables copied.
 */
export function restoreBackup(name) {
  const file = resolveBackup(name);
  if (!file) throw Object.assign(new Error('Backup not found.'), { status: 404 });

  db.exec('PRAGMA foreign_keys = OFF');
  let restored = 0;
  try {
    db.exec(`ATTACH DATABASE ${sqlString(file)} AS restored`);
    const tables = copyableTables();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of tables) {
        const backupCols = new Set(columnsOf('restored', table));
        const cols = columnsOf('main', table).filter((col) => backupCols.has(col));
        if (!cols.length) continue;
        const list = cols.map((col) => `"${col}"`).join(', ');
        db.exec(`DELETE FROM main."${table}"`);
        db.exec(`INSERT INTO main."${table}" (${list}) SELECT ${list} FROM restored."${table}"`);
        restored += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw error;
    }
  } finally {
    try {
      db.exec('DETACH DATABASE restored');
    } catch {
      /* not attached */
    }
    db.exec('PRAGMA foreign_keys = ON');
  }

  const orphans = get('SELECT COUNT(*) AS n FROM pragma_foreign_key_check');
  if (orphans?.n) console.warn(`[backup] restore left ${orphans.n} foreign-key violations`);

  return { restored, tables: restored, name: path.basename(file) };
}

/** Delete one snapshot. */
export function removeBackup(name) {
  const file = resolveBackup(name);
  if (!file) throw Object.assign(new Error('Backup not found.'), { status: 404 });
  fs.rmSync(file, { force: true });
  return true;
}

/**
 * Snapshot the database on a timer. The first run happens one interval
 * after boot so `node --watch`, which restarts on every edit, does not
 * spray a snapshot per save.
 */
export function startAutoBackup({
  intervalMs = config.backupIntervalMs,
  onDone = null,
} = {}) {
  const tick = () => {
    try {
      const info = createBackup({ auto: true });
      console.log(`[backup] automatic snapshot ${info.name} (${info.size} bytes)`);
      onDone?.(info);
    } catch (error) {
      console.error('[backup] automatic snapshot failed:', error.message);
    }
  };

  // Take one straight away, so a server that is restarted more often than
  // the interval still leaves a snapshot behind.
  tick();

  const timer = setInterval(tick, Math.max(intervalMs, 60_000));
  timer.unref?.();
  return timer;
}

export default {
  BACKUP_DIR, ensureDir, resolveBackup, listBackups, createBackup, restoreBackup,
  removeBackup, prune, startAutoBackup, isBusy,
};
