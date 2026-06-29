const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/schema');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { notifySlipSubmitted, notifySlipApproved, notifySlipRejected, notifySlipChangesRequested, notifySlipNonBillable } = require('../services/notification');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../public/uploads'),
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  let query = `SELECT s.*, p.project_number, p.name as project_name, u.full_name as foreman_name, org.name as org_name
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations org ON u.organization_id = org.id
    WHERE 1=1`;
  const params = [];

  if (user.role === 'foreman') {
    query += ' AND s.foreman_id = ?';
    params.push(user.id);
  } else if (user.role === 'arborist') {
    query += " AND s.status IN ('submitted','approved','rejected','non_billable','changes_requested','invoiced','paid')";
  } else if (user.role === 'billing') {
    query += " AND s.status IN ('approved','invoiced','paid','archived')";
  }

  if (req.query.status) { query += ' AND s.status = ?'; params.push(req.query.status); }
  if (req.query.project_id) { query += ' AND s.project_id = ?'; params.push(req.query.project_id); }
  if (req.query.search) {
    query += ' AND (s.slip_number LIKE ? OR s.officer_name LIKE ? OR p.project_number LIKE ?)';
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.date_from) { query += ' AND s.shift_start >= ?'; params.push(req.query.date_from); }
  if (req.query.date_to) { query += ' AND s.shift_end <= ?'; params.push(req.query.date_to); }

  query += ' ORDER BY s.created_at DESC';
  const slips = db.prepare(query).all(...params);
  const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;

  res.renderWithLayout('slips/index', { user, slips, projects, query: req.query, unreadNotifCount });
});

router.get('/create', requireAuth, requireRole('foreman'), (req, res) => {
  const db = getDb();
  const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.user.id).c;
  res.renderWithLayout('slips/create', { user: req.session.user, projects, slip: null, errors: null, unreadNotifCount });
});

router.post('/create', requireAuth, requireRole('foreman'), upload.array('attachments', 5), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { project_id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate_per_hour, location_details, crew_info, notes } = req.body;

  const errors = [];
  if (!project_id) errors.push('Project is required');
  if (!officer_name) errors.push('Officer name is required');
  if (!officer_badge) errors.push('Badge number is required');
  if (!officer_department) errors.push('Department is required');
  if (!location_details) errors.push('Location details are required');
  if (!shift_start || !shift_end) errors.push('Shift start and end times are required');

  // Auto-calculate hours from shift times
  let calculatedHours = total_hours;
  if (shift_start && shift_end) {
    const diff = new Date(shift_end) - new Date(shift_start);
    if (diff > 0) {
      calculatedHours = (diff / (1000 * 60 * 60)).toFixed(2);
    }
  }
  if (!calculatedHours || calculatedHours <= 0) errors.push('Valid total hours are required');

  if (errors.length > 0) {
    const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
    const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
    return res.renderWithLayout('slips/create', { user, projects, slip: req.body, errors, unreadNotifCount });
  }

  // Duplicate check: same officer, same shift times, same location
  const existing = db.prepare(`SELECT id, slip_number, status FROM police_detail_slips
    WHERE officer_name = ? AND shift_start = ? AND shift_end = ? AND COALESCE(location_details,'') = COALESCE(?,'')
    LIMIT 1`).get(officer_name, shift_start, shift_end, location_details || '');
  if (existing) {
    const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
    const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
    errors.push(`Duplicate slip detected — ${existing.slip_number} (${existing.status}) already exists for ${officer_name} at this location on the same date/time.`);
    return res.renderWithLayout('slips/create', { user, projects, slip: req.body, errors, unreadNotifCount });
  }

  const slipNumber = `PDS-${new Date().getFullYear()}-${String(db.prepare("SELECT COUNT(*) as c FROM police_detail_slips WHERE strftime('%Y', created_at) = strftime('%Y', 'now')").get().c + 1).padStart(3, '0')}`;
  const rate = rate_per_hour || 85.00;

  const result = db.prepare(`INSERT INTO police_detail_slips (slip_number, project_id, status, foreman_id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate_per_hour, location_details, crew_info, notes) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slipNumber, project_id, user.id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate, location_details, crew_info, notes
  );

  const slipId = result.lastInsertRowid;

  if (req.files && req.files.length > 0) {
    const attachStmt = db.prepare('INSERT INTO slip_attachments (slip_id, filename, filepath, filetype, filesize, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');
    for (const file of req.files) {
      attachStmt.run(slipId, file.originalname, file.filename, file.mimetype, file.size, user.id);
    }
  }

  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(slipId, 'draft', user.id, user.role, 'Slip created');

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'CREATE', entityType: 'slip', entityId: slipId, afterState: { status: 'draft' }, ip: req.ip });

  res.redirect(`/slips/view/${slipId}`);
});

router.get('/view/:id', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare(`SELECT s.*, p.project_number, p.name as project_name, p.work_order_number, p.location as project_location,
    u1.full_name as foreman_name, u1.phone as foreman_phone, org1.name as vendor_name,
    u2.full_name as reviewer_name, org2.name as utility_name
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u1 ON s.foreman_id = u1.id
    LEFT JOIN organizations org1 ON u1.organization_id = org1.id
    LEFT JOIN users u2 ON s.reviewer_id = u2.id
    LEFT JOIN organizations org2 ON u2.organization_id = org2.id
    WHERE s.id = ?`).get(req.params.id);

  if (!slip) return res.status(404).renderWithLayout('error', { user, message: 'Slip not found', error: 'Not Found' });

  const statusHistory = db.prepare(`SELECT ssh.*, u.full_name as changed_by_name
    FROM slip_status_history ssh LEFT JOIN users u ON ssh.changed_by = u.id
    WHERE ssh.slip_id = ? ORDER BY ssh.created_at ASC`).all(slip.id);
  const attachments = db.prepare('SELECT * FROM slip_attachments WHERE slip_id = ?').all(slip.id);
  const invoices = db.prepare(`SELECT i.* FROM invoices i
    JOIN invoice_slips inv_s ON i.id = inv_s.invoice_id
    WHERE inv_s.slip_id = ?`).all(slip.id);
  const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
  let draftInvoices = [];
  if (user.role === 'billing') {
    draftInvoices = db.prepare('SELECT id, invoice_number, grand_total FROM invoices WHERE status = ? AND billing_team_id = ? ORDER BY created_at DESC').all('draft', user.id);
  }

  res.renderWithLayout('slips/view', { user, slip, statusHistory, attachments, invoices, projects, unreadNotifCount, draftInvoices });
});

router.post('/submit/:id', requireAuth, requireRole('foreman'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND foreman_id = ?').get(req.params.id, user.id);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });
  if (slip.status !== 'draft' && slip.status !== 'changes_requested') return res.status(400).json({ error: 'Only draft or changes_requested slips can be submitted' });

  // Ensure all required fields are filled before submission
  const missing = [];
  if (!slip.project_id) missing.push('Project');
  if (!slip.officer_name) missing.push('Officer name');
  if (!slip.officer_badge) missing.push('Badge number');
  if (!slip.officer_department) missing.push('Department');
  if (!slip.location_details) missing.push('Location details');
  if (!slip.shift_start) missing.push('Shift start');
  if (!slip.shift_end) missing.push('Shift end');
  if (!slip.total_hours || slip.total_hours <= 0) missing.push('Total hours');
  if (missing.length > 0) {
    return res.status(400).json({ error: `Please fill in the following fields before submitting: ${missing.join(', ')}` });
  }

  // Recalculate hours from shift times
  let calculatedHours = slip.total_hours;
  if (slip.shift_start && slip.shift_end) {
    const diff = new Date(slip.shift_end) - new Date(slip.shift_start);
    if (diff > 0) {
      calculatedHours = (diff / (1000 * 60 * 60)).toFixed(2);
    }
  }
  if (calculatedHours != slip.total_hours) {
    db.prepare('UPDATE police_detail_slips SET total_hours = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(calculatedHours, slip.id);
  }

  db.prepare("UPDATE police_detail_slips SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(slip.id);
  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(slip.id, 'submitted', user.id, user.role, 'Submitted for review');

  notifySlipSubmitted(slip.id, user.full_name);

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'SUBMIT', entityType: 'slip', entityId: slip.id, beforeState: { status: slip.status }, afterState: { status: 'submitted' }, ip: req.ip });

  res.redirect(`/slips/view/${slip.id}`);
});

router.post('/delete/:id', requireAuth, (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });

  // Only the foreman (draft/changes_requested) or super_admin can delete
  if (user.role === 'foreman' && slip.foreman_id === user.id) {
    if (slip.status !== 'draft' && slip.status !== 'changes_requested') {
      return res.status(400).json({ error: 'Only draft or changes_requested slips can be deleted' });
    }
  } else if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Not authorized to delete this slip' });
  }

  // Check if slip is linked to any invoice
  const invLink = db.prepare('SELECT invoice_id FROM invoice_slips WHERE slip_id = ?').get(slip.id);
  if (invLink) {
    return res.status(400).json({ error: 'Cannot delete a slip that is linked to an invoice. Remove it from the invoice first.' });
  }

  db.prepare('DELETE FROM slip_status_history WHERE slip_id = ?').run(slip.id);
  db.prepare('DELETE FROM slip_attachments WHERE slip_id = ?').run(slip.id);
  db.prepare('DELETE FROM notifications WHERE entity_type = ? AND entity_id = ?').run('slip', slip.id);
  db.prepare('DELETE FROM police_detail_slips WHERE id = ?').run(slip.id);

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'DELETE', entityType: 'slip', entityId: slip.id, beforeState: { slip_number: slip.slip_number, status: slip.status }, ip: req.ip });

  res.redirect('/slips');
});

router.post('/review/:id', requireAuth, requireRole('arborist'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const { action, comments, non_billable_reason } = req.body;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ?').get(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });
  if (slip.status !== 'submitted') return res.status(400).json({ error: 'Only submitted slips can be reviewed' });

  const validActions = ['approved', 'rejected', 'non_billable', 'changes_requested'];
  if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const updateData = { status: action, reviewer_id: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() };

  if (action === 'rejected') updateData.rejection_reason = comments;
  if (action === 'non_billable') updateData.non_billable_reason = non_billable_reason || comments;
  if (action === 'changes_requested') updateData.change_request_notes = comments;

  db.prepare(`UPDATE police_detail_slips SET status = ?, reviewer_id = ?, reviewed_at = ?, updated_at = ?${action === 'rejected' ? ', rejection_reason = ?' : ''}${action === 'non_billable' ? ', non_billable_reason = ?' : ''}${action === 'changes_requested' ? ', change_request_notes = ?' : ''} WHERE id = ?`).run(
    ...(action === 'rejected' ? [updateData.status, updateData.reviewer_id, updateData.reviewed_at, updateData.updated_at, updateData.rejection_reason, slip.id] :
      action === 'non_billable' ? [updateData.status, updateData.reviewer_id, updateData.reviewed_at, updateData.updated_at, updateData.non_billable_reason, slip.id] :
      action === 'changes_requested' ? [updateData.status, updateData.reviewer_id, updateData.reviewed_at, updateData.updated_at, updateData.change_request_notes, slip.id] :
      [updateData.status, updateData.reviewer_id, updateData.reviewed_at, updateData.updated_at, slip.id])
  );

  db.prepare('INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)').run(slip.id, action, user.id, user.role, comments || '');

  if (action === 'approved') notifySlipApproved(slip.id, slip.foreman_id);
  else if (action === 'rejected') notifySlipRejected(slip.id, slip.foreman_id, comments);
  else if (action === 'changes_requested') notifySlipChangesRequested(slip.id, slip.foreman_id, comments);
  else if (action === 'non_billable') notifySlipNonBillable(slip.id, slip.foreman_id, non_billable_reason || comments);

  logAction({ userId: user.id, username: user.username, role: user.role, action: action.toUpperCase(), entityType: 'slip', entityId: slip.id, beforeState: { status: slip.status }, afterState: { status: action }, ip: req.ip });

  res.redirect(`/slips/view/${slip.id}`);
});

router.get('/edit/:id', requireAuth, requireRole('foreman'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND foreman_id = ?').get(req.params.id, user.id);
  if (!slip) return res.status(404).renderWithLayout('error', { user, message: 'Slip not found', error: 'Not Found' });
  if (slip.status !== 'draft' && slip.status !== 'changes_requested') return res.status(400).renderWithLayout('error', { user, message: 'Only draft or changes_requested slips can be edited', error: 'Bad Request' });

  const projects = db.prepare("SELECT * FROM projects WHERE status = 'active'").all();
  const unreadNotifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).c;
  res.renderWithLayout('slips/edit', { user, slip, projects, errors: null, unreadNotifCount });
});

router.post('/edit/:id', requireAuth, requireRole('foreman'), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND foreman_id = ?').get(req.params.id, user.id);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });
  if (slip.status !== 'draft' && slip.status !== 'changes_requested') return res.status(400).json({ error: 'Only draft or changes_requested slips can be edited' });

  let { project_id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate_per_hour, location_details, crew_info, notes } = req.body;

  // Auto-calculate hours from shift times
  if (shift_start && shift_end) {
    const diff = new Date(shift_end) - new Date(shift_start);
    if (diff > 0) {
      total_hours = (diff / (1000 * 60 * 60)).toFixed(2);
    }
  }

  db.prepare(`UPDATE police_detail_slips SET project_id=?, officer_name=?, officer_badge=?, officer_department=?, shift_start=?, shift_end=?, total_hours=?, rate_per_hour=?, location_details=?, crew_info=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    project_id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate_per_hour || 85, location_details, crew_info, notes, slip.id
  );

  logAction({ userId: user.id, username: user.username, role: user.role, action: 'EDIT', entityType: 'slip', entityId: slip.id, beforeState: { status: slip.status }, afterState: { status: 'edited' }, ip: req.ip });

  res.redirect(`/slips/view/${slip.id}`);
});

router.post('/upload/:id', requireAuth, requireRole('foreman'), upload.array('attachments', 5), (req, res) => {
  const db = getDb();
  const user = req.session.user;
  const slip = db.prepare('SELECT * FROM police_detail_slips WHERE id = ? AND foreman_id = ?').get(req.params.id, user.id);
  if (!slip) return res.status(404).json({ error: 'Slip not found' });

  if (req.files && req.files.length > 0) {
    const attachStmt = db.prepare('INSERT INTO slip_attachments (slip_id, filename, filepath, filetype, filesize, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');
    for (const file of req.files) {
      attachStmt.run(slip.id, file.originalname, file.filename, file.mimetype, file.size, user.id);
    }
  }
  res.redirect(`/slips/view/${slip.id}`);
});

router.get('/download/:attachmentId', requireAuth, (req, res) => {
  const db = getDb();
  const attachment = db.prepare('SELECT * FROM slip_attachments WHERE id = ?').get(req.params.attachmentId);
  if (!attachment) return res.status(404).send('File not found');
  const filePath = path.join(__dirname, '../public/uploads', attachment.filepath);
  res.download(filePath, attachment.filename);
});

module.exports = router;
