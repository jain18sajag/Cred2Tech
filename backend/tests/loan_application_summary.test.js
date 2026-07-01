const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  SHEET_NAMES,
  buildReportFileName,
  sanitizeExcelValue,
  ensureWorksheetContract,
  validateWorkbook,
  copySourceWorkbookToSheet
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
    ['Account Holders', 'Elevate Consulting']
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
  assert.equal(sheet.getCell('A6').value, 'Monthly summary');
  assert.equal(sheet.getCell('A7').value, 'Month');
});
