const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/schema');
const { logAction } = require('../middleware/audit');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  const db = getDb();
  const orgs = db.prepare('SELECT * FROM organizations WHERE is_active = 1').all();
  res.renderWithLayout('auth/login', { user: null, error: null, orgs, selectedRole: req.query.role || '' });
});

router.post('/login', (req, res) => {
  const { username, password, role } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    const orgs = db.prepare('SELECT * FROM organizations WHERE is_active = 1').all();
    return res.renderWithLayout('auth/login', { user: null, error: 'Invalid credentials', orgs, selectedRole: role || '' });
  }

  if (role && user.role !== role) {
    const orgs = db.prepare('SELECT * FROM organizations WHERE is_active = 1').all();
    return res.renderWithLayout('auth/login', { user: null, error: `This account does not have the ${role} role. Please select the correct role.`, orgs, selectedRole: role });
  }

  const roleData = db.prepare('SELECT permissions FROM roles WHERE name = ?').get(user.role);
  const permissions = roleData ? JSON.parse(roleData.permissions) : [];

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    organization_id: user.organization_id,
    permissions
  };

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  logAction({
    userId: user.id,
    username: user.username,
    role: user.role,
    action: 'LOGIN',
    entityType: 'user',
    entityId: user.id,
    ip: req.ip
  });

  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  if (req.session.user) {
    logAction({
      userId: req.session.user.id,
      username: req.session.user.username,
      role: req.session.user.role,
      action: 'LOGOUT',
      entityType: 'user',
      entityId: req.session.user.id,
      ip: req.ip
    });
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

router.get('/switch-role/:role', (req, res) => {
  res.redirect('/dashboard');
});

module.exports = router;
