const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'pdm.db');
let db;

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// Compatibility wrapper so existing code using better-sqlite3 API continues to work
function wrap(db) {
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    const origRun = stmt.run.bind(stmt);
    const origGet = stmt.get.bind(stmt);
    const origAll = stmt.all.bind(stmt);
    stmt.run = (...args) => {
      // if called with array as first arg (better-sqlite3 style), spread it
      if (args.length === 1 && Array.isArray(args[0])) return origRun(...args[0]);
      return origRun(...args);
    };
    stmt.get = (...args) => {
      if (args.length === 1 && Array.isArray(args[0])) return origGet(...args[0]);
      return origGet(...args);
    };
    stmt.all = (...args) => {
      if (args.length === 1 && Array.isArray(args[0])) return origAll(...args[0]);
      return origAll(...args);
    };
    return stmt;
  };
  return db;
}

function initDb() {
  const raw = new DatabaseSync(DB_PATH);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  db = wrap(raw);

  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('vendor','utility')),
      address TEXT,
      phone TEXT,
      email TEXT,
      logo_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      permissions TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK(role IN ('foreman','arborist','billing','detail_admin','super_admin')),
      organization_id INTEGER REFERENCES organizations(id),
      is_active INTEGER DEFAULT 1,
      last_login DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_number TEXT NOT NULL UNIQUE,
      work_order_number TEXT,
      name TEXT NOT NULL,
      description TEXT,
      organization_id INTEGER REFERENCES organizations(id),
      location TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS police_detail_slips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slip_number TEXT NOT NULL UNIQUE,
      project_id INTEGER REFERENCES projects(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','non_billable','changes_requested','invoiced','paid','archived')),
      foreman_id INTEGER REFERENCES users(id),
      arborist_id INTEGER REFERENCES users(id),
      officer_name TEXT NOT NULL,
      officer_badge TEXT,
      officer_department TEXT,
      shift_start DATETIME NOT NULL,
      shift_end DATETIME NOT NULL,
      total_hours REAL NOT NULL,
      rate_per_hour REAL DEFAULT 85.00,
      location_details TEXT,
      crew_info TEXT,
      notes TEXT,
      non_billable_reason TEXT,
      change_request_notes TEXT,
      rejection_reason TEXT,
      submitted_at DATETIME,
      reviewed_at DATETIME,
      reviewer_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS slip_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slip_id INTEGER NOT NULL REFERENCES police_detail_slips(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      filetype TEXT,
      filesize INTEGER,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS slip_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slip_id INTEGER NOT NULL REFERENCES police_detail_slips(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id),
      changed_by_role TEXT,
      comments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      slip_id INTEGER NOT NULL REFERENCES police_detail_slips(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','under_review','reconciled','disputed','paid','archived')),
      billing_team_id INTEGER REFERENCES users(id),
      subtotal REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,
      payment_terms TEXT,
      notes TEXT,
      reconciled_at DATETIME,
      reconciled_by INTEGER REFERENCES users(id),
      reconciliation_notes TEXT,
      paid_at DATETIME,
      paid_by INTEGER REFERENCES users(id),
      payment_reference TEXT,
      payment_comments TEXT,
      archived_at DATETIME,
      archived_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_slips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      slip_id INTEGER NOT NULL REFERENCES police_detail_slips(id),
      UNIQUE(invoice_id, slip_id)
    );
    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      hours REAL NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      amount REAL NOT NULL,
      payment_date DATETIME NOT NULL,
      reference_number TEXT,
      payment_method TEXT,
      received_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      changed_by INTEGER REFERENCES users(id),
      changed_by_role TEXT,
      comments TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      before_state TEXT,
      after_state TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('slip_submitted','slip_approved','slip_rejected','slip_changes_requested','slip_non_billable','invoice_created','invoice_reconciled','invoice_paid','invoice_disputed','user_created','role_updated','payment_received','general')),
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_slips_status ON police_detail_slips(status);
    CREATE INDEX IF NOT EXISTS idx_slips_foreman ON police_detail_slips(foreman_id);
    CREATE INDEX IF NOT EXISTS idx_slips_project ON police_detail_slips(project_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_slip ON invoices(slip_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_slip_status_history_slip ON slip_status_history(slip_id);
    CREATE INDEX IF NOT EXISTS idx_slip_status_history_created ON slip_status_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_status_history_invoice ON invoice_status_history(invoice_id);
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at DATETIME
    );
  `);

  console.log('Database initialized successfully');
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { initDb, getDb, closeDb };
