'use strict';

/**
 * Loan Application Summary Excel Report
 *
 * Generates the template-based Loan Application Summary workbook without
 * changing the uploaded template layout/design. Values are mapped from the
 * existing case/customer/applicant/property/ESR/API data sources.
 *
 * Uses exceljs throughout (both for writing the template-based output, which
 * needs to preserve formatting and insert images, and for reading uploaded
 * source Excel documents — the `xlsx`/SheetJS package this file used to read
 * with has known Prototype-Pollution/ReDoS advisories with no upstream fix,
 * and this parsing path takes attacker-reachable uploaded files as input.
 * Known behavior change: exceljs only reads modern `.xlsx` (OOXML), not
 * legacy binary `.xls` — an `.xls` source document now falls through to
 * `readSourceExcelWorkbook`'s existing null-handling instead of parsing.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const axios = require('axios');
const prisma = require('../../../config/db');
const { getStorageProvider } = require('../storage');
const { buildCanonicalLoanApplicationSummaryData } = require('./loanApplicationSummary.mapper');

const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/reports/Loan Application Summary.xlsx');
const LOGO_PATH = path.resolve(__dirname, '../../templates/reports/white-logo.jpg');

const SHEET_NAMES = [
  'Summary',
  'Bank Statement Analysis.',
  'ITR Analysis',
  'GST Analysis',
  'Cibil - Transunion'
];
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SOURCE_EXCEL_SIZE_BYTES = 15 * 1024 * 1024;
const SOURCE_SHEET_LIMITS = {
  bank: ['Summary'],
  itr: ['General Information', 'Tax Calculation', 'Balance Sheet', 'Profit and Loss Statement', 'Ratio Analysis'],
  gst: ['Entity Details', 'Account Details', 'Overview Yearly', 'Overview Monthly']
};

function buildReportFileName(caseId) {
  const suffix = Number.isFinite(Number(caseId)) ? Number(caseId) : String(caseId || 'case');
  return `Loan_Application_Summary_${suffix}.xlsx`;
}

const KNOWN_TEMPLATE_SAMPLE_VALUES = ['RAMESH KUMAR', 'RAJESH KUMAR', 'SUNITA', 'SUHAS', 'DEEPIKA'];

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
  if (/^-+$/.test(text)) return text;
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const cleaned = String(value)
    .replace(/[₹,\s]/g, '')
    .replace(/%$/, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (cleaned === '-' || cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

function labelsMatch(actual, expected) {
  const a = normalizeKey(actual);
  const e = normalizeKey(expected);
  if (!a || !e) return false;
  if (a === e) return true;
  const shorter = a.length < e.length ? a : e;
  const longer = a.length < e.length ? e : a;
  return shorter.length >= 6
    && shorter.length / longer.length >= 0.65
    && longer.includes(shorter);
}

function safeNumber(value) {
  return toNumber(value);
}

function safeCurrency(value, fallback = 'N/A') {
  return formatInr(value, fallback);
}

function safePercent(value, fallback = 'N/A') {
  const n = toNumber(value);
  if (n === null) return fallback;
  return `${n}%`;
}

function calculateAverageFromMonthlyValues(values = []) {
  const nums = values.map(toNumber).filter(n => n !== null);
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function calculateLast12MonthTotal(values = []) {
  const nums = values.map(toNumber).filter(n => n !== null);
  if (!nums.length) return null;
  return nums.slice(-12).reduce((sum, n) => sum + n, 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Brand palette (matches the template's existing design language)
// ─────────────────────────────────────────────────────────────────────────────

const BRAND = {
  // Section headers  (e.g. "1. APPLICANT / BORROWER DETAILS")
  SECTION_BG: 'FFDDEBFF',
  SECTION_FG: 'FF17365D',
  // Sub-headers / column header rows
  HEADER_BG: 'FFF1F5F9',
  HEADER_FG: 'FF334155',
  // Top banner (row 1 title)
  BANNER_BG: 'FFEAF2FF',
  BANNER_FG: 'FF0A2540',
  // Meta rows (rows 2-4)
  META_BG: 'FFF8FAFC',
  // Eligibility / Sanction highlight
  ELIGIBILITY_BG: 'FFD9F2E6',
  ELIGIBILITY_FG: 'FF065F46',
  // Document status
  STATUS_UPLOADED_BG: 'FFECFDF3',
  STATUS_UPLOADED_FG: 'FF027A48',
  STATUS_PENDING_BG: 'FFFFF7ED',
  STATUS_PENDING_FG: 'FFC2410C',
  // Data rows alternating
  ROW_ALT_BG: 'FFFAFBFC',
  // Borders
  BORDER_COLOR: 'FFD1D5DB',
  BORDER_INNER: 'FFE5E7EB',
};

const INR_FORMAT = '[$₹-en-IN]#,##,##0';
const INR_FORMAT_DEC = '[$₹-en-IN]#,##,##0.00';

function applyBorder(cell, style = 'thin') {
  cell.border = {
    top:    { style, color: { argb: BRAND.BORDER_COLOR } },
    left:   { style, color: { argb: BRAND.BORDER_COLOR } },
    bottom: { style, color: { argb: BRAND.BORDER_COLOR } },
    right:  { style, color: { argb: BRAND.BORDER_COLOR } }
  };
}

function styleSectionHeader(cell, { merged = false } = {}) {
  cell.font      = { bold: true, size: 11, color: { argb: BRAND.SECTION_FG }, name: 'Arial' };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.SECTION_BG } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
  applyBorder(cell);
}

function styleColumnHeader(cell) {
  cell.font      = { bold: true, size: 9, color: { argb: BRAND.HEADER_FG }, name: 'Arial' };
  cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.HEADER_BG } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  applyBorder(cell);
}

function styleDataCell(cell, { align = 'left', wrap = true, bold = false, altRow = false } = {}) {
  cell.font      = { bold, size: 9, name: 'Arial' };
  cell.fill      = altRow
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.ROW_ALT_BG } }
    : { type: 'pattern', pattern: 'none' };
  cell.alignment = { horizontal: align, vertical: 'top', wrapText: wrap };
  applyBorder(cell, 'hair');
}

function styleLabelCell(cell, altRow = false) {
  cell.font      = { bold: true, size: 9, name: 'Arial' };
  cell.fill      = altRow
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.ROW_ALT_BG } }
    : { type: 'pattern', pattern: 'none' };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  applyBorder(cell, 'hair');
}

function styleStatusCell(cell, status) {
  const isUploaded = String(status || '').toLowerCase().includes('upload');
  cell.font  = { bold: true, size: 9, name: 'Arial', color: { argb: isUploaded ? BRAND.STATUS_UPLOADED_FG : BRAND.STATUS_PENDING_FG } };
  cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: isUploaded ? BRAND.STATUS_UPLOADED_BG : BRAND.STATUS_PENDING_BG } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  applyBorder(cell, 'hair');
}

function styleFinancialDataCell(cell) {
  cell.font      = { size: 9, name: 'Arial' };
  cell.fill      = { type: 'pattern', pattern: 'none' };
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  applyBorder(cell, 'hair');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cell write helpers
// ─────────────────────────────────────────────────────────────────────────────

function setCell(ws, address, value, fallback = '') {
  ws.getCell(address).value = sanitizeExcelValue(value, fallback);
}

function setNumberCell(ws, address, value) {
  const n = toNumber(value);
  ws.getCell(address).value = n === null ? '' : n;
}

function setFinancialCell(ws, address, value) {
  const n = toNumber(value);
  const cell = ws.getCell(address);
  if (n === null) {
    cell.value = '';
  } else {
    cell.value = n;
    cell.numFmt = INR_FORMAT;
  }
}

function setStyledCell(ws, address, value, styleFn, fallback = '') {
  const cell = ws.getCell(address);
  cell.value = sanitizeExcelValue(value, fallback);
  styleFn(cell);
}

function setStyledFinancialCell(ws, address, value) {
  const n = toNumber(value);
  const cell = ws.getCell(address);
  if (n === null) {
    cell.value = '';
  } else {
    cell.value = n;
    cell.numFmt = INR_FORMAT;
  }
  styleFinancialDataCell(cell);
}

function setStyledStatusCell(ws, address, status) {
  const cell = ws.getCell(address);
  cell.value = sanitizeExcelValue(status, 'Pending');
  styleStatusCell(cell, status);
}

// Extracts the raw JS value from an exceljs cell regardless of its internal
// representation (formulas are {formula, result}, hyperlinks are {text,
// hyperlink}, rich text is {richText: [...]}), mirroring what xlsx's `.v`
// (raw value) meant for the source-cell-scanning logic below.
function rawCellValue(cell) {
  if (!cell) return null;
  let v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) v = v.result;
    else if (Array.isArray(v.richText)) v = v.richText.map((rt) => rt.text).join('');
    else if ('text' in v) v = v.text;
  }
  return v;
}

// Source Excel documents (bank/GST/ITR statement exports) are read for
// display/mapping purposes — mirrors xlsx's cellDisplayValue behavior
// (prefer the number-format-aware display text, fall back to raw value,
// treat long integers/labelled fields as identifiers to avoid precision
// loss or scientific notation).
function cellDisplayValue(cell, leftLabel = '') {
  const raw = rawCellValue(cell);
  if (raw === undefined || raw === null || raw === '') return '';
  if (raw instanceof Date) return formatDate(raw);
  const label = String(leftLabel ?? '').toLowerCase();
  if (typeof raw === 'number') {
    const looksLikeIdentifier = Number.isInteger(raw)
      && (Math.abs(raw) >= 1000000000 || /(account|aadhaar|aadhar|mobile|phone|pan|gstin|ifsc|micr|din)/i.test(label));
    if (looksLikeIdentifier) return String(raw);
    const text = cell.text;
    if (text && !/[eE]\+/.test(String(text))) return text;
    return raw;
  }
  const text = cell.text;
  if (text && !/[eE]\+/.test(String(text))) return text;
  return raw;
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
  // Read back from wherever this specific document actually lives — not
  // always S3, since a document uploaded before storage was made S3-only may
  // still be sitting on local disk.
  const storage = getStorageProvider(doc.storage_provider);
  const stream = await storage.getStream(doc.storage_path);
  const buffer = await streamToBuffer(stream);
  if (!buffer.length) return null;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    // Legacy binary .xls (or a corrupt/non-Excel file) — exceljs only reads
    // OOXML .xlsx. Fall through to the caller's null-handling.
    console.warn(`[loanApplicationSummary] Could not parse source document #${doc.id} as .xlsx: ${err.message}`);
    return null;
  }
  return { workbook, document: doc, source: 'document' };
}

async function findStoredExcelDocument({
  documentId,
  tenantId,
  sourceUrl,
  documentTypes = [],
  caseId = null,
  customerId = null,
  applicantId = null
}) {
  const select = {
    id: true,
    tenant_id: true,
    customer_id: true,
    case_id: true,
    applicant_id: true,
    storage_provider: true,
    storage_path: true,
    extension: true,
    mime_type: true,
    file_name: true,
    original_file_name: true,
    document_type: true,
    source_url: true,
    created_at: true,
    updated_at: true
  };

  const baseWhere = {
    tenant_id: Number(tenantId),
    status: 'ACTIVE',
    deleted_at: null,
    ...(documentTypes.length
      ? { document_type: { in: documentTypes } }
      : {})
  };

  if (documentId) {
    const doc = await prisma.document.findFirst({
      where: {
        ...baseWhere,
        id: Number(documentId)
      },
      select
    });
    if (doc && isExcelDocument(doc)) return doc;
  }

  if (sourceUrl) {
    const doc = await prisma.document.findFirst({
      where: {
        ...baseWhere,
        source_url: sourceUrl
      },
      orderBy: [
        { updated_at: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      select
    });
    if (doc && isExcelDocument(doc)) return doc;
  }

  const scopeQueries = [];

  if (caseId) {
    scopeQueries.push({
      ...baseWhere,
      case_id: Number(caseId),
      ...(applicantId
        ? {
            OR: [
              { applicant_id: Number(applicantId) },
              { applicant_id: null }
            ]
          }
        : {})
    });
  }

  if (customerId) {
    scopeQueries.push({
      ...baseWhere,
      customer_id: Number(customerId),
      ...(applicantId
        ? {
            OR: [
              { applicant_id: Number(applicantId) },
              { applicant_id: null }
            ]
          }
        : {})
    });
  }

  for (const where of scopeQueries) {
    const doc = await prisma.document.findFirst({
      where,
      orderBy: [
        { updated_at: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' }
      ],
      select
    });
    if (doc && isExcelDocument(doc)) return doc;
  }

  return null;
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
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    console.warn(`[loanApplicationSummary] Could not parse source URL as .xlsx: ${err.message}`);
    return null;
  }
  return { workbook, source: 'url' };
}

async function readSourceExcelWorkbook({
  document = null,
  documentId,
  tenantId,
  sourceUrl,
  documentTypes = [],
  caseId = null,
  customerId = null,
  applicantId = null
}) {
  const resolvedDocument = document || await findStoredExcelDocument({
    documentId,
    tenantId,
    sourceUrl,
    documentTypes,
    caseId,
    customerId,
    applicantId
  });

  const fromDocument = await readExcelWorkbookFromDocument(resolvedDocument);
  if (fromDocument) return fromDocument;

  return readExcelWorkbookFromUrl(sourceUrl);
}

function findSourceSheetName(workbook, wantedName) {
  if (!workbook) return undefined;

  const wantedNames = Array.isArray(wantedName)
    ? wantedName
    : [wantedName];

  const normalizedWanted = wantedNames
    .filter(Boolean)
    .map(name => String(name).toLowerCase().replace(/[^a-z0-9]/g, ''));

  const exact = workbook.worksheets.find((ws) => {
    const normalizedSheet = String(ws.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedWanted.includes(normalizedSheet);
  });
  if (exact) return exact.name;

  let best = null;
  let bestScore = 0;
  workbook.worksheets.forEach((ws) => {
    const normalizedSheet = String(ws.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    normalizedWanted.forEach((wanted) => {
      if (!wanted || !normalizedSheet) return;
      const contains = normalizedSheet.includes(wanted) || wanted.includes(normalizedSheet);
      const score = contains
        ? Math.min(normalizedSheet.length, wanted.length) / Math.max(normalizedSheet.length, wanted.length)
        : 0;
      if (score > bestScore) {
        bestScore = score;
        best = ws.name;
      }
    });
  });

  return bestScore >= 0.55 ? best : undefined;
}

function sourceSheetRows(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const colCount = Math.max(sheet.columnCount || 0, sheet.actualColumnCount || 0);
  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (sheetRow) => {
    const row = [];
    let lastNonBlank = -1;
    const rowColCount = Math.max(colCount, sheetRow.cellCount || 0);
    for (let c = 1; c <= rowColCount; c += 1) {
      const leftCell = c > 1 ? sheetRow.getCell(c - 1) : null;
      const cell = sheetRow.getCell(c);
      const value = cellDisplayValue(cell, leftCell ? rawCellValue(leftCell) : null);
      row.push(value);
      if (!isBlank(value)) lastNonBlank = row.length - 1;
    }
    if (lastNonBlank >= 0) rows.push(row.slice(0, lastNonBlank + 1));
  });
  return trimEmptyColumns(rows);
}

function getSourceRows(workbook, sheetNames, { fallbackToAllSheets = true } = {}) {
  if (!workbook) return [];

  const candidates = Array.isArray(sheetNames)
    ? sheetNames
    : [sheetNames];

  for (const candidate of candidates) {
    const actualSheetName = findSourceSheetName(workbook, candidate);
    if (actualSheetName) {
      const rows = sourceSheetRows(workbook, actualSheetName);
      if (rows.length) return rows;
    }
  }

  if (!fallbackToAllSheets) return [];

  const combined = [];
  workbook.worksheets.forEach((ws) => {
    const rows = sourceSheetRows(workbook, ws.name);
    if (!rows.length) return;
    combined.push([ws.name]);
    combined.push(...rows);
    combined.push([]);
  });
  return combined;
}

function findRowByLabels(rows, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  return rows.find(row => row?.some(value => labelList.some(label => labelsMatch(value, label)))) || null;
}

function findRowIndexByLabels(rows, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  return rows.findIndex(row => row?.some(value => labelList.some(label => labelsMatch(value, label))));
}

function findLabelColumn(row, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  return (row || []).findIndex(value => labelList.some(label => labelsMatch(value, label)));
}

function findHeaderRowForMetric(rows, metricRowIndex) {
  for (let i = metricRowIndex - 1; i >= Math.max(0, metricRowIndex - 12); i -= 1) {
    const row = rows[i] || [];
    const hasTotal = row.some(value => labelsMatch(value, 'Total'));
    const hasMonth = row.some(value => isMonthHeader(value));
    const hasYear = row.some(value => /^(FY|AY)?\s*20\d{2}(?:[-/]\d{2,4})?$/i.test(String(value || '').trim()));
    if (hasTotal || hasMonth || hasYear) return row;
  }
  return null;
}

function isMonthHeader(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  const text = String(value || '').trim();
  if (!text) return false;
  return /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-/']*\d{2,4}$/i.test(text)
    || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/i.test(text)
    || /^\d{1,2}[\-/]\d{2,4}$/.test(text)
    || /^\d{4}[\-/]\d{1,2}$/.test(text);
}

function getMetricRowDetails(rows, labels) {
  const rowIndex = findRowIndexByLabels(rows, labels);
  if (rowIndex < 0) return null;
  const row = rows[rowIndex];
  const labelCol = findLabelColumn(row, labels);
  return {
    rowIndex,
    row,
    labelCol,
    header: findHeaderRowForMetric(rows, rowIndex)
  };
}

function getKeyValue(rows, labels) {
  const row = findRowByLabels(rows, labels);
  if (!row) return '';
  const labelCol = findLabelColumn(row, labels);
  return firstNonBlank(...row.slice(Math.max(labelCol + 1, 1)));
}

function numericCells(row) {
  return (row || []).slice(1).map(toNumber).filter(n => n !== null);
}

function metricTotal(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details) return null;
  const { row, labelCol, header } = details;
  if (header) {
    const totalIdx = header.findIndex(value => labelsMatch(value, 'Total'));
    if (totalIdx > labelCol) {
      const total = toNumber(row[totalIdx]);
      if (total !== null) return total;
    }
  }
  const nums = row.slice(Math.max(labelCol + 1, 1)).map(toNumber).filter(n => n !== null);
  return nums.length ? nums[nums.length - 1] : null;
}

function metricMonthlyValues(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details) return [];
  const { row, labelCol, header } = details;
  if (!header) return [];
  const values = [];
  for (let idx = Math.max(labelCol + 1, 1); idx < row.length; idx += 1) {
    if (labelsMatch(header[idx], 'Total') || !isMonthHeader(header[idx])) continue;
    const n = toNumber(row[idx]);
    if (n !== null) values.push(n);
  }
  return values;
}

function metricFlowTotal(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details) return null;
  const { row, labelCol, header } = details;
  if (header) {
    const totalIndex = header.findIndex(value => labelsMatch(value, 'Total'));
    if (totalIndex > labelCol) {
      const explicitTotal = toNumber(row[totalIndex]);
      if (explicitTotal !== null) return explicitTotal;
    }
  }
  const monthly = metricMonthlyValues(rows, labels);
  if (monthly.length) return monthly.reduce((sum, value) => sum + value, 0);
  const values = row.slice(Math.max(labelCol + 1, 1)).map(toNumber).filter(value => value !== null);
  return values.length === 1 ? values[0] : values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}



function getKeyValues(rows, labels) {
  const row = findRowByLabels(rows, labels);
  if (!row) return [];
  const labelCol = findLabelColumn(row, labels);
  const labelList = Array.isArray(labels) ? labels : [labels];
  return row
    .slice(Math.max(labelCol + 1, 1))
    .filter(value => !isBlank(value))
    .filter(value => !labelList.some(label => labelsMatch(value, label)));
}

function extractMetricSeries(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details) return { entries: [], total: null };
  const { row, labelCol, header } = details;
  const entries = [];
  let total = null;

  for (let idx = Math.max(labelCol + 1, 1); idx < row.length; idx += 1) {
    const value = toNumber(row[idx]);
    if (value === null) continue;
    const headerValue = header?.[idx] ?? '';
    if (labelsMatch(headerValue, 'Total')) {
      total = value;
      continue;
    }
    entries.push({
      label: String(headerValue || '').trim(),
      value
    });
  }

  if (total === null && entries.length) {
    total = entries[entries.length - 1].value;
  }
  return { entries, total };
}

function splitLatestPrevious(series) {
  const entries = (series?.entries || []).filter(item => item.value !== null);
  return {
    latest: entries.length ? entries[entries.length - 1] : null,
    previous: entries.length > 1 ? entries[entries.length - 2] : null,
    older: entries.length > 2 ? entries[entries.length - 3] : null,
    total: series?.total ?? null
  };
}

function extractMonthlyMetricEntries(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details?.header) return [];
  const { row, labelCol, header } = details;
  const result = [];
  for (let idx = Math.max(labelCol + 1, 1); idx < row.length; idx += 1) {
    if (!isMonthHeader(header[idx])) continue;
    const value = toNumber(row[idx]);
    if (value === null) continue;
    result.push({ month: String(header[idx]).trim(), value });
  }
  return result;
}

function extractSimpleMonthlyTable(rows, sectionLabels = []) {
  let headerIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const hasMonth = row.some(value => labelsMatch(value, 'Month'));
    const hasTaxable = row.some(value => labelsMatch(value, 'Taxable Value'));
    if (!hasMonth || !hasTaxable) continue;

    if (sectionLabels.length) {
      const priorText = rows.slice(Math.max(0, i - 4), i)
        .flat()
        .join(' ');
      if (!sectionLabels.some(label => labelsMatch(priorText, label))) continue;
    }
    headerIndex = i;
    break;
  }
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  const monthIndex = header.findIndex(value => labelsMatch(value, 'Month'));
  const taxableIndex = header.findIndex(value => labelsMatch(value, 'Taxable Value'));
  const taxIndex = header.findIndex(value => labelsMatch(value, 'Tax'));
  const result = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const month = row[monthIndex];
    if (isBlank(month)) break;
    if (labelsMatch(month, 'Total')) break;
    if (!isMonthHeader(month)) continue;
    result.push({
      month: String(month).trim(),
      taxableValue: toNumber(row[taxableIndex]),
      tax: taxIndex >= 0 ? toNumber(row[taxIndex]) : null
    });
  }
  return result;
}

function collectCaseDocuments(caseRecord) {
  const caseDocuments = Array.isArray(caseRecord?.documents) ? caseRecord.documents : [];
  const applicantDocuments = (caseRecord?.applicants || []).flatMap(applicant =>
    (applicant.documents || []).map(document => ({
      ...document,
      applicant_id: document.applicant_id ?? applicant.id
    }))
  );
  const deduped = new Map();
  [...caseDocuments, ...applicantDocuments].forEach(document => {
    if (document?.id !== undefined && document?.id !== null) deduped.set(String(document.id), document);
  });
  return [...deduped.values()];
}

function findCaseExcelDocument(caseRecord, documentTypes, applicantId, keywords = []) {
  const allowedTypes = new Set((documentTypes || []).map(type => String(type).toUpperCase()));
  const normalizedKeywords = (keywords || []).map(keyword => String(keyword).toLowerCase());
  const documents = collectCaseDocuments(caseRecord)
    .filter(document => document?.status !== 'DELETED' && !document?.deleted_at)
    .filter(isExcelDocument)
    .filter(document => {
      const type = String(document.document_type || '').toUpperCase();
      if (allowedTypes.has(type)) return true;
      const searchable = `${document.file_name || ''} ${document.original_file_name || ''}`.toLowerCase();
      return normalizedKeywords.some(keyword => searchable.includes(keyword));
    })
    .sort((a, b) => {
      const applicantScoreA = applicantId && Number(a.applicant_id) === Number(applicantId) ? 2 : a.applicant_id ? 0 : 1;
      const applicantScoreB = applicantId && Number(b.applicant_id) === Number(applicantId) ? 2 : b.applicant_id ? 0 : 1;
      if (applicantScoreA !== applicantScoreB) return applicantScoreB - applicantScoreA;
      const timeA = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
      const timeB = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
      return timeB - timeA || Number(b.id || 0) - Number(a.id || 0);
    });
  return documents[0] || null;
}

function selectLatestSourceRecord(records = [], idField, urlField) {
  const successStatuses = new Set(['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCEEDED', 'PROCESSED', 'REPORT_READY']);
  return [...(records || [])].sort((a, b) => {
    const score = record => {
      const success = successStatuses.has(String(record?.status || record?.report_status || '').toUpperCase()) ? 4 : 0;
      const linked = record?.[idField] ? 2 : 0;
      const url = record?.[urlField] ? 1 : 0;
      return success + linked + url;
    };
    return score(b) - score(a)
      || (new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime())
      || Number(b?.id || 0) - Number(a?.id || 0);
  })[0] || null;
}

function latestYearMetric(rows, labels) {
  const details = getMetricRowDetails(rows, labels);
  if (!details) return null;
  const { row, labelCol, header } = details;
  const values = [];
  for (let idx = Math.max(labelCol + 1, 1); idx < row.length; idx += 1) {
    if (header && labelsMatch(header[idx], 'Total')) continue;
    const n = toNumber(row[idx]);
    if (n !== null) values.push(n);
  }
  return values.length ? values[values.length - 1] : metricTotal(rows, labels);
}

function extractCompanyProfile(gstWorkbook) {
  const entityRows = getSourceRows(gstWorkbook, ['Entity Details', 'Company Profile', 'GST Analysis']);
  const accountRows = getSourceRows(gstWorkbook, ['Account Details', 'Company Profile', 'GST Analysis']);
  return {
    gstin: firstNonBlank(getKeyValue(entityRows, ['GSTIN/UIN', 'GSTIN']), getKeyValue(accountRows, ['GSTIN/UIN', 'GSTIN'])),
    legalName: getKeyValue(entityRows, ['Legal Name', 'Legal Name of Business']),
    tradeName: getKeyValue(entityRows, ['Trade Name', 'Trade Name of Business']),
    pan: getKeyValue(entityRows, 'PAN'),
    email: getKeyValue(entityRows, ['Email', 'Email Id']),
    mobile: getKeyValue(entityRows, ['Mobile Number', 'Mobile', 'Phone Number']),
    constitution: getKeyValue(entityRows, ['Constitution of Business', 'Constitution']),
    natureOfBusiness: getKeyValue(entityRows, ['Nature of Business Activity', 'Nature of Business']),
    principalPlaceOfBusiness: getKeyValue(entityRows, ['Principal Place of Business', 'Registered Address']),
    taxpayerType: getKeyValue(entityRows, 'Taxpayer Type'),
    gstStatus: getKeyValue(entityRows, ['GSTIN/UIN Status', 'GSTIN Status', 'Registration Status']),
    dateOfRegistration: getKeyValue(entityRows, ['Date of Registration', 'Registration Date']),
    stateJurisdiction: getKeyValue(entityRows, 'State Jurisdiction'),
    centreJurisdiction: getKeyValue(entityRows, ['Centre Jurisdiction', 'Center Jurisdiction']),
    stateOfOperations: getKeyValue(entityRows, ['State of Operations', 'State']),
    reportPeriod: getKeyValue(entityRows, 'Report Period'),
    reportDate: getKeyValue(entityRows, 'Report Date')
  };
}

function extractAnnualGstrSales(gstWorkbook) {
  const rows = getSourceRows(gstWorkbook, ['Overview Yearly', 'GST Analysis']);
  return splitLatestPrevious(extractMetricSeries(rows, ['GSTR 1 Gross Sales E A B C D', 'GSTR 1 Gross Sales'])).latest?.value ?? null;
}

function extractLast12MonthGstrSales(gstWorkbook) {
  const rows = getSourceRows(gstWorkbook, ['Overview Monthly', 'Monthly Sales Summary', 'GST Analysis']);
  const total = metricTotal(rows, ['GSTR 1 Gross Sales E A B C D', 'GSTR 1 Gross Sales']);
  if (total !== null) return total;
  const monthly = metricMonthlyValues(rows, ['GSTR 1 Gross Sales E A B C D', 'GSTR 1 Gross Sales']);
  if (monthly.length) return calculateLast12MonthTotal(monthly);
  const table = extractSimpleMonthlyTable(rows, ['Monthly Sales Summary']);
  return table.length ? table.reduce((sum, row) => sum + (toNumber(row.taxableValue) || 0), 0) : null;
}

function extractGeneralInformation(itrWorkbook) {
  const rows = getSourceRows(itrWorkbook, ['General Information', 'ITR Analysis']);
  const yearValues = getKeyValues(rows, ['Particulars']);
  const valuesFor = labels => getKeyValues(rows, labels);
  const latestValue = labels => {
    const values = valuesFor(labels);
    return values.length ? values[values.length - 1] : '';
  };
  const previousValue = labels => {
    const values = valuesFor(labels);
    return values.length > 1 ? values[values.length - 2] : '';
  };
  return {
    latestYear: yearValues.length ? yearValues[yearValues.length - 1] : '',
    previousYear: yearValues.length > 1 ? yearValues[yearValues.length - 2] : '',
    applicantName: latestValue('Name'),
    previousApplicantName: previousValue('Name'),
    pan: latestValue('PAN'),
    previousPan: previousValue('PAN'),
    email: latestValue(['Email Id', 'Email']),
    mobile: latestValue(['Contact Number', 'Mobile Number', 'Mobile']),
    dob: latestValue(['Date of Birth', 'DOB']),
    address: latestValue(['Registered Address', 'Address']),
    acknowledgementNumber: latestValue(['Acknowledgement Number', 'Acknowledgment Number']),
    itrType: latestValue('ITR Type')
  };
}

function extractTaxCalculation(itrWorkbook) {
  const rows = getSourceRows(itrWorkbook, ['Tax Calculation', 'ITR Analysis']);
  const metric = labels => splitLatestPrevious(extractMetricSeries(rows, labels));
  const gross = metric('Gross Total Income');
  const taxable = metric('Total Taxable Income');
  const salary = metric('Income from Salary');
  const agricultural = metric('Net Agricultural Income');
  return {
    grossTotalIncome: gross.latest?.value ?? null,
    previousGrossTotalIncome: gross.previous?.value ?? null,
    totalTaxableIncome: taxable.latest?.value ?? null,
    previousTotalTaxableIncome: taxable.previous?.value ?? null,
    salaryIncome: salary.latest?.value ?? null,
    previousSalaryIncome: salary.previous?.value ?? null,
    agriculturalIncome: agricultural.latest?.value ?? null,
    previousAgriculturalIncome: agricultural.previous?.value ?? null
  };
}

function extractProfitAndLoss(itrWorkbook) {
  const rows = getSourceRows(itrWorkbook, ['Profit and Loss Statement', 'Profit and Loss', 'ITR Analysis']);
  const metric = labels => splitLatestPrevious(extractMetricSeries(rows, labels));
  const pat = metric(['Profit After Tax', 'Net Profit After Tax']);
  const depreciation = metric(['Depreciation and Amortization', 'Depreciation']);
  const finance = metric(['Finance Cost', 'Interest on Loan']);
  const revenue = metric(['Revenue from Operations', 'Gross Receipts', 'Turnover']);
  return {
    latestYear: pat.latest?.label || revenue.latest?.label || '',
    previousYear: pat.previous?.label || revenue.previous?.label || '',
    netProfitAfterTax: pat.latest?.value ?? null,
    previousNetProfitAfterTax: pat.previous?.value ?? null,
    depreciation: depreciation.latest?.value ?? null,
    previousDepreciation: depreciation.previous?.value ?? null,
    interestOnLoan: finance.latest?.value ?? null,
    previousInterestOnLoan: finance.previous?.value ?? null,
    revenueFromOperations: revenue.latest?.value ?? null,
    previousRevenueFromOperations: revenue.previous?.value ?? null
  };
}

function extractBalanceSheet(itrWorkbook) {
  return { rows: getSourceRows(itrWorkbook, 'Balance Sheet') };
}

function extractRatios(itrWorkbook) {
  return { rows: getSourceRows(itrWorkbook, 'Ratio Analysis') };
}

function extractAccountDetails(bankWorkbook) {
  const rows = getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis', 'Account Summary']);
  const description = getKeyValue(rows, ['Description', 'Bank Accounts']);
  return {
    description,
    accountHolder: getKeyValue(rows, ['Account Holders', 'Account Holder', 'Account Holder Name', 'Customer Name']),
    accountNumber: getKeyValue(rows, ['Account Number', 'Account No', 'A/c No', 'Acc No']),
    bankName: getKeyValue(rows, ['Bank Name', 'Institution Name']),
    accountType: getKeyValue(rows, ['Account Type', 'Type of Account']),
    email: getKeyValue(rows, ['Email', 'Email Id']),
    phone: getKeyValue(rows, ['Phone Number', 'Phone', 'Mobile Number', 'Mobile']),
    statementFrom: getKeyValue(rows, ['Statement From', 'From Date']),
    statementTo: getKeyValue(rows, ['Statement To', 'To Date']),
    transactionStartDate: getKeyValue(rows, ['Txn Start Date', 'Transaction Start Date']),
    transactionEndDate: getKeyValue(rows, ['Txn End Date', 'Transaction End Date'])
  };
}

function extractMonthwiseMetric(bankWorkbook, metricName) {
  return metricMonthlyValues(getSourceRows(bankWorkbook, 'Summary'), metricName);
}

function extractCreditTxnTotal(bankWorkbook) {
  const rows = getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']);
  return metricFlowTotal(rows, ['Credit Txns', 'Credit Transactions', 'Total Credits', 'Net Credit']);
}

function extractMonthlyAverageBalance(bankWorkbook) {
  const rows = getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']);
  const aliases = ['Monthly Average Balance', 'Average EOD Balance', 'Average Daily Balance'];
  const monthly = metricMonthlyValues(rows, aliases);
  if (monthly.length) return calculateAverageFromMonthlyValues(monthly);

  const details = getMetricRowDetails(rows, aliases);
  const monthCount = details?.header
    ? details.header.filter((value, idx) => idx > details.labelCol && isMonthHeader(value)).length
    : 0;
  const total = metricTotal(rows, aliases);
  if (total !== null && monthCount > 0) return total / monthCount;
  return null;
}

function extractBankCharges(bankWorkbook) {
  return metricFlowTotal(getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']), ['Bank Charges', 'Minimum Balance Charges']);
}

function extractCashDeposit(bankWorkbook) {
  return metricFlowTotal(getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']), ['Cash Deposit', 'Cash Deposits']);
}

function extractCashWithdrawal(bankWorkbook) {
  return metricFlowTotal(getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']), ['Cash Withdrawal', 'Cash Withdrawals']);
}

function extractChequeBounceCounts(bankWorkbook) {
  const rows = getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']);
  const inward = metricFlowTotal(rows, ['I/W Cheque Bounces', 'Inward Cheque Bounced Count', 'Inward Cheque Bounces']) || 0;
  const outward = metricFlowTotal(rows, ['O/W Cheque Bounces', 'Outward Cheque Bounced Count', 'Outward Cheque Bounces']) || 0;
  return { inward, outward, total: inward + outward };
}

function extractEmiLoanPayments(bankWorkbook) {
  return metricFlowTotal(getSourceRows(bankWorkbook, ['Summary', 'Bank Statement Analysis']), ['EMI / Loan Payments', 'EMI Loan Payments', 'EMI/ Loan Payments']);
}

function buildFinancialSnapshot({ gst = {}, itr = {}, bank = {} }) {
  return {
    netProfitAfterTax: itr.profitAndLoss?.netProfitAfterTax,
    depreciation: itr.profitAndLoss?.depreciation,
    interestOnLoan: itr.profitAndLoss?.interestOnLoan,
    annualGstrSales: gst.annualGstrSales,
    last12MonthGstrSales: gst.last12MonthGstrSales,
    turnoverReceiptItr: itr.profitAndLoss?.revenueFromOperations,
    annualBusinessReceiptBank: bank.creditTxnTotal,
    averageBankBalance: bank.monthlyAverageBalance,
    salaryIncome: itr.taxCalculation?.salaryIncome,
    agriculturalIncome: itr.taxCalculation?.agriculturalIncome,
    bankCharges: bank.bankCharges,
    cashDeposit: bank.cashDeposit,
    cashWithdrawal: bank.cashWithdrawal,
    chequeBounces: bank.chequeBounces?.total,
    emiLoanPayments: bank.emiLoanPayments
  };
}

function buildApplicantDetails(mappedSources = {}) {
  return {
    gst: mappedSources.gst?.companyProfile || {},
    itr: mappedSources.itr?.generalInformation || {},
    bank: mappedSources.bank?.accountDetails || {}
  };
}

function buildLoanRequirement(caseRecord) {
  return {
    loanAmount: firstNonBlank(caseRecord.loan_amount, caseRecord.esr_financials?.requested_loan_amount),
    tenure: caseRecord.esr_financials?.requested_tenure_months,
    propertyValue: resolvePropertyValue(caseRecord)
  };
}

function buildBureauDetails(caseRecord) {
  const primary = getPrimaryApplicant(caseRecord);
  return {
    score: firstNonBlank(primary.cibil_score, latestBureau(primary)?.score, caseRecord.cibil_score, caseRecord.esr_financials?.bureau_score)
  };
}

function mapSourceWorkbooks(sourceWorkbooks = {}) {
  const gst = sourceWorkbooks.gst ? (() => {
    const profile = extractCompanyProfile(sourceWorkbooks.gst);
    const yearlyRows = getSourceRows(sourceWorkbooks.gst, ['Overview Yearly', 'GST Analysis']);
    const salesSeries = splitLatestPrevious(extractMetricSeries(yearlyRows, ['GSTR 1 Gross Sales E A B C D', 'GSTR 1 Gross Sales']));
    const purchaseSeries = splitLatestPrevious(extractMetricSeries(yearlyRows, ['GSTR 2A Gross Purchases', 'Gross Purchases']));
    const monthlyRows = getSourceRows(sourceWorkbooks.gst, ['Overview Monthly', 'Monthly Sales Summary', 'GST Analysis']);
    return {
      companyProfile: profile,
      annualGstrSales: salesSeries.latest?.value ?? extractAnnualGstrSales(sourceWorkbooks.gst),
      previousAnnualGstrSales: salesSeries.previous?.value ?? null,
      annualGstrSalesYear: salesSeries.latest?.label || '',
      previousAnnualGstrSalesYear: salesSeries.previous?.label || '',
      annualPurchases: purchaseSeries.latest?.value ?? null,
      previousAnnualPurchases: purchaseSeries.previous?.value ?? null,
      last12MonthGstrSales: extractLast12MonthGstrSales(sourceWorkbooks.gst),
      monthlySales: extractSimpleMonthlyTable(monthlyRows, ['Monthly Sales Summary']),
      monthlyPurchases: extractSimpleMonthlyTable(monthlyRows, ['Monthly Purchase Summary'])
    };
  })() : {};

  const itr = sourceWorkbooks.itr ? {
    generalInformation: extractGeneralInformation(sourceWorkbooks.itr),
    taxCalculation: extractTaxCalculation(sourceWorkbooks.itr),
    profitAndLoss: extractProfitAndLoss(sourceWorkbooks.itr),
    balanceSheet: extractBalanceSheet(sourceWorkbooks.itr),
    ratios: extractRatios(sourceWorkbooks.itr)
  } : {};

  const bank = sourceWorkbooks.bank ? (() => {
    const rows = getSourceRows(sourceWorkbooks.bank, ['Summary', 'Bank Statement Analysis']);
    return {
      accountDetails: extractAccountDetails(sourceWorkbooks.bank),
      creditTxnTotal: extractCreditTxnTotal(sourceWorkbooks.bank),
      monthlyAverageBalance: extractMonthlyAverageBalance(sourceWorkbooks.bank),
      bankCharges: extractBankCharges(sourceWorkbooks.bank),
      cashDeposit: extractCashDeposit(sourceWorkbooks.bank),
      cashWithdrawal: extractCashWithdrawal(sourceWorkbooks.bank),
      chequeBounces: extractChequeBounceCounts(sourceWorkbooks.bank),
      emiLoanPayments: extractEmiLoanPayments(sourceWorkbooks.bank),
      monthly: {
        debitTransactions: extractMonthlyMetricEntries(rows, ['Debit Txns', 'Debit Transactions']),
        creditTransactions: extractMonthlyMetricEntries(rows, ['Credit Txns', 'Credit Transactions']),
        openingBalance: extractMonthlyMetricEntries(rows, 'Opening Balance'),
        closingBalance: extractMonthlyMetricEntries(rows, 'Closing Balance'),
        averageBalance: extractMonthlyMetricEntries(rows, ['Monthly Average Balance', 'Average EOD Balance']),
        cashDeposit: extractMonthlyMetricEntries(rows, ['Cash Deposit', 'Cash Deposits']),
        cashWithdrawal: extractMonthlyMetricEntries(rows, ['Cash Withdrawal', 'Cash Withdrawals']),
        inwardBounces: extractMonthlyMetricEntries(rows, ['I/W Cheque Bounces', 'Inward Cheque Bounces']),
        outwardBounces: extractMonthlyMetricEntries(rows, ['O/W Cheque Bounces', 'Outward Cheque Bounces']),
        emiLoanPayments: extractMonthlyMetricEntries(rows, ['EMI / Loan Payments', 'EMI Loan Payments', 'EMI/ Loan Payments']),
        bankCharges: extractMonthlyMetricEntries(rows, ['Bank Charges', 'Minimum Balance Charges'])
      }
    };
  })() : {};

  return {
    gst,
    itr,
    bank,
    financialSnapshot: buildFinancialSnapshot({ gst, itr, bank })
  };
}

function trimEmptyColumns(rows) {
  if (!rows.length) return [];
  let first = Infinity;
  let last = -1;
  rows.forEach((row) => {
    row.forEach((value, index) => {
      if (!isBlank(value)) {
        first = Math.min(first, index);
        last = Math.max(last, index);
      }
    });
  });
  if (last < 0) return [];
  return rows.map(row => row.slice(first, last + 1));
}

function clearWorksheet(ws) {
  if (!ws) return;
  const merges = ws._merges ? Object.keys(ws._merges) : [];
  merges.forEach((range) => {
    try { ws.unMergeCells(range); } catch (_) {}
  });
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
      cell.style = {};
    });
  });
  if (ws.rowCount > 0) ws.spliceRows(1, ws.rowCount);
  ws.columns = [];
}

function rowNonBlankCount(row) {
  return (row || []).filter(value => !isBlank(value)).length;
}

function rowHasMostlyText(row) {
  const nonBlank = (row || []).filter(value => !isBlank(value));
  return nonBlank.length > 1 && nonBlank.some(value => /[A-Za-z]/.test(String(value)));
}

function isLikelyHeaderRow(row, nextRow) {
  if (!nextRow) return false;
  return rowNonBlankCount(row) >= 2 && rowHasMostlyText(row) && rowNonBlankCount(nextRow) >= 2;
}

function applySourceSheetLayout(ws, { sectionRows = new Set(), headerRows = new Set(), maxColumns = 1 } = {}) {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.pageSetup = {
    ...(ws.pageSetup || {}),
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    orientation: 'landscape',
    horizontalCentered: true
  };

  ws.eachRow((row, rowNumber) => {
    const isSection = sectionRows.has(rowNumber);
    const isHeader  = headerRows.has(rowNumber);
    const isAlt     = !isSection && !isHeader && rowNumber % 2 === 0;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font      = { size: 9, name: 'Arial' };
      cell.alignment = { vertical: 'top', wrapText: true };
      applyBorder(cell, 'hair');

      if (isSection) {
        cell.font      = { bold: true, size: 11, color: { argb: BRAND.SECTION_FG }, name: 'Arial' };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.SECTION_BG } };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
        applyBorder(cell, 'thin');
      } else if (isHeader) {
        cell.font = { bold: true, size: 9, color: { argb: BRAND.HEADER_FG }, name: 'Arial' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.HEADER_BG } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      } else if (isAlt) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.ROW_ALT_BG } };
      }
    });
    row.height = isSection ? 22 : isHeader ? 24 : undefined;
  });

  for (let i = 1; i <= Math.max(maxColumns, ws.columnCount, 1); i += 1) {
    let maxLength = i === 1 ? 20 : 13;
    ws.getColumn(i).eachCell({ includeEmpty: false }, (cell) => {
      const length = String(cell.value || '').length;
      maxLength = Math.max(maxLength, Math.min(length + 2, 44));
    });
    ws.getColumn(i).width = Math.min(Math.max(maxLength, i === 1 ? 22 : 13), i === 1 ? 40 : 32);
  }
}

function copySourceWorkbookToSheet(targetSheet, sourceWorkbook, sourceType) {
  const sourceSheetNames = sourceWorkbook?.worksheets?.map((ws) => ws.name) || [];
  if (!targetSheet || !sourceSheetNames.length) return false;

  clearWorksheet(targetSheet);
  const preferredSheets = SOURCE_SHEET_LIMITS[sourceType] || sourceSheetNames;
  const selectedSheetNames = preferredSheets
    .map(name => findSourceSheetName(sourceWorkbook, name))
    .filter(Boolean);
  const fallbackSheetNames = selectedSheetNames.length ? [] : sourceSheetNames.slice(0, Math.min(sourceSheetNames.length, preferredSheets.length || 1));
  const sheetNames = [...new Set([...selectedSheetNames, ...fallbackSheetNames])];

  const sections = sheetNames.map(sheetName => ({
    sheetName,
    rows: sourceSheetRows(sourceWorkbook, sheetName)
  })).filter(section => section.rows.length);

  const maxColumns = Math.max(1, ...sections.flatMap(section => section.rows.map(row => row.length || 1)));
  let rowCursor = 1;
  const sectionRows = new Set();
  const headerRows = new Set();

  for (const { sheetName, rows } of sections) {
    if (maxColumns > 1) targetSheet.mergeCells(rowCursor, 1, rowCursor, maxColumns);
    setCell(targetSheet, targetSheet.getCell(rowCursor, 1).address, sheetName, 'Source Data');
    sectionRows.add(rowCursor);
    rowCursor += 1;

    rows.forEach((row, index) => {
      if (isLikelyHeaderRow(row, rows[index + 1])) headerRows.add(rowCursor);
      for (let col = 1; col <= maxColumns; col += 1) {
        targetSheet.getCell(rowCursor, col).value = sanitizeExcelValue(row[col - 1], '');
      }
      rowCursor += 1;
    });
    rowCursor += 1;
  }

  if (rowCursor === 1) return false;
  applySourceSheetLayout(targetSheet, { sectionRows, headerRows, maxColumns });
  return true;
}

async function copyStoredSourceWorkbook({ workbook, targetSheetName, sourceType, documentId, tenantId, sourceUrl, documentTypes = [] }) {
  const source = await readSourceExcelWorkbook({ documentId, tenantId, sourceUrl, documentTypes });
  if (!source?.workbook) return false;
  return copySourceWorkbookToSheet(workbook.getWorksheet(targetSheetName), source.workbook, sourceType);
}

async function loadAvailableSourceWorkbooks(caseRecord, tenantId) {
  const primaryApplicant = getPrimaryApplicant(caseRecord);
  const applicantId = primaryApplicant?.id || null;
  const caseId = caseRecord?.id || null;
  const customerId = caseRecord?.customer_id || caseRecord?.customer?.id || null;

  const bank = selectLatestSourceRecord(caseRecord.bank_statements || [], 'bank_excel_document_id', 'report_excel_url');
  const itr = selectLatestSourceRecord(caseRecord.itr_analytics || [], 'itr_document_id', 'excel_url');
  const gst = selectLatestSourceRecord(caseRecord.gst_requests || [], 'gst_excel_document_id', 'report_excel_url');

  const bankDocument = findCaseExcelDocument(
    caseRecord,
    ['BANK_EXCEL', 'BANK_STATEMENT'],
    applicantId,
    ['bank', 'statement']
  );
  const itrDocument = findCaseExcelDocument(
    caseRecord,
    ['ITR_EXCEL', 'ITR'],
    applicantId,
    ['itr', 'income tax']
  );
  const gstDocument = findCaseExcelDocument(
    caseRecord,
    ['GST_REPORT_EXCEL', 'GST_RETURNS'],
    applicantId,
    ['gst', 'gstr']
  );

  const read = async (label, args) => {
    try {
      return await readSourceExcelWorkbook(args);
    } catch (err) {
      console.warn(`[LoanApplicationSummary] ${label} source Excel read failed:`, err.message);
      return null;
    }
  };

  const [bankSource, itrSource, gstSource] = await Promise.all([
    read('Bank', {
      document: bankDocument,
      documentId: bank?.bank_excel_document_id,
      tenantId,
      sourceUrl: bank?.report_excel_url,
      documentTypes: ['BANK_EXCEL', 'BANK_STATEMENT'],
      caseId,
      customerId,
      applicantId
    }),
    read('ITR', {
      document: itrDocument,
      documentId: itr?.itr_document_id,
      tenantId,
      sourceUrl: itr?.excel_url,
      documentTypes: ['ITR_EXCEL', 'ITR'],
      caseId,
      customerId,
      applicantId
    }),
    read('GST', {
      document: gstDocument,
      documentId: gst?.gst_excel_document_id,
      tenantId,
      sourceUrl: gst?.report_excel_url,
      documentTypes: ['GST_REPORT_EXCEL', 'GST_RETURNS'],
      caseId,
      customerId,
      applicantId
    })
  ]);

  return {
    bank: bankSource?.workbook || null,
    itr: itrSource?.workbook || null,
    gst: gstSource?.workbook || null,
    metadata: {
      bank: bankSource ? { source: bankSource.source, documentId: bankSource.document?.id || null } : null,
      itr: itrSource ? { source: itrSource.source, documentId: itrSource.document?.id || null } : null,
      gst: gstSource ? { source: gstSource.source, documentId: gstSource.document?.id || null } : null
    }
  };
}

async function copyAvailableSourceWorkbooks(workbook, caseRecord, tenantId, sourceWorkbooks = null) {
  const sources = sourceWorkbooks || await loadAvailableSourceWorkbooks(caseRecord, tenantId);
  const bankCopied = sources.bank ? copySourceWorkbookToSheet(workbook.getWorksheet('Bank Statement Analysis.'), sources.bank, 'bank') : false;
  const itrCopied = sources.itr ? copySourceWorkbookToSheet(workbook.getWorksheet('ITR Analysis'), sources.itr, 'itr') : false;
  const gstCopied = sources.gst ? copySourceWorkbookToSheet(workbook.getWorksheet('GST Analysis'), sources.gst, 'gst') : false;

  return { bankCopied, itrCopied, gstCopied };
}

function ensureWorksheetContract(workbook) {
  const bankWithoutTrailingDot = workbook.getWorksheet('Bank Statement Analysis');
  if (bankWithoutTrailingDot) bankWithoutTrailingDot.name = 'Bank Statement Analysis.';

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
  clearWorksheet(ws);

  const title = String(message || ws.name || 'Report')
    .replace(/\s+data\s+is\s+not\s+available\s+for\s+this\s+case\.?/i, '')
    .trim() || ws.name || 'Report';

  ws.mergeCells('A1:D1');
  const banner = ws.getCell('A1');
  banner.value = title;
  banner.font      = { bold: true, size: 14, color: { argb: BRAND.BANNER_FG }, name: 'Arial' };
  banner.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.BANNER_BG } };
  banner.alignment = { horizontal: 'left', vertical: 'middle' };
  applyBorder(banner);
  ws.getRow(1).height = 34;

  // Row 2 — subtle info message
  ws.mergeCells('A2:D2');
  const infoCell = ws.getCell('A2');
  infoCell.value     = 'No source data available for this case.';
  infoCell.font      = { italic: true, size: 9, color: { argb: BRAND.HEADER_FG }, name: 'Arial' };
  infoCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.META_BG } };
  infoCell.alignment = { horizontal: 'left', vertical: 'middle' };
  applyBorder(infoCell, 'hair');
  ws.getRow(2).height = 20;

  // Row 3 — column header
  ['A3', 'B3', 'C3', 'D3'].forEach((address, idx) => {
    const cell = ws.getCell(address);
    cell.value = idx === 0 ? 'Particulars' : '';
    styleColumnHeader(cell);
  });
  ws.getRow(3).height = 24;

  // Row 4 — empty data row with borders
  ['A4', 'B4', 'C4', 'D4'].forEach((address) => {
    const cell = ws.getCell(address);
    cell.value = '';
    applyBorder(cell, 'hair');
  });

  ws.columns = [
    { width: 28 },
    { width: 18 },
    { width: 18 },
    { width: 18 }
  ];
  ws.views = [{ state: 'frozen', ySplit: 3 }];
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

function getApplicantLabel(applicant, index = 0, fallback = '') {
  if (!applicant) return fallback || `Applicant ${index + 1}`;
  return firstNonBlank(
    applicant.name,
    applicant.applicant_label,
    fallback,
    index === 0 ? 'Primary Applicant' : `Co-Applicant ${index}`
  );
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

function documentStatus(caseRecord, types = [], applicant = null, keywords = []) {
  const wanted = new Set(types.map(t => String(t).toUpperCase()));
  const applicantDocs = (caseRecord.applicants || []).flatMap(a =>
    (a.documents || []).map(doc => ({ ...doc, _ownerApplicantId: a.id }))
  );
  const docs = [...(caseRecord.documents || []), ...applicantDocs];
  const applicantId = applicant?.id || null;
  const wantedKeywords = keywords.map(value => String(value).toLowerCase());
  const matched = docs.find(doc => {
    if (doc.status === 'DELETED') return false;
    const docType = String(doc.document_type || '').toUpperCase();
    if (!wanted.has(docType)) return false;
    const ownerApplicantId = doc.applicant_id ?? doc._ownerApplicantId;
    if (applicantId && Number(ownerApplicantId) !== Number(applicantId)) return false;
    if (wantedKeywords.length) {
      const searchable = [
        doc.document_subtype,
        doc.document_name,
        doc.name,
        doc.file_name,
        doc.original_name,
        doc.scope,
        doc.description
      ].filter(Boolean).join(' ').toLowerCase();
      if (!wantedKeywords.some(keyword => searchable.includes(keyword))) return false;
    }
    return true;
  });
  return matched ? 'Uploaded' : 'Pending';
}

function latestRawBank(caseRecord) {
  const bank = getLatest(caseRecord.bank_statements || []);
  if (!bank) return null;
  return normalizeJson(bank.raw_analyze_response)
      || normalizeJson(bank.raw_retrieve_response)
      || normalizeJson(bank.raw_download_response)
      || normalizeJson(bank.files_payload);
}

function latestRawItr(caseRecord) {
  const itr = getLatest(caseRecord.itr_analytics || []);
  return itr ? normalizeJson(itr.analytics_payload) : null;
}

function latestRawGst(caseRecord) {
  const gst = getLatest(caseRecord.gst_requests || []);
  return gst
    ? normalizeJson(gst.raw_report_data)
      || normalizeJson(gst.raw_fetch_data)
      || normalizeJson(gst.raw_gst_data)
      || normalizeJson(gst.provider_callback_payload)
    : null;
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

// Tab colours per sheet for quick navigation
const SHEET_TAB_COLORS = {
  'Summary':                '0A2540',
  'Bank Statement Analysis.':'1D4ED8',
  'ITR Analysis':           '065F46',
  'GST Analysis':           '7C3AED',
  'Cibil - Transunion':     'B45309'
};

// function addLogoAndPrintSettings(workbook) {
//   const hasLogo = fs.existsSync(LOGO_PATH);
//   const imageId = hasLogo ? workbook.addImage({ filename: LOGO_PATH, extension: 'jpeg' }) : null;

//   workbook.worksheets.forEach((ws) => {
//     // Tab colour
//     const tabColor = SHEET_TAB_COLORS[ws.name];
//     if (tabColor) ws.properties = { ...(ws.properties || {}), tabColor: { argb: `FF${tabColor}` } };

//     // Logo (top-right, doesn't overwrite template cells)
//     if (imageId !== null) {
//       ws.addImage(imageId, {
//         tl: { col: Math.max(0, (ws.columnCount || 8) - 3), row: 0.15 },
//         ext: { width: 145, height: 52 },
//         editAs: 'oneCell'
//       });
//     }

//     ws.pageSetup = {
//       ...(ws.pageSetup || {}),
//       fitToPage: true,
//       fitToWidth: 1,
//       fitToHeight: 0,
//       orientation: ws.name === 'Summary' ? 'portrait' : 'landscape',
//       horizontalCentered: true,
//       margins: { left: 0.25, right: 0.25, top: 0.55, bottom: 0.45, header: 0.25, footer: 0.25 },
//       printTitlesRow: '1:4'
//     };

//     ws.headerFooter = {
//       ...(ws.headerFooter || {}),
//       oddHeader: `&C&"Arial,Bold"&14${ws.name}`,
//       oddFooter: '&L&"Arial"&9Loan Application Summary&C&"Arial"&9Page &P of &N&R&"Arial"&9Generated by Cred2Tech'
//     };
//   });
// }


function getSheetTitle(sheetName) {
  const titles = {
    Summary: 'LOAN APPLICATION SUMMARY',
    'Bank Statement Analysis.': 'BANK STATEMENT ANALYSIS',
    'ITR Analysis': 'ITR ANALYSIS — GENERAL INFORMATION',
    'GST Analysis': 'GST ANALYSIS',
    'Cibil - Transunion': 'CIBIL - TRANSUNION — DEMOGRAPHIC DETAILS'
  };

  return titles[sheetName]
    || String(sheetName || '').toUpperCase();
}

function normalizeTopHeaderRow(ws) {
  if (!ws) return;

  const rowOneMerges = Object.values(
    ws._merges || {}
  )
    .map((range) => range?.model)
    .filter(
      (model) =>
        model
        && model.top <= 1
        && model.bottom >= 1
    );

  rowOneMerges.forEach((model) => {
    try {
      ws.unMergeCells(
        model.top,
        model.left,
        model.bottom,
        model.right
      );
    } catch (_) {
      // Ignore malformed legacy merge definitions.
    }
  });

  const minimumColumns =
    ws.name === 'Summary' ? 7 : 5;

  const lastColumn = Math.max(
    ws.actualColumnCount || 0,
    ws.columnCount || 0,
    minimumColumns
  );

  ws.mergeCells(1, 1, 1, lastColumn);

  const titleCell = ws.getCell('A1');

  titleCell.value = getSheetTitle(ws.name);
  titleCell.font = {
    name: 'Arial',
    size: 14,
    bold: true,
    color: {
      argb: 'FFFFFFFF'
    }
  };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: {
      argb: 'FF000000'
    }
  };
  titleCell.alignment = {
    horizontal: 'right',
    vertical: 'middle',
    wrapText: false,
    indent: 1
  };

  for (
    let column = 1;
    column <= lastColumn;
    column += 1
  ) {
    const cell = ws.getCell(1, column);
    cell.fill = titleCell.fill;
    applyBorder(cell);
  }

  ws.getRow(1).height = 42;
  ws.getRow(2).height = Math.max(
    Number(ws.getRow(2).height) || 0,
    22
  );
}

function applyLoanApplicationSummaryPresentation(workbook) {
  if (!workbook) return;

  const imageId = fs.existsSync(LOGO_PATH)
    ? workbook.addImage({
        filename: LOGO_PATH,
        extension: 'jpeg'
      })
    : null;

  workbook.worksheets.forEach((ws) => {
    normalizeTopHeaderRow(ws);

    const tabColor =
      SHEET_TAB_COLORS[ws.name];

    if (tabColor) {
      ws.properties = {
        ...(ws.properties || {}),
        tabColor: {
          argb: `FF${tabColor}`
        }
      };
    }

    if (
      imageId !== null
      && (
        !ws.getImages
        || ws.getImages().length === 0
      )
    ) {
      ws.addImage(imageId, {
        tl: {
          col: 0.04,
          row: 0.04
        },
        ext: {
          width: 132,
          height: 46
        },
        editAs: 'oneCell'
      });
    }

    /*
     * Only rows 1 and 2 are frozen.
     * No column is frozen.
     */
    ws.views = [
      {
        state: 'frozen',
        xSplit: 0,
        ySplit: 2,
        topLeftCell: 'A3',
        activeCell: 'A3',
        showGridLines: false
      }
    ];

    ws.pageSetup = {
      ...(ws.pageSetup || {}),
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation:
        ws.name === 'Summary'
          ? 'portrait'
          : 'landscape',
      horizontalCentered: false,
      verticalCentered: false,
      printTitlesRow: '1:2',
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.45,
        bottom: 0.45,
        header: 0.15,
        footer: 0.2
      }
    };

    ws.headerFooter = {
      ...(ws.headerFooter || {}),
      oddHeader: '',
      evenHeader: '',
      firstHeader: '',
      oddFooter:
        '&L&"Arial"&9Loan Application Summary'
        + '&C&"Arial"&9Page &P of &N'
        + '&R&"Arial"&9Generated by Cred2Tech'
    };
  });
}



// ─────────────────────────────────────────────────────────────────────────────
// Sheet fillers
// ─────────────────────────────────────────────────────────────────────────────

function applySummarySheetFormatting(ws) {
  // ── Column widths (mirror the template exactly) ───────────────────────────
  ws.getColumn('A').width = 22;
  ws.getColumn('B').width = 28;
  ws.getColumn('C').width = 24;
  ws.getColumn('D').width = 23;
  ws.getColumn('E').width = 22;
  ws.getColumn('F').width = 24;
  ws.getColumn('G').width = 42;

  // ── Row 1: Banner title ───────────────────────────────────────────────────
  ws.getRow(1).height = 34;
  const bannerCell = ws.getCell('A1');
  bannerCell.font      = { bold: true, size: 14, color: { argb: BRAND.BANNER_FG }, name: 'Arial' };
  bannerCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.BANNER_BG } };
  bannerCell.alignment = { horizontal: 'left', vertical: 'middle' };
  applyBorder(bannerCell);
  // Shade the full banner row
  ['B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
    const c = ws.getCell(`${col}1`);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.BANNER_BG } };
    applyBorder(c);
  });

  // ── Rows 2–4: Meta header block ───────────────────────────────────────────
  [2, 3, 4].forEach(r => {
    ws.getRow(r).height = 24;
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
      const c = ws.getCell(`${col}${r}`);
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.META_BG } };
      applyBorder(c, 'hair');
      // Label cells (A-column and C-column are labels in the meta block)
      if (col === 'A' || col === 'C') {
        c.font = { bold: true, size: 9, name: 'Arial' };
      } else {
        c.font = { size: 9, name: 'Arial' };
      }
      c.alignment = { vertical: 'middle', wrapText: false };
    });
  });

  // ── Section divider rows ──────────────────────────────────────────────────
  const SECTION_ROWS = [6, 13, 19, 23, 43, 50, 57, 62];
  SECTION_ROWS.forEach(r => {
    ws.getRow(r).height = 23;
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
      styleSectionHeader(ws.getCell(`${col}${r}`));
    });
  });

  // ── Column-header rows ────────────────────────────────────────────────────
  const HEADER_ROWS = [7, 14, 24, 44, 51, 58, 63];
  HEADER_ROWS.forEach(r => {
    ws.getRow(r).height = 26;
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
      styleColumnHeader(ws.getCell(`${col}${r}`));
    });
  });

  // ── Applicant data rows (8-11): taller for multi-line contact ─────────────
  [8, 9, 10, 11].forEach(r => {
    ws.getRow(r).height = 42;
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((col, idx) => {
      const c = ws.getCell(`${col}${r}`);
      styleDataCell(c, { wrap: true, altRow: r % 2 === 0 });
      if (col === 'A') styleLabelCell(c, r % 2 === 0);
    });
  });

  // ── Standard data rows ────────────────────────────────────────────────────
  const DATA_ROWS = [
    15, 16, 17, 18,          // Loan requirement
    20, 21,                   // Bureau
    25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, // Financials
    42,                       // Eligibility
    45, 46, 47, 48, 49,       // KYC docs
    52, 53, 54, 55, 56,       // Property docs
    59, 60, 61,               // References
    64, 65, 66                // Contacts (if present)
  ];
  DATA_ROWS.forEach(r => {
    ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(col => {
      styleDataCell(ws.getCell(`${col}${r}`), { altRow: r % 2 === 0 });
    });
  });

  // ── Freeze pane + print settings ─────────────────────────────────────────
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

function clearLoanApplicationSummaryDynamicCells(summarySheet) {
  if (!summarySheet) return;
  for (let row = 2; row <= 60; row += 1) {
    for (let col = 1; col <= 7; col += 1) {
      const cell = summarySheet.getCell(row, col);
      if (cell.value && typeof cell.value === 'object' && cell.value.formula) continue;
      cell.value = '';
      cell.note = undefined;
    }
  }
}

function clearCellValues(ws, addresses) {
  if (!ws) return;
  addresses.forEach((address) => {
    const cell = ws.getCell(address);
    cell.value = '';
    cell.note = undefined;
  });
}

function clearRangeValues(ws, startRow, endRow, columns) {
  if (!ws) return;
  for (let row = startRow; row <= endRow; row += 1) {
    columns.forEach(column => clearCellValues(ws, [`${column}${row}`]));
  }
}

/**
 * Clears the example customer from the checked-in sample workbook without
 * changing its labels, styles, merged cells, dimensions or worksheet views.
 */
function resetTemplateSampleData(workbook) {
  const summary = workbook.getWorksheet('Summary');
  clearCellValues(summary, [
    'B2', 'D2', 'B3', 'D3', 'B4', 'D4', 'G4',
    'B8', 'D8', 'E8', 'F8', 'G8',
    'B9', 'C9', 'D9', 'E9', 'F9', 'G9',
    'B10', 'C10', 'D10', 'E10', 'F10', 'G10',
    'B11', 'C11', 'D11', 'E11', 'F11', 'G11',
    'B15', 'D15', 'F15', 'B17', 'D17', 'B18', 'D18',
    'B20', 'C20', 'D20', 'B21', 'C21', 'D21',
    'B45', 'C45', 'E45', 'F45', 'B46', 'C46', 'E46', 'F46',
    'B47', 'C47', 'E47', 'F47', 'B48', 'C48', 'E48', 'F48',
    'B52', 'C52', 'E52', 'F52', 'B53', 'C53', 'E53', 'F53',
    'B54', 'C54', 'E54', 'F54', 'B55', 'C55', 'E55', 'F55',
    'B59', 'C59', 'D59', 'E59', 'B60', 'C60', 'D60', 'E60'
  ]);
  clearRangeValues(summary, 26, 40, ['B', 'C', 'D', 'E', 'F']);

  const bank = workbook.getWorksheet('Bank Statement Analysis.');
  clearRangeValues(bank, 2, 12, ['B']);
  clearRangeValues(bank, 16, 16, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
  clearRangeValues(bank, 17, 66, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']);

  const itr = workbook.getWorksheet('ITR Analysis');
  clearRangeValues(itr, 2, 34, ['F', 'G', 'H']);
  clearRangeValues(itr, 37, 76, ['G', 'H']);
  clearRangeValues(itr, 80, 218, ['C', 'D', 'E']);

  const gst = workbook.getWorksheet('GST Analysis');
  clearRangeValues(gst, 3, 20, ['B']);
  clearRangeValues(gst, 24, 24, ['C', 'D']);
  clearRangeValues(gst, 25, 29, ['B', 'C', 'D']);
  clearRangeValues(gst, 35, 47, ['A', 'B', 'C']);
  clearRangeValues(gst, 51, 63, ['A', 'B', 'C']);
  clearRangeValues(gst, 68, 84, ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N']);
}

function addSourceNote(cell, sourceTrace, field) {
  const item = sourceTrace?.[field];
  if (!cell || !item) return;
  cell.note = `Source: ${item.selectedSourceTable || 'N/A'} #${item.sourceRecordId ?? 'N/A'}\nApplicant: ${item.applicantId ?? 'N/A'}\nPath: ${item.jsonPath || 'N/A'}\nTimestamp: ${item.sourceTimestamp || 'N/A'}${item.fallbackReason ? `\nFallback: ${item.fallbackReason}` : ''}`;
}

function canonicalDocumentStatus(reportData, types = [], applicantId = null, keywords = []) {
  const normalizedTypes = new Set(types.map(type => String(type).toUpperCase()));
  const normalizedKeywords = keywords.map(keyword => String(keyword).toLowerCase());
  const records = reportData?.documents?.records || [];
  const matched = records.some((record) => {
    if (applicantId && record.applicant_id && Number(record.applicant_id) !== Number(applicantId)) return false;
    const type = String(record.document_type || '').toUpperCase();
    const searchable = `${record.file_name || ''} ${record.original_name || ''} ${record.document_name || ''}`.toLowerCase();
    return normalizedTypes.has(type) || normalizedKeywords.some(keyword => searchable.includes(keyword));
  });
  return matched ? 'Uploaded' : 'Pending';
}


function findTemplateRowByLabel(
  ws,
  labels,
  {
    columns = [1],
    startRow = 1,
    endRow = null
  } = {}
) {
  if (!ws) return null;

  const wanted = Array.isArray(labels)
    ? labels
    : [labels];

  const finalRow = Math.min(
    endRow || ws.rowCount || 1,
    ws.rowCount || 1
  );

  for (let row = startRow; row <= finalRow; row += 1) {
    for (const column of columns) {
      const value = rawCellValue(
        ws.getCell(row, column)
      );

      const matched = wanted.some((label) =>
        labelsMatch(value, label)
      );

      if (matched) {
        return row;
      }
    }
  }

  return null;
}

function setTextByLabel(
  ws,
  labels,
  value,
  column,
  options = {}
) {
  const row = findTemplateRowByLabel(
    ws,
    labels,
    options
  );

  if (!row) return false;

  setCell(
    ws,
    ws.getCell(row, column).address,
    value
  );

  return true;
}

function setFinancialByLabel(
  ws,
  labels,
  value,
  column,
  options = {}
) {
  const row = findTemplateRowByLabel(
    ws,
    labels,
    options
  );

  if (!row) return false;

  setStyledFinancialCell(
    ws,
    ws.getCell(row, column).address,
    value
  );

  return true;
}

function assignFallback(target, key, value) {
  if (
    !target ||
    !isBlank(target[key]) ||
    isBlank(value)
  ) {
    return false;
  }

  target[key] = value;

  return true;
}

function mergeFallbackSourcesIntoCanonicalReportData(reportData, mappedSources = {}) {
  if (!reportData?.financials) return reportData;

  const bank = reportData.financials.banking || (reportData.financials.banking = {});
  bank.latest ||= {};
  bank.previous ||= {};
  bank.older ||= {};
  bank.rolling12Months ||= {};
  bank.monthly ||= {};
  const bankFallback = mappedSources.bank || {};
  const bankAccount = bankFallback.accountDetails || {};
  let bankUsed = false;

  [
    ['accountHolderName', bankAccount.accountHolder],
    ['accountNumber', bankAccount.accountNumber],
    ['bankName', bankAccount.bankName],
    ['accountType', bankAccount.accountType],
    ['email', bankAccount.email],
    ['phone', bankAccount.phone],
    ['statementFrom', bankAccount.statementFrom],
    ['statementTo', bankAccount.statementTo],
    ['transactionStartDate', bankAccount.transactionStartDate],
    ['transactionEndDate', bankAccount.transactionEndDate]
  ].forEach(([key, value]) => { bankUsed = assignFallback(bank, key, value) || bankUsed; });

  bankUsed = assignFallback(bank.latest, 'averageBalance', bankFallback.monthlyAverageBalance) || bankUsed;
  bankUsed = assignFallback(bank.latest, 'totalCredits', bankFallback.creditTxnTotal) || bankUsed;
  bankUsed = assignFallback(bank.rolling12Months, 'totalCredits', bankFallback.creditTxnTotal) || bankUsed;
  bankUsed = assignFallback(bank.rolling12Months, 'averageMonthlyCredits', bankFallback.creditTxnTotal ? bankFallback.creditTxnTotal / 12 : null) || bankUsed;
  [
    ['bankCharges', bankFallback.bankCharges],
    ['cashDeposit', bankFallback.cashDeposit],
    ['cashWithdrawal', bankFallback.cashWithdrawal],
    ['emiLoanPayments', bankFallback.emiLoanPayments],
    ['inwardChequeBounces', bankFallback.chequeBounces?.inward],
    ['outwardChequeBounces', bankFallback.chequeBounces?.outward]
  ].forEach(([key, value]) => { bankUsed = assignFallback(bank, key, value) || bankUsed; });

  Object.entries(bankFallback.monthly || {}).forEach(([key, entries]) => {
    if ((!Array.isArray(bank.monthly[key]) || !bank.monthly[key].length) && Array.isArray(entries) && entries.length) {
      bank.monthly[key] = entries;
      bankUsed = true;
    }
  });
  if (bankUsed && bank.sourceKind === 'NONE') bank.sourceKind = 'EXCEL';

  const itr = reportData.financials.itr || (reportData.financials.itr = {});
  itr.latest ||= {};
  itr.previous ||= {};
  itr.older ||= {};
  const itrFallback = mappedSources.itr || {};
  const itrGeneral = itrFallback.generalInformation || {};
  const itrPnl = itrFallback.profitAndLoss || {};
  const itrTax = itrFallback.taxCalculation || {};
  let itrUsed = false;

  [
    ['year', itrPnl.latestYear || itrGeneral.latestYear],
    ['taxpayerName', itrGeneral.applicantName],
    ['pan', itrGeneral.pan],
    ['profitAfterTax', itrPnl.netProfitAfterTax],
    ['depreciation', itrPnl.depreciation],
    ['financeCost', itrPnl.interestOnLoan],
    ['grossReceipts', itrPnl.revenueFromOperations],
    ['agriculturalIncome', itrTax.agriculturalIncome],
    ['salaryIncome', itrTax.salaryIncome],
    ['grossTotalIncome', itrTax.grossTotalIncome],
    ['totalTaxableIncome', itrTax.totalTaxableIncome]
  ].forEach(([key, value]) => { itrUsed = assignFallback(itr.latest, key, value) || itrUsed; });

  [
    ['year', itrPnl.previousYear || itrGeneral.previousYear],
    ['taxpayerName', itrGeneral.previousApplicantName || itrGeneral.applicantName],
    ['pan', itrGeneral.previousPan || itrGeneral.pan],
    ['profitAfterTax', itrPnl.previousNetProfitAfterTax],
    ['depreciation', itrPnl.previousDepreciation],
    ['financeCost', itrPnl.previousInterestOnLoan],
    ['grossReceipts', itrPnl.previousRevenueFromOperations],
    ['agriculturalIncome', itrTax.previousAgriculturalIncome],
    ['salaryIncome', itrTax.previousSalaryIncome],
    ['grossTotalIncome', itrTax.previousGrossTotalIncome],
    ['totalTaxableIncome', itrTax.previousTotalTaxableIncome]
  ].forEach(([key, value]) => { itrUsed = assignFallback(itr.previous, key, value) || itrUsed; });

  [
    ['email', itrGeneral.email],
    ['mobile', itrGeneral.mobile],
    ['dob', itrGeneral.dob],
    ['registeredAddress', itrGeneral.address]
  ].forEach(([key, value]) => { itrUsed = assignFallback(itr, key, value) || itrUsed; });
  if (itrUsed && itr.sourceKind === 'NONE') itr.sourceKind = 'EXCEL';

  const gst = reportData.financials.gst || (reportData.financials.gst = {});
  gst.latest ||= {};
  gst.previous ||= {};
  gst.older ||= {};
  gst.rolling12Months ||= {};
  gst.monthlySales ||= [];
  gst.monthlyPurchases ||= [];
  const gstFallback = mappedSources.gst || {};
  const gstProfile = gstFallback.companyProfile || {};
  let gstUsed = false;

  [
    ['gstin', gstProfile.gstin],
    ['legalName', gstProfile.legalName],
    ['tradeName', gstProfile.tradeName],
    ['registrationStatus', gstProfile.gstStatus],
    ['registrationDate', gstProfile.dateOfRegistration],
    ['taxpayerType', gstProfile.taxpayerType],
    ['natureOfBusiness', gstProfile.natureOfBusiness],
    ['businessAddress', gstProfile.principalPlaceOfBusiness],
    ['email', gstProfile.email],
    ['mobile', gstProfile.mobile],
    ['constitution', gstProfile.constitution],
    ['stateJurisdiction', gstProfile.stateJurisdiction],
    ['centreJurisdiction', gstProfile.centreJurisdiction],
    ['stateOfOperations', gstProfile.stateOfOperations],
    ['filingPeriod', gstProfile.reportPeriod]
  ].forEach(([key, value]) => { gstUsed = assignFallback(gst, key, value) || gstUsed; });

  gstUsed = assignFallback(gst.latest, 'year', gstFallback.annualGstrSalesYear) || gstUsed;
  gstUsed = assignFallback(gst.latest, 'turnover', gstFallback.annualGstrSales) || gstUsed;
  gstUsed = assignFallback(gst.previous, 'year', gstFallback.previousAnnualGstrSalesYear) || gstUsed;
  gstUsed = assignFallback(gst.previous, 'turnover', gstFallback.previousAnnualGstrSales) || gstUsed;
  gstUsed = assignFallback(gst.rolling12Months, 'turnover', gstFallback.last12MonthGstrSales) || gstUsed;
  gstUsed = assignFallback(gst.rolling12Months, 'averageMonthlySales', gstFallback.last12MonthGstrSales ? gstFallback.last12MonthGstrSales / 12 : null) || gstUsed;

  if (!gst.monthlySales.length && Array.isArray(gstFallback.monthlySales) && gstFallback.monthlySales.length) {
    gst.monthlySales = gstFallback.monthlySales;
    gstUsed = true;
  }
  if (!gst.monthlyPurchases.length && Array.isArray(gstFallback.monthlyPurchases) && gstFallback.monthlyPurchases.length) {
    gst.monthlyPurchases = gstFallback.monthlyPurchases;
    gstUsed = true;
  }
  if (gstUsed && gst.sourceKind === 'NONE') gst.sourceKind = 'EXCEL';

  return reportData;
}

function applyCanonicalSummaryData(workbook, reportData) {
  const ws = workbook.getWorksheet('Summary');
  if (!ws || !reportData) return;
  const itr = reportData.financials.itr;
  const gst = reportData.financials.gst;
  const bank = reportData.financials.banking;
  const primary = reportData.primaryApplicant || {};
  const coApps = reportData.coApplicants || [];
  const best = reportData.eligibility.best;

  setCell(ws, 'B2', reportData.case.reference);
  setCell(ws, 'D2', formatLakhs(reportData.case.requestedAmount));
  setCell(ws, 'B3', reportData.case.customerName);
  setCell(ws, 'D3', reportData.case.productType);
  setCell(ws, 'D4', formatDate(new Date()));
  setCell(ws, 'B4', [reportData.case.dsaName, reportData.case.dsaCode].filter(Boolean).join(' · '));

  setCell(ws, 'B8', reportData.business.name || primary.name);
  setCell(ws, 'D8', reportData.business.pan || primary.pan_number);
  setCell(ws, 'E8', reportData.business.gstin);
  setCell(ws, 'F8', contactText({ mobile: reportData.business.mobile, email: reportData.business.email }));
  setCell(ws, 'G8', reportData.business.address);
  setCell(ws, 'B9', primary.name);
  setCell(ws, 'C9', primary.employment_type);
  setCell(ws, 'D9', primary.pan_number || reportData.business.pan);
  setCell(ws, 'F9', contactText({ mobile: primary.mobile, email: primary.email }));

  [10, 11].forEach((row, index) => {
    const applicant = coApps[index];
    if (!applicant) {
      for (let col = 2; col <= 7; col += 1) ws.getCell(row, col).value = '';
      return;
    }
    setCell(ws, `A${row}`, `Co-Applicant ${index + 1}`);
    setCell(ws, `B${row}`, applicant.name || applicant.applicant_label);
    setCell(ws, `C${row}`, applicant.relationship_to_primary || applicant.employment_type || applicant.type);
    setCell(ws, `D${row}`, applicant.pan_number);
    setCell(ws, `F${row}`, contactText({ mobile: applicant.mobile, email: applicant.email }));
  });

  setCell(ws, 'B15', formatLakhs(reportData.case.requestedAmount));
  setCell(ws, 'D15', reportData.case.requestedTenureMonths === null ? '' : `${Math.ceil(reportData.case.requestedTenureMonths / 12)} Years`);
  setCell(ws, 'F15', reportData.property.ownership);
  setCell(ws, 'B17', reportData.property.type);
  setCell(ws, 'D17', reportData.property.occupancy);
  setCell(ws, 'B18', formatInr(reportData.property.marketValue));
  setCell(ws, 'D18', reportData.property.address);

  setCell(ws, 'B20', primary.name);
  setCell(ws, 'C20', coApps[0]?.name || coApps[0]?.applicant_label);
  setCell(ws, 'D20', coApps[1]?.name || coApps[1]?.applicant_label);
  setCell(ws, 'B21', firstNonBlank(primary.cibil_score, reportData.bureau.primary?.score));
  setCell(ws, 'C21', firstNonBlank(coApps[0]?.cibil_score, reportData.bureau.coApplicants[0]?.record?.score));
  setCell(ws, 'D21', firstNonBlank(coApps[1]?.cibil_score, reportData.bureau.coApplicants[1]?.record?.score));

  setCell(ws, 'B24', itr.latest.year || gst.latest.year || 'Current Year (X)');
  setCell(ws, 'C24', itr.previous.year || gst.previous.year || 'X-1');
  setCell(ws, 'D24', itr.older.year || gst.older.year || 'X-2');
  const values = {
    26: [itr.latest.profitAfterTax, itr.previous.profitAfterTax, itr.older.profitAfterTax, null, null],
    27: [itr.latest.depreciation, itr.previous.depreciation, itr.older.depreciation, null, null],
    28: [itr.latest.financeCost, itr.previous.financeCost, itr.older.financeCost, null, null],
    29: [itr.latest.remuneration, itr.previous.remuneration, itr.older.remuneration, null, null],
    30: [gst.latest.turnover, gst.previous.turnover, gst.older.turnover, gst.rolling12Months.turnover, gst.rolling12Months.averageMonthlySales],
    31: [null, null, null, gst.rolling12Months.turnover, gst.rolling12Months.averageMonthlySales],
    32: [itr.latest.grossReceipts, itr.previous.grossReceipts, itr.older.grossReceipts, null, null],
    33: [bank.latest.totalCredits, bank.previous.totalCredits, bank.older.totalCredits, bank.rolling12Months.totalCredits, bank.rolling12Months.averageMonthlyCredits],
    34: [bank.latest.averageBalance, bank.previous.averageBalance, bank.older.averageBalance, null, bank.latest.averageBalance],
    35: [null, null, null, null, reportData.financials.rentalIncome.bankMonthly],
    36: [null, null, null, null, reportData.financials.rentalIncome.cashMonthly],
    37: [itr.latest.agriculturalIncome, itr.previous.agriculturalIncome, itr.older.agriculturalIncome, null, null],
    38: [null, null, null, null, reportData.financials.salary.monthlyNet],
    39: [null, null, null, null, reportData.financials.otherIncome.monthly],
    40: [null, null, null, null, null]
  };
  Object.entries(values).forEach(([row, rowValues]) => {
    ['B', 'C', 'D', 'E', 'F'].forEach((column, index) => setStyledFinancialCell(ws, `${column}${row}`, rowValues[index]));
  });
  addSourceNote(ws.getCell('B26'), reportData.sourceTrace, 'financials.itr.latest.profitAfterTax');
  addSourceNote(ws.getCell('B27'), reportData.sourceTrace, 'financials.itr.latest.depreciation');
  addSourceNote(ws.getCell('B28'), reportData.sourceTrace, 'financials.itr.latest.financeCost');
  addSourceNote(ws.getCell('B30'), reportData.sourceTrace, 'financials.gst.latest.turnover');
  addSourceNote(ws.getCell('E31'), reportData.sourceTrace, 'financials.gst.rolling12Months.turnover');
  addSourceNote(ws.getCell('B33'), reportData.sourceTrace, 'financials.banking.rolling12Months.totalCredits');
  addSourceNote(ws.getCell('B34'), reportData.sourceTrace, 'financials.banking.latest.averageBalance');
  addSourceNote(ws.getCell('F38'), reportData.sourceTrace, 'financials.salary.monthlyNet');
  addSourceNote(ws.getCell('B18'), reportData.sourceTrace, 'property.marketValue');

  const primaryLabel = primary.name || reportData.business.name || 'Applicant';
  setCell(ws, 'B45', `Primary / ${primaryLabel}`);
  setCell(ws, 'C45', canonicalDocumentStatus(reportData, ['PAN_CARD'], primary.id));
  setCell(ws, 'E45', `Primary / ${primaryLabel}`);
  setCell(ws, 'F45', canonicalDocumentStatus(reportData, ['AADHAAR'], primary.id));
  [46, 47].forEach((row, index) => {
    const applicant = coApps[index];
    if (!applicant) return;
    const label = `Co-Borrower ${index + 1} / ${applicant.name || applicant.applicant_label || `Applicant ${index + 2}`}`;
    setCell(ws, `B${row}`, label);
    setCell(ws, `C${row}`, canonicalDocumentStatus(reportData, ['PAN_CARD'], applicant.id));
    setCell(ws, `E${row}`, label);
    setCell(ws, `F${row}`, canonicalDocumentStatus(reportData, ['AADHAAR'], applicant.id));
  });
  setCell(ws, 'B48', 'Borrower business');
  setCell(ws, 'C48', canonicalDocumentStatus(reportData, ['GST_PDF', 'GST_REPORT_PDF', 'GST_REPORT_EXCEL']));
  setCell(ws, 'E48', 'Borrower business');
  setCell(ws, 'F48', canonicalDocumentStatus(reportData, ['OTHER'], null, ['partnership', 'moa', 'memorandum', 'deed']));

  [
    ['B52', 'Collateral property'], ['E52', 'Collateral property'],
    ['B53', 'Collateral property'], ['E53', 'Collateral property'],
    ['B55', 'Collateral property'], ['E55', 'Business premises']
  ].forEach(([address, value]) => setCell(ws, address, value));
  setCell(ws, 'C52', canonicalDocumentStatus(reportData, ['SALE_DEED', 'PROPERTY_DOCUMENT'], null, ['sale deed', 'title deed']));
  setCell(ws, 'F52', canonicalDocumentStatus(reportData, ['PROPERTY_DOCUMENT'], null, ['tax receipt', 'property tax']));
  setCell(ws, 'C53', canonicalDocumentStatus(reportData, ['PROPERTY_DOCUMENT'], null, ['encumbrance']));
  setCell(ws, 'F53', canonicalDocumentStatus(reportData, ['PROPERTY_DOCUMENT'], null, ['building plan', 'approved plan']));
  setCell(ws, 'B54', primaryLabel);
  setCell(ws, 'C54', canonicalDocumentStatus(reportData, ['OTHER'], primary.id, ['photo', 'photograph']));
  setCell(ws, 'E54', coApps[0]?.name || coApps[0]?.applicant_label || 'Co-Applicant');
  setCell(ws, 'F54', canonicalDocumentStatus(reportData, ['OTHER'], coApps[0]?.id, ['photo', 'photograph']));
  setCell(ws, 'C55', canonicalDocumentStatus(reportData, ['PROPERTY_DOCUMENT'], null, ['photo', 'photograph']));
  setCell(ws, 'F55', canonicalDocumentStatus(reportData, ['OTHER'], null, ['business premises', 'premises photo']));

  [46, 47].forEach((row, index) => {
    if (coApps[index]) return;
    ['B', 'C', 'E', 'F'].forEach(col => { ws.getCell(`${col}${row}`).value = ''; });
  });
}

// function applyCanonicalAnalysisData(workbook, reportData) {
//   const bankWs = workbook.getWorksheet('Bank Statement Analysis.');
//   const itrWs = workbook.getWorksheet('ITR Analysis');
//   const gstWs = workbook.getWorksheet('GST Analysis');
//   const bank = reportData.financials.banking;
//   const itr = reportData.financials.itr;
//   const gst = reportData.financials.gst;
//   if (bankWs && bank.sourceKind !== 'NONE') {
//     [
//       ['B2', [bank.bankName, bank.accountNumber].filter(Boolean).join(' - ')],
//       ['B3', bank.accountHolderName],
//       ['B4', bank.accountNumber],
//       ['B5', bank.bankName],
//       ['B9', bank.statementPeriod]
//     ].forEach(([addr, value]) => setCell(bankWs, addr, value));
//     setStyledFinancialCell(bankWs, 'N19', bank.rolling12Months.totalCredits);
//     setStyledFinancialCell(bankWs, 'N27', bank.latest.averageBalance);
//     setStyledFinancialCell(bankWs, 'N43', bank.latest.averageBalance);
//     setStyledFinancialCell(bankWs, 'N39', bank.rolling12Months.totalCredits);
//   }
//   if (itrWs && itr.sourceKind !== 'NONE') {
//     setCell(itrWs, 'H2', itr.latest.year);
//     setCell(itrWs, 'G2', itr.previous.year);
//     setCell(itrWs, 'H6', itr.latest.taxpayerName || reportData.primaryApplicant.name);
//     setCell(itrWs, 'G6', itr.previous.taxpayerName || itr.latest.taxpayerName || reportData.primaryApplicant.name);
//     setCell(itrWs, 'H12', itr.latest.pan || reportData.business.pan);
//     setCell(itrWs, 'G12', itr.previous.pan || itr.latest.pan || reportData.business.pan);
//     setCell(itrWs, 'H14', reportData.business.email || reportData.primaryApplicant.email);
//     setCell(itrWs, 'H15', reportData.business.mobile || reportData.primaryApplicant.mobile);
//     setStyledFinancialCell(itrWs, 'H40', itr.latest.profitAfterTax);
//     setStyledFinancialCell(itrWs, 'G40', itr.previous.profitAfterTax);
//     ['H44', 'H46', 'H50'].forEach(addr => setStyledFinancialCell(itrWs, addr, itr.latest.profitAfterTax));
//     setStyledFinancialCell(itrWs, 'H52', itr.latest.agriculturalIncome);
//     setCell(itrWs, 'C141', itr.latest.year);
//     setCell(itrWs, 'D141', itr.previous.year);
//     setStyledFinancialCell(itrWs, 'C173', itr.latest.profitAfterTax);
//     setStyledFinancialCell(itrWs, 'D173', itr.previous.profitAfterTax);
//   }
//   if (gstWs && gst.sourceKind !== 'NONE') {
//     setCell(gstWs, 'A1', `${gst.legalName || reportData.business.name || 'Borrower'} - GST ANALYTICS REPORT`);
//     setCell(gstWs, 'B3', gst.legalName || reportData.business.name);
//     setCell(gstWs, 'B4', gst.tradeName || reportData.business.name);
//     setCell(gstWs, 'B5', gst.gstin || reportData.business.gstin);
//     setCell(gstWs, 'B6', reportData.business.pan);
//     setCell(gstWs, 'B7', reportData.business.email);
//     setCell(gstWs, 'B8', reportData.business.mobile);
//     setCell(gstWs, 'B11', gst.natureOfBusiness);
//     setCell(gstWs, 'B12', gst.businessAddress);
//     setCell(gstWs, 'B14', gst.registrationStatus);
//     setCell(gstWs, 'C24', gst.latest.year);
//     setCell(gstWs, 'D24', gst.previous.year);
//     setStyledFinancialCell(gstWs, 'B25', gst.latest.turnover);
//     setStyledFinancialCell(gstWs, 'C25', gst.previous.turnover);
//     setStyledFinancialCell(gstWs, 'D25', gst.older.turnover);
//   }
// }



function setMonthlyMetricByLabel(ws, labels, entries = [], total = null, options = {}) {
  const row = findTemplateRowByLabel(ws, labels, options);
  if (!row) return false;
  const normalizedEntries = Array.isArray(entries) ? entries : [];
  const headerRow = row > 1 ? row - 1 : row;
  const byMonth = new Map(normalizedEntries.map(item => [normalizeKey(item.month || item.label), item.value]));
  let sequentialIndex = 0;
  for (let column = 2; column <= 13; column += 1) {
    const header = rawCellValue(ws.getCell(headerRow, column));
    const matched = byMonth.get(normalizeKey(header));
    const fallback = matched === undefined ? normalizedEntries[sequentialIndex]?.value : matched;
    if (matched !== undefined || fallback !== undefined) {
      setStyledFinancialCell(ws, ws.getCell(row, column).address, fallback);
      if (matched === undefined) sequentialIndex += 1;
    }
  }
  if (total !== null && total !== undefined && total !== '') {
    setStyledFinancialCell(ws, ws.getCell(row, 14).address, total);
  }
  return true;
}

function writeMonthlyTaxTable(ws, startRow, endRow, rows = []) {
  const available = Math.max(0, endRow - startRow + 1);
  for (let row = startRow; row <= endRow; row += 1) {
    clearCellValues(ws, [`A${row}`, `B${row}`, `C${row}`]);
  }
  (Array.isArray(rows) ? rows : []).slice(-available).forEach((item, index) => {
    const row = startRow + index;
    setCell(ws, `A${row}`, item.month);
    setStyledFinancialCell(ws, `B${row}`, item.taxableValue);
    setStyledFinancialCell(ws, `C${row}`, item.tax);
  });
}

function setNoDataMarker(ws, address, message) {
  if (!ws || !isBlank(ws.getCell(address).value)) return;
  const cell = ws.getCell(address);
  cell.value = message;
  cell.font = { italic: true, size: 9, color: { argb: BRAND.HEADER_FG }, name: 'Arial' };
  cell.alignment = { wrapText: true, vertical: 'middle' };
}

function applyCanonicalAnalysisData(workbook, reportData) {
  const bankWs = workbook.getWorksheet('Bank Statement Analysis.');
  const itrWs = workbook.getWorksheet('ITR Analysis');
  const gstWs = workbook.getWorksheet('GST Analysis');
  const bank = reportData.financials.banking || {};
  const itr = reportData.financials.itr || {};
  const gst = reportData.financials.gst || {};

  if (bankWs && bank.sourceKind !== 'NONE') {
    const accountDescription = firstNonBlank(
      [bank.bankName, bank.accountNumber, bank.accountType].filter(Boolean).join(' - '),
      bank.description
    );
    const bankFields = [
      ['Description', accountDescription],
      [['Account Holders', 'Account Holder'], bank.accountHolderName],
      ['Account Number', bank.accountNumber],
      ['Bank Name', bank.bankName],
      ['Account Type', bank.accountType],
      ['Email', bank.email],
      [['Phone Number', 'Phone'], bank.phone],
      ['Statement From', bank.statementFrom || bank.statementPeriod],
      ['Statement To', bank.statementTo],
      [['Txn Start Date', 'Transaction Start Date'], bank.transactionStartDate || bank.statementFrom],
      [['Txn End Date', 'Transaction End Date'], bank.transactionEndDate || bank.statementTo]
    ];
    bankFields.forEach(([labels, value]) => setTextByLabel(bankWs, labels, value, 2, { startRow: 2, endRow: 12 }));

    setMonthlyMetricByLabel(bankWs, ['Credit Txns(₹)', 'Credit Txns'], bank.monthly?.creditTransactions || bank.monthly?.credits, bank.rolling12Months?.totalCredits, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['Monthly Average Balance', 'Average EOD Balance'], bank.monthly?.averageBalance, bank.latest?.averageBalance, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['Bank Charges', 'Minimum Balance Charges'], bank.monthly?.bankCharges, bank.bankCharges, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['Cash Deposit(₹)', 'Cash Deposit'], bank.monthly?.cashDeposit, bank.cashDeposit, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['Cash Withdrawal(₹)', 'Cash Withdrawal'], bank.monthly?.cashWithdrawal, bank.cashWithdrawal, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['I/W Cheque Bounces', 'Inward Cheque Bounces'], bank.monthly?.inwardBounces, bank.inwardChequeBounces, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['O/W Cheque Bounces', 'Outward Cheque Bounces'], bank.monthly?.outwardBounces, bank.outwardChequeBounces, { startRow: 16 });
    setMonthlyMetricByLabel(bankWs, ['EMI/ Loan Payments', 'EMI / Loan Payments', 'EMI Loan Payments'], bank.monthly?.emiLoanPayments, firstNonBlank(bank.emiLoanPayments, bank.emiObligations), { startRow: 16 });

    // Never reuse aggregate values for unrelated rows.
    ['N27', 'N39', 'N43'].forEach(address => {
      const row = bankWs.getCell(address).row;
      const label = rawCellValue(bankWs.getCell(row, 1));
      const allowed = labelsMatch(label, 'Max Balance') || labelsMatch(label, 'Net Debit') || labelsMatch(label, 'Min EOD Balance');
      if (allowed && isBlank(bankWs.getCell(address).value)) bankWs.getCell(address).value = '';
    });
  } else if (bankWs) {
    setNoDataMarker(bankWs, 'B2', 'No Bank Statement source data is available for this case.');
  }

  if (itrWs && itr.sourceKind !== 'NONE') {
    setCell(itrWs, 'F2', itr.previous?.year);
    setCell(itrWs, 'H2', itr.latest?.year);

    const primaryName = reportData.primaryApplicant?.name || reportData.case?.customerName;
    [
      ['Name', itr.previous?.taxpayerName || itr.latest?.taxpayerName || primaryName, 6],
      ['Name', itr.latest?.taxpayerName || primaryName, 8],
      ['PAN', itr.previous?.pan || itr.latest?.pan || reportData.business?.pan, 6],
      ['PAN', itr.latest?.pan || reportData.business?.pan, 8],
      [['Date of Birth', 'DOB'], itr.dob || reportData.primaryApplicant?.date_of_birth, 8],
      [['Registered Address', 'Address'], itr.registeredAddress || reportData.business?.address, 8],
      [['Email Id', 'Email'], itr.email || reportData.business?.email || reportData.primaryApplicant?.email, 8],
      [['Contact Number', 'Mobile Number'], itr.mobile || reportData.business?.mobile || reportData.primaryApplicant?.mobile, 8]
    ].forEach(([labels, value, column]) => setTextByLabel(itrWs, labels, value, column, { startRow: 2, endRow: 34 }));

    [
      ['Income from Salary', 'salaryIncome'],
      ['Gross Total Income', 'grossTotalIncome'],
      ['Total Taxable Income', 'totalTaxableIncome'],
      ['Net Agricultural Income', 'agriculturalIncome']
    ].forEach(([label, key]) => {
      setFinancialByLabel(itrWs, label, itr.previous?.[key], 7, { startRow: 36, endRow: 76 });
      setFinancialByLabel(itrWs, label, itr.latest?.[key], 8, { startRow: 36, endRow: 76 });
    });

    setCell(itrWs, 'C141', itr.previous?.year);
    setCell(itrWs, 'D141', itr.latest?.year);
    [
      ['Revenue from Operations', 'grossReceipts'],
      ['Depreciation and Amortization', 'depreciation'],
      ['Finance Cost', 'financeCost'],
      ['Profit after Tax', 'profitAfterTax']
    ].forEach(([label, key]) => {
      setFinancialByLabel(itrWs, label, itr.previous?.[key], 3, { columns: [2], startRow: 140, endRow: 174 });
      setFinancialByLabel(itrWs, label, itr.latest?.[key], 4, { columns: [2], startRow: 140, endRow: 174 });
    });
  } else if (itrWs) {
    setNoDataMarker(itrWs, 'H2', 'No ITR source data is available for this case.');
  }

  if (gstWs && gst.sourceKind !== 'NONE') {
    const profileValues = {
      'Legal Name': gst.legalName || reportData.business?.name,
      'Trade Name': gst.tradeName || reportData.business?.name,
      'GSTIN/UIN': gst.gstin || reportData.business?.gstin,
      PAN: reportData.business?.pan,
      Email: gst.email || reportData.business?.email,
      'Mobile Number': gst.mobile || reportData.business?.mobile,
      'Constitution of Business': gst.constitution,
      'Nature of Business Activity': gst.natureOfBusiness,
      'Principal Place of Business': gst.businessAddress,
      'Taxpayer Type': gst.taxpayerType,
      'GSTIN/UIN Status': gst.registrationStatus,
      'Date of Registration': gst.registrationDate,
      'State Jurisdiction': gst.stateJurisdiction,
      'Centre Jurisdiction': gst.centreJurisdiction,
      'State of Operations': gst.stateOfOperations,
      'Report Period': gst.filingPeriod || gst.rolling12Months?.endPeriod,
      'Report Date': formatDate(new Date())
    };
    Object.entries(profileValues).forEach(([label, value]) => setTextByLabel(gstWs, label, value, 2, { startRow: 2, endRow: 20 }));

    setCell(gstWs, 'C24', gst.previous?.year);
    setCell(gstWs, 'D24', gst.latest?.year);
    setFinancialByLabel(gstWs, 'GSTR 1 Gross Sales', gst.rolling12Months?.turnover, 2, { startRow: 23, endRow: 29 });
    setFinancialByLabel(gstWs, 'GSTR 1 Gross Sales', gst.previous?.turnover, 3, { startRow: 23, endRow: 29 });
    setFinancialByLabel(gstWs, 'GSTR 1 Gross Sales', gst.latest?.turnover, 4, { startRow: 23, endRow: 29 });

    writeMonthlyTaxTable(gstWs, 35, 46, gst.monthlySales);
    writeMonthlyTaxTable(gstWs, 51, 62, gst.monthlyPurchases);
    if (gst.monthlySales?.length) {
      setCell(gstWs, 'A47', 'Total');
      setStyledFinancialCell(gstWs, 'B47', gst.monthlySales.reduce((sum, row) => sum + (toNumber(row.taxableValue) || 0), 0));
      setStyledFinancialCell(gstWs, 'C47', gst.monthlySales.reduce((sum, row) => sum + (toNumber(row.tax) || 0), 0));
    }
    if (gst.monthlyPurchases?.length) {
      setCell(gstWs, 'A63', 'Total');
      setStyledFinancialCell(gstWs, 'B63', gst.monthlyPurchases.reduce((sum, row) => sum + (toNumber(row.taxableValue) || 0), 0));
      setStyledFinancialCell(gstWs, 'C63', gst.monthlyPurchases.reduce((sum, row) => sum + (toNumber(row.tax) || 0), 0));
    }
  } else if (gstWs) {
    setNoDataMarker(gstWs, 'B3', 'No GST source data is available for this case.');
  }
}

function validateCanonicalWorkbook(
  workbook,
  reportData,
  {
    requirePresentation = false
  } = {}
) {
  const errors = [];
  const summary = workbook.getWorksheet(
    'Summary'
  );

  const worksheetNames =
    workbook.worksheets.map(
      (ws) => ws.name
    );

  if (
    worksheetNames.length
      !== SHEET_NAMES.length
    || worksheetNames.some(
      (name, index) =>
        name !== SHEET_NAMES[index]
    )
  ) {
    errors.push(
      `Invalid worksheet order: ${worksheetNames.join(', ')}.`
    );
  }

  const dynamicText = [];

  workbook.worksheets.forEach((ws) => {
    ws.eachRow((row) => {
      row.eachCell(
        { includeEmpty: false },
        (cell) => {
          const value =
            cell.value?.result
            ?? cell.value?.text
            ?? cell.value;

          if (typeof value === 'string') {
            dynamicText.push(
              value.toUpperCase()
            );
          }

          if (
            value === undefined
            || value === null
          ) {
            return;
          }

          if (
            typeof value === 'number'
            && !Number.isFinite(value)
          ) {
            errors.push(
              `${ws.name}!${cell.address} contains a non-finite number.`
            );
          }

          if (
            String(value)
              === '[object Object]'
          ) {
            errors.push(
              `${ws.name}!${cell.address} contains an invalid object value.`
            );
          }
        }
      );
    });

    if (requirePresentation) {
      const view = ws.views?.[0] || {};

      if (
        view.state !== 'frozen'
        || Number(view.ySplit) !== 2
        || Number(view.xSplit || 0) !== 0
        || view.topLeftCell !== 'A3'
      ) {
        errors.push(
          `${ws.name} must freeze only rows 1 and 2 with A3 as the first scrollable cell.`
        );
      }

      if (
        ws.pageSetup?.printTitlesRow
          !== '1:2'
      ) {
        errors.push(
          `${ws.name} must repeat rows 1 and 2 while printing.`
        );
      }

      if (
        fs.existsSync(LOGO_PATH)
        && (
          !ws.getImages
          || ws.getImages().length !== 1
        )
      ) {
        errors.push(
          `${ws.name} must contain exactly one Cred2Tech logo.`
        );
      }
    }
  });

  KNOWN_TEMPLATE_SAMPLE_VALUES.forEach(
    (sample) => {
      if (
        dynamicText.some(
          (value) => value.includes(sample)
        )
      ) {
        errors.push(
          `Stale template customer value remains: ${sample}.`
        );
      }
    }
  );

  (reportData?.coApplicants || [])
    .slice(2)
    .forEach((app) => {
      if (app?.id) {
        errors.push(
          'Template supports only two co-applicants; additional applicant requires explicit layout handling.'
        );
      }
    });

  if (
    !reportData?.coApplicants?.[1]
    && summary
  ) {
    const populated = [
      'B11', 'C11', 'D11', 'E11',
      'F11', 'G11', 'B47', 'C47',
      'E47', 'F47'
    ].filter(
      (address) =>
        !isBlank(
          summary.getCell(address).value
        )
    );

    if (populated.length) {
      errors.push(
        `Unused Co-Borrower 2 cells are populated: ${populated.join(', ')}.`
      );
    }
  }

  const requiredTrace = [
    [
      'B26',
      'financials.itr.latest.profitAfterTax',
      reportData?.financials?.itr?.sourceKind
    ],
    [
      'B30',
      'financials.gst.latest.turnover',
      reportData?.financials?.gst?.sourceKind
    ],
    [
      'B34',
      'financials.banking.latest.averageBalance',
      reportData?.financials?.banking?.sourceKind
    ],
    [
      'B18',
      'property.marketValue',
      null
    ]
  ];

  requiredTrace.forEach(
    ([address, field, sourceKind]) => {
      const isExcelFallback =
        sourceKind === 'EXCEL';

      if (
        summary
        && !isBlank(
          summary.getCell(address).value
        )
        && !reportData?.sourceTrace?.[field]
        && !isExcelFallback
      ) {
        errors.push(
          `Missing source trace for ${field}.`
        );
      }
    }
  );

  [
    'B26', 'B27', 'B28',
    'B30', 'B31', 'B32',
    'B33', 'B34', 'F38'
  ].forEach((address) => {
    if (!summary) return;

    const value =
      summary.getCell(address).value;

    if (
      !isBlank(value)
      && typeof value !== 'number'
    ) {
      errors.push(
        `${summary.name}!${address} must contain a numeric value.`
      );
    }
  });

  if (summary && reportData?.case) {
    const summaryText = JSON.stringify(
      summary.getSheetValues()
    );

    if (
      reportData.case.reference
      && !summaryText.includes(
        String(reportData.case.reference)
      )
    ) {
      errors.push(
        'Summary does not contain the current case reference.'
      );
    }

    if (
      reportData.case.customerName
      && !summaryText.includes(
        String(reportData.case.customerName)
      )
    ) {
      errors.push(
        'Summary does not contain the current customer name.'
      );
    }
  }

  if (errors.length) {
    throw new Error(
      `Loan Application Summary canonical validation failed: ${errors.join(' ')}`
    );
  }
}

function fillSummarySheet(workbook, caseRecord, mappedSources = {}) {
  const ws = workbook.getWorksheet('Summary');
  if (!ws) return;
  clearLoanApplicationSummaryDynamicCells(ws);

  const customer = caseRecord.customer || {};
  const primary = getPrimaryApplicant(caseRecord);
  const coApps = getCoApplicants(caseRecord);
  const panProfile = latestPanProfile(customer);
  const applicantDetails = buildApplicantDetails(mappedSources);
  const sourceFinancials = mappedSources.financialSnapshot || {};
  const gstin = firstNonBlank(applicantDetails.gst.gstin, getGstin(caseRecord));
  const property = caseRecord.property || {};
  const financials = caseRecord.esr_financials || {};
  const { latestEsr, best } = findLatestEligibility(caseRecord);

  // Apply full formatting pass first (so it doesn't overwrite values set after)
  applySummarySheetFormatting(ws);

  // ── Row 1: Banner ─────────────────────────────────────────────────────────
  ws.getCell('A1').value = 'LOAN APPLICATION SUMMARY';

  // ── Rows 2–4: Meta ────────────────────────────────────────────────────────
  setCell(ws, 'A2', 'Case Ref');
  setCell(ws, 'B2', `CASE-${caseRecord.id}`);
  setCell(ws, 'C2', 'Required Amount');
  setCell(ws, 'D2', formatLakhs(firstNonBlank(caseRecord.loan_amount, financials.requested_loan_amount)) || 'N/A');
  setCell(ws, 'A3', 'Customer');
  setCell(ws, 'B3', firstNonBlank(caseRecord.customer_name, customer.business_name, primary.name, 'N/A'));
  setCell(ws, 'C3', 'Product');
  setCell(ws, 'D3', firstNonBlank(caseRecord.product_type, financials.product_type, 'N/A'));
  setCell(ws, 'A4', 'DSA / Source');
  setCell(ws, 'B4', [caseRecord.created_by?.name, caseRecord.dsa_code].filter(Boolean).join(' · ') || 'N/A');
  setCell(ws, 'C4', 'Prepared On');
  setCell(ws, 'D4', formatDate(new Date()));
  setCell(ws, 'G4', latestEsr ? `ESR v${latestEsr.version_number || ''}`.trim() : 'ESR Pending');

  // ── Section 1: Applicant header row ───────────────────────────────────────
  setCell(ws, 'A6', '1. APPLICANT / BORROWER DETAILS');
  setCell(ws, 'A7', 'Party');
  setCell(ws, 'B7', 'Name / Entity');
  setCell(ws, 'C7', 'Role / Relationship');
  setCell(ws, 'D7', 'PAN');
  setCell(ws, 'E7', 'GSTIN / DIN');
  setCell(ws, 'F7', 'Contact Details');
  setCell(ws, 'G7', 'Address');

  // ── Applicant rows ────────────────────────────────────────────────────────
  setCell(ws, 'A8', 'Applicant / Business');
  setCell(ws, 'B8', firstNonBlank(applicantDetails.gst.legalName, applicantDetails.gst.tradeName, customer.business_name, caseRecord.customer_name, primary.name, 'N/A'));
  setCell(ws, 'C8', 'Primary Borrower');
  setCell(ws, 'D8', firstNonBlank(applicantDetails.itr.pan, customer.business_pan, primary.pan_number, 'N/A'));
  setCell(ws, 'E8', gstin || 'N/A');
  setCell(ws, 'F8', contactText({ mobile: applicantDetails.itr.mobile || customer.business_mobile || primary.mobile, email: applicantDetails.itr.email || customer.business_email || primary.email }) || 'N/A');
  setCell(ws, 'G8', firstNonBlank(applicantDetails.itr.address, resolveAddress(caseRecord), 'N/A'));

  setCell(ws, 'A9', 'Promoter / Contact Person');
  setCell(ws, 'B9', firstNonBlank(applicantDetails.itr.applicantName, primary.name, customer.business_name, 'N/A'));
  setCell(ws, 'C9', firstNonBlank(primary.employment_type, 'Promoter / Contact Person'));
  setCell(ws, 'D9', firstNonBlank(applicantDetails.itr.pan, primary.pan_number, customer.business_pan, 'N/A'));
  setCell(ws, 'E9', '');
  setCell(ws, 'F9', contactText({ mobile: primary.mobile || customer.business_mobile, email: primary.email || customer.business_email }) || 'N/A');
  setCell(ws, 'G9', firstNonBlank(panProfile?.principal_address, ''));

  ['10', '11'].forEach((row, idx) => {
    const app = coApps[idx];
    setCell(ws, `A${row}`, `Co-Applicant ${idx + 1}`);
    if (!app) {
      ['B', 'C', 'D', 'E', 'F', 'G'].forEach(col => setCell(ws, `${col}${row}`, ''));
      return;
    }
    setCell(ws, `B${row}`, getApplicantLabel(app, idx));
    setCell(ws, `C${row}`, firstNonBlank(app.relationship_to_primary, app.employment_type, app.type));
    setCell(ws, `D${row}`, firstNonBlank(app.pan_number, 'N/A'));
    setCell(ws, `E${row}`, '');
    setCell(ws, `F${row}`, contactText({ mobile: app.mobile, email: app.email }) || 'N/A');
    setCell(ws, `G${row}`, '');
  });

  // ── Section 2: Loan Requirement ───────────────────────────────────────────
  setCell(ws, 'A13', '2. LOAN REQUIREMENT & COLLATERAL');
  setCell(ws, 'A14', 'Parameter');
  setCell(ws, 'B14', 'Details');
  setCell(ws, 'C14', 'Parameter');
  setCell(ws, 'D14', 'Details');
  setCell(ws, 'E14', 'Parameter');
  setCell(ws, 'F14', 'Details');

  setCell(ws, 'A15', 'Loan Amount Required');
  setCell(ws, 'B15', formatLakhs(firstNonBlank(caseRecord.loan_amount, financials.requested_loan_amount), 'N/A'));
  setCell(ws, 'C15', 'Tenure Required');
  setCell(ws, 'D15', financials.requested_tenure_months ? `${financials.requested_tenure_months} Months` : 'N/A');
  setCell(ws, 'E15', 'Ownership');
  setCell(ws, 'F15', firstNonBlank(property.ownership_type, 'N/A'));

  setCell(ws, 'A17', 'Property Type');
  setCell(ws, 'B17', firstNonBlank(property.property_type, financials.property_type, caseRecord.property_type, 'N/A'));
  setCell(ws, 'C17', 'Occupancy');
  setCell(ws, 'D17', firstNonBlank(property.occupancy_status, financials.occupancy_type, caseRecord.occupancy, 'N/A'));
  setCell(ws, 'A18', 'Property Market Value');
  setCell(ws, 'B18', formatInr(resolvePropertyValue(caseRecord), 'N/A'));
  setCell(ws, 'C18', 'Property Address');
  setCell(ws, 'D18', firstNonBlank(property.remarks, caseRecord.location, 'N/A'));

  // ── Bureau section ────────────────────────────────────────────────────────
  setCell(ws, 'A19', 'BUREAU DETAILS');
  setCell(ws, 'A20', 'Bureau Details');
  setCell(ws, 'B20', firstNonBlank(primary.name, customer.business_name, 'Primary Applicant'));
  coApps.slice(0, 2).forEach((app, idx) => setCell(ws, idx === 0 ? 'C20' : 'D20', getApplicantLabel(app, idx)));
  setCell(ws, 'A21', 'CIBIL Score');
  {
    const score = firstNonBlank(primary.cibil_score, latestBureau(primary)?.score, caseRecord.cibil_score, financials.bureau_score, 'N/A');
    const scoreCell = ws.getCell('B21');
    scoreCell.value = sanitizeExcelValue(score, 'N/A');
    // Colour-code CIBIL score: green ≥ 750, orange 650-749, red < 650
    const n = toNumber(score);
    if (n !== null) {
      const fg = n >= 750 ? BRAND.STATUS_UPLOADED_BG : n >= 650 ? BRAND.STATUS_PENDING_BG : 'FFFEF2F2';
      const fc = n >= 750 ? BRAND.STATUS_UPLOADED_FG : n >= 650 ? BRAND.STATUS_PENDING_FG : 'FFB91C1C';
      scoreCell.font = { bold: true, size: 11, color: { argb: fc }, name: 'Arial' };
      scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } };
      scoreCell.alignment = { horizontal: 'center', vertical: 'middle' };
      applyBorder(scoreCell, 'thin');
    }
  }
  if (coApps[0]) setCell(ws, 'C21', firstNonBlank(coApps[0].cibil_score, latestBureau(coApps[0])?.score, 'N/A'));
  if (coApps[1]) setCell(ws, 'D21', firstNonBlank(coApps[1].cibil_score, latestBureau(coApps[1])?.score, 'N/A'));

  // ── Section 3: Financial snapshot ─────────────────────────────────────────
  setCell(ws, 'A23', '3. FINANCIAL & CREDIT SNAPSHOT');
  setCell(ws, 'A24', 'Key Financials / Income Parameters');
  setCell(ws, 'B24', 'Current Year (X)');
  setCell(ws, 'C24', 'X-1');
  setCell(ws, 'D24', 'X-2');
  setCell(ws, 'E24', 'Last 12 Months');
  setCell(ws, 'F24', 'Monthly');

  const rentBankAnnual   = sumIncomeByType(caseRecord, type => type.includes('rental') && type.includes('bank'));
  const rentCashAnnual   = sumIncomeByType(caseRecord, type => type.includes('rental') && type.includes('cash'));
  const agriAnnual       = sumIncomeByType(caseRecord, type => type.includes('agriculture'));
  const salaryAnnual     = sumIncomeByType(caseRecord, type => type === 'salary' || type.includes('director salary') || type.includes('partner'));
  const incentiveAnnual  = sumIncomeByType(caseRecord, type => type.includes('incentive'));
  const bonusAnnual      = sumIncomeByType(caseRecord, type => type.includes('bonus'));

  const financialRows = [
    { row: 26, label: 'Net Profit After Tax',                              colB: sourceFinancials.netProfitAfterTax },
    { row: 27, label: 'Depreciation',                                      colB: sourceFinancials.depreciation },
    { row: 28, label: 'Interest on Loan',                                  colB: sourceFinancials.interestOnLoan },
    { row: 29, label: 'Director Remuneration / Partner Salary',            colB: null },
    { row: 30, label: 'Annual Sales as per GSTR',                          colB: sourceFinancials.annualGstrSales },
    { row: 31, label: 'Last 12 Month Sales as per GSTR',                   colB: sourceFinancials.last12MonthGstrSales },
    { row: 32, label: 'Turnover / Receipt as per ITR/P&L',                 colB: sourceFinancials.turnoverReceiptItr },
    { row: 33, label: 'Annual Business Receipt as per Banking (12 mo)',     colB: sourceFinancials.annualBusinessReceiptBank },
    { row: 34, label: 'Average Bank Balance',                              colB: sourceFinancials.averageBankBalance, colF: sourceFinancials.averageBankBalance },
    { row: 35, label: 'Monthly Rental Income — Bank Credit',               colF: rentBankAnnual ? rentBankAnnual / 12 : null },
    { row: 36, label: 'Monthly Rental Income — Cash Rental',               colF: rentCashAnnual ? rentCashAnnual / 12 : null },
    { row: 37, label: 'Annual Agricultural Income as per ITR',             colB: firstNonBlank(sourceFinancials.agriculturalIncome, agriAnnual || null) },
    { row: 38, label: 'Salary Income — As per Pay Slip',                   colF: sourceFinancials.salaryIncome ? sourceFinancials.salaryIncome / 12 : (salaryAnnual ? salaryAnnual / 12 : null) },
    { row: 39, label: 'Incentive Income — Variable',                       colB: incentiveAnnual || null },
    { row: 40, label: 'Bonus Income — Variable',                           colB: bonusAnnual || null }
  ];

  financialRows.forEach(({ row, label, colB, colF }) => {
    setCell(ws, `A${row}`, label);
    styleLabelCell(ws.getCell(`A${row}`), row % 2 === 0);
    setStyledFinancialCell(ws, `B${row}`, colB !== undefined ? colB : null);
    ['C', 'D', 'E'].forEach(col => {
      const c = ws.getCell(`${col}${row}`);
      c.value = '';
      styleFinancialDataCell(c);
    });
    setStyledFinancialCell(ws, `F${row}`, colF !== undefined ? colF : null);
    styleDataCell(ws.getCell(`G${row}`), { altRow: row % 2 === 0 });
  });

  // ── Eligibility / Sanction row ────────────────────────────────────────────
  setCell(ws, 'A42', 'ELIGIBILITY / SANCTION SUMMARY');
  {
    const eligCells = ['A42', 'B42', 'C42', 'D42', 'E42', 'F42', 'G42'];
    eligCells.forEach(addr => {
      const c = ws.getCell(addr);
      c.font = { bold: true, size: 10, name: 'Arial', color: { argb: BRAND.ELIGIBILITY_FG } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.ELIGIBILITY_BG } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      applyBorder(c, 'thin');
    });
    ws.getRow(42).height = 22;
    ws.getCell('A42').alignment = { horizontal: 'left', vertical: 'middle' };
  }
  setCell(ws, 'B42', best?.lender_name || caseRecord.lender_name || 'N/A');
  setCell(ws, 'C42', best?.best_scheme_name || financials.selected_income_method || 'N/A');
  setCell(ws, 'D42', formatInr(best?.eligible_amount, 'N/A'));
  setCell(ws, 'E42', best?.roi ? `${best.roi}%` : 'N/A');
  setCell(ws, 'F42', best?.tenure_months ? `${best.tenure_months} Months` : 'N/A');
  setCell(ws, 'G42', caseRecord.sanction?.sanctioned_amount ? formatInr(caseRecord.sanction.sanctioned_amount) : 'N/A');

  // ── Section 4: KYC Document Status ────────────────────────────────────────
  setCell(ws, 'A43', 'KYC DOCUMENT STATUS');
  setCell(ws, 'A44', 'Document');
  setCell(ws, 'B44', 'For Whom / Related To');
  setCell(ws, 'C44', 'Status');
  setCell(ws, 'D44', 'Document');
  setCell(ws, 'E44', 'For Whom / Related To');
  setCell(ws, 'F44', 'Status');

  const primaryLabel = firstNonBlank(primary.name, customer.business_name, 'Applicant');
  setCell(ws, 'A45', 'PAN Card');
  setCell(ws, 'B45', `Primary / ${primaryLabel}`);
  setStyledStatusCell(ws, 'C45', documentStatus(caseRecord, ['PAN_CARD'], primary));
  setCell(ws, 'D45', 'Aadhaar');
  setCell(ws, 'E45', `Primary / ${primaryLabel}`);
  setStyledStatusCell(ws, 'F45', documentStatus(caseRecord, ['AADHAAR'], primary));

  coApps.slice(0, 2).forEach((app, idx) => {
    const r = 46 + idx;
    const lbl = `Co-Borrower ${idx + 1} / ${getApplicantLabel(app, idx)}`;
    setCell(ws, `A${r}`, 'PAN Card');
    setCell(ws, `B${r}`, lbl);
    setStyledStatusCell(ws, `C${r}`, documentStatus(caseRecord, ['PAN_CARD'], app));
    setCell(ws, `D${r}`, 'Aadhaar');
    setCell(ws, `E${r}`, lbl);
    setStyledStatusCell(ws, `F${r}`, documentStatus(caseRecord, ['AADHAAR'], app));
  });

  setCell(ws, 'A48', 'GST Registration Certificate');
  setCell(ws, 'B48', 'Borrower business');
  setStyledStatusCell(ws, 'C48', documentStatus(caseRecord, ['GST_PDF', 'GST_REPORT_PDF', 'GST_REPORT_EXCEL']));
  setCell(ws, 'D48', 'Partnership Deed / MOA');
  setCell(ws, 'E48', 'Borrower business');
  setStyledStatusCell(ws, 'F48', documentStatus(caseRecord, ['OTHER'], null, ['partnership', 'moa', 'memorandum', 'deed']));

  // ── Section 5: Property Documents ────────────────────────────────────────
  setCell(ws, 'A50', 'PROPERTY DOCUMENT STATUS');
  setCell(ws, 'A51', 'Document');
  setCell(ws, 'B51', 'For Whom / Related To');
  setCell(ws, 'C51', 'Status');
  setCell(ws, 'D51', 'Document');
  setCell(ws, 'E51', 'For Whom / Related To');
  setCell(ws, 'F51', 'Status');

  setCell(ws, 'A52', 'Sale Deed / Title Deed');
  setCell(ws, 'B52', 'Collateral property');
  setStyledStatusCell(ws, 'C52', documentStatus(caseRecord, ['SALE_DEED', 'PROPERTY_DOCUMENT']));
  setCell(ws, 'D52', 'Property Tax Receipt');
  setCell(ws, 'E52', 'Collateral property');
  setStyledStatusCell(ws, 'F52', documentStatus(caseRecord, ['PROPERTY_DOCUMENT'], null, ['tax receipt', 'property tax']));

  setCell(ws, 'A53', 'Encumbrance Certificate');
  setCell(ws, 'B53', 'Collateral property');
  setStyledStatusCell(ws, 'C53', documentStatus(caseRecord, ['PROPERTY_DOCUMENT'], null, ['encumbrance']));
  setCell(ws, 'D53', 'Approved Building Plan');
  setCell(ws, 'E53', 'Collateral property');
  setStyledStatusCell(ws, 'F53', documentStatus(caseRecord, ['PROPERTY_DOCUMENT'], null, ['building plan', 'approved plan']));

  setCell(ws, 'A54', 'Borrower Photograph');
  setCell(ws, 'B54', firstNonBlank(primary.name, customer.business_name, 'Applicant'));
  setStyledStatusCell(ws, 'C54', documentStatus(caseRecord, ['OTHER'], primary, ['photo', 'photograph']));
  setCell(ws, 'D54', 'Co-Applicant Photograph');
  setCell(ws, 'E54', coApps[0] ? getApplicantLabel(coApps[0], 0) : 'Co-Applicant');
  setStyledStatusCell(ws, 'F54', coApps[0] ? documentStatus(caseRecord, ['OTHER'], coApps[0], ['photo', 'photograph']) : 'Pending');

  setCell(ws, 'A55', 'Property Photographs');
  setCell(ws, 'B55', 'Collateral property');
  setStyledStatusCell(ws, 'C55', documentStatus(caseRecord, ['PROPERTY_DOCUMENT'], null, ['photo', 'photograph']));
  setCell(ws, 'D55', 'Business Premises Photos');
  setCell(ws, 'E55', 'Business premises');
  setStyledStatusCell(ws, 'F55', documentStatus(caseRecord, ['OTHER'], null, ['business premises', 'premises photo']));

  // ── Section 6: References ─────────────────────────────────────────────────
  setCell(ws, 'A57', '5. REFERENCES');
  setCell(ws, 'A58', 'Reference');
  setCell(ws, 'B58', 'Name');
  setCell(ws, 'C58', 'Mobile');
  setCell(ws, 'D58', 'Relationship');
  setCell(ws, 'E58', 'Address');
  for (const row of [59, 60]) {
    for (const col of ['A', 'B', 'C', 'D', 'E']) setCell(ws, `${col}${row}`, '');
  }
  setCell(ws, 'A59', 'Reference 1');
  setCell(ws, 'A60', 'Reference 2');
}

function applyAnalysisSheetHeaderStyle(ws, title) {
  // Row 1 banner
  ws.getRow(1).height = 34;
  const numCols = Math.max(ws.columnCount || 4, 4);
  try { ws.mergeCells(1, 1, 1, numCols); } catch (_) {}
  const banner = ws.getCell('A1');
  banner.value     = title;
  banner.font      = { bold: true, size: 14, color: { argb: BRAND.BANNER_FG }, name: 'Arial' };
  banner.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.BANNER_BG } };
  banner.alignment = { horizontal: 'left', vertical: 'middle' };
  applyBorder(banner);
  for (let c = 2; c <= numCols; c++) {
    const cell = ws.getCell(1, c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.BANNER_BG } };
    applyBorder(cell);
  }
}

function styleKvBlock(ws, startRow, endRow) {
  for (let r = startRow; r <= endRow; r++) {
    ws.getRow(r).height = 21;
    const labelCell = ws.getCell(r, 1);
    const valueCell = ws.getCell(r, 2);
    styleLabelCell(labelCell, r % 2 === 0);
    styleDataCell(valueCell, { altRow: r % 2 === 0 });
  }
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

  applyAnalysisSheetHeaderStyle(ws, 'BANK STATEMENT ANALYSIS');

  // ── Account details KV block ──────────────────────────────────────────────
  const kvRows = [
    ['Bank Accounts', [bankInfo.bankName, bankInfo.accountNumber, bankInfo.accountType].filter(Boolean).join(' - ') || 'N/A'],
    ['Description',  [bankInfo.bankName, bankInfo.accountNumber, bankInfo.accountType].filter(Boolean).join(' - ') || 'N/A'],
    ['Account Holders', bankInfo.accountHolder || 'N/A'],
    ['Account Number',  bankInfo.accountNumber || 'N/A'],
    ['Bank Name',       bankInfo.bankName || 'N/A'],
    ['Account Type',    bankInfo.accountType || 'N/A'],
    ['Email',           bankInfo.email || 'N/A'],
    ['Phone',           bankInfo.phone || 'N/A'],
    ['Statement From',  formatDate(bankInfo.statementFrom) || 'N/A'],
    ['Statement To',    formatDate(bankInfo.statementTo) || 'N/A']
  ];
  kvRows.forEach(([label, value], idx) => {
    const r = 2 + idx;
    setCell(ws, ws.getCell(r, 1).address, label);
    setCell(ws, ws.getCell(r, 2).address, value);
    styleLabelCell(ws.getCell(r, 1), r % 2 === 0);
    styleDataCell(ws.getCell(r, 2), { altRow: r % 2 === 0 });
    ws.getRow(r).height = 21;
  });

  // ── Section header above monthly table ───────────────────────────────────
  const sectionRow = 13;
  ws.getRow(sectionRow).height = 22;
  const secCell = ws.getCell(sectionRow, 1);
  secCell.value = 'Monthly Banking Summary';
  styleSectionHeader(secCell);
  for (let c = 2; c <= Math.max(ws.columnCount, 14); c++) {
    styleSectionHeader(ws.getCell(sectionRow, c));
  }

  // ── Column widths ─────────────────────────────────────────────────────────
  ws.getColumn(1).width = 36;
  for (let c = 2; c <= Math.max(ws.columnCount, 14); c++) {
    ws.getColumn(c).width = 14;
  }

  // ── Totals in the Total column (N) ────────────────────────────────────────
  setStyledFinancialCell(ws, 'N19', financials.bank_total_credits);
  setStyledFinancialCell(ws, 'N27', firstNonBlank(financials.bank_avg_balance, bankInfo.avgBalance));
  setStyledFinancialCell(ws, 'N43', firstNonBlank(financials.bank_avg_balance, bankInfo.avgBalance));
  setStyledFinancialCell(ws, 'N39', financials.bank_total_credits);
  setStyledFinancialCell(ws, 'N40', financials.itr_finance_cost);

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function fillItrSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('ITR Analysis');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'itr')) {
    writeNoDataMessage(ws, 'ITR Analysis data is not available for this case.');
    return;
  }

  const customer   = caseRecord.customer || {};
  const primary    = getPrimaryApplicant(caseRecord);
  const panProfile = latestPanProfile(customer);
  const itr        = getLatest(caseRecord.itr_analytics || []);
  const financials = caseRecord.esr_financials || {};

  applyAnalysisSheetHeaderStyle(ws, 'ITR ANALYSIS');

  // ── Applicant header fields ───────────────────────────────────────────────
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

  // ── Financial values with INR formatting ─────────────────────────────────
  [['H40', financials.itr_pat], ['H43', financials.itr_pat], ['H44', financials.itr_pat],
   ['H46', financials.itr_pat], ['H50', financials.itr_pat]].forEach(([addr, val]) => {
    setStyledFinancialCell(ws, addr, val);
  });
  setStyledFinancialCell(ws, 'H52', sumIncomeByType(caseRecord, type => type.includes('agriculture')) || null);

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function fillGstSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('GST Analysis');
  if (!ws) return;

  if (sourceUnavailable(caseRecord, 'gst')) {
    writeNoDataMessage(ws, 'GST Analysis data is not available for this case.');
    return;
  }

  const customer   = caseRecord.customer || {};
  const gstProfile = latestGstProfile(customer);
  const panProfile = latestPanProfile(customer);
  const gstReq     = getLatest(caseRecord.gst_requests || []);
  const financials = caseRecord.esr_financials || {};
  const gstin      = getGstin(caseRecord);
  const annualSales = toNumber(financials.gst_avg_monthly_sales) ? Number(financials.gst_avg_monthly_sales) * 12 : null;

  // ── Banner ────────────────────────────────────────────────────────────────
  applyAnalysisSheetHeaderStyle(ws, `${firstNonBlank(customer.business_name, caseRecord.customer_name, 'Borrower')} — GST ANALYTICS REPORT`);

  // ── Entity details KV block (rows 2-20) ───────────────────────────────────
  const kvPairs = [
    ['Legal Name',           firstNonBlank(panProfile?.legal_name, gstProfile?.raw_response?.legal_name, customer.business_name)],
    ['Trade Name',           firstNonBlank(panProfile?.trade_name, customer.business_name)],
    ['GSTIN',                gstin],
    ['PAN',                  firstNonBlank(customer.business_pan, panProfile?.pan)],
    ['Email',                customer.business_email],
    ['Mobile',               customer.business_mobile],
    ['Director(s)',          Array.isArray(panProfile?.director_names) ? panProfile.director_names.join(', ') : ''],
    ['Constitution',         firstNonBlank(customer.entity_type, panProfile?.constitution_of_business)],
    ['Industry',             firstNonBlank(customer.industry, financials.gst_industry_type)],
    ['Registered Address',   firstNonBlank(panProfile?.principal_address, '')],
    ['Principal Place',      ''],
    ['Filing Status',        firstNonBlank(gstProfile?.filing_status, gstReq?.status)],
    ['',                     ''], ['', ''], ['', ''],
    ['State',                firstNonBlank(panProfile?.principal_state, '')],
    ['Financial Year(s)',    [financials.financial_year_latest, financials.financial_year_previous].filter(Boolean).join(' / ')],
    ['Report Generated On',  formatDate(new Date())]
  ];
  kvPairs.forEach(([label, value], idx) => {
    const r = 2 + idx;
    const bAddr = ws.getCell(r, 1).address;
    const vAddr = ws.getCell(r, 2).address;
    setCell(ws, bAddr, label);
    setCell(ws, vAddr, sanitizeExcelValue(value, ''));
    if (label) {
      styleLabelCell(ws.getCell(bAddr), r % 2 === 0);
      styleDataCell(ws.getCell(vAddr), { altRow: r % 2 === 0 });
      ws.getRow(r).height = 21;
    }
  });

  // ── GST summary section ───────────────────────────────────────────────────
  const sumSecRow = 21;
  ws.getRow(sumSecRow).height = 22;
  ['A', 'B', 'C', 'D'].forEach(col => styleSectionHeader(ws.getCell(`${col}${sumSecRow}`)));
  setCell(ws, `A${sumSecRow}`, 'GST SUMMARY');

  setCell(ws, 'A22', 'Parameter');
  setCell(ws, 'B22', 'Current Year');
  setCell(ws, 'C22', 'Previous Year');
  setCell(ws, 'D22', 'Industry Avg');
  ['A22', 'B22', 'C22', 'D22'].forEach(addr => styleColumnHeader(ws.getCell(addr)));
  ws.getRow(22).height = 24;

  [
    ['A25', 'Annual GSTR Sales'],
    ['A27', 'Annual GST Income'],
    ['A29', 'Industry Margin']
  ].forEach(([addr, lbl]) => {
    styleLabelCell(ws.getCell(addr));
    setCell(ws, addr, lbl);
  });

  setStyledFinancialCell(ws, 'B25', annualSales);
  setStyledFinancialCell(ws, 'C25', annualSales);
  setStyledFinancialCell(ws, 'D25', annualSales);
  setStyledFinancialCell(ws, 'B27', annualSales && financials.gst_income ? financials.gst_income * 12 : null);
  setCell(ws, 'B29', financials.gst_industry_margin ? `${Number(financials.gst_industry_margin) * 100}%` : '');

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}


function normalizeBureauRaw(value) {
  const seen = new WeakSet();
  function normalize(input, depth = 0) {
    if (depth > 18 || input === null || input === undefined) return input;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        const parsed = normalizeJson(trimmed);
        if (parsed) return normalize(parsed, depth + 1);
      }
      return input;
    }
    if (typeof input !== 'object') return input;
    if (seen.has(input)) return input;
    seen.add(input);
    if (Array.isArray(input)) return input.map(item => normalize(item, depth + 1));
    const output = {};
    Object.entries(input).forEach(([key, child]) => { output[key] = normalize(child, depth + 1); });
    return output;
  }
  return normalize(normalizeJson(value) || (value && typeof value === 'object' ? value : {}));
}

function deepCollectArrays(root, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const result = [];
  const seen = new Set();
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 14 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, child]) => {
      if (wanted.has(normalizeKey(key)) && Array.isArray(child)) result.push(child);
      visit(child, depth + 1);
    });
  }
  visit(root);
  return result;
}

function deepScalar(root, candidateKeys, fallback = '') {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const seen = new Set();
  let result = fallback;
  function visit(value, depth = 0) {
    if (result !== fallback || !value || typeof value !== 'object' || depth > 14 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(normalizeKey(key)) && child !== null && child !== undefined && child !== '' && typeof child !== 'object') {
        result = child;
        return;
      }
      visit(child, depth + 1);
      if (result !== fallback) return;
    }
  }
  visit(root);
  return result;
}

function bureauAccounts(raw) {
  const arrays = deepCollectArrays(raw, [
    'creditAccounts', 'accounts', 'accountDetails', 'tradelines', 'tradeLines',
    'loanAccounts', 'creditFacilities', 'retailAccounts', 'accountList'
  ]);
  return arrays.flat().filter(item => item && typeof item === 'object' && !Array.isArray(item));
}

function bureauEnquiries(raw) {
  const arrays = deepCollectArrays(raw, [
    'enquiries', 'enquiriesDetails', 'enquiryDetails', 'inquiries',
    'inquiryDetails', 'enquiryList', 'inquiryList'
  ]);
  return arrays.flat().filter(item => item && typeof item === 'object' && !Array.isArray(item));
}

function bureauDpdText(account) {
  const value = firstNonBlank(
    deepScalar(account, ['paymentHistory', 'paymentHistoryProfile', 'dpdHistory', 'assetClassification', 'paymentStatus', 'dpd']),
    account.paymentHistory, account.paymentHistoryProfile, account.dpdHistory,
    account.assetClassification, account.paymentStatus, account.dpd
  );
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? Object.values(item).filter(v => !isBlank(v)).join(':') : item).join(' | ');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}:${item}`).join(' | ');
  return value;
}

function mapBureauAccount(account) {
  return {
    lender: firstNonBlank(deepScalar(account, ['subscriberName', 'memberName', 'lenderName', 'institutionName', 'creditorName', 'bankName'])),
    accountType: firstNonBlank(deepScalar(account, ['accountType', 'loanType', 'portfolioType', 'creditFacilityType', 'accountTypeDescription'])),
    ownership: firstNonBlank(deepScalar(account, ['ownershipIndicator', 'ownershipType', 'ownership'])),
    sanctionAmount: firstNonBlank(deepScalar(account, ['sanctionedAmount', 'sanctionAmount', 'highCredit', 'loanAmount', 'creditLimit'])),
    currentBalance: firstNonBlank(deepScalar(account, ['currentBalance', 'outstandingAmount', 'balance', 'amountOutstanding'])),
    overdueAmount: firstNonBlank(deepScalar(account, ['amountOverdue', 'overdueAmount', 'pastDueAmount', 'overdue'])),
    emi: firstNonBlank(deepScalar(account, ['emi', 'emiAmount', 'installmentAmount', 'monthlyPayment', 'monthlyInstallment'])),
    openDate: firstNonBlank(deepScalar(account, ['opened', 'openDate', 'dateOpened', 'disbursedDate', 'dateOfOpening'])),
    closeDate: firstNonBlank(deepScalar(account, ['closedDate', 'closeDate', 'dateClosed'])),
    status: firstNonBlank(deepScalar(account, ['accountStatus', 'status', 'paymentStatus', 'accountStatusDescription'])),
    dpdHistory: bureauDpdText(account)
  };
}

function mapBureauEnquiry(enquiry) {
  return {
    date: firstNonBlank(deepScalar(enquiry, ['enquiryDate', 'inquiryDate', 'date', 'dateOfEnquiry'])),
    member: firstNonBlank(deepScalar(enquiry, ['memberName', 'subscriberName', 'lenderName', 'institutionName'])),
    purpose: firstNonBlank(deepScalar(enquiry, ['enquiryPurpose', 'inquiryPurpose', 'purpose', 'loanType'])),
    amount: firstNonBlank(deepScalar(enquiry, ['enquiryAmount', 'inquiryAmount', 'amount']))
  };
}

function latestBureauForApplicant(caseRecord, applicant) {
  const applicantRows = applicant?.bureau_checks || [];
  const caseRows = (caseRecord?.bureau_checks || []).filter(row =>
    Number(row.applicant_id) === Number(applicant?.id)
    || (!row.applicant_id && (applicant?.is_primary || String(applicant?.type || '').toUpperCase().includes('PRIMARY')))
  );
  const deduped = new Map();
  [...applicantRows, ...caseRows].forEach(row => {
    if (row?.id !== undefined && row?.id !== null) deduped.set(String(row.id), row);
  });
  const rows = [...deduped.values()].sort((a, b) => {
    const success = row => ['SUCCESS', 'COMPLETED', 'COMPLETE', 'SUCCEEDED', 'PROCESSED'].includes(String(row?.status || '').toUpperCase()) ? 1 : 0;
    return success(b) - success(a)
      || (new Date(b?.updated_at || b?.created_at || 0).getTime() - new Date(a?.updated_at || a?.created_at || 0).getTime());
  });
  return rows[0] || null;
}

function addCibilSection(ws, rowNumber, title, columns) {
  const lastColumn = columns.length;
  ws.mergeCells(rowNumber, 1, rowNumber, lastColumn);
  const section = ws.getCell(rowNumber, 1);
  section.value = title;
  styleSectionHeader(section);
  for (let column = 2; column <= lastColumn; column += 1) styleSectionHeader(ws.getCell(rowNumber, column));

  const headerRow = rowNumber + 1;
  columns.forEach((label, index) => {
    const cell = ws.getCell(headerRow, index + 1);
    cell.value = label;
    styleColumnHeader(cell);
  });
  return headerRow + 1;
}

function writeCibilNoDataRow(ws, rowNumber, columnCount) {
  ws.mergeCells(rowNumber, 1, rowNumber, columnCount);
  const cell = ws.getCell(rowNumber, 1);
  cell.value = 'No data available';
  styleDataCell(cell, { wrap: true });
  return rowNumber + 1;
}

function fillCibilSheet(workbook, caseRecord) {
  const ws = workbook.getWorksheet('Cibil - Transunion');
  if (!ws) return;

  clearWorksheet(ws);
  applyAnalysisSheetHeaderStyle(ws, 'CIBIL - TRANSUNION CREDIT REPORT');

  const applicants = caseRecord.applicants || [];
  const primary = getPrimaryApplicant(caseRecord);
  const orderedApplicants = primary?.id
    ? [primary, ...applicants.filter(applicant => Number(applicant.id) !== Number(primary.id))]
    : applicants;
  const caseObligations = caseRecord.obligations || [];
  const mapObligation = obligation => ({
    lender: obligation.lender_name,
    accountType: obligation.loan_type,
    ownership: obligation.ownership_type || '',
    sanctionAmount: obligation.loan_amount,
    currentBalance: obligation.outstanding_amount,
    overdueAmount: obligation.overdue_amount,
    emi: obligation.emi_per_month,
    openDate: obligation.loan_start_date,
    closeDate: obligation.loan_end_date,
    status: obligation.status || 'ACTIVE',
    dpdHistory: obligation.dpd_history || obligation.remarks || ''
  });

  const bureauRows = orderedApplicants.map((applicant, index) => {
    const record = latestBureauForApplicant(caseRecord, applicant);
    const raw = normalizeBureauRaw(firstNonBlank(record?.raw_response, record?.response_payload, record?.provider_response, record?.callback_payload));
    const rawAccounts = bureauAccounts(raw).map(mapBureauAccount);
    const rawEnquiries = bureauEnquiries(raw).map(mapBureauEnquiry);
    const obligationMap = new Map();
    [...(applicant.obligations || []), ...caseObligations.filter(item =>
      !item.applicant_id || Number(item.applicant_id) === Number(applicant.id)
    )].forEach(obligation => {
      const key = String(obligation.id || `${obligation.lender_name}|${obligation.loan_type}|${obligation.outstanding_amount}`);
      obligationMap.set(key, obligation);
    });
    const fallbackAccounts = [...obligationMap.values()].map(mapObligation);
    const accounts = rawAccounts.length ? rawAccounts : fallbackAccounts;
    const fallbackName = index === 0
      ? firstNonBlank(caseRecord.customer_name, caseRecord.customer?.business_name, 'Primary Applicant')
      : `Co-Applicant ${index}`;
    const score = toNumber(firstNonBlank(applicant.cibil_score, record?.score, deepScalar(raw, ['score', 'creditScore', 'bureauScore', 'crScore'])));
    return {
      applicant, record, raw,
      name: getApplicantLabel(applicant, index, fallbackName),
      type: index === 0 ? 'PRIMARY' : firstNonBlank(applicant.type, applicant.applicant_type, 'CO_APPLICANT'),
      pan: firstNonBlank(applicant.pan_number, deepScalar(raw, ['pan', 'panNumber'])),
      mobile: firstNonBlank(applicant.mobile, record?.mobile_number, deepScalar(raw, ['mobileNumber', 'mobile', 'phoneNumber'])),
      score, accounts, enquiries: rawEnquiries
    };
  });

  let row = 2;
  row = addCibilSection(ws, row, '1. DEMOGRAPHIC DETAILS', ['Applicant Name', 'Applicant Type', 'PAN', 'Mobile', 'Bureau Score', 'Report Date', 'Request ID']);
  if (!bureauRows.length) row = writeCibilNoDataRow(ws, row, 7);
  else bureauRows.forEach((entry, index) => {
    [entry.name, entry.type, entry.pan, entry.mobile, entry.score, formatDate(entry.record?.updated_at || entry.record?.created_at), entry.record?.request_id]
      .forEach((value, columnIndex) => {
        const cell = ws.getCell(row, columnIndex + 1);
        cell.value = sanitizeExcelValue(value, '');
        styleDataCell(cell, { altRow: index % 2 === 1, wrap: true });
      });
    row += 1;
  });

  row += 1;
  row = addCibilSection(ws, row, '2. LOAN SUMMARY', ['Applicant', 'Total Accounts', 'Active Accounts', 'Closed Accounts', 'Current Balance', 'Overdue Amount', 'Total EMI Obligation']);
  if (!bureauRows.length) row = writeCibilNoDataRow(ws, row, 7);
  else bureauRows.forEach((entry, index) => {
    const active = entry.accounts.filter(account => !/closed|settled|written\s*off|fully\s*paid/i.test(String(account.status || '')));
    const closed = entry.accounts.length - active.length;
    const currentBalance = entry.accounts.reduce((sum, account) => sum + (toNumber(account.currentBalance) || 0), 0);
    const overdueAmount = entry.accounts.reduce((sum, account) => sum + (toNumber(account.overdueAmount) || 0), 0);
    const totalEmi = entry.accounts.reduce((sum, account) => sum + (toNumber(account.emi) || 0), 0) || toNumber(entry.record?.emi_obligations_total) || 0;
    [entry.name, entry.accounts.length, active.length, closed, currentBalance, overdueAmount, totalEmi]
      .forEach((value, columnIndex) => {
        const cell = ws.getCell(row, columnIndex + 1);
        if (columnIndex >= 4) setStyledFinancialCell(ws, cell.address, value);
        else {
          cell.value = sanitizeExcelValue(value, '');
          styleDataCell(cell, { altRow: index % 2 === 1 });
        }
      });
    row += 1;
  });

  row += 1;
  row = addCibilSection(ws, row, '3. LOANWISE DETAILS INCLUDING DPD', ['Applicant', 'Lender', 'Account Type', 'Ownership', 'Sanction Amount', 'Current Balance', 'EMI', 'Open Date', 'Status', 'DPD History']);
  const allAccounts = bureauRows.flatMap(entry => entry.accounts.map(account => ({ ...account, applicantName: entry.name })));
  if (!allAccounts.length) row = writeCibilNoDataRow(ws, row, 10);
  else allAccounts.forEach((account, index) => {
    [account.applicantName, account.lender, account.accountType, account.ownership, account.sanctionAmount, account.currentBalance, account.emi, formatDate(account.openDate), account.status, account.dpdHistory]
      .forEach((value, columnIndex) => {
        const cell = ws.getCell(row, columnIndex + 1);
        if ([4, 5, 6].includes(columnIndex)) setStyledFinancialCell(ws, cell.address, value);
        else {
          cell.value = sanitizeExcelValue(value, '');
          styleDataCell(cell, { altRow: index % 2 === 1, wrap: true });
        }
      });
    row += 1;
  });

  row += 1;
  row = addCibilSection(ws, row, '4. ENQUIRY DETAILS', ['Applicant', 'Enquiry Date', 'Member / Lender', 'Purpose', 'Amount']);
  const allEnquiries = bureauRows.flatMap(entry => entry.enquiries.map(enquiry => ({ ...enquiry, applicantName: entry.name })));
  if (!allEnquiries.length) row = writeCibilNoDataRow(ws, row, 5);
  else allEnquiries.forEach((enquiry, index) => {
    [enquiry.applicantName, formatDate(enquiry.date), enquiry.member, enquiry.purpose, enquiry.amount]
      .forEach((value, columnIndex) => {
        const cell = ws.getCell(row, columnIndex + 1);
        if (columnIndex === 4) setStyledFinancialCell(ws, cell.address, value);
        else {
          cell.value = sanitizeExcelValue(value, '');
          styleDataCell(cell, { altRow: index % 2 === 1, wrap: true });
        }
      });
    row += 1;
  });

  const widths = [26, 24, 20, 18, 17, 17, 16, 15, 16, 42];
  widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  ws.pageSetup.printArea = `A1:J${Math.max(row, 10)}`;
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
      gst_requests: {
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        include: { gst_financial_year_summaries: { orderBy: { financial_year: 'desc' } } }
      },
      itr_analytics: { orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }] },
      bank_statements: { orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }, { id: 'desc' }] },
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

async function generateLoanApplicationSummaryWorkbook({
  caseId,
  tenantId,
  user
}) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(
      `Loan Application Summary template not found at ${TEMPLATE_PATH}`
    );
  }

  const caseRecord = await fetchReportCase(
    caseId,
    tenantId,
    user
  );

  if (!caseRecord) {
    const err = new Error(
      'Case not found or unauthorized.'
    );
    err.statusCode = 404;
    throw err;
  }

  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.readFile(
    TEMPLATE_PATH
  );

  ensureWorksheetContract(workbook);
  resetTemplateSampleData(workbook);

  workbook.creator = 'Cred2Tech';
  workbook.lastModifiedBy =
    user?.name
    || user?.email
    || 'Cred2Tech';
  workbook.created = new Date();
  workbook.modified = new Date();

  const reportData =
    buildCanonicalLoanApplicationSummaryData(
      caseRecord
    );

  /*
   * Provider Excel files are fallback-only.
   * Their values may fill missing canonical
   * fields, but their raw worksheets must
   * never replace the approved report
   * template.
   */
  const sourceWorkbooks =
    await loadAvailableSourceWorkbooks(
      caseRecord,
      tenantId
    );

  const mappedSources =
    mapSourceWorkbooks(
      sourceWorkbooks
    );

  mergeFallbackSourcesIntoCanonicalReportData(
    reportData,
    mappedSources
  );

  applyCanonicalSummaryData(
    workbook,
    reportData
  );

  applyCanonicalAnalysisData(
    workbook,
    reportData
  );

  fillCibilSheet(
    workbook,
    caseRecord
  );

  /*
   * This must be the final presentation pass
   * so every worksheet gets one top-left
   * logo, only two frozen rows and repeated
   * print rows 1:2.
   */
  applyLoanApplicationSummaryPresentation(
    workbook
  );

  console.info(
    '[LoanApplicationSummary] canonical source trace',
    JSON.stringify({
      caseId: caseRecord.id,
      tenantId: caseRecord.tenant_id,
      warnings: reportData.warnings,
      providerExcelSources: sourceWorkbooks.metadata,
      sourceTrace: reportData.sourceTrace
    })
  );

  validateWorkbook(
    workbook,
    {
      requireCaseSummary: true
    }
  );

  validateCanonicalWorkbook(
    workbook,
    reportData,
    {
      requirePresentation: true
    }
  );

  const buffer =
    await workbook.xlsx.writeBuffer();

  if (!buffer || !buffer.byteLength) {
    throw new Error(
      'Generated workbook is empty.'
    );
  }

  /*
   * Reload the generated file because images,
   * panes, print titles and merges can behave
   * differently after serialization.
   */
  const check = new ExcelJS.Workbook();
  await check.xlsx.load(buffer);

  validateWorkbook(
    check,
    {
      requireCaseSummary: true
    }
  );

  validateCanonicalWorkbook(
    check,
    reportData,
    {
      requirePresentation: true
    }
  );

  return buffer;
}

async function generateAndSaveLoanApplicationSummary({ caseId, tenantId, user }) {
  const buffer = await generateLoanApplicationSummaryWorkbook({ caseId, tenantId, user });
  const fileName = buildReportFileName(caseId);
  const storageKey = `reports/loan-application-summary/${tenantId}/${caseId}/${fileName}`;
  const storage = getStorageProvider('S3');
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
  setFinancialCell,
  clearLoanApplicationSummaryDynamicCells,
  resetTemplateSampleData,
  applyCanonicalSummaryData,
  applyCanonicalAnalysisData,
  fillCibilSheet,
  applyLoanApplicationSummaryPresentation,
  mergeFallbackSourcesIntoCanonicalReportData,
  loadAvailableSourceWorkbooks,
  findCaseExcelDocument,
  collectCaseDocuments,
  findTemplateRowByLabel,
  validateCanonicalWorkbook,
  buildCanonicalLoanApplicationSummaryData,
  ensureWorksheetContract,
  validateWorkbook,
  copySourceWorkbookToSheet,
  writeNoDataMessage,
  findStoredExcelDocument,
  isSafeHttpsSourceUrl,
  mapSourceWorkbooks,
  extractCompanyProfile,
  extractAnnualGstrSales,
  extractLast12MonthGstrSales,
  extractGeneralInformation,
  extractTaxCalculation,
  extractProfitAndLoss,
  extractAccountDetails,
  extractCreditTxnTotal,
  extractMonthlyAverageBalance,
  calculateAverageFromMonthlyValues,
  calculateLast12MonthTotal,
  safeNumber,
  safeCurrency,
  safePercent,
  generateLoanApplicationSummaryWorkbook,
  generateAndSaveLoanApplicationSummary
};
