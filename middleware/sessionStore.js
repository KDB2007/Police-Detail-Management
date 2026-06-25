const { getDb } = require('../database/schema');

class SQLiteSessionStore extends require('express-session').Store {
  constructor() {
    super();
    this.cleanup();
  }

  cleanup() {
    const db = getDb();
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  }

  get(sid, cb) {
    const db = getDb();
    try {
      const row = db.prepare("SELECT data FROM sessions WHERE sid = ? AND (expires_at IS NULL OR expires_at > datetime('now'))").get(sid);
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }

  set(sid, session, cb) {
    const db = getDb();
    try {
      const data = JSON.stringify(session);
      const maxAge = session.cookie && session.cookie.maxAge;
      const expiresAt = maxAge ? new Date(Date.now() + maxAge).toISOString() : null;
      db.prepare("INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)").run(sid, data, expiresAt);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    const db = getDb();
    try {
      db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  touch(sid, session, cb) {
    const db = getDb();
    try {
      const maxAge = session.cookie && session.cookie.maxAge;
      const expiresAt = maxAge ? new Date(Date.now() + maxAge).toISOString() : null;
      db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }
}

module.exports = SQLiteSessionStore;
