const express = require('express');
const { getDb } = require('../database/schema');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const role = user.role;

  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  const roleDashboards = {
    foreman: () => {
      const mySlips = db.prepare(`SELECT s.*, p.project_number, p.name as project_name
        FROM police_detail_slips s LEFT JOIN projects p ON s.project_id = p.id
        WHERE s.foreman_id = ? ORDER BY s.created_at DESC LIMIT 10`).all(user.id);
      const stats = {
        total: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ?').get(user.id).c,
        draft: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'draft'").get(user.id).c,
        submitted: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'submitted'").get(user.id).c,
        approved: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status = 'approved'").get(user.id).c,
        rejected: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status IN ('rejected','non_billable','changes_requested')").get(user.id).c,
        invoiced: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE foreman_id = ? AND status IN ('invoiced','paid','archived')").get(user.id).c
      };
      const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
      const recentActivity = db.prepare(`SELECT ssh.*, u.full_name FROM slip_status_history ssh
        LEFT JOIN users u ON ssh.changed_by = u.id
        WHERE ssh.slip_id IN (SELECT id FROM police_detail_slips WHERE foreman_id = ?)
        ORDER BY ssh.created_at DESC LIMIT 10`).all(user.id);
      res.renderWithLayout('dashboard/foreman', { user, stats, mySlips, projects, recentActivity, unreadNotifCount });
    },
    arborist: () => {
      const pendingReview = db.prepare(`SELECT s.*, p.project_number, p.name as project_name, u.full_name as foreman_name, org.name as org_name
        FROM police_detail_slips s
        LEFT JOIN projects p ON s.project_id = p.id
        LEFT JOIN users u ON s.foreman_id = u.id
        LEFT JOIN organizations org ON u.organization_id = org.id
        WHERE s.status = 'submitted' ORDER BY s.submitted_at ASC`).all();
      const stats = {
        pending: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status = 'submitted'").get().c,
        approved: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status = 'approved' AND reviewer_id = ?").get(user.id).c,
        reviewed: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips WHERE reviewer_id = ?').get(user.id).c,
        changes: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status = 'changes_requested' AND reviewer_id = ?").get(user.id).c
      };
      const recentReviews = db.prepare(`SELECT s.slip_number, s.status, s.reviewed_at, p.project_number
        FROM police_detail_slips s LEFT JOIN projects p ON s.project_id = p.id
        WHERE s.reviewer_id = ? ORDER BY s.reviewed_at DESC LIMIT 10`).all(user.id);
      res.renderWithLayout('dashboard/arborist', { user, stats, pendingReview, recentReviews, unreadNotifCount });
    },
    billing: () => {
      const approvedSlips = db.prepare(`SELECT s.*, p.project_number, p.name as project_name, u.full_name as foreman_name, org.name as org_name
        FROM police_detail_slips s
        LEFT JOIN projects p ON s.project_id = p.id
        LEFT JOIN users u ON s.foreman_id = u.id
        LEFT JOIN organizations org ON u.organization_id = org.id
        WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC`).all();
      const myInvoices = db.prepare(`SELECT i.*, s.slip_number
        FROM invoices i LEFT JOIN police_detail_slips s ON i.slip_id = s.id
        WHERE i.billing_team_id = ? ORDER BY i.created_at DESC LIMIT 10`).all(user.id);
      const stats = {
        draft: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE billing_team_id = ? AND status = 'draft'").get(user.id).c,
        submitted: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE billing_team_id = ? AND status = 'submitted'").get(user.id).c,
        reconciled: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE billing_team_id = ? AND status = 'reconciled'").get(user.id).c,
        paid: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE billing_team_id = ? AND status = 'paid'").get(user.id).c,
        totalBilled: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices WHERE billing_team_id = ? AND status IN ('submitted','reconciled','paid')").get(user.id).c
      };
      const approvedCount = approvedSlips.length;
      res.renderWithLayout('dashboard/billing', { user, stats, approvedSlips, myInvoices, approvedCount, unreadNotifCount });
    },
    detail_admin: () => {
      const pendingRecon = db.prepare(`SELECT i.*, s.slip_number, p.project_number, u.full_name as billing_name, org.name as org_name
        FROM invoices i
        LEFT JOIN police_detail_slips s ON i.slip_id = s.id
        LEFT JOIN projects p ON s.project_id = p.id
        LEFT JOIN users u ON i.billing_team_id = u.id
        LEFT JOIN organizations org ON u.organization_id = org.id
        WHERE i.status IN ('submitted','under_review') ORDER BY i.created_at ASC`).all();
      const recentInvoices = db.prepare(`SELECT i.*, s.slip_number
        FROM invoices i LEFT JOIN police_detail_slips s ON i.slip_id = s.id
        ORDER BY i.created_at DESC LIMIT 10`).all();
      const stats = {
        pending: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status IN ('submitted','under_review')").get().c,
        reconciled: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status = 'reconciled'").get().c,
        paid: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status = 'paid'").get().c,
        archived: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status = 'archived'").get().c,
        totalAmount: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices WHERE status IN ('reconciled','paid')").get().c
      };
      const pendingCount = pendingRecon.length;
      res.renderWithLayout('dashboard/detail_admin', { user, stats, pendingRecon, recentInvoices, pendingCount, unreadNotifCount });
    },
    super_admin: () => {
      const stats = {
        users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        activeUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get().c,
        orgs: db.prepare('SELECT COUNT(*) as c FROM organizations').get().c,
        slips: db.prepare('SELECT COUNT(*) as c FROM police_detail_slips').get().c,
        activeSlips: db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE status NOT IN ('archived','paid')").get().c,
        invoices: db.prepare('SELECT COUNT(*) as c FROM invoices').get().c,
        pendingInvoices: db.prepare("SELECT COUNT(*) as c FROM invoices WHERE status IN ('submitted','under_review')").get().c,
        totalBilled: db.prepare("SELECT COALESCE(SUM(grand_total),0) as c FROM invoices WHERE status IN ('paid','reconciled')").get().c
      };
      const recentUsers = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 5').all();
      const recentAudit = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10').all();
      const recentSlips = db.prepare(`SELECT s.*, p.project_number FROM police_detail_slips s
        LEFT JOIN projects p ON s.project_id = p.id ORDER BY s.created_at DESC LIMIT 5`).all();
      res.renderWithLayout('dashboard/superadmin', { user, stats, recentUsers, recentAudit, recentSlips, unreadNotifCount });
    }
  };

  if (roleDashboards[role]) {
    roleDashboards[role]();
  } else {
    res.redirect('/login');
  }
});

module.exports = router;
