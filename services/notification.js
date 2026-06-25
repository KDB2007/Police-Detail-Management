const { getDb } = require('../database/schema');

function createNotification({ userId, type, title, message, link }) {
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)`);
  return stmt.run(userId, type, title, message, link || null);
}

function notifySlipSubmitted(slipId, foremanName) {
  const db = getDb();
  const arborists = db.prepare("SELECT id FROM users WHERE role = 'arborist' AND is_active = 1").all();
  for (const a of arborists) {
    createNotification({
      userId: a.id,
      type: 'slip_submitted',
      title: 'New Slip Submitted',
      message: `A new police detail slip has been submitted by ${foremanName}`,
      link: `/slips/view/${slipId}`
    });
  }
}

function notifySlipApproved(slipId, foremanId) {
  createNotification({
    userId: foremanId,
    type: 'slip_approved',
    title: 'Slip Approved',
    message: 'Your police detail slip has been approved and is ready for invoicing.',
    link: `/slips/view/${slipId}`
  });
}

function notifySlipRejected(slipId, foremanId, reason) {
  createNotification({
    userId: foremanId,
    type: 'slip_rejected',
    title: 'Slip Rejected',
    message: reason ? `Your slip was rejected: ${reason}` : 'Your police detail slip has been rejected.',
    link: `/slips/view/${slipId}`
  });
}

function notifySlipChangesRequested(slipId, foremanId, notes) {
  createNotification({
    userId: foremanId,
    type: 'slip_changes_requested',
    title: 'Changes Requested',
    message: notes ? `Changes requested: ${notes}` : 'Changes have been requested for your slip.',
    link: `/slips/view/${slipId}`
  });
}

function notifySlipNonBillable(slipId, foremanId, reason) {
  createNotification({
    userId: foremanId,
    type: 'slip_non_billable',
    title: 'Slip Marked Non-Billable',
    message: reason ? `Marked non-billable: ${reason}` : 'Your slip has been marked as non-billable.',
    link: `/slips/view/${slipId}`
  });
}

function notifyInvoiceCreated(invoiceId, slipId) {
  const db = getDb();
  const admins = db.prepare("SELECT id FROM users WHERE role = 'detail_admin' AND is_active = 1").all();
  const slip = db.prepare('SELECT foreman_id FROM police_detail_slips WHERE id = ?').get(slipId);
  for (const a of admins) {
    createNotification({
      userId: a.id,
      type: 'invoice_created',
      title: 'New Invoice Created',
      message: 'A new invoice has been created from an approved slip.',
      link: `/invoices/view/${invoiceId}`
    });
  }
  if (slip) {
    createNotification({
      userId: slip.foreman_id,
      type: 'invoice_created',
      title: 'Invoice Generated',
      message: 'An invoice has been generated from your approved slip.',
      link: `/invoices/view/${invoiceId}`
    });
  }
}

function notifyInvoiceReconciled(invoiceId, billingTeamId) {
  createNotification({
    userId: billingTeamId,
    type: 'invoice_reconciled',
    title: 'Invoice Reconciled',
    message: 'Your invoice has been reconciled by NG Detail Admin.',
    link: `/invoices/view/${invoiceId}`
  });
}

function notifyInvoicePaid(invoiceId, billingTeamId) {
  createNotification({
    userId: billingTeamId,
    type: 'invoice_paid',
    title: 'Invoice Paid',
    message: 'Payment has been processed for your invoice.',
    link: `/invoices/view/${invoiceId}`
  });
}

function notifyUserCreated(userId) {
  createNotification({
    userId,
    type: 'user_created',
    title: 'Account Created',
    message: 'Your account has been created. Please log in.',
    link: '/login'
  });
}

function notifyRoleUpdated(userId) {
  createNotification({
    userId,
    type: 'role_updated',
    title: 'Role Updated',
    message: 'Your account role has been updated by an administrator.',
    link: '/dashboard'
  });
}

module.exports = {
  createNotification,
  notifySlipSubmitted,
  notifySlipApproved,
  notifySlipRejected,
  notifySlipChangesRequested,
  notifySlipNonBillable,
  notifyInvoiceCreated,
  notifyInvoiceReconciled,
  notifyInvoicePaid,
  notifyUserCreated,
  notifyRoleUpdated
};
