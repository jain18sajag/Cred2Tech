'use strict';

/**
 * Loan Application Summary Excel Report
 *
 * Generates the template-based Loan Application Summary workbook without
 * changing the uploaded template layout/design. Values are mapped from the
 * existing case/customer/applicant/property/ESR/API data sources.
 *
 * Requires exceljs because the existing `xlsx` package does not reliably
 * preserve template formatting and cannot insert images.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const axios = require('axios');
const prisma = require('../../../config/db');
const { getStorageProvider } = require('../storage');

const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/reports/Loan Application Summary.xlsx');
const LOGO_PATH = path.resolve(__dirname, '../../templates/reports/white-logo.jpg');

const SHEET_NAMES = [
  'Summary',
  'Bank Statement Analysis',
  'ITR Analysis',
  'GST Analysis',
  'Cibil - Transunion'
];
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SOURCE_EXCEL_SIZE_BYTES = 15 * 1024 * 1024;
const SOURCE_SHEET_LIMITS = {
  bank: ['Summary', 'Overview', 'Monthly summary', 'Daily balance', 'Transactions'],
  itr: ['General Information', 'Tax Calculation', 'Balance Sheet', 'Profit and Loss Statement', 'Ratio Analysis'],
  gst: ['Account Details', 'Entity Details', 'Overview Yearly', 'Overview Monthly', 'Monthly Sales and Purchase', 'Customer Summary', 'Supplier Summary']
};

function buildReportFileName(caseId) {
  const suffix = Number.isFinite(Number(caseId)) ? Number(caseId) : String(caseId || 'case');
  return `Loan_Application_Summary_${suffix}.xlsx`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────────────

function isBlank(value) {
  return value === undefined || value === null || value === '';
}

function safe(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  return value;
}

function safeNA(value) {
  return safe(value, 'N/A');
}

function sanitizeExcelValue(value, fallback = '') {
  const resolved = safe(value, fallback);
  if (resolved === undefined || resolved === null || resolved === '') return fallback;
  if (typeof resolved === 'number') return Number.isFinite(resolved) ? resolved : fallback;
  if (resolved instanceof Date) return resolved;
  const text = String(resolved)
    .replace(/\b(null|undefined|NaN|None)\b/gi, 'N/A')
    .trim();
  if (!text) return fallback;
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const n = Number(String(value).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatInr(value, fallback = '') {
  const n = toNumber(value);
  if (n === null) return fallback;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function formatLakhs(value, fallback = '') {
  const n = toNumber(value);
  if (n === null || n <= 0) return fallback;
  return `₹${(n / 100000).toFixed(2)} Lakhs`;
}

function normalizeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return null; }
  }
  return null;
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (!isBlank(value)) return value;
  }
  return '';
}

function getDeep(obj, paths, fallback = '') {
  if (!obj) return fallback;
  const pathList = Array.isArray(paths) ? paths : [paths];
  for (const p of pathList) {
    if (!p) continue;
    const parts = String(p).split('.');
    let cur = obj;
    let ok = true;
    for (const key of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, key)) {
        cur = cur[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && !isBlank(cur)) return cur;
  }
  return fallback;
}

function setCell(ws, address, value, fallback = '') {
  ws.getCell(address).value = sanitizeExcelValue(value, fallback);
}

function setNumberCell(ws, address, value) {
  const n = toNumber(value);
  ws.getCell(address).value = n === null ? '' : n;
}

function cellDisplayValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (value.result !== undefined && value.result !== null) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    if (value.hyperlink) return value.text || value.hyperlink;
    return '';
  }
  return value;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function isSafeHttpsSourceUrl(rawUrl) {
  if (!rawUrl) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '0.0.0.0') return false;
  const blockedPrefixes = [
    '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
    '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.', '127.', '169.254.'
  ];
  return !blockedPrefixes.some(prefix => hostname.startsWith(prefix));
}

function isExcelDocument(doc) {
  const ext = String(doc?.extension || path.extname(doc?.original_file_name || '') || '').toLowerCase();
  const mime = String(doc?.mime_type || '').toLowerCase();
  return ['.xlsx', '.xls'].includes(ext)
    || mime.includes('spreadsheet')
    || mime.includes('excel');
}

async function readExcelWorkbookFromDocument(doc) {
  if (!doc?.storage_path || !isExcelDocument(doc)) return null;
  const storage = getStorageProvider();
  const stream = await storage.getStream(doc.storage_path);
  const buffer = await streamToBuffer(stream);
  if (!buffer.length) return null;
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false, dense: false });
  return { workbook, document: doc, source: 'document' };
}

async function findStoredExcelDocument({ documentId, tenantId, sourceUrl, documentTypes = [] }) {
  if (documentId) {
    const doc = await prisma.document.findFirst({
      where: {
        id: Number(documentId),
        tenant_id: tenantId,
        status: 'ACTIVE',
        deleted_at: null
      },
      select: {
        id: true,
        storage_path: true,
        extension: true,
        mime_type: true,
        original_file_name: true,
        document_type: true
      }
    });
    if (doc) return doc;
  }

  if (!sourceUrl) return null;
  return prisma.document.findFirst({
    where: {
      tenant_id: tenantId,
      source_url: sourceUrl,
      status: 'ACTIVE',
      deleted_at: null,
      ...(documentTypes.length ? { document_type: { in: documentTypes } } : {})
    },
    select: {
      id: true,
      storage_path: true,
      extension: true,
      mime_type: true,
      original_file_name: true,
      document_type: true
    }
  });
}

async function readExcelWorkbookFromUrl(sourceUrl) {
  if (!isSafeHttpsSourceUrl(sourceUrl)) return null;
  const response = await axios.get(sourceUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxRedirects: 3,
    maxContentLength: MAX_SOURCE_EXCEL_SIZE_BYTES,
    maxBodyLength: MAX_SOURCE_EXCEL_SIZE_BYTES,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (contentType && !contentType.includes('spreadsheet') && !contentType.includes('excel') && !contentType.includes('octet-stream')) {
    return null;
  }
  const buffer = Buffer.from(response.data);
  if (!buffer.length || buffer.length > MAX_SOURCE_EXCEL_SIZE_BYTES) return null;
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false, dense: false });
  return { workbook, source: 'url' };
}

async function readSourceExcelWorkbook({ documentId, tenantId, sourceUrl, documentTypes = [] }) {
  const doc = await findStoredExcelDocument({ documentId, tenantId, sourceUrl, documentTypes });
  const fromDocument = await readExcelWorkbookFromDocument(doc);
  if (fromDocument) return fromDocument;
  return readExcelWorkbookFromUrl(sourceUrl);
}

function findSourceSheetName(workbook, wantedName) {
  const normalizedWanted = String(wantedName).toLowerCase().replace(/[^a-z0-9]/g, '');
  return workbook.SheetNames.find(name => (
    String(name).toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedWanted
  ));
}

function sourceSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  }).map(row => row.map(cellDisplayValue));
}

function clearWorksheet(ws) {
  if (!ws) return;
  const merges = ws._merges ? Object.keys(ws._merges) : [];
  merges.forEach((range) => {
    try { ws.unMergeCells(range); } catch (_) {}
  });
  if (ws.rowCount > 0) ws.spliceRows(1, ws.rowCount);
  ws.columns = [];
}

function applySourceSheetLayout(ws) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
      if (rowNumber === 1 || cell.value === String(cell.value).toUpperCase()) {
        cell.font = { ...(cell.font || {}), bold: rowNumber <= 2 };
      }
    });
  });
  for (let i = 1; i <= Math.max(ws.columnCount, 1); i += 1) {
    ws.getColumn(i).width = Math.min(Math.max(ws.getColumn(i).width || 14, 14), 32);
  }
}

function copySourceWorkbookToSheet(targetSheet, sourceWorkbook, sourceType) {
  if (!targetSheet || !sourceWorkbook?.SheetNames?.length) return false;

  clearWorksheet(targetSheet);
  const preferredSheets = SOURCE_SHEET_LIMITS[sourceType] || sourceWorkbook.SheetNames;
  const selectedSheetNames = preferredSheets
    .map(name => findSourceSheetName(sourceWorkbook, name))
    .filter(Boolean);
  const fallbackSheetNames = selectedSheetNames.length ? [] : sourceWorkbook.SheetNames.slice(0, 5);
  const sheetNames = [...new Set([...selectedSheetNames, ...fallbackSheetNames])];

  let rowCursor = 1;
  let maxColumns = 1;
  for (const sheetName of sheetNames) {
    const rows = sourceSheetRows(sourceWorkbook, sheetName);
    if (!rows.length) continue;

    targetSheet.getCell(rowCursor, 1).value = sanitizeExcelValue(sheetName, 'Source Data');
    targetSheet.getCell(rowCursor, 1).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    targetSheet.getCell(rowCursor, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    rowCursor += 1;

    rows.forEach((row) => {
      maxColumns = Math.max(maxColumns, row.length || 1);
      row.forEach((value, index) => {
        targetSheet.getCell(rowCursor, index + 1).value = sanitizeExcelValue(value, '');
      });
      rowCursor += 1;
    });
    rowCursor += 2;
  }

  if (rowCursor === 1) return false;
  for (let col = 1; col <= maxColumns; col += 1) {
    targetSheet.getColumn(col).width = col === 1 ? 28 : 18;
  }
  applySourceSheetLayout(targetSheet);
  return true;
}

async function copyStoredSourceWorkbook({ workbook, targetSheetName, sourceType, documentId, tenantId, sourceUrl, documentTypes = [] }) {
  const source = await readSourceExcelWorkbook({ documentId, tenantId, sourceUrl, documentTypes });
  if (!source?.workbook) return false;
  return copySourceWorkbookToSheet(workbook.getWorksheet(targetSheetName), source.workbook, sourceType);
}

async function copyAvailableSourceWorkbooks(workbook, caseRecord, tenantId) {
  const bank = getLatest(caseRecord.bank_statements || []);
  const itr = getLatest(caseRecord.itr_analytics || []);
  const gst = getLatest(caseRecord.gst_requests || []);

  const [bankCopied, itrCopied, gstCopied] = await Promise.all([
    copyStoredSourceWorkbook({
      workbook,
      targetSheetName: 'Bank Statement Analysis',
      sourceType: 'bank',
      documentId: bank?.bank_excel_document_id,
      tenantId,
      sourceUrl: bank?.report_excel_url,
      documentTypes: ['BANK_EXCEL']
    }).catch((err) => {
      console.warn('[LoanApplicationSummary] Bank source Excel copy skipped:', err.message);
      return false;
    }),
    copyStoredSourceWorkbook({
      workbook,
      targetSheetName: 'ITR Analysis',
      sourceType: 'itr',
      documentId: itr?.itr_document_id,
      tenantId,
      sourceUrl: itr?.excel_url,
      documentTypes: ['ITR_EXCEL']
    }).catch((err) => {
      console.warn('[LoanApplicationSummary] ITR source Excel copy skipped:', err.message);
      return false;
    }),
    copyStoredSourceWorkbook({
      workbook,
      targetSheetName: 'GST Analysis',
      sourceType: 'gst',
      documentId: gst?.gst_excel_document_id,
      tenantId,
      sourceUrl: gst?.report_excel_url,
      documentTypes: ['GST_REPORT_EXCEL']
    }).catch((err) => {
      console.warn('[LoanApplicationSummary] GST source Excel copy skipped:', err.message);
      return false;
    })
  ]);

  return { bankCopied, itrCopied, gstCopied };
}

function ensureWorksheetContract(workbook) {
  const bankWithTrailingDot = workbook.getWorksheet('Bank Statement Analysis.');
  if (bankWithTrailingDot) bankWithTrailingDot.name = 'Bank Statement Analysis';

  SHEET_NAMES.forEach((name) => {
    if (!workbook.getWorksheet(name)) workbook.addWorksheet(name);
  });

  workbook.worksheets.slice().forEach((ws) => {
    if (!SHEET_NAMES.includes(ws.name)) workbook.removeWorksheet(ws.id);
  });

  const ordered = SHEET_NAMES.map(name => workbook.getWorksheet(name)).filter(Boolean);
  if (ordered.length === SHEET_NAMES.length) {
    workbook._worksheets = [undefined, ...ordered];
  }
}

function sourceUnavailable(caseRecord, source) {
  if (source === 'bank') {
    const bank = getLatest(caseRecord.bank_statements || []);
    return !bank?.bank_excel_document_id && !bank?.report_excel_url && !latestRawBank(caseRecord) && !caseRecord.esr_financials?.bank_avg_balance;
  }
  if (source === 'itr') {
    const itr = getLatest(caseRecord.itr_analytics || []);
    return !itr?.itr_document_id && !itr?.excel_url && !latestRawItr(caseRecord) && !caseRecord.esr_financials?.itr_pat;
  }
  if (source === 'gst') {
    const gst = getLatest(caseRecord.gst_requests || []);
    return !gst?.gst_excel_document_id && !gst?.report_excel_url && !latestRawGst(caseRecord) && !caseRecord.esr_financials?.gst_avg_monthly_sales;
  }
  if (source === 'cibil') {
    const applicantChecks = (caseRecord.applicants || []).some(a => (a.bureau_checks || []).length || a.cibil_score);
    return !(caseRecord.bureau_checks || []).length && !applicantChecks && !caseRecord.cibil_score;
  }
  return false;
}

function writeNoDataMessage(ws, message) {
  if (!ws) return;
  ws.spliceRows(1, Math.max(ws.rowCount, 1));
  ws.getCell('A1').value = message;
  ws.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FF1F2937' } };
  ws.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 10, 64);
}

function validateWorkbook(workbook, { requireCaseSummary = false } = {}) {
  const names = workbook.worksheets.map(ws => ws.name);
  const errors = [];

  if (names.length !== SHEET_NAMES.length) errors.push(`Expected ${SHEET_NAMES.length} sheets, found ${names.length}.`);
  SHEET_NAMES.forEach((name, idx) => {
    if (names[idx] !== name) errors.push(`Expected sheet ${idx + 1} to be "${name}", found "${names[idx] || 'missing'}".`);
  });

  if (requireCaseSummary) {
    const summary = workbook.getWorksheet('Summary');
    const values = summary ? JSON.stringify(summary.getSheetValues()) : '';
    if (!values.includes('CASE-')) errors.push('Summary does not contain Case Ref.');
    if (!values.replace(/\bN\/A\b/g, '').match(/[A-Za-z]{3,}/)) errors.push('Summary does not contain Customer.');
  }

  const forbidden = /\b(undefined|null|NaN|None)\b|#DIV\/0!|#VALUE!|#REF!|#NAME\?/i;
  workbook.worksheets.forEach((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value && typeof cell.value === 'object' && 'text' in cell.value ? cell.value.text : cell.value;
        if (typeof value === 'string' && forbidden.test(value)) {
          errors.push(`Invalid display value in ${ws.name}!${cell.address}`);
        }
      });
    });
  });

  if (errors.length) {
    const err = new Error(`Loan Application Summary validation failed: ${errors.join(' ')}`);
    err.validationErrors = errors;
    throw err;
  }
}

function cleanString(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLatest(records = []) {
  return Array.isArray(records) && records.length ? records[0] : null;
}

function getPrimaryApplicant(caseRecord) {
  return (caseRecord.applicants || []).find(a => a.is_primary || a.type === 'PRIMARY') || {};
}

function getCoApplicants(caseRecord) {
  return (caseRecord.applicants || []).filter(a => !(a.is_primary || a.type === 'PRIMARY'));
}

function getApplicantLabel(applicant, index = 0) {
  if (!applicant) return '';
  return applicant.name || applicant.applicant_label || applicant.email || applicant.pan_number || `Co-Applicant ${index + 1}`;
}

function contactText({ mobile, email }) {
  const parts = [];
  if (mobile) parts.push(`Mobile: ${mobile}`);
  if (email) parts.push(`Email: ${email}`);
  return parts.join('\n');
}

function sumIncomeByType(caseRecord, matcher) {
  const entries = caseRecord.income_entries || [];
  return entries.reduce((sum, entry) => {
    const type = String(entry.income_type || '').toLowerCase();
    return matcher(type, entry) ? sum + (toNumber(entry.annual_amount) || 0) : sum;
  }, 0);
}

function documentStatus(caseRecord, types = [], applicant = null) {
  const wanted = new Set(types.map(t => String(t).toUpperCase()));
  const applicantDocs = (caseRecord.applicants || []).flatMap(a => a.documents || []);
  const docs = [...(caseRecord.documents || []), ...applicantDocs];
  const applicantId = applicant?.id || null;
  const matched = docs.find(doc => {
    if (doc.status === 'DELETED') return false;
    const docType = String(doc.document_type || '').toUpperCase();
    if (!wanted.has(docType)) return false;
    if (applicantId && doc.applicant_id && doc.applicant_id !== applicantId) return false;
    return true;
  });
  return matched ? 'Uploaded' : 'Pending';
}

function latestRawBank(caseRecord) {
  const bank = getLatest(caseRecord.bank_statements || []);
  if (!bank) return null;
  return normalizeJson(bank.raw_download_response)
      || normalizeJson(bank.raw_retrieve_response)
      || normalizeJson(bank.raw_analyze_response)
      || normalizeJson(bank.files_payload);
}

function latestRawItr(caseRecord) {
  const itr = getLatest(caseRecord.itr_analytics || []);
  return itr ? normalizeJson(itr.analytics_payload) : null;
}

function latestRawGst(caseRecord) {
  const gst = getLatest(caseRecord.gst_requests || []);
  return gst ? normalizeJson(gst.raw_gst_data) : null;
}

function latestPanProfile(customer) {
  return getLatest(customer?.pan_profiles || []);
}

function latestGstProfile(customer) {
  return getLatest(customer?.gst_profiles || []);
}

function latestBureau(applicant) {
  return getLatest(applicant?.bureau_checks || []);
}

function getGstin(caseRecord) {
  const customer = caseRecord.customer || {};
  const panProfile = latestPanProfile(customer);
  const gstProfile = latestGstProfile(customer);
  const gstReq = getLatest(caseRecord.gst_requests || []);
  return firstNonBlank(
    gstProfile?.gstin,
    panProfile?.gstin,
    panProfile?.gstin_records?.[0]?.gstin,
    gstReq?.gstin
  );
}

function resolvePropertyValue(caseRecord) {
  return firstNonBlank(
    caseRecord.property?.market_value,
    caseRecord.esr_financials?.property_value,
    caseRecord.property_value
  );
}

function resolveAddress(caseRecord) {
  const customer = caseRecord.customer || {};
  const panProfile = latestPanProfile(customer);
  return firstNonBlank(
    panProfile?.principal_address,
    getDeep(latestRawGst(caseRecord), [
      'data.entity_details.principalPlaceOfBusiness',
      'entity_details.principalPlaceOfBusiness',
      'principalPlaceOfBusiness.address',
      'principalPlaceOfBusiness'
    ]),
    customer.address,
    ''
  );
}

function extractBankAccountInfo(caseRecord) {
  const raw = latestRawBank(caseRecord) || {};
  const bank = getLatest(caseRecord.bank_statements || {}) || {};
  return {
    accountHolder: firstNonBlank(
      getDeep(raw, ['account_holder', 'accountHolder', 'account.holderName', 'data.accountHolderName']),
      caseRecord.customer?.business_name
    ),
    accountNumber: firstNonBlank(getDeep(raw, ['account_number', 'accountNumber', 'account.number', 'data.accountNumber']), ''),
    bankName: firstNonBlank(getDeep(raw, ['bank_name', 'bankName', 'account.bankName', 'data.bankName']), ''),
    accountType: firstNonBlank(getDeep(raw, ['account_type', 'accountType', 'account.type', 'data.accountType']), ''),
    email: firstNonBlank(getDeep(raw, ['email', 'data.email']), caseRecord.customer?.business_email),
    phone: firstNonBlank(getDeep(raw, ['phone', 'mobile', 'data.phone', 'data.mobile']), caseRecord.customer?.business_mobile),
    statementFrom: firstNonBlank(getDeep(raw, ['statement_from', 'statementFrom', 'fromDate', 'period.from']), ''),
    statementTo: firstNonBlank(getDeep(raw, ['statement_to', 'statementTo', 'toDate', 'period.to']), ''),
    avgBalance: firstNonBlank(caseRecord.esr_financials?.bank_avg_balance, bank.avg_bank_balance_latest_year),
    totalCredits: firstNonBlank(caseRecord.esr_financials?.bank_total_credits, caseRecord.esr_financials?.bank_avg_monthly_credit ? Number(caseRecord.esr_financials.bank_avg_monthly_credit) * 12 : '')
  };
}

function findLatestEligibility(caseRecord) {
  const latestEsr = (caseRecord.esrs || []).find(r => r.is_latest) || getLatest(caseRecord.esrs || []);
  const lenders = latestEsr?.lenders || [];
  const eligible = lenders.filter(l => l.is_eligible && toNumber(l.eligible_amount) > 0);
  const best = eligible.sort((a, b) => (toNumber(b.eligible_amount) || 0) - (toNumber(a.eligible_amount) || 0))[0] || null;
  return { latestEsr, lenders, best };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workbook visual/header helpers
// ─────────────────────────────────────────────────────────────────────────────

function addLogoAndPrintSettings(workbook) {
  if (!fs.existsSync(LOGO_PATH)) return;

  const imageId = workbook.addImage({
    filename: LOGO_PATH,
    extension: 'jpeg'
  });

  workbook.worksheets.forEach((ws) => {
    // Put logo in the top-right area without changing template cells.
    // Repeating row header is configured so Excel repeats the report header when printed.
    ws.addImage(imageId, {
      tl: { col: Math.max(0, (ws.columnCount || 8) - 3), row: 0.15 },
      ext: { width: 145, height: 52 },
      editAs: 'oneCell'
    });

    ws.pageSetup = {
      ...(ws.pageSetup || {}),
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: ws.name === 'Summary' ? 'portrait' : 'landscape',
      horizontalCentered: true,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.55,
        bottom: 0.45,
        header: 0.25,
        footer: 0.25
      },
      printTitlesRow: '1:4'
    };

    ws.headerFooter = {
      ...(ws.headerFooter || {}),
      oddFooter: '&LLoan Application Summary&CPage &P of &N&RGenerated by Cred2Tech'
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet fillers
// ─────────────────────────────────────────────────────────────────────────────

function fillSummarySheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('Summary');
  if (!ws) return;

  const customer = caseRecord.customer || {};
  const primary = getPrimaryApplicant(caseRecord);
  const coApps = getCoApplicants(caseRecord);
  const panProfile = latestPanProfile(customer);
  const gstin = getGstin(caseRecord);
  const property = caseRecord.property || {};
  const financials = caseRecord.esr_financials || {};
  const { latestEsr, best } = findLatestEligibility(caseRecord);

  setCell(ws, 'B2', `CASE-${caseRecord.id}`);
  setCell(ws, 'D2', formatLakhs(firstNonBlank(caseRecord.loan_amount, financials.requested_loan_amount)) || 'N/A');
  setCell(ws, 'B3', firstNonBlank(caseRecord.customer_name, customer.business_name, primary.name, 'N/A'));
  setCell(ws, 'D3', firstNonBlank(caseRecord.product_type, financials.product_type, 'N/A'));
  setCell(ws, 'B4', [caseRecord.created_by?.name, caseRecord.dsa_code].filter(Boolean).join(' · ') || 'N/A');
  setCell(ws, 'D4', formatDate(new Date()));

  // Applicant / borrower details
  setCell(ws, 'B8', firstNonBlank(customer.business_name, caseRecord.customer_name, primary.name, 'N/A'));
  setCell(ws, 'C8', 'Primary Borrower');
  setCell(ws, 'D8', firstNonBlank(customer.business_pan, primary.pan_number, 'N/A'));
  setCell(ws, 'E8', gstin || 'N/A');
  setCell(ws, 'F8', contactText({ mobile: customer.business_mobile || primary.mobile, email: customer.business_email || primary.email }) || 'N/A');
  setCell(ws, 'G8', resolveAddress(caseRecord) || 'N/A');

  setCell(ws, 'B9', firstNonBlank(primary.name, customer.business_name, 'N/A'));
  setCell(ws, 'C9', firstNonBlank(primary.employment_type, 'Promoter / Contact Person'));
  setCell(ws, 'D9', firstNonBlank(primary.pan_number, customer.business_pan, 'N/A'));
  setCell(ws, 'E9', '');
  setCell(ws, 'F9', contactText({ mobile: primary.mobile || customer.business_mobile, email: primary.email || customer.business_email }) || 'N/A');
  setCell(ws, 'G9', firstNonBlank(panProfile?.principal_address, ''));

  ['10', '11'].forEach((row, idx) => {
    const app = coApps[idx];
    if (!app) {
      ['B', 'C', 'D', 'E', 'F', 'G'].forEach(col => setCell(ws, `${col}${row}`, ''));
      return;
    }
    setCell(ws, `A${row}`, `Co-Applicant ${idx + 1}`);
    setCell(ws, `B${row}`, getApplicantLabel(app, idx));
    setCell(ws, `C${row}`, firstNonBlank(app.relationship_to_primary, app.employment_type, app.type));
    setCell(ws, `D${row}`, firstNonBlank(app.pan_number, 'N/A'));
    setCell(ws, `E${row}`, '');
    setCell(ws, `F${row}`, contactText({ mobile: app.mobile, email: app.email }) || 'N/A');
    setCell(ws, `G${row}`, '');
  });

  // Loan requirement & collateral
  setCell(ws, 'B15', formatLakhs(firstNonBlank(caseRecord.loan_amount, financials.requested_loan_amount), 'N/A'));
  setCell(ws, 'D15', financials.requested_tenure_months ? `${financials.requested_tenure_months} Months` : 'N/A');
  setCell(ws, 'F15', firstNonBlank(property.ownership_type, 'N/A'));
  setCell(ws, 'B17', firstNonBlank(property.property_type, financials.property_type, caseRecord.property_type, 'N/A'));
  setCell(ws, 'D17', firstNonBlank(property.occupancy_status, financials.occupancy_type, caseRecord.occupancy, 'N/A'));
  setCell(ws, 'B18', formatInr(resolvePropertyValue(caseRecord), 'N/A'));
  setCell(ws, 'D18', firstNonBlank(property.remarks, caseRecord.location, 'N/A'));

  // Bureau details
  coApps.slice(0, 2).forEach((app, idx) => setCell(ws, idx === 0 ? 'B20' : 'C20', getApplicantLabel(app, idx)));
  setCell(ws, 'A21', 'Cibil Score');
  setCell(ws, 'B21', firstNonBlank(primary.cibil_score, latestBureau(primary)?.score, caseRecord.cibil_score, financials.bureau_score, 'N/A'));
  if (coApps[0]) setCell(ws, 'C21', firstNonBlank(coApps[0].cibil_score, latestBureau(coApps[0])?.score, 'N/A'));
  if (coApps[1]) setCell(ws, 'D21', firstNonBlank(coApps[1].cibil_score, latestBureau(coApps[1])?.score, 'N/A'));

  // Financial & credit snapshot
  const rentBankAnnual = sumIncomeByType(caseRecord, type => type.includes('rental') && type.includes('bank'));
  const rentCashAnnual = sumIncomeByType(caseRecord, type => type.includes('rental') && type.includes('cash'));
  const agriAnnual = sumIncomeByType(caseRecord, type => type.includes('agriculture'));
  const salaryAnnual = sumIncomeByType(caseRecord, type => type === 'salary' || type.includes('director salary') || type.includes("partner"));
  const incentiveAnnual = sumIncomeByType(caseRecord, type => type.includes('incentive'));
  const bonusAnnual = sumIncomeByType(caseRecord, type => type.includes('bonus'));

  setNumberCell(ws, 'B26', financials.itr_pat);
  setNumberCell(ws, 'B27', financials.itr_depreciation);
  setNumberCell(ws, 'B28', financials.itr_finance_cost);
  setNumberCell(ws, 'B29', financials.itr_remuneration);
  setNumberCell(ws, 'B30', toNumber(financials.gst_avg_monthly_sales) ? Number(financials.gst_avg_monthly_sales) * 12 : null);
  setNumberCell(ws, 'B31', toNumber(financials.gst_avg_monthly_sales) ? Number(financials.gst_avg_monthly_sales) * 12 : null);
  setNumberCell(ws, 'B32', financials.itr_gross_receipts);
  setNumberCell(ws, 'B33', financials.bank_total_credits);
  setNumberCell(ws, 'B34', financials.bank_avg_balance);
  setNumberCell(ws, 'F34', financials.bank_avg_balance);
  setNumberCell(ws, 'F35', rentBankAnnual ? rentBankAnnual / 12 : null);
  setNumberCell(ws, 'F36', rentCashAnnual ? rentCashAnnual / 12 : null);
  setNumberCell(ws, 'B37', agriAnnual);
  setNumberCell(ws, 'F38', financials.salaried_income || (salaryAnnual ? salaryAnnual / 12 : null));
  setNumberCell(ws, 'B39', incentiveAnnual);
  setNumberCell(ws, 'B40', bonusAnnual);

  // Reuse blank space in the template for key eligibility/sanction summary without altering layout.
  setCell(ws, 'A42', 'ELIGIBILITY / SANCTION SUMMARY');
  setCell(ws, 'B42', best?.lender_name || caseRecord.lender_name || 'N/A');
  setCell(ws, 'C42', best?.best_scheme_name || financials.selected_income_method || 'N/A');
  setCell(ws, 'D42', formatInr(best?.eligible_amount, 'N/A'));
  setCell(ws, 'E42', best?.roi ? `${best.roi}%` : 'N/A');
  setCell(ws, 'F42', best?.tenure_months ? `${best.tenure_months} Months` : 'N/A');
  setCell(ws, 'G42', caseRecord.sanction?.sanctioned_amount ? formatInr(caseRecord.sanction.sanctioned_amount) : 'N/A');

  // KYC document status
  setCell(ws, 'B45', `Primary / ${firstNonBlank(primary.name, customer.business_name, 'Applicant')}`);
  setCell(ws, 'C45', documentStatus(caseRecord, ['PAN_CARD'], primary));
  setCell(ws, 'E45', `Primary / ${firstNonBlank(primary.name, customer.business_name, 'Applicant')}`);
  setCell(ws, 'F45', documentStatus(caseRecord, ['AADHAAR'], primary));

  coApps.slice(0, 2).forEach((app, idx) => {
    const row = 46 + idx;
    setCell(ws, `B${row}`, `Co-Borrower ${idx + 1} / ${getApplicantLabel(app, idx)}`);
    setCell(ws, `C${row}`, documentStatus(caseRecord, ['PAN_CARD'], app));
    setCell(ws, `E${row}`, `Co-Borrower ${idx + 1} / ${getApplicantLabel(app, idx)}`);
    setCell(ws, `F${row}`, documentStatus(caseRecord, ['AADHAAR'], app));
  });

  setCell(ws, 'C48', documentStatus(caseRecord, ['GST_PDF', 'GST_REPORT_PDF', 'GST_REPORT_EXCEL']));
  setCell(ws, 'F48', documentStatus(caseRecord, ['OTHER']));

  // Property documents
  setCell(ws, 'C52', documentStatus(caseRecord, ['SALE_DEED', 'PROPERTY_DOCUMENT']));
  setCell(ws, 'F52', documentStatus(caseRecord, ['PROPERTY_DOCUMENT']));
  setCell(ws, 'C53', documentStatus(caseRecord, ['PROPERTY_DOCUMENT']));
  setCell(ws, 'F53', documentStatus(caseRecord, ['PROPERTY_DOCUMENT']));
  setCell(ws, 'B54', firstNonBlank(primary.name, customer.business_name, 'Applicant'));
  setCell(ws, 'C54', documentStatus(caseRecord, ['OTHER'], primary));
  setCell(ws, 'E54', coApps[0] ? getApplicantLabel(coApps[0], 0) : 'Co-Applicant');
  setCell(ws, 'F54', coApps[0] ? documentStatus(caseRecord, ['OTHER'], coApps[0]) : 'Pending');

  // References are not currently stored as structured fields; blank sample data instead of hard-code.
  for (const row of [58, 59]) {
    for (const col of ['B', 'C', 'D', 'E']) setCell(ws, `${col}${row}`, '');
  }

  // Record report date/status in available cells/comments style.
  setCell(ws, 'G4', latestEsr ? `ESR v${latestEsr.version_number || ''}`.trim() : 'ESR Pending');
}

function fillBankStatementSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('Bank Statement Analysis');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'bank')) {
    writeNoDataMessage(ws, 'Bank Statement Analysis data is not available for this case.');
    return;
  }

  const bankInfo = extractBankAccountInfo(caseRecord);
  const financials = caseRecord.esr_financials || {};

  setCell(ws, 'B2', [bankInfo.bankName, bankInfo.accountNumber, bankInfo.accountType].filter(Boolean).join(' - ') || 'Bank Statement Analysis');
  setCell(ws, 'B3', bankInfo.accountHolder || 'N/A');
  setCell(ws, 'B4', bankInfo.accountNumber || 'N/A');
  setCell(ws, 'B5', bankInfo.bankName || 'N/A');
  setCell(ws, 'B6', bankInfo.accountType || 'N/A');
  setCell(ws, 'B7', bankInfo.email || 'N/A');
  setCell(ws, 'B8', bankInfo.phone || 'N/A');
  setCell(ws, 'B9', formatDate(bankInfo.statementFrom) || 'N/A');
  setCell(ws, 'B10', formatDate(bankInfo.statementTo) || 'N/A');
  setCell(ws, 'B11', formatDate(bankInfo.statementFrom) || 'N/A');
  setCell(ws, 'B12', formatDate(bankInfo.statementTo) || 'N/A');

  // Fill totals/fallback snapshots into the Total column while preserving all monthly-layout columns.
  setNumberCell(ws, 'N19', financials.bank_total_credits);
  setNumberCell(ws, 'N27', firstNonBlank(financials.bank_avg_balance, bankInfo.avgBalance));
  setNumberCell(ws, 'N43', firstNonBlank(financials.bank_avg_balance, bankInfo.avgBalance));
  setNumberCell(ws, 'N39', financials.bank_total_credits);
  setNumberCell(ws, 'N40', financials.itr_finance_cost);
}

function fillItrSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('ITR Analysis');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'itr')) {
    writeNoDataMessage(ws, 'ITR Analysis data is not available for this case.');
    return;
  }

  const customer = caseRecord.customer || {};
  const primary = getPrimaryApplicant(caseRecord);
  const panProfile = latestPanProfile(customer);
  const itr = getLatest(caseRecord.itr_analytics || []);
  const financials = caseRecord.esr_financials || {};

  setCell(ws, 'F5', itr?.reference_id || '');
  setCell(ws, 'H5', itr?.reference_id || '');
  setCell(ws, 'F6', firstNonBlank(primary.name, customer.business_name));
  setCell(ws, 'H6', firstNonBlank(primary.name, customer.business_name));
  setCell(ws, 'F11', '');
  setCell(ws, 'H11', '');
  setCell(ws, 'F12', firstNonBlank(primary.pan_number, customer.business_pan));
  setCell(ws, 'H12', firstNonBlank(primary.pan_number, customer.business_pan));
  setCell(ws, 'F13', firstNonBlank(panProfile?.principal_address, ''));
  setCell(ws, 'H13', firstNonBlank(panProfile?.principal_address, ''));
  setCell(ws, 'F14', firstNonBlank(primary.email, customer.business_email));
  setCell(ws, 'H14', firstNonBlank(primary.email, customer.business_email));
  setCell(ws, 'F15', firstNonBlank(primary.mobile, customer.business_mobile));
  setCell(ws, 'H15', firstNonBlank(primary.mobile, customer.business_mobile));
  setCell(ws, 'H20', formatDate(itr?.updated_at || itr?.created_at));
  setCell(ws, 'H22', firstNonBlank(customer.entity_type, financials.constitution_type));

  setNumberCell(ws, 'H40', financials.itr_pat);
  setNumberCell(ws, 'H43', financials.itr_pat);
  setNumberCell(ws, 'H44', financials.itr_pat);
  setNumberCell(ws, 'H46', financials.itr_pat);
  setNumberCell(ws, 'H50', financials.itr_pat);
  setNumberCell(ws, 'H52', sumIncomeByType(caseRecord, type => type.includes('agriculture')));

  // Common business addbacks near balance/profit rows if template has them farther down.
  // Cells below row 80 are not listed here to avoid overwriting sections we did not inspect.
}

function fillGstSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('GST Analysis');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'gst')) {
    writeNoDataMessage(ws, 'GST Analysis data is not available for this case.');
    return;
  }

  const customer = caseRecord.customer || {};
  const gstProfile = latestGstProfile(customer);
  const panProfile = latestPanProfile(customer);
  const gstReq = getLatest(caseRecord.gst_requests || []);
  const financials = caseRecord.esr_financials || {};
  const gstin = getGstin(caseRecord);
  const annualSales = toNumber(financials.gst_avg_monthly_sales) ? Number(financials.gst_avg_monthly_sales) * 12 : null;

  setCell(ws, 'A1', `${firstNonBlank(customer.business_name, caseRecord.customer_name, 'Borrower')} - GST ANALYTICS REPORT`);
  setCell(ws, 'B3', firstNonBlank(panProfile?.legal_name, gstProfile?.raw_response?.legal_name, customer.business_name));
  setCell(ws, 'B4', firstNonBlank(panProfile?.trade_name, customer.business_name));
  setCell(ws, 'B5', gstin);
  setCell(ws, 'B6', firstNonBlank(customer.business_pan, panProfile?.pan));
  setCell(ws, 'B7', customer.business_email);
  setCell(ws, 'B8', customer.business_mobile);
  setCell(ws, 'B9', Array.isArray(panProfile?.director_names) ? panProfile.director_names.join(', ') : '');
  setCell(ws, 'B10', firstNonBlank(customer.entity_type, panProfile?.constitution_of_business));
  setCell(ws, 'B11', firstNonBlank(customer.industry, financials.gst_industry_type));
  setCell(ws, 'B12', firstNonBlank(panProfile?.principal_address, ''));
  setCell(ws, 'B13', '');
  setCell(ws, 'B14', firstNonBlank(gstProfile?.filing_status, gstReq?.status));
  setCell(ws, 'B18', firstNonBlank(panProfile?.principal_state, ''));
  setCell(ws, 'B19', [financials.financial_year_latest, financials.financial_year_previous].filter(Boolean).join(' / '));
  setCell(ws, 'B20', formatDate(new Date()));

  setNumberCell(ws, 'B25', annualSales);
  setNumberCell(ws, 'C25', annualSales);
  setNumberCell(ws, 'D25', annualSales);
  setNumberCell(ws, 'B27', annualSales && financials.gst_income ? financials.gst_income * 12 : null);
  setCell(ws, 'B29', financials.gst_industry_margin ? `${Number(financials.gst_industry_margin) * 100}%` : '');
}

function fillCibilSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('Cibil - Transunion');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'cibil')) {
    writeNoDataMessage(ws, 'CIBIL/TransUnion data is not available for this case.');
    return;
  }

  const primary = getPrimaryApplicant(caseRecord);
  const coApps = getCoApplicants(caseRecord);
  const obligations = caseRecord.obligations || [];
  const primaryBureau = latestBureau(primary);

  setCell(ws, 'A2', [
    `Primary: ${getApplicantLabel(primary) || 'N/A'}`,
    `PAN: ${primary.pan_number || 'N/A'}`,
    `Mobile: ${primary.mobile || 'N/A'}`,
    `CIBIL Score: ${firstNonBlank(primary.cibil_score, primaryBureau?.score, caseRecord.cibil_score, 'N/A')}`
  ].join('\n'));

  setCell(ws, 'A4', obligations.length
    ? `Active obligations: ${obligations.length}; Total EMI: ${formatInr(obligations.reduce((s, o) => s + (toNumber(o.emi_per_month) || 0), 0), '₹0')}`
    : 'No obligations available');

  setCell(ws, 'A6', obligations.map((o, idx) => (
    `${idx + 1}. ${cleanString(o.lender_name) || 'Lender'} | ${cleanString(o.loan_type) || 'Loan'} | EMI ${formatInr(o.emi_per_month, '₹0')} | Outstanding ${formatInr(o.outstanding_amount, '₹0')} | ${o.status || 'ACTIVE'}`
  )).join('\n') || 'No loanwise obligation data available');

  setCell(ws, 'A7', coApps.length
    ? `Co-applicants: ${coApps.map((a, idx) => `${getApplicantLabel(a, idx)} (${firstNonBlank(a.cibil_score, latestBureau(a)?.score, 'CIBIL N/A')})`).join('; ')}`
    : 'Co-applicants: N/A');
}

async function fetchReportCase(caseId, tenantId, currentUser) {
  const roleName = currentUser?.role?.name || currentUser?.role || currentUser?.role_name;
  const hierarchyFilter = roleName === 'DSA_ADMIN' || roleName === 'SUPER_ADMIN'
    ? {}
    : { created_by: { hierarchy_path: { startsWith: currentUser?.hierarchy_path || '' } } };

  return prisma.case.findFirst({
    where: {
      id: Number(caseId),
      tenant_id: tenantId,
      ...hierarchyFilter
    },
    include: {
      customer: {
        include: {
          pan_profiles: { orderBy: { created_at: 'desc' }, include: { gstin_records: true } },
          gst_profiles: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      },
      created_by: true,
      applicants: {
        include: {
          bureau_checks: { orderBy: { created_at: 'desc' }, take: 3 },
          salary_ocr_results: { orderBy: { created_at: 'desc' } },
          income_entries: true,
          obligations: true,
          documents: true
        },
        orderBy: { id: 'asc' }
      },
      property: true,
      esr_financials: true,
      income_entries: { orderBy: { created_at: 'asc' } },
      obligations: { orderBy: { created_at: 'asc' } },
      documents: { where: { deleted_at: null }, orderBy: { created_at: 'desc' } },
      gst_requests: { orderBy: { updated_at: 'desc' }, take: 3 },
      itr_analytics: { orderBy: { updated_at: 'desc' }, take: 3 },
      bank_statements: { orderBy: { updated_at: 'desc' }, take: 3 },
      bureau_checks: { orderBy: { updated_at: 'desc' }, take: 3 },
      sanction: true,
      disbursements: { orderBy: { tranche_number: 'asc' } },
      esrs: {
        where: { is_latest: true },
        orderBy: { version_number: 'desc' },
        take: 1,
        include: { lenders: true }
      }
    }
  });
}

async function generateLoanApplicationSummaryWorkbook({ caseId, tenantId, user }) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Loan Application Summary template not found at ${TEMPLATE_PATH}`);
  }

  const caseRecord = await fetchReportCase(caseId, tenantId, user);
  if (!caseRecord) {
    const err = new Error('Case not found or unauthorized.');
    err.statusCode = 404;
    throw err;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  ensureWorksheetContract(workbook);

  workbook.creator = 'Cred2Tech';
  workbook.lastModifiedBy = user?.name || user?.email || 'Cred2Tech';
  workbook.created = new Date();
  workbook.modified = new Date();

  fillSummarySheet(workbook, caseRecord);
  fillBankStatementSheet(workbook, caseRecord);
  fillItrSheet(workbook, caseRecord);
  fillGstSheet(workbook, caseRecord);
  fillCibilSheet(workbook, caseRecord);
  await copyAvailableSourceWorkbooks(workbook, caseRecord, tenantId);
  addLogoAndPrintSettings(workbook);
  validateWorkbook(workbook, { requireCaseSummary: true });

  const buffer = await workbook.xlsx.writeBuffer();
  if (!buffer || !buffer.byteLength) throw new Error('Generated workbook is empty.');

  const check = new ExcelJS.Workbook();
  await check.xlsx.load(buffer);
  validateWorkbook(check, { requireCaseSummary: true });

  return buffer;
}

async function generateAndSaveLoanApplicationSummary({ caseId, tenantId, user }) {
  const buffer = await generateLoanApplicationSummaryWorkbook({ caseId, tenantId, user });
  const fileName = buildReportFileName(caseId);
  const storageKey = `reports/loan-application-summary/${tenantId}/${caseId}/${fileName}`;
  const storage = getStorageProvider();
  const saved = await storage.save(Buffer.from(buffer), storageKey, MIME_XLSX);

  return {
    fileName,
    storageKey: saved.key,
    sizeBytes: saved.sizeBytes,
    mimeType: MIME_XLSX,
    downloadUrl: `/api/cases/${Number(caseId)}/loan-application-summary.xlsx`
  };
}

module.exports = {
  SHEET_NAMES,
  buildReportFileName,
  sanitizeExcelValue,
  ensureWorksheetContract,
  validateWorkbook,
  copySourceWorkbookToSheet,
  findStoredExcelDocument,
  isSafeHttpsSourceUrl,
  generateLoanApplicationSummaryWorkbook,
  generateAndSaveLoanApplicationSummary
};
