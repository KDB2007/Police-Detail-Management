const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/schema');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { notifyUserCreated, notifyRoleUpdated } = require('../services/notification');

const router = express.Router();

function getUnreadCount(userId) {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;
}

router.get('/users', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT u.*, o.name as org_name FROM users u LEFT JOIN organizations o ON u.organization_id = o.id ORDER BY u.created_at DESC`).all();
  const roles = db.prepare('SELECT * FROM roles').all();
  const orgs = db.prepare('SELECT * FROM organizations WHERE is_active = 1').all();
  res.renderWithLayout('admin/users', { user: req.session.user, users, roles, orgs, unreadNotifCount: getUnreadCount(req.session.user.id) });
});

router.post('/users/create', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const { username, email, password, full_name, phone, role, organization_id } = req.body;

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    return res.status(400).json({ error: 'Username or email already exists' });
  }

  const hash = bcrypt.hashSync(password || 'password123', 10);
  const result = db.prepare('INSERT INTO users (username, email, password_hash, full_name, phone, role, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    username, email, hash, full_name, phone, role, organization_id || null
  );

  notifyUserCreated(result.lastInsertRowid);

  logAction({ userId: req.session.user.id, username: req.session.user.username, role: req.session.user.role, action: 'CREATE_USER', entityType: 'user', entityId: result.lastInsertRowid, afterState: { username, role }, ip: req.ip });

  res.redirect('/admin/users');
});

router.post('/users/edit/:id', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const { full_name, email, phone, role, organization_id, is_active } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const oldRole = user.role;
  db.prepare('UPDATE users SET full_name=?, email=?, phone=?, role=?, organization_id=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    full_name, email, phone, role, organization_id || null, is_active ? 1 : 0, user.id
  );

  if (oldRole !== role) {
    notifyRoleUpdated(user.id);
  }

  logAction({ userId: req.session.user.id, username: req.session.user.username, role: req.session.user.role, action: 'EDIT_USER', entityType: 'user', entityId: user.id, beforeState: { role: oldRole }, afterState: { role }, ip: req.ip });

  res.redirect('/admin/users');
});

router.get('/organizations', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const orgs = db.prepare('SELECT * FROM organizations ORDER BY name ASC').all();
  res.renderWithLayout('admin/organizations', { user: req.session.user, orgs, unreadNotifCount: getUnreadCount(req.session.user.id) });
});

router.post('/organizations/create', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const { name, type, address, phone, email } = req.body;
  db.prepare('INSERT INTO organizations (name, type, address, phone, email) VALUES (?, ?, ?, ?, ?)').run(name, type, address, phone, email);

  logAction({ userId: req.session.user.id, username: req.session.user.username, role: req.session.user.role, action: 'CREATE_ORG', entityType: 'organization', afterState: { name, type }, ip: req.ip });

  res.redirect('/admin/organizations');
});

router.post('/organizations/edit/:id', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const { name, type, address, phone, email, is_active } = req.body;
  db.prepare('UPDATE organizations SET name=?, type=?, address=?, phone=?, email=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    name, type, address, phone, email, is_active ? 1 : 0, req.params.id
  );
  res.redirect('/admin/organizations');
});

router.get('/audit', requireAuth, requireRole('detail_admin', 'super_admin'), (req, res) => {
  const db = getDb();
  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (req.query.action) { query += ' AND action = ?'; params.push(req.query.action); }
  if (req.query.entity_type) { query += ' AND entity_type = ?'; params.push(req.query.entity_type); }
  if (req.query.user_id) { query += ' AND user_id = ?'; params.push(req.query.user_id); }
  if (req.query.date_from) { query += ' AND created_at >= ?'; params.push(req.query.date_from); }
  if (req.query.date_to) { query += ' AND created_at <= ?'; params.push(req.query.date_to); }

  query += ' ORDER BY created_at DESC LIMIT 200';
  const logs = db.prepare(query).all(...params);
  res.renderWithLayout('admin/audit', { user: req.session.user, logs, query: req.query, unreadNotifCount: getUnreadCount(req.session.user.id) });
});

router.get('/settings', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const roles = db.prepare('SELECT * FROM roles').all();
  res.renderWithLayout('admin/settings', { user: req.session.user, roles, unreadNotifCount: getUnreadCount(req.session.user.id) });
});

router.post('/settings/roles/:id', requireAuth, requireRole('super_admin'), (req, res) => {
  const db = getDb();
  const { permissions } = req.body;
  const perms = Array.isArray(permissions) ? permissions : [permissions].filter(Boolean);
  db.prepare('UPDATE roles SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(perms), req.params.id);
  res.redirect('/admin/settings');
});

module.exports = router;
