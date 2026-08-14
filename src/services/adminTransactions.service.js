'use strict';

/**
 * Admin Transactions — a unified, read-only view across every real-money
 * Razorpay-backed payment flow on the platform: MSME direct-customer
 * eligibility fees (CasePayment) and DSA wallet top-ups (WalletTopupRequest).
 *
 * Deliberately excludes purely internal computed ledgers (CommissionLedger,
 * SubDsaPayoutLedger, SalesIncentiveLedger, Disbursement, WalletTransaction) —
 * those aren't something a "user" pays for, they're the platform's own
 * accounting of money already earned, and each already has its own dedicated
 * admin/DSA page. This page exists specifically to answer "did this payment
 * actually happen" for the two flows where a human hands over real money
 * through Razorpay Checkout.
 *
 * Each row is cross-referenced against RazorpayWebhookEvent by
 * razorpay_order_id. This matters because the webhook handler
 * (webhook.controller.js) only ever updates WalletTopupRequest — it never
 * touches CasePayment at all. A CasePayment only becomes 'PAID' if the
 * frontend's post-checkout success handler successfully calls
 * POST /msme/payment/verify; if that call is dropped (closed tab, network
 * blip) the row is stuck at 'INITIATED' forever even though Razorpay
 * actually captured the money — RazorpayWebhookEvent's raw payload is the
 * only remaining record that the capture really happened. `reconciliation_flag`
 * below surfaces exactly that mismatch.
 */

const prisma = require('../../config/db');

const STATUS_MAP = {
  CASE_PAYMENT: {
    INITIATED: 'PENDING',
    PAID: 'SUCCESS',
  },
  WALLET_TOPUP: {
    INITIATED: 'PENDING',
    CREDITED: 'SUCCESS',
    FAILED: 'FAILED',
    REFUND_REVIEW_REQUIRED: 'REVIEW',
  },
};

const VALID_STATUSES = ['SUCCESS', 'PENDING', 'FAILED', 'REVIEW'];
const VALID_TYPES = ['CASE_PAYMENT', 'WALLET_TOPUP'];
const MAX_ROWS_PER_SOURCE = 10000;

function normalizeStatus(source, rawStatus) {
  return (STATUS_MAP[source] && STATUS_MAP[source][rawStatus]) || rawStatus || 'UNKNOWN';
}

function rawStatusesFor(source, normalized) {
  if (!normalized) return null;
  return Object.entries(STATUS_MAP[source])
    .filter(([, norm]) => norm === normalized)
    .map(([raw]) => raw);
}

function parseDateBoundary(value, endOfDay) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function parseFilters(query = {}) {
  const type = VALID_TYPES.includes(query.type) ? query.type : null;
  const status = VALID_STATUSES.includes(query.status) ? query.status : null;
  const search = String(query.search || '').trim();
  const dateFrom = parseDateBoundary(query.date_from, false);
  const dateTo = parseDateBoundary(query.date_to, true);
  const minAmount = query.min_amount !== undefined && query.min_amount !== '' && Number.isFinite(Number(query.min_amount))
    ? Number(query.min_amount) : undefined;
  const maxAmount = query.max_amount !== undefined && query.max_amount !== '' && Number.isFinite(Number(query.max_amount))
    ? Number(query.max_amount) : undefined;
  return { type, status, search, dateFrom, dateTo, minAmount, maxAmount };
}

function buildCreatedAtFilter({ dateFrom, dateTo }) {
  if (!dateFrom && !dateTo) return undefined;
  const f = {};
  if (dateFrom) f.gte = dateFrom;
  if (dateTo) f.lte = dateTo;
  return f;
}

function buildAmountFilter({ minAmount, maxAmount }) {
  if (minAmount === undefined && maxAmount === undefined) return undefined;
  const f = {};
  if (minAmount !== undefined) f.gte = minAmount;
  if (maxAmount !== undefined) f.lte = maxAmount;
  return f;
}

// A search box entry of "42", "CP-42" or "cp-42" is treated as an exact id
// lookup (scoped to the given source's own id prefix) in addition to the
// normal text-contains matching below — lets an admin paste the row id shown
// in the table straight back into search.
function extractNumericToken(search, prefix) {
  const trimmed = search.trim();
  const prefixed = new RegExp(`^${prefix}-?(\\d+)$`, 'i').exec(trimmed);
  if (prefixed) return Number(prefixed[1]);
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return undefined;
}

async function fetchCasePayments(filters) {
  if (filters.type && filters.type !== 'CASE_PAYMENT') return [];
  const rawStatuses = rawStatusesFor('CASE_PAYMENT', filters.status);
  if (filters.status && (!rawStatuses || rawStatuses.length === 0)) return [];

  const where = {};
  if (rawStatuses) where.status = { in: rawStatuses };
  const createdAt = buildCreatedAtFilter(filters);
  if (createdAt) where.created_at = createdAt;
  const amount = buildAmountFilter(filters);
  if (amount) where.amount_inr = amount;

  if (filters.search) {
    const s = filters.search;
    const numericId = extractNumericToken(s, 'CP');
    where.OR = [
      { razorpay_order_id: { contains: s, mode: 'insensitive' } },
      { razorpay_payment_id: { contains: s, mode: 'insensitive' } },
      { purpose: { contains: s, mode: 'insensitive' } },
      { user: { name: { contains: s, mode: 'insensitive' } } },
      { user: { email: { contains: s, mode: 'insensitive' } } },
      { user: { mobile: { contains: s, mode: 'insensitive' } } },
      ...(numericId !== undefined ? [{ id: numericId }, { case_id: numericId }] : []),
    ];
  }

  const rows = await prisma.casePayment.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true, mobile: true } } },
    orderBy: { created_at: 'desc' },
    take: MAX_ROWS_PER_SOURCE,
  });

  return rows.map((row) => ({
    id: `CP-${row.id}`,
    source: 'CASE_PAYMENT',
    type_label: 'MSME Eligibility Fee',
    amount_inr: Number(row.amount_inr),
    currency: row.currency,
    status: normalizeStatus('CASE_PAYMENT', row.status),
    raw_status: row.status,
    razorpay_order_id: row.razorpay_order_id,
    razorpay_payment_id: row.razorpay_payment_id,
    user: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email, mobile: row.user.mobile } : null,
    tenant: null,
    case_id: row.case_id,
    purpose: row.purpose,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    completed_at: row.verified_at,
  }));
}

async function fetchWalletTopups(filters) {
  if (filters.type && filters.type !== 'WALLET_TOPUP') return [];
  const rawStatuses = rawStatusesFor('WALLET_TOPUP', filters.status);
  if (filters.status && (!rawStatuses || rawStatuses.length === 0)) return [];

  const where = {};
  if (rawStatuses) where.status = { in: rawStatuses };
  const createdAt = buildCreatedAtFilter(filters);
  if (createdAt) where.created_at = createdAt;
  const amount = buildAmountFilter(filters);
  if (amount) where.amount_inr = amount;

  if (filters.search) {
    const s = filters.search;
    const numericId = extractNumericToken(s, 'WT');
    where.OR = [
      { razorpay_order_id: { contains: s, mode: 'insensitive' } },
      { razorpay_payment_id: { contains: s, mode: 'insensitive' } },
      { user: { name: { contains: s, mode: 'insensitive' } } },
      { user: { email: { contains: s, mode: 'insensitive' } } },
      { user: { mobile: { contains: s, mode: 'insensitive' } } },
      { tenant: { name: { contains: s, mode: 'insensitive' } } },
      ...(numericId !== undefined ? [{ id: numericId }] : []),
    ];
  }

  const rows = await prisma.walletTopupRequest.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, mobile: true } },
      tenant: { select: { id: true, name: true } },
    },
    orderBy: { created_at: 'desc' },
    take: MAX_ROWS_PER_SOURCE,
  });

  return rows.map((row) => ({
    id: `WT-${row.id}`,
    source: 'WALLET_TOPUP',
    type_label: 'DSA Wallet Top-up',
    amount_inr: Number(row.amount_inr),
    currency: row.currency,
    status: normalizeStatus('WALLET_TOPUP', row.status),
    raw_status: row.status,
    razorpay_order_id: row.razorpay_order_id,
    razorpay_payment_id: row.razorpay_payment_id,
    user: row.user ? { id: row.user.id, name: row.user.name, email: row.user.email, mobile: row.user.mobile } : null,
    tenant: row.tenant ? { id: row.tenant.id, name: row.tenant.name } : null,
    case_id: null,
    purpose: `Wallet top-up — ${row.credits_to_add} credits`,
    failure_reason: row.failure_reason,
    created_at: row.created_at,
    completed_at: row.credited_at || row.failed_at,
  }));
}

function emptyWebhookInfo() {
  return { received: false, latest_event_type: null, processed: null, received_at: null, event_count: 0, captured: false, failed: false };
}

async function attachWebhookInfo(rows) {
  const orderIds = [...new Set(rows.map((r) => r.razorpay_order_id).filter(Boolean))];
  if (orderIds.length === 0) {
    rows.forEach((r) => { r.webhook = emptyWebhookInfo(); r.reconciliation_flag = null; });
    return;
  }

  const events = await prisma.razorpayWebhookEvent.findMany({
    where: { razorpay_order_id: { in: orderIds } },
    orderBy: { received_at: 'desc' },
  });

  const byOrder = new Map();
  for (const e of events) {
    if (!byOrder.has(e.razorpay_order_id)) byOrder.set(e.razorpay_order_id, []);
    byOrder.get(e.razorpay_order_id).push(e);
  }

  for (const row of rows) {
    const evs = row.razorpay_order_id ? (byOrder.get(row.razorpay_order_id) || []) : [];
    row.webhook = evs.length
      ? {
        received: true,
        latest_event_type: evs[0].event_type,
        processed: evs[0].processed,
        received_at: evs[0].received_at,
        event_count: evs.length,
        captured: evs.some((e) => e.event_type === 'payment.captured'),
        failed: evs.some((e) => e.event_type === 'payment.failed'),
      }
      : emptyWebhookInfo();

    row.reconciliation_flag = row.status === 'PENDING' && row.webhook.captured
      ? 'CAPTURED_NOT_REFLECTED'
      : row.status === 'PENDING' && row.webhook.failed
        ? 'FAILED_NOT_REFLECTED'
        : null;
  }
}

async function getAllFilteredRows(query) {
  const filters = parseFilters(query);
  const [casePayments, walletTopups] = await Promise.all([
    fetchCasePayments(filters),
    fetchWalletTopups(filters),
  ]);
  const rows = [...casePayments, ...walletTopups];
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  await attachWebhookInfo(rows);
  return { rows, filters };
}

async function list(query) {
  const { rows } = await getAllFilteredRows(query);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 200);
  const total = rows.length;
  const start = (page - 1) * limit;
  const transactions = rows.slice(start, start + limit);
  return { transactions, total, page, limit, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

async function summary(query) {
  const { rows } = await getAllFilteredRows(query);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const out = {
    total_count: rows.length,
    total_amount: 0,
    success_count: 0,
    success_amount: 0,
    pending_count: 0,
    failed_count: 0,
    review_count: 0,
    mismatch_count: 0,
    case_payment_count: 0,
    case_payment_amount: 0,
    wallet_topup_count: 0,
    wallet_topup_amount: 0,
    today_success_count: 0,
    today_success_amount: 0,
  };

  for (const r of rows) {
    out.total_amount += r.amount_inr;
    if (r.status === 'SUCCESS') { out.success_count += 1; out.success_amount += r.amount_inr; }
    else if (r.status === 'PENDING') out.pending_count += 1;
    else if (r.status === 'FAILED') out.failed_count += 1;
    else if (r.status === 'REVIEW') out.review_count += 1;

    if (r.reconciliation_flag) out.mismatch_count += 1;

    if (r.source === 'CASE_PAYMENT') { out.case_payment_count += 1; out.case_payment_amount += r.amount_inr; }
    else { out.wallet_topup_count += 1; out.wallet_topup_amount += r.amount_inr; }

    if (r.status === 'SUCCESS' && new Date(r.created_at) >= todayStart) {
      out.today_success_count += 1;
      out.today_success_amount += r.amount_inr;
    }
  }

  return out;
}

function describeFilters(filters) {
  const parts = [];
  parts.push(`Type: ${filters.type ? (filters.type === 'CASE_PAYMENT' ? 'MSME Eligibility Fee' : 'DSA Wallet Top-up') : 'All'}`);
  parts.push(`Status: ${filters.status || 'All'}`);
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`Date: ${filters.dateFrom ? filters.dateFrom.toLocaleDateString('en-IN') : '…'} – ${filters.dateTo ? filters.dateTo.toLocaleDateString('en-IN') : '…'}`);
  }
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    parts.push(`Amount: Rs ${filters.minAmount ?? 0} – ${filters.maxAmount !== undefined ? `Rs ${filters.maxAmount}` : 'no max'}`);
  }
  if (filters.search) parts.push(`Search: "${filters.search}"`);
  return parts.join('   |   ');
}

async function buildExcelWorkbook(query) {
  const ExcelJS = require('exceljs');
  const { rows } = await getAllFilteredRows(query);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cred2Tech Admin';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Transactions');

  sheet.columns = [
    { header: 'Row ID', key: 'id', width: 12 },
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Type', key: 'type', width: 22 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Amount (INR)', key: 'amount', width: 14 },
    { header: 'User Name', key: 'user_name', width: 22 },
    { header: 'User Email', key: 'user_email', width: 26 },
    { header: 'User Mobile', key: 'user_mobile', width: 15 },
    { header: 'Tenant (DSA)', key: 'tenant_name', width: 22 },
    { header: 'Case ID', key: 'case_id', width: 10 },
    { header: 'Razorpay Order ID', key: 'order_id', width: 26 },
    { header: 'Razorpay Payment ID', key: 'payment_id', width: 26 },
    { header: 'Purpose', key: 'purpose', width: 30 },
    { header: 'Failure Reason', key: 'failure_reason', width: 30 },
    { header: 'Webhook Received', key: 'webhook_received', width: 16 },
    { header: 'Webhook Event', key: 'webhook_event', width: 20 },
    { header: 'Reconciliation Flag', key: 'flag', width: 24 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  rows.forEach((r) => {
    sheet.addRow({
      id: r.id,
      date: new Date(r.created_at).toLocaleString('en-IN'),
      type: r.type_label,
      status: r.status,
      amount: r.amount_inr,
      user_name: r.user?.name || '—',
      user_email: r.user?.email || '—',
      user_mobile: r.user?.mobile || '—',
      tenant_name: r.tenant?.name || '—',
      case_id: r.case_id || '—',
      order_id: r.razorpay_order_id || '—',
      payment_id: r.razorpay_payment_id || '—',
      purpose: r.purpose || '—',
      failure_reason: r.failure_reason || '—',
      webhook_received: r.webhook.received ? 'Yes' : 'No',
      webhook_event: r.webhook.latest_event_type || '—',
      flag: r.reconciliation_flag || '—',
    });
  });

  sheet.getColumn('amount').numFmt = '#,##0.00';
  return wb;
}

async function streamPdfReport(query, res) {
  const PDFDocument = require('pdfkit');
  const { rows, filters } = await getAllFilteredRows(query);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
  // Pipe FIRST, before any content is written — pdfkit is a readable stream
  // that starts paused; writing content before a destination is attached
  // risks losing buffered chunks if the stream starts flowing early.
  doc.pipe(res);

  doc.fontSize(16).fillColor('#4f46e5').text('Cred2Tech — Transaction Report', { continued: false });
  doc.fontSize(8).fillColor('#666').text(`Generated ${new Date().toLocaleString('en-IN')}`);
  doc.fontSize(8).fillColor('#666').text(describeFilters(filters));
  doc.moveDown(0.6);

  const columns = [
    { key: 'date', label: 'Date', width: 85 },
    { key: 'type', label: 'Type', width: 105 },
    { key: 'status', label: 'Status', width: 55 },
    { key: 'amount', label: 'Amount', width: 75 },
    { key: 'party', label: 'User / Tenant', width: 140 },
    { key: 'order_id', label: 'Razorpay Order ID', width: 175 },
    { key: 'flag', label: 'Flag', width: 130 },
  ];
  const tableWidth = columns.reduce((s, c) => s + c.width, 0);
  const startX = doc.page.margins.left;
  const rowHeight = 16;
  let y = doc.y;
  // pdfkit only truncates-with-ellipsis for text that overflows both `width`
  // AND `height` — `ellipsis` alone (even combined with `lineBreak: false`)
  // still wraps long strings onto a second line instead of cutting them off,
  // which pushed a long name's second line down into the next row's stripe.
  // Constraining `height` to one line height is what actually forces the
  // single-line-with-"…" behavior.
  doc.fontSize(7.5);
  const cellLineHeight = doc.currentLineHeight();

  const drawHeaderRow = () => {
    doc.rect(startX, y, tableWidth, rowHeight).fill('#4f46e5');
    let x = startX;
    doc.fontSize(7.5).fillColor('#ffffff');
    columns.forEach((c) => {
      doc.text(c.label, x + 4, y + 4, { width: c.width - 6, height: cellLineHeight, ellipsis: true });
      x += c.width;
    });
    y += rowHeight;
  };

  drawHeaderRow();

  rows.forEach((r, idx) => {
    if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeaderRow();
    }
    if (idx % 2 === 0) {
      doc.rect(startX, y, tableWidth, rowHeight).fill('#f4f4f8');
    }
    // Rupee sign (₹) isn't reliably in pdfkit's built-in Helvetica glyph set —
    // renders as a missing-glyph box on some viewers. "Rs" avoids that.
    const cells = {
      date: new Date(r.created_at).toLocaleDateString('en-IN'),
      type: r.type_label,
      status: r.status,
      amount: `Rs ${r.amount_inr.toLocaleString('en-IN')}`,
      party: r.user?.name || r.tenant?.name || '—',
      order_id: r.razorpay_order_id || '—',
      flag: r.reconciliation_flag ? r.reconciliation_flag.replace(/_/g, ' ') : '',
    };
    let x = startX;
    doc.fontSize(7.5).fillColor(r.reconciliation_flag ? '#b91c1c' : '#111111');
    columns.forEach((c) => {
      doc.text(String(cells[c.key] ?? ''), x + 4, y + 4, { width: c.width - 6, height: cellLineHeight, ellipsis: true });
      x += c.width;
    });
    y += rowHeight;
  });

  if (rows.length === 0) {
    doc.fontSize(9).fillColor('#666').text('No transactions match the applied filters.', startX + 4, y + 6);
  }

  doc.end();
}

module.exports = {
  list,
  summary,
  buildExcelWorkbook,
  streamPdfReport,
};
