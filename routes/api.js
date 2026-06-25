const express = require('express');
const { getDb } = require('../database/schema');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/stats/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let data = {};

  if (user.role === 'foreman') {
    data = {
      total: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ?').get(user.id).c,
      draft: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'draft'").get(user.id).c,
      submitted: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'submitted'").get(user.id).c,
      approved: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'approved'").get(user.id).c
    };
  } else if (user.role === 'arborist') {
    data = {
      pending: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status = 'submitted'").get().c,
      reviewed: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips WHERE reviewer_id = ?').get(user.id).c
    };
  } else if (user.role === 'billing') {
    data = {
      approved: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status = 'approved'").get().c,
      draftInvoices: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE billing_team_id = ? AND status = 'draft'").get(user.id).c,
      totalBilled: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices WHERE billing_team_id = ? AND status IN ('submitted','reconciled','paid')").get(user.id).c
    };
  } else if (user.role === 'detail_admin') {
    data = {
      pendingRecon: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status IN ('submitted','under_review')").get().c,
      paidThisMonth: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices WHERE status = 'paid' AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')").get().c
    };
  } else {
    data = {
      totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      totalSlips: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips').get().c,
      totalInvoices: db.prepare('SELECT COUNT(*) as c FROM invoices').get().c,
      totalBilled: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices").get().c
    };
  }
  res.json(data);
});

router.get('/activity/recent', requireAuth, (req, res) => {
  const db = getDb();
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20').all();
  res.json(logs);
});

router.get('/chart/slip-status', requireAuth, (req, res) => {
  const db = getDb();
  const data = db.prepare("SELECT status, COUNT(*) as count FROM police_detail_slips GROUP BY status").all();
  res.json(data);
});

router.get('/chart/invoice-status', requireAuth, (req, res) => {
  const db = getDb();
  const data = db.prepare("SELECT status, COUNT(*) as count FROM invoices GROUP BY status").all();
  res.json(data);
});

router.get('/chart/monthly-billing', requireAuth, (req, res) => {
  const db = getDb();
  const data = db.prepare(`SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count, COALESCE(SUM(grand_total),0) as total
    FROM invoices GROUP BY month ORDER BY month DESC LIMIT 12`).all();
  res.json(data);
});

module.exports = router;
