import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config, { ROOT } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

// WAL keeps reads fast while writes happen; busy_timeout avoids
// SQLITE_BUSY errors when two requests write at the same moment.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`);

/* ── tiny query helpers ─────────────────────────────────────────────
 * node:sqlite's prepared statements are synchronous and return plain
 * objects, which is exactly what the route handlers want.
 */

/** Run a statement, return { changes, lastInsertRowid }. */
export const run = (sql, ...params) => db.prepare(sql).run(...params);

/** Run a statement, return the first row or undefined. */
export const get = (sql, ...params) => db.prepare(sql).get(...params);

/** Run a statement, return every row. */
export const all = (sql, ...params) => db.prepare(sql).all(...params);

/** Run several statements inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* the transaction was already rolled back */
    }
    throw error;
  }
}

/** true/false helper - SQLite has no boolean type. */
export const exists = (sql, ...params) => Boolean(get(sql, ...params));

/**
 * SELECT COUNT(*) for a table with an optional WHERE clause.
 * The WHERE fragment is written by us, never by a user.
 */
export const count = (table, where = '1 = 1', ...params) =>
  get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...params)?.n ?? 0;

/* ── migrations ─────────────────────────────────────────────────────
 * Every .sql file in src/migrations is applied once, in filename
 * order, and recorded in the _migrations table.
 */
const migrationsDir = path.join(ROOT, 'src', 'migrations');

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const applied = new Set(all('SELECT id FROM _migrations').map((row) => row.id));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const fresh = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    try {
      tx(() => {
        db.exec(sql);
        run('INSERT INTO _migrations (id) VALUES (?)', file);
      });
      fresh.push(file);
    } catch (error) {
      // Another process may have applied the same migration a moment ago
      // (two servers started together). That is not an error - the schema
      // is what we wanted either way.
      if (get('SELECT id FROM _migrations WHERE id = ?', file)) continue;
      throw error;
    }
  }
  return fresh;
}

const applied = migrate();
if (applied.length) {
  console.log(`[db] applied migrations: ${applied.join(', ')}`);
}

export default db;
