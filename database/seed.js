const bcrypt = require('bcryptjs');
const { initDb, getDb } = require('./schema');

function seed() {
  initDb();
  const db = getDb();

  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (existing.c > 0) {
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM audit_logs');
    db.exec('DELETE FROM payments');
    db.exec('DELETE FROM invoice_line_items');
    db.exec('DELETE FROM invoice_status_history');
    db.exec('DELETE FROM invoices');
    db.exec('DELETE FROM slip_attachments');
    db.exec('DELETE FROM slip_status_history');
    db.exec('DELETE FROM police_detail_slips');
    db.exec('DELETE FROM projects');
    db.exec('DELETE FROM users');
    db.exec('DELETE FROM roles');
    db.exec('DELETE FROM organizations');
    console.log('Cleared existing data, re-seeding...');
  }

  const hash = bcrypt.hashSync('password123', 10);

  const orgs = db.prepare(`INSERT INTO organizations (name, type, address, phone, email) VALUES (?, ?, ?, ?, ?)`);
  orgs.run('National Grid', 'utility', '100 Utility Ave, Boston, MA', '555-0100', 'admin@nationalgrid.com');
  orgs.run('Pioneer Tree Service', 'vendor', '200 Forestry Ln, Worcester, MA', '555-0200', 'info@pioneertree.com');
  orgs.run('Northeast Arbor Care', 'vendor', '350 Elm St, Springfield, MA', '555-0300', 'contact@northeastarbor.com');

  const roles = db.prepare(`INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)`);
  roles.run('foreman', 'Vendor Ground Foreman - creates and submits police detail slips', JSON.stringify(['slip:create','slip:edit','slip:submit','slip:view','attachment:upload','dashboard:view']));
  roles.run('arborist', 'NG Arborist - reviews and approves/rejects police detail slips', JSON.stringify(['slip:review','slip:approve','slip:reject','slip:view','dashboard:view']));
  roles.run('billing', 'Vendor Billing Team - creates invoices from approved slips', JSON.stringify(['invoice:create','invoice:edit','invoice:submit','invoice:view','report:view','dashboard:view']));
  roles.run('detail_admin', 'NG Detail Admin - reconciles invoices, marks paid, archives', JSON.stringify(['invoice:reconcile','invoice:pay','invoice:archive','invoice:view','slip:view','report:view','audit:view','dashboard:view']));
  roles.run('super_admin', 'Super Admin - full system access and configuration', JSON.stringify(['*']));

  const users = db.prepare(`INSERT INTO users (username, email, password_hash, full_name, phone, role, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  users.run('john.foreman', 'john.foreman@pioneertree.com', hash, 'John Smith', '555-1001', 'foreman', 2);
  users.run('jane.foreman', 'jane.foreman@northeastarbor.com', hash, 'Jane Doe', '555-1002', 'foreman', 3);
  users.run('mike.arborist', 'mike.arborist@nationalgrid.com', hash, 'Mike Johnson', '555-2001', 'arborist', 1);
  users.run('sarah.arborist', 'sarah.arborist@nationalgrid.com', hash, 'Sarah Wilson', '555-2002', 'arborist', 1);
  users.run('bob.billing', 'bob.billing@pioneertree.com', hash, 'Bob Davis', '555-3001', 'billing', 2);
  users.run('lisa.billing', 'lisa.billing@northeastarbor.com', hash, 'Lisa Brown', '555-3002', 'billing', 3);
  users.run('dave.admin', 'dave.admin@nationalgrid.com', hash, 'Dave Miller', '555-4001', 'detail_admin', 1);
  users.run('emma.admin', 'emma.admin@nationalgrid.com', hash, 'Emma Garcia', '555-4002', 'detail_admin', 1);
  users.run('admin', 'admin@pdm.com', hash, 'Super Admin', '555-9000', 'super_admin', 1);

  const projects = db.prepare(`INSERT INTO projects (project_number, work_order_number, name, description, organization_id, location, status) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  projects.run('NG-2026-001', 'WO-101', 'Main Street Pole Replacement', 'Replace utility poles on Main Street', 1, '123 Main St, Boston, MA', 'active');
  projects.run('NG-2026-002', 'WO-102', 'Oak Avenue Line Maintenance', 'Routine line maintenance on Oak Ave', 1, '456 Oak Ave, Worcester, MA', 'active');
  projects.run('NG-2026-003', 'WO-103', 'Pine Road Transformer Upgrade', 'Upgrade transformer station on Pine Rd', 1, '789 Pine Rd, Springfield, MA', 'active');
  projects.run('NG-2026-004', 'WO-104', 'Elm Street Cable Installation', 'New cable installation on Elm Street', 1, '321 Elm St, Boston, MA', 'active');
  projects.run('NG-2026-005', 'WO-105', 'Cedar Lane Vegetation Management', 'Tree trimming and vegetation management', 1, '555 Cedar Ln, Worcester, MA', 'active');

  const insertSlip = db.prepare(`INSERT INTO police_detail_slips (slip_number, project_id, status, foreman_id, arborist_id, officer_name, officer_badge, officer_department, shift_start, shift_end, total_hours, rate_per_hour, location_details, crew_info, notes, submitted_at, reviewed_at, reviewer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date();
  const d = (days) => new Date(now.getTime() + days * 86400000);

  insertSlip.run('PDS-2026-001', 1, 'approved', 1, 3, 'Officer Roberts', 'B-1234', 'Boston PD', d(-5).toISOString(), d(-5).toISOString(), 8, 85, 'Main St & First Ave', 'Crew A - 3 workers', 'All clear', d(-5).toISOString(), d(-4).toISOString(), 3);
  insertSlip.run('PDS-2026-002', 2, 'submitted', 1, null, 'Officer Williams', 'B-5678', 'Worcester PD', d(-3).toISOString(), d(-3).toISOString(), 6, 85, 'Oak Ave & 2nd St', 'Crew B - 2 workers', 'Traffic heavy', d(-3).toISOString(), null, null);
  insertSlip.run('PDS-2026-003', 1, 'draft', 2, null, 'Officer Davis', 'B-9012', 'Boston PD', d(-1).toISOString(), d(-1).toISOString(), 10, 85, 'Main St & 3rd Ave', 'Crew C - 4 workers', 'Night work', null, null, null);
  insertSlip.run('PDS-2026-004', 3, 'non_billable', 1, 4, 'Officer Martinez', 'B-3456', 'Springfield PD', d(-4).toISOString(), d(-4).toISOString(), 4, 85, 'Pine Rd & Oak St', 'Crew A - 2 workers', 'Weather delay - non billable', d(-4).toISOString(), d(-3).toISOString(), 4);
  insertSlip.run('PDS-2026-005', 4, 'changes_requested', 2, 3, 'Officer Thompson', 'B-7890', 'Boston PD', d(-2).toISOString(), d(-2).toISOString(), 8, 85, 'Elm St & Maple Ave', 'Crew B - 3 workers', 'Need corrected hours and officer badge number. Please update and resubmit.', d(-2).toISOString(), d(-1).toISOString(), 3);
  insertSlip.run('PDS-2026-006', 2, 'invoiced', 1, 3, 'Officer Anderson', 'B-1111', 'Worcester PD', d(-10).toISOString(), d(-10).toISOString(), 7.5, 90, 'Oak Ave & 4th St', 'Crew A - 3 workers', 'Overtime rate applied', d(-10).toISOString(), d(-9).toISOString(), 3);
  insertSlip.run('PDS-2026-007', 5, 'paid', 2, 4, 'Officer Clark', 'B-2222', 'Worcester PD', d(-15).toISOString(), d(-15).toISOString(), 6, 85, 'Cedar Lane & Elm', 'Crew C - 2 workers', 'Routine maintenance', d(-15).toISOString(), d(-14).toISOString(), 4);
  insertSlip.run('PDS-2026-008', 3, 'approved', 2, 4, 'Officer White', 'B-3333', 'Springfield PD', d(-7).toISOString(), d(-7).toISOString(), 8, 85, 'Pine Rd & 1st Ave', 'Crew B - 3 workers', 'Transformer work', d(-7).toISOString(), d(-6).toISOString(), 4);

  const insertStatusHistory = db.prepare(`INSERT INTO slip_status_history (slip_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)`);
  insertStatusHistory.run(1, 'draft', 1, 'foreman', 'Slip created');
  insertStatusHistory.run(1, 'submitted', 1, 'foreman', 'Submitted for review');
  insertStatusHistory.run(1, 'approved', 3, 'arborist', 'All details verified, approved');
  insertStatusHistory.run(2, 'draft', 1, 'foreman', 'Slip created');
  insertStatusHistory.run(2, 'submitted', 1, 'foreman', 'Submitted for review');
  insertStatusHistory.run(3, 'draft', 2, 'foreman', 'Slip created');
  insertStatusHistory.run(4, 'draft', 1, 'foreman', 'Slip created');
  insertStatusHistory.run(4, 'submitted', 1, 'foreman', 'Submitted');
  insertStatusHistory.run(4, 'non_billable', 4, 'arborist', 'Weather delay, not billable');
  insertStatusHistory.run(5, 'draft', 2, 'foreman', 'Slip created');
  insertStatusHistory.run(5, 'submitted', 2, 'foreman', 'Submitted');
  insertStatusHistory.run(5, 'changes_requested', 3, 'arborist', 'Badge number incorrect, hours mismatch');
  insertStatusHistory.run(6, 'draft', 1, 'foreman', 'Slip created');
  insertStatusHistory.run(6, 'submitted', 1, 'foreman', 'Submitted');
  insertStatusHistory.run(6, 'approved', 3, 'arborist', 'Approved');
  insertStatusHistory.run(6, 'invoiced', 5, 'billing', 'Invoice generated');
  insertStatusHistory.run(7, 'draft', 2, 'foreman', 'Slip created');
  insertStatusHistory.run(7, 'submitted', 2, 'foreman', 'Submitted');
  insertStatusHistory.run(7, 'approved', 4, 'arborist', 'Approved');
  insertStatusHistory.run(7, 'invoiced', 6, 'billing', 'Invoice NG-INV-2026-002');
  insertStatusHistory.run(7, 'reconciled', 7, 'detail_admin', 'Reconciled');
  insertStatusHistory.run(7, 'paid', 7, 'detail_admin', 'Payment processed');
  insertStatusHistory.run(7, 'archived', 7, 'detail_admin', 'Archived after payment');
  insertStatusHistory.run(8, 'draft', 2, 'foreman', 'Slip created');
  insertStatusHistory.run(8, 'submitted', 2, 'foreman', 'Submitted');
  insertStatusHistory.run(8, 'approved', 4, 'arborist', 'Approved');

  const insertInvoice = db.prepare(`INSERT INTO invoices (invoice_number, slip_id, status, billing_team_id, subtotal, tax_rate, tax_amount, grand_total, reconciled_at, reconciled_by, paid_at, paid_by, payment_reference, archived_at, archived_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertInvoice.run('NG-INV-2026-001', 6, 'submitted', 5, 675, 6.25, 42.19, 717.19, null, null, null, null, null, null, null);
  insertInvoice.run('NG-INV-2026-002', 7, 'archived', 6, 510, 6.25, 31.88, 541.88, d(-13).toISOString(), 7, d(-12).toISOString(), 7, 'PAY-REF-2026-001', d(-11).toISOString(), 7);
  insertInvoice.run('NG-INV-2026-003', 8, 'draft', 6, 0, 6.25, 0, 0, null, null, null, null, null, null, null);

  const insertInvoiceSlip = db.prepare('INSERT OR IGNORE INTO invoice_slips (invoice_id, slip_id) VALUES (?, ?)');
  insertInvoiceSlip.run(1, 6);
  insertInvoiceSlip.run(2, 7);
  insertInvoiceSlip.run(3, 8);

  const insertInvoiceLineItems = db.prepare(`INSERT INTO invoice_line_items (invoice_id, description, hours, rate, amount) VALUES (?, ?, ?, ?, ?)`);
  insertInvoiceLineItems.run(1, 'Traffic Control - Main St Pole Replacement', 7.5, 90, 675);
  insertInvoiceLineItems.run(2, 'Traffic Control - Cedar Lane Vegetation Management', 6, 85, 510);
  insertInvoiceLineItems.run(3, 'Traffic Control - Pine Road Transformer Upgrade', 8, 85, 680);

  const insertInvoiceHistory = db.prepare(`INSERT INTO invoice_status_history (invoice_id, status, changed_by, changed_by_role, comments) VALUES (?, ?, ?, ?, ?)`);
  insertInvoiceHistory.run(1, 'draft', 5, 'billing', 'Invoice created');
  insertInvoiceHistory.run(1, 'submitted', 5, 'billing', 'Submitted for reconciliation');
  insertInvoiceHistory.run(2, 'draft', 6, 'billing', 'Invoice created');
  insertInvoiceHistory.run(2, 'submitted', 6, 'billing', 'Submitted');
  insertInvoiceHistory.run(2, 'under_review', 7, 'detail_admin', 'Under review');
  insertInvoiceHistory.run(2, 'reconciled', 7, 'detail_admin', 'All items verified');
  insertInvoiceHistory.run(2, 'paid', 7, 'detail_admin', 'Payment completed');
  insertInvoiceHistory.run(2, 'archived', 7, 'detail_admin', 'Archived');
  insertInvoiceHistory.run(3, 'draft', 6, 'billing', 'Invoice created');

  const insertPayment = db.prepare(`INSERT INTO payments (invoice_id, amount, payment_date, reference_number, payment_method, received_by) VALUES (?, ?, ?, ?, ?, ?)`);
  insertPayment.run(2, 541.88, d(-12).toISOString(), 'PAY-REF-2026-001', 'Wire Transfer', 7);

  const notifications = db.prepare(`INSERT INTO notifications (user_id, type, title, message, link, is_read) VALUES (?, ?, ?, ?, ?, ?)`);
  notifications.run(1, 'slip_approved', 'Slip PDS-2026-001 Approved', 'Your police detail slip has been approved.', '/slips/view/1', 1);
  notifications.run(1, 'slip_rejected', 'Slip PDS-2026-004 Marked Non-Billable', 'A slip has been marked as non-billable.', '/slips/view/4', 0);
  notifications.run(2, 'slip_changes_requested', 'Changes Requested for PDS-2026-005', 'Please review requested changes and resubmit.', '/slips/view/5', 0);
  notifications.run(6, 'invoice_reconciled', 'Invoice NG-INV-2026-002 Reconciled', 'Your invoice has been reconciled.', '/invoices/view/2', 1);
  notifications.run(6, 'invoice_paid', 'Invoice NG-INV-2026-002 Paid', 'Payment has been processed for invoice.', '/invoices/view/2', 0);

  const auditLogs = db.prepare(`INSERT INTO audit_logs (user_id, username, role, action, entity_type, entity_id, before_state, after_state, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  auditLogs.run(1, 'john.foreman', 'foreman', 'CREATE', 'slip', 1, null, JSON.stringify({status:'draft'}), '192.168.1.1');
  auditLogs.run(1, 'john.foreman', 'foreman', 'SUBMIT', 'slip', 1, JSON.stringify({status:'draft'}), JSON.stringify({status:'submitted'}), '192.168.1.1');
  auditLogs.run(3, 'mike.arborist', 'arborist', 'APPROVE', 'slip', 1, JSON.stringify({status:'submitted'}), JSON.stringify({status:'approved'}), '192.168.1.2');
  auditLogs.run(7, 'dave.admin', 'detail_admin', 'RECONCILE', 'invoice', 2, JSON.stringify({status:'under_review'}), JSON.stringify({status:'reconciled'}), '192.168.1.3');
  auditLogs.run(7, 'dave.admin', 'detail_admin', 'PAY', 'invoice', 2, JSON.stringify({status:'reconciled'}), JSON.stringify({status:'paid'}), '192.168.1.3');
  auditLogs.run(7, 'dave.admin', 'detail_admin', 'ARCHIVE', 'invoice', 2, JSON.stringify({status:'paid'}), JSON.stringify({status:'archived'}), '192.168.1.3');

  console.log('Database seeded successfully!');
  console.log('Login credentials:');
  console.log('  All users: password = password123');
  console.log('  Foreman: john.foreman / jane.foreman');
  console.log('  Arborist: mike.arborist / sarah.arborist');
  console.log('  Billing: bob.billing / lisa.billing');
  console.log('  Detail Admin: dave.admin / emma.admin');
  console.log('  Super Admin: admin');
}

seed();
