function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      return res.status(403).render('error', {
        user: req.session.user,
        message: 'You do not have permission to access this page',
        error: 'Forbidden'
      });
    }
    next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role === 'super_admin') return next();
    const userPermissions = req.session.user.permissions || [];
    if (userPermissions.includes('*') || userPermissions.includes(permission)) {
      return next();
    }
    return res.status(403).render('error', {
      user: req.session.user,
      message: 'You do not have the required permission',
      error: 'Forbidden'
    });
  };
}

function loadUserPermissions(req, res, next) {
  if (req.session.user) {
    const db = require('../database/schema').getDb();
    const role = db.prepare('SELECT permissions FROM roles WHERE name = ?').get(req.session.user.role);
    req.session.user.permissions = role ? JSON.parse(role.permissions) : [];
  }
  next();
}

module.exports = { requireAuth, requireRole, requirePermission, loadUserPermissions };
