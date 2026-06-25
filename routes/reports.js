const express = require('express');
const { getDb } = require('../database/schema');
const { requireAuth } = require('../middleware/auth');
const { exportSlipsToPDF, exportSlipsToExcel, exportSlipsToCSV, exportInvoicesToExcel } = require('../services/reportExport');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const projects = db.prepare('SELECT * FROM projects ORDER BY name').all();
  const foremen = db.prepare("SELECT id, full_name FROM users WHERE role = 'foreman' AND is_active = 1").all();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  res.renderWithLayout('reports/index', { user, projects, foremen, unreadNotifCount });
});

router.get('/slips/pdf', requireAuth, (req, res) => {
  exportSlipsToPDF(res, req.query);
});

router.get('/slips/excel', requireAuth, (req, res) => {
  exportSlipsToExcel(res, req.query);
});

router.get('/slips/csv', requireAuth, (req, res) => {
  exportSlipsToCSV(res, req.query);
});

router.get('/invoices/excel', requireAuth, (req, res) => {
  exportInvoicesToExcel(res, req.query);
});

module.exports = router;
