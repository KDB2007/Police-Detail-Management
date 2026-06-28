const express = require('express');
const { getDb } = require('../database/schema');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { notifyInvoiceCreated, notifyInvoiceReconciled, notifyInvoicePaid } = require('../services/notification');

const router = express.Router();

function getInvoiceSlips(invoiceId) {
  const db = getDb();
  return db.prepare(`SELECT s.*, p.project_number, p.name as project_name, p.work_order_number,
    u.full_name as foreman_name, org.name as org_name
    FROM invoice_slips inv_s
    JOIN police_detail_slips s ON inv_s.slip_id = s.id
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations org ON u.organization_id = org.id
    WHERE inv_s.invoice_id = ?`).all(invoiceId);
}

function updateInvoiceSlipStatus(invoiceId, status, userId, userRole, comments, statusLabel) {
  const db = getDb();
  const slips = db.prepare('SELECT slip_id FROM invoice_slips WHERE invoice_id = ?').all(invoiceId);
  slips.forEach(({ slip_id }) => {
    db.prepare(`UPDATE police_detail_slips SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, slip_id);
    db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(slip_id, status, userId, userRole, comments || statusLabel);
  });
}

function recalcInvoice(invoiceId) {
  const db = getDb();
  const lineItems = db.prepare('SELECT SUM(amount) as total FROM invoice_line_items WHERE invoice_id = ?').get(invoiceId);
  const invoice = db.prepare('SELECT tax_rate FROM invoices WHERE id = ?').get(invoiceId);
  const subtotal = lineItems.total || 0;
  const taxRate = invoice.tax_rate;
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;
  db.prepare('UPDATE invoices SET subtotal = ?, tax_amount = ?, grand_total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(subtotal, taxAmount, grandTotal, invoiceId);
}

function getApprovedSlipsNotInvoiced() {
  const db = getDb();
  return db.prepare(`SELECT s.*, p.project_number, p.name as project_name, u.full_name as foreman_name, org.name as org_name
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations org ON u.organization_id = org.id
    WHERE s.status = 'approved' AND s.id NOT IN (SELECT slip_id FROM invoice_slips)
    ORDER BY s.submitted_at DESC`).all();
}

// Redirect to existing invoice if slip is already invoiced, otherwise to create page
router.get('/redirect-for-slip/:slipId', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT invoice_id FROM invoice_slips WHERE slip_id = ?').get(req.params.slipId);
  if (existing) {
    return res.redirect(`/invoices/view/${existing.invoice_id}`);
  }
  res.redirect('/invoices/create');
});

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let query = `SELECT i.*,
    (SELECT GROUP_CONCAT(s.slip_number, ', ') FROM invoice_slips inv_s JOIN police_detail_slips s ON inv_s.slip_id = s.id WHERE inv_s.invoice_id = i.id) as slip_numbers,
    (SELECT GROUP_CONCAT(p.project_number, ', ') FROM invoice_slips inv_s JOIN police_detail_slips s ON inv_s.slip_id = s.id LEFT JOIN projects p ON s.project_id = p.id WHERE inv_s.invoice_id = i.id) as project_numbers,
    u.full_name as billing_name, org.name as org_name
    FROM invoices i
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
    query += ' AND (i.invoice_number LIKE ? OR i.id IN (SELECT inv_s.invoice_id FROM invoice_slips inv_s JOIN police_detail_slips s ON inv_s.slip_id = s.id WHERE s.slip_number LIKE ?))';
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.date_from) { query += ' AND i.created_at >= ?'; params.push(req.query.date_from); }
  if (req.query.date_to) { query += ' AND i.created_at <= ?'; params.push(req.query.date_to); }

  query += ' ORDER BY i.created_at DESC';
  const invoices = db.prepare(query).all(...params);
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  res.renderWithLayout('invoices/index', { user, invoices, query: req.query, unreadNotifCount });
});

// Single-slip creation
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
  res.renderWithLayout('invoices/create_single', { user, slip, unreadNotifCount });
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

  db.prepare('INSERT OR IGNORE INTO invoice_slips (invoice_id, slip_id) VALUES (?, ?)').run(invoiceId, slip.id);
  db.prepare('INSERT INTO invoice_line_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)').run(
    invoiceId, `Police Detail - ${slip.officer_name} (${slip.slip_number})`, totalHours, hourlyRate, subtotal
  );

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoiceId, 'draft', user.id, user.role, 'Invoice created');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'CREATE', entityType: 'invoice', entityId: invoiceId, afterState: { status: 'draft' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoiceId}`);
});

// Multi-slip creation page
router.get('/create', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const approvedSlips = getApprovedSlipsNotInvoiced();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
  res.renderWithLayout('invoices/create', { user, approvedSlips, unreadNotifCount });
});

router.post('/create', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let slipIds = req.body.slip_ids;
  if (!slipIds) return res.redirect('/invoices/create');
  if (!Array.isArray(slipIds)) slipIds = [slipIds];

  const { tax_rate, payment_terms, notes } = req.body;
  const taxRate = parseFloat(tax_rate) || 6.25;

  const slips = [];
  for (const id of slipIds) {
    const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND status = ?').get(id, 'approved');
    if (slip) slips.push(slip);
  }
  if (slips.length === 0) return res.redirect('/invoices/create');

  const subtotal = slips.reduce((sum, s) => sum + (s.total_hours * s.rate_per_hour), 0);
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;

  const invCount = db.prepare("SELECT COUNT(*) as c FROM invoices WHERE strftime('%Y', created_at) = strftime('%Y', 'now')").get().c;
  const invNumber = `NG-INV-${new Date().getFullYear()}-${String(invCount + 1).padStart(3, '0')}`;

  const firstSlipId = slips[0].id;
  const result = db.prepare(`INSERT INTO invoices (invoice_number, slip_id, status, billing_team_id, subtotal, tax_rate, tax_amount, grand_total, payment_terms, notes) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`).run(
    invNumber, firstSlipId, user.id, subtotal, taxRate, taxAmount, grandTotal, payment_terms, notes
  );
  const invoiceId = result.lastInsertRowid;

  const insertInvSlip = db.prepare('INSERT OR IGNORE INTO invoice_slips (invoice_id, slip_id) VALUES (?, ?)');
  const insertLineItem = db.prepare('INSERT INTO invoice_line_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)');
  slips.forEach(slip => {
    insertInvSlip.run(invoiceId, slip.id);
    insertLineItem.run(invoiceId, `Police Detail - ${slip.officer_name} (${slip.slip_number})`, slip.total_hours, slip.rate_per_hour, slip.total_hours * slip.rate_per_hour);
  });

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoiceId, 'draft', user.id, user.role, 'Invoice created');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'CREATE', entityType: 'invoice', entityId: invoiceId, afterState: { status: 'draft', slipCount: slips.length }, ip: req.ip });

  res.redirect(`/invoices/view/${invoiceId}`);
});

// Add slip to existing draft invoice
router.post('/:id/add-slip', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND billing_team_id = ?').get(req.params.id, user.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be modified' });

  const slipId = parseInt(req.body.slip_id);
  if (!slipId) return res.redirect(`/invoices/view/${invoice.id}`);

  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND status = ?').get(slipId, 'approved');
  if (!slip) return res.status(404).json({ error: 'Approved slip not found' });

  const already = db.prepare('SELECT id FROM invoice_slips WHERE invoice_id = ? AND slip_id = ?').get(invoice.id, slipId);
  if (already) return res.redirect(`/invoices/view/${invoice.id}`);

  db.prepare('INSERT INTO invoice_slips (invoice_id, slip_id) VALUES (?, ?)').run(invoice.id, slip.id);
  db.prepare('INSERT INTO invoice_line_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)').run(
    invoice.id, `Police Detail - ${slip.officer_name} (${slip.slip_number})`, slip.total_hours, slip.rate_per_hour, slip.total_hours * slip.rate_per_hour
  );

  recalcInvoice(invoice.id);

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'draft', user.id, user.role, `Slip ${slip.slip_number} added`);

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'EDIT', entityType: 'invoice', entityId: invoice.id, afterState: { slipAdded: slipId }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

// Remove slip from draft invoice
router.post('/:id/remove-slip/:slipId', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND billing_team_id = ?').get(req.params.id, user.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be modified' });

  const slipId = parseInt(req.params.slipId);
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ?').get(slipId);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });

  db.prepare('DELETE FROM invoice_slips WHERE invoice_id = ? AND slip_id = ?').run(invoice.id, slipId);
  db.prepare("DELETE FROM invoice_line_items WHERE invoice_id = ? AND description LIKE ?").run(invoice.id, `%(${slip.slip_number})`);

  recalcInvoice(invoice.id);

  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'draft', user.id, user.role, `Slip ${slip.slip_number} removed`);

  // Check if invoice still has slips; if not, delete it
  const remaining = db.prepare('SELECT COUNT(*) as c FROM invoice_slips WHERE invoice_id = ?').get(invoice.id).c;
  if (remaining === 0) {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
    logAction({ userId: user.id, username: user.username, role: user.role, action: 'EDIT', entityType: 'invoice', entityId: invoice.id, afterState: { deleted: true, reason: 'last slip removed' }, ip: req.ip });
    return res.redirect('/invoices');
  }

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'EDIT', entityType: 'invoice', entityId: invoice.id, afterState: { slipRemoved: slipId }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

router.get('/view/:id', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare(`SELECT i.*,
    u1.full_name as billing_name, u1.phone as billing_phone,
    u2.full_name as reconciled_by_name,
    u3.full_name as paid_by_name,
    u4.full_name as archived_by_name,
    org.name as org_name
    FROM invoices i
    LEFT JOIN users u1 ON i.billing_team_id = u1.id
    LEFT JOIN organizations org ON u1.organization_id = org.id
    LEFT JOIN users u2 ON i.reconciled_by = u2.id
    LEFT JOIN users u3 ON i.paid_by = u3.id
    LEFT JOIN users u4 ON i.archived_by = u4.id
    WHERE i.id = ?`).get(req.params.id);

  if (!invoice) return res.status(404).renderWithLayout('error', { user, message: 'Invoice not found', error: 'Not Found' });

  const invoiceSlips = getInvoiceSlips(invoice.id);
  const lineItems = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(invoice.id);
  const statusHistory = db.prepare(`SELECT ish.*, u.full_name as changed_by_name
    FROM invoice_status_history ish LEFT JOIN users u ON ish.changed_by = u.id
    WHERE ish.invoice_id = ? ORDER BY ish.created_at ASC`).all(invoice.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(invoice.id);
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  // Available approved slips not yet on any invoice (for "Add Slip" on draft invoices)
  let availableSlips = [];
  if (invoice.status === 'draft' && user.role === 'billing' && invoice.billing_team_id === user.id) {
    availableSlips = getApprovedSlipsNotInvoiced();
  }

  res.renderWithLayout('invoices/view', { user, invoice, invoiceSlips, lineItems, statusHistory, payments, unreadNotifCount, availableSlips });
});

router.post('/submit/:id', requireAuth, requireRole('billing'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND billing_team_id = ?').get(req.params.id, user.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be submitted' });

  db.prepare("UPDATE invoices SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(invoice.id);
  db.prepare('INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(invoice.id, 'submitted', user.id, user.role, 'Submitted for reconciliation');

  updateInvoiceSlipStatus(invoice.id, 'invoiced', user.id, user.role, 'Invoice generated', 'Invoice submitted');

  notifyInvoiceCreated(invoice.id);

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

  updateInvoiceSlipStatus(invoice.id, 'paid', user.id, user.role, 'Payment received', 'Payment processed');

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

  updateInvoiceSlipStatus(invoice.id, 'archived', user.id, user.role, 'Archived', 'Archived after payment');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'ARCHIVE', entityType: 'invoice', entityId: invoice.id, beforeState: { status: 'paid' }, afterState: { status: 'archived' }, ip: req.ip });

  res.redirect(`/invoices/view/${invoice.id}`);
});

module.exports = router;
