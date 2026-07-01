const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  SHEET_NAMES,
  buildReportFileName,
  sanitizeExcelValue,
  ensureWorksheetContract,
  validateWorkbook
} = require('../src/services/reports/loanApplicationSummary.service');

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
