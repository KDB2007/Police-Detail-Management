const express = require('express');
const { getDb } = require('../database/schema');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { notifyInvoiceCreated, notifyInvoiceReconciled, notifyInvoicePaid } = require('../services/notification');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let query = `SELECT i.*, s.slip_number, p.project_number, u.full_name as billing_name, org.name as org_name
    FROM invoices i
    LEFT JOIN police_detail_slips s ON i.slip_id = s.id
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON i.billing_team_id = u.id
    LEFT JOIN organizations org ON u.organization_id = org.id
    WHERE 1=1`;
  const params = [];

  if (user.role === 'billing') {
    query += ' AND i.billing_team_id = ?';
    params.push(user.id);
  }

  if (req.query.status) { query += ' AND i.status = ?'; params.push(req.query.status); }
  if (req.query.search) {
    query += ' AND (i.invoice_number LIKE ? OR s.slip_number LIKE ?)';
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.date_from) { query += ' AND i.created_at >= ?'; params.push(req.query.date_from); }
  if (req.query.date_to) { query += ' AND i.created_at <= ?'; params.push(req.query.date_to); }

  query += ' ORDER BY i.created_at DESC';
  const invoices = db.prepare(query).all(...params);
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  res.renderWithLayout('invoices/index', { user, invoices, query: req.query, unreadNotifCount });
});

router.get('/create/:slipId', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare(`SELECT s.*, p.project_number, p.name as project_name, p.work_order_number, u.full_name as foreman_name, org.name as org_name
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations org ON u.organization_id = org.id
    WHERE s.id = ? AND s.status = 'approved'`).get(req.params.slipId);

  if (!slip) return res.status(404).renderWithLayout('error', { user, message: 'Approved slip not found', error: 'Not Found' });

  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
  res.renderWithLayout('invoices/create', { user, slip, unreadNotifCount });
});

router.post('/create/:slipId', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND status = ?').get(req.params.slipId, 'approved');
  if (!slip) return res.status(404).json({ error: 'Approved slip not found' });

  const { hours, rate, tax_rate, payment_terms, notes } = req.body;
  const totalHours = parseFloat(hours) || slip.total_hours;
  const hourlyRate = parseFloat(rate) || slip.rate_per_hour;
  const taxRate = parseFloat(tax_rate) || 6.25;
  const subtotal = totalHours * hourlyRate;
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;

  const invCount = db.prepare("SELECT COUNT(*) as c FROM invoices WHERE strftime('%Y', created_at) = strftime('%Y', 'now')").get().c;
  const invNumber = `NG-INV-${new Date().getFullYear()}-${String(invCount + 1).padStart(3, '0')}`;

  const result = db.prepare(`INSERT INTO invoices (invoice_number, slip_id, status, billing_team_id, subtotal, tax_rate, tax_amount, grand_total, payment_terms, notes) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`).run(
    invNumber, slip.id, user.id, subtotal, taxRate, taxAmount, grandTotal, payment_terms, notes
  );

  const invoiceId = result.lastInsertRowid;

  db.prepare('INSERT INTO invoice_line_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)').run(
    invoiceId, `Police Detail - ${slip.officer_name} (${slip.slip_number})`, totalHours, hourlyRate, subtotal
  );

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoiceId, 'draft', user.id, user.role, 'Invoice created');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'CREATE', entityType: 'invoice', entityId: invoiceId, afterState: { status: 'draft' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoiceId}`);
});

router.get('/view/:id', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare(`SELECT i.*, s.slip_number, s.officer_name, s.officer_badge, s.officer_department, s.shift_start, s.shift_end, s.total_hours, s.rate_per_hour, s.location_details, s.crew_info,
    p.project_number, p.name as project_name, p.work_order_number,
    u1.full_name as billing_name, u1.phone as billing_phone,
    u2.full_name as reconciled_by_name,
    u3.full_name as paid_by_name,
    u4.full_name as archived_by_name,
    org.name as org_name
    FROM invoices i
    LEFT JOIN police_detail_slips s ON i.slip_id = s.id
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u1 ON i.billing_team_id = u1.id
    LEFT JOIN organizations org ON u1.organization_id = org.id
    LEFT JOIN users u2 ON i.reconciled_by = u2.id
    LEFT JOIN users u3 ON i.paid_by = u3.id
    LEFT JOIN users u4 ON i.archived_by = u4.id
    WHERE i.id = ?`).get(req.params.id);

  if (!invoice) return res.status(404).renderWithLayout('error', { user, message: 'Invoice not found', error: 'Not Found' });

  const lineItems = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(invoice.id);
  const statusHistory = db.prepare(`SELECT ish.*, u.full_name as changed_by_name
    FROM invoice_status_history ish LEFT JOIN users u ON ish.changed_by = u.id
    WHERE ish.invoice_id = ? ORDER BY ish.created_at ASC`).all(invoice.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(invoice.id);
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  res.renderWithLayout('invoices/view', { user, invoice, lineItems, statusHistory, payments, unreadNotifCount });
});

router.post('/submit/:id', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND billing_team_id = ?').get(req.params.id, user.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be submitted' });

  db.prepare("UPDATE invoices SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.id);
  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'submitted', user.id, user.role, 'Submitted for reconciliation');

  db.prepare("UPDATE police_detail_slips SET status = 'invoiced', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.slip_id);
  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.slip_id, 'invoiced', user.id, user.role, 'Invoice generated');

  notifyInvoiceCreated(invoice.id, invoice.slip_id);

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'SUBMIT', entityType: 'invoice', entityId: invoice.id, beforeState: { status: 'draft' }, afterState: { status: 'submitted' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

router.post('/reconcile/:id', requireAuth, requireRole('detail_admin'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { action, notes } = req.body;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'submitted' && invoice.status !== 'under_review') return res.status(400).json({ error: 'Invoice must be submitted to reconcile' });

  if (action === 'reconcile') {
    db.prepare("UPDATE invoices SET status = 'reconciled', reconciled_at = CURRENT_TIMESTAMP, reconciled_by = ?, reconciliation_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id, notes, invoice.id);
    db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'reconciled', user.id, user.role, notes || 'Reconciled');

    notifyInvoiceReconciled(invoice.id, invoice.billing_team_id);

    logAction({ userId: user.id, username: user.username, role: user.role, action: 'RECONCILE', entityType: 'invoice', entityId: invoice.id, beforeState: { status: invoice.status }, afterState: { status: 'reconciled' }, ip: req.ip });
  } else if (action === 'dispute') {
    db.prepare("UPDATE invoices SET status = 'disputed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.id);
    db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'disputed', user.id, user.role, notes || 'Disputed');

    logAction({ userId: user.id, username: user.username, role: user.role, action: 'DISPUTE', entityType: 'invoice', entityId: invoice.id, beforeState: { status: invoice.status }, afterState: { status: 'disputed' }, ip: req.ip });
  } else if (action === 'review') {
    db.prepare("UPDATE invoices SET status = 'under_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.id);
    db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'under_review', user.id, user.role, notes || 'Under review');
  }

  res.redirect(`/invoices/view/${invoice.id}`);
});

router.post('/pay/:id', requireAuth, requireRole('detail_admin'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { payment_reference, payment_comments, payment_date } = req.body;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'reconciled') return res.status(400).json({ error: 'Invoice must be reconciled before payment' });

  db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_by = ?, payment_reference = ?, payment_comments = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    payment_date || new Date().toISOString(), user.id, payment_reference, payment_comments, invoice.id
  );

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'paid', user.id, user.role, `Payment ref: ${payment_reference}`);

  db.prepare(`INSERT INTO payments (invoice_id, amount, payment_date, reference_number, payment_method, received_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    invoice.id, invoice.grand_total, payment_date || new Date().toISOString(), payment_reference, 'Wire Transfer', user.id, payment_comments
  );

  notifyInvoicePaid(invoice.id, invoice.billing_team_id);

  db.prepare("UPDATE police_detail_slips SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.slip_id);
  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.slip_id, 'paid', user.id, user.role, 'Payment received');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'PAY', entityType: 'invoice', entityId: invoice.id, beforeState: { status: 'reconciled' }, afterState: { status: 'paid' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

router.post('/archive/:id', requireAuth, requireRole('detail_admin'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'paid') return res.status(400).json({ error: 'Only paid invoices can be archived' });

  db.prepare("UPDATE invoices SET status = 'archived', archived_at = CURRENT_TIMESTAMP, archived_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id, invoice.id);
  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'archived', user.id, user.role, 'Archived after payment');

  db.prepare("UPDATE police_detail_slips SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.slip_id);
  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.slip_id, 'archived', user.id, user.role, 'Archived');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'ARCHIVE', entityType: 'invoice', entityId: invoice.id, beforeState: { status: 'paid' }, afterState: { status: 'archived' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

module.exports = router;
