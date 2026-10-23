import session from 'express-session';
import { db } from '../db.js';
import config from '../config.js';

const Store = session.Store;

/**
 * express-session store backed by the same SQLite database as the app.
 * Keeping sessions in SQLite means logins survive a server restart and
 * no extra service (Redis etc.) is required.
 */
export class SqliteStore extends Store {
  constructor({ ttlMs = config.sessionMaxAgeMs, cleanupIntervalMs = 1000 * 60 * 15 } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.stmts = {
      get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      upsert: db.prepare(
        `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`,
      ),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      all: db.prepare('SELECT sid, data FROM sessions WHERE expires > ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?'),
      clear: db.prepare('DELETE FROM sessions'),
      purge: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };

    this.purge();
    this.timer = setInterval(() => this.purge(), cleanupIntervalMs);
    // Don't hold the event loop open just for housekeeping.
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.on('disconnect', () => clearInterval(this.timer));
  }

  /** Remove expired rows. Cheap enough to run on a timer. */
  purge() {
    try {
      this.stmts.purge.run(Date.now());
    } catch (error) {
      console.error('[session] purge failed:', error.message);
    }
  }

  #expiry(record) {
    const value = record?.cookie?.expires;
    if (value) return new Date(value).getTime();
    return Date.now() + this.ttlMs;
  }

  get(sid, callback) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        this.stmts.destroy.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, record, callback) {
    try {
      this.stmts.upsert.run(sid, JSON.stringify(record), this.#expiry(record));
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, record, callback) {
    try {
      this.stmts.touch.run(this.#expiry(record), sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.stmts.destroy.run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  length(callback) {
    try {
      return callback(null, this.stmts.count.get(Date.now()).n);
    } catch (error) {
      return callback(error);
    }
  }

  clear(callback) {
    try {
      this.stmts.clear.run();
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  all(callback) {
    try {
      const rows = this.stmts.all.all(Date.now());
      return callback(null, rows.map((row) => JSON.parse(row.data)));
    } catch (error) {
      return callback(error);
    }
  }
}

export default SqliteStore;
