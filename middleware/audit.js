function createAuditLog({ userId, username, role, action, entityType, entityId, beforeState, afterState, ipAddress }) {
  const db = require('../database/schema').getDb();
  const stmt = db.prepare(`INSERT INTO audit_logs (user_id, username, role, action, entity_type, entity_id, before_state, after_state, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  stmt.run(userId, username, role, action, entityType, entityId,
    beforeState ? JSON.stringify(beforeState) : null,
    afterState ? JSON.stringify(afterState) : null,
    ipAddress);
}

function auditMiddleware(action, entityType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    const originalRender = res.render.bind(res);
    const originalRedirect = res.redirect.bind(res);

    res.json = function (body) {
      if (res.statusCode < 400 && req.method !== 'GET') {
        const afterState = body?.data || body;
        createAuditLog({
          userId: req.session.user?.id,
          username: req.session.user?.username,
          role: req.session.user?.role,
          action,
          entityType,
          entityId: body?.id || body?.data?.id || req.params.id,
          afterState,
          ipAddress: req.ip
        });
      }
      return originalJson(body);
    };

    res.redirect = function (url) {
      if (req.method !== 'GET' && res.statusCode < 400) {
        createAuditLog({
          userId: req.session.user?.id,
          username: req.session.user?.username,
          role: req.session.user?.role,
          action,
          entityType,
          entityId: req.params.id,
          ipAddress: req.ip
        });
      }
      return originalRedirect(url);
    };

    next();
  };
}

function logAction({ userId, username, role, action, entityType, entityId, beforeState, afterState, ip }) {
  createAuditLog({ userId, username, role, action, entityType, entityId, beforeState, afterState, ipAddress: ip });
}

module.exports = { auditMiddleware, logAction, createAuditLog };
