const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('node:test').mock;
const ExcelJS = require('exceljs');
const documentFindFirst = mock.fn();

require.cache[require.resolve('../config/db')] = {
  exports: {
    document: {
      findFirst: documentFindFirst
    }
  }
};

const {
  SHEET_NAMES,
  buildReportFileName,
  sanitizeExcelValue,
  ensureWorksheetContract,
  validateWorkbook,
  copySourceWorkbookToSheet,
  findStoredExcelDocument,
  isSafeHttpsSourceUrl
} = require('../src/services/reports/loanApplicationSummary.service');
const XLSX = require('xlsx');

test('loan application summary filename includes case id', () => {
  assert.equal(buildReportFileName(42), 'Loan_Application_Summary_42.xlsx');
});

test('loan application summary normalizes exact sheet names and removes trailing bank dot', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Summary');
  workbook.addWorksheet('Bank Statement Analysis.');
  workbook.addWorksheet('ITR Analysis');
  workbook.addWorksheet('GST Analysis');
  workbook.addWorksheet('Cibil - Transunion');

  ensureWorksheetContract(workbook);

  assert.deepEqual(workbook.worksheets.map(ws => ws.name), SHEET_NAMES);
  assert.doesNotThrow(() => validateWorkbook(workbook));
});

test('loan application summary rejects invalid workbook contract', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Summary');
  workbook.addWorksheet('Bank Statement Analysis.');

  assert.throws(() => validateWorkbook(workbook), /Expected 5 sheets/);
});

test('loan application summary sanitizes unsafe and missing display values', () => {
  assert.equal(sanitizeExcelValue('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(sanitizeExcelValue('+441234567890'), "'+441234567890");
  assert.equal(sanitizeExcelValue('undefined'), 'N/A');
  assert.equal(sanitizeExcelValue(Number.NaN, 'N/A'), 'N/A');
});

test('loan application summary copies source Excel sections into existing report sheet', () => {
  const target = new ExcelJS.Workbook();
  const sheet = target.addWorksheet('Bank Statement Analysis');
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'Old Template Header';

  const source = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([
    ['Description', 'HDFC - 123 - Savings'],
    ['Account Holders', 'Elevate Consulting'],
    ['Account Number', 50200080231149]
  ]), 'Summary');
  XLSX.utils.book_append_sheet(source, XLSX.utils.aoa_to_sheet([
    ['Month', 'Credit', 'Debit'],
    ['Apr 2025', 1000, 500]
  ]), 'Monthly summary');

  const copied = copySourceWorkbookToSheet(sheet, source, 'bank');

  assert.equal(copied, true);
  assert.equal(target.worksheets.length, 1);
  assert.equal(sheet.name, 'Bank Statement Analysis');
  assert.equal(sheet.getCell('A1').value, 'Summary');
  assert.equal(sheet.getCell('A2').value, 'Description');
  assert.equal(sheet.getCell('B2').value, 'HDFC - 123 - Savings');
  assert.equal(sheet.getCell('B4').value, '50200080231149');
  assert.equal(sheet.getCell('A6').value, 'Monthly summary');
  assert.equal(sheet.getCell('A7').value, 'Month');
});

test('loan application summary resolves stored source URL when document id is missing', async () => {
  const expected = {
    id: 99,
    storage_path: '2026/07/source.xlsx',
    extension: '.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    original_file_name: 'source.xlsx',
    document_type: 'BANK_EXCEL'
  };
  documentFindFirst.mock.mockImplementationOnce(async () => expected);

  const doc = await findStoredExcelDocument({
    documentId: null,
    tenantId: 7,
    sourceUrl: 'https://example.com/source.xlsx',
    documentTypes: ['BANK_EXCEL']
  });

  assert.equal(doc, expected);
  assert.equal(documentFindFirst.mock.calls[0].arguments[0].where.source_url, 'https://example.com/source.xlsx');
  assert.deepEqual(documentFindFirst.mock.calls[0].arguments[0].where.document_type.in, ['BANK_EXCEL']);
});

test('loan application summary only allows safe https source URLs', () => {
  assert.equal(isSafeHttpsSourceUrl('https://example.com/source.xlsx'), true);
  assert.equal(isSafeHttpsSourceUrl('http://example.com/source.xlsx'), false);
  assert.equal(isSafeHttpsSourceUrl('https://localhost/source.xlsx'), false);
  assert.equal(isSafeHttpsSourceUrl('https://192.168.1.10/source.xlsx'), false);
});
