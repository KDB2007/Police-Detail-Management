const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { getDb } = require('../database/schema');

function exportSlipsToPDF(res, filters) {
  const db = getDb();
  let query = `SELECT s.*, p.project_number, p.name as project_name, u.full_name as foreman_name, o.name as org_name
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations o ON u.organization_id = o.id
    WHERE 1=1`;
  const params = [];
  if (filters.status) { query += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.project_id) { query += ' AND s.project_id = ?'; params.push(filters.project_id); }
  if (filters.foreman_id) { query += ' AND s.foreman_id = ?'; params.push(filters.foreman_id); }
  if (filters.date_from) { query += ' AND s.shift_start >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { query += ' AND s.shift_end <= ?'; params.push(filters.date_to); }
  query += ' ORDER BY s.created_at DESC';
  const slips = db.prepare(query).all(...params);

  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=slips_report.pdf');
  doc.pipe(res);

  doc.fontSize(20).font('Helvetica-Bold').text('Police Detail Slips Report', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown();

  slips.forEach((slip, i) => {
    if (i > 0) doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').text(`Slip: ${slip.slip_number}`);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Project: ${slip.project_number} - ${slip.project_name}`);
    doc.text(`Foreman: ${slip.foreman_name}`);
    doc.text(`Organization: ${slip.org_name}`);
    doc.text(`Status: ${slip.status}`);
    doc.text(`Officer: ${slip.officer_name} (${slip.officer_badge || 'N/A'})`);
    doc.text(`Shift: ${slip.shift_start} - ${slip.shift_end}`);
    doc.text(`Hours: ${slip.total_hours} @ $${slip.rate_per_hour}/hr`);
    doc.text(`Location: ${slip.location_details || 'N/A'}`);
    doc.text(`Crew: ${slip.crew_info || 'N/A'}`);
    doc.text(`Submitted: ${slip.submitted_at || 'Not submitted'}`);
    doc.text(`Reviewed: ${slip.reviewed_at || 'Not reviewed'}`);
    if (slip.notes) doc.text(`Notes: ${slip.notes}`);
  });

  doc.end();
}

function exportSlipsToExcel(res, filters) {
  const db = getDb();
  let query = `SELECT s.slip_number, p.project_number, p.name as project_name, u.full_name as foreman_name,
    o.name as org_name, s.officer_name, s.officer_badge, s.officer_department, s.shift_start, s.shift_end,
    s.total_hours, s.rate_per_hour, s.status, s.location_details, s.crew_info, s.submitted_at, s.reviewed_at
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations o ON u.organization_id = o.id
    WHERE 1=1`;
  const params = [];
  if (filters.status) { query += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.project_id) { query += ' AND s.project_id = ?'; params.push(filters.project_id); }
  if (filters.foreman_id) { query += ' AND s.foreman_id = ?'; params.push(filters.foreman_id); }
  if (filters.date_from) { query += ' AND s.shift_start >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { query += ' AND s.shift_end <= ?'; params.push(filters.date_to); }
  query += ' ORDER BY s.created_at DESC';
  const slips = db.prepare(query).all(...params);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Police Detail Slips');
  sheet.columns = [
    { header: 'Slip Number', key: 'slip_number', width: 18 },
    { header: 'Project Number', key: 'project_number', width: 15 },
    { header: 'Project Name', key: 'project_name', width: 30 },
    { header: 'Foreman', key: 'foreman_name', width: 20 },
    { header: 'Organization', key: 'org_name', width: 25 },
    { header: 'Officer Name', key: 'officer_name', width: 20 },
    { header: 'Badge', key: 'officer_badge', width: 12 },
    { header: 'Department', key: 'officer_department', width: 18 },
    { header: 'Shift Start', key: 'shift_start', width: 20 },
    { header: 'Shift End', key: 'shift_end', width: 20 },
    { header: 'Hours', key: 'total_hours', width: 10 },
    { header: 'Rate', key: 'rate_per_hour', width: 10 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Location', key: 'location_details', width: 25 },
    { header: 'Crew', key: 'crew_info', width: 20 },
    { header: 'Submitted', key: 'submitted_at', width: 20 },
    { header: 'Reviewed', key: 'reviewed_at', width: 20 }
  ];
  slips.forEach(s => sheet.addRow(s));
  sheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=slips_report.xlsx');
  return workbook.xlsx.write(res).then(() => res.end());
}

function exportSlipsToCSV(res, filters) {
  const db = getDb();
  let query = `SELECT s.slip_number, p.project_number, p.name as project_name, u.full_name as foreman_name,
    o.name as org_name, s.officer_name, s.officer_badge, s.officer_department, s.shift_start, s.shift_end,
    s.total_hours, s.rate_per_hour, s.status, s.location_details, s.crew_info, s.submitted_at, s.reviewed_at
    FROM police_detail_slips s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN users u ON s.foreman_id = u.id
    LEFT JOIN organizations o ON u.organization_id = o.id
    WHERE 1=1`;
  const params = [];
  if (filters.status) { query += ' AND s.status = ?'; params.push(filters.status); }
  if (filters.project_id) { query += ' AND s.project_id = ?'; params.push(filters.project_id); }
  if (filters.foreman_id) { query += ' AND s.foreman_id = ?'; params.push(filters.foreman_id); }
  if (filters.date_from) { query += ' AND s.shift_start >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { query += ' AND s.shift_end <= ?'; params.push(filters.date_to); }
  query += ' ORDER BY s.created_at DESC';
  const slips = db.prepare(query).all(...params);

  const headers = ['Slip Number','Project Number','Project Name','Foreman','Organization','Officer Name','Badge','Department','Shift Start','Shift End','Hours','Rate','Status','Location','Crew','Submitted','Reviewed'];
  let csv = headers.join(',') + '\n';
  slips.forEach(s => {
    const row = headers.map(h => {
      const key = h.toLowerCase().replace(/ /g,'_');
      const val = s[key] || '';
      return `"${String(val).replace(/"/g,'""')}"`;
    });
    csv += row.join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=slips_report.csv');
  res.send(csv);
}

function exportInvoicesToExcel(res, filters) {
  const db = getDb();
  let query = `SELECT i.invoice_number, s.slip_number, i.status, i.subtotal, i.tax_rate, i.tax_amount, i.grand_total,
    u.full_name as billing_person, i.payment_reference, i.paid_at, i.created_at
    FROM invoices i
    LEFT JOIN police_detail_slips s ON i.slip_id = s.id
    LEFT JOIN users u ON i.billing_team_id = u.id
    WHERE 1=1`;
  const params = [];
  if (filters.status) { query += ' AND i.status = ?'; params.push(filters.status); }
  if (filters.date_from) { query += ' AND i.created_at >= ?'; params.push(filters.date_from); }
  if (filters.date_to) { query += ' AND i.created_at <= ?'; params.push(filters.date_to); }
  query += ' ORDER BY i.created_at DESC';
  const invoices = db.prepare(query).all(...params);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Invoices');
  sheet.columns = [
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Slip Number', key: 'slip_number', width: 18 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Subtotal', key: 'subtotal', width: 12 },
    { header: 'Tax Rate', key: 'tax_rate', width: 10 },
    { header: 'Tax Amount', key: 'tax_amount', width: 12 },
    { header: 'Grand Total', key: 'grand_total', width: 14 },
    { header: 'Billing Person', key: 'billing_person', width: 20 },
    { header: 'Payment Ref', key: 'payment_reference', width: 20 },
    { header: 'Paid At', key: 'paid_at', width: 20 },
    { header: 'Created', key: 'created_at', width: 20 }
  ];
  invoices.forEach(inv => sheet.addRow(inv));
  sheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=invoices_report.xlsx');
  return workbook.xlsx.write(res).then(() => res.end());
}

module.exports = { exportSlipsToPDF, exportSlipsToExcel, exportSlipsToCSV, exportInvoicesToExcel };
