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
require.cache[require.resolve('../src/services/storage')] = {
  exports: {
    getStorageProvider: () => ({
      getStream: async () => {
        throw new Error('storage not available in unit test');
      },
      save: async () => ({ key: 'unit-test.xlsx', sizeBytes: 0 })
    })
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
  isSafeHttpsSourceUrl,
  mapSourceWorkbooks,
  extractAnnualGstrSales,
  extractLast12MonthGstrSales,
  extractProfitAndLoss,
  extractCreditTxnTotal,
  extractMonthlyAverageBalance
} = require('../src/services/reports/loanApplicationSummary.service');
const XLSX = require('xlsx');

function makeWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  });
  return workbook;
}

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
  assert.equal(sanitizeExcelValue('-'), '-');
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
  assert.equal(sheet.getCell('A6').value, null);
  assert.equal(sheet.getCell('A7').value, null);
});

test('loan application summary copies only requested GST and ITR source sheets', () => {
  const target = new ExcelJS.Workbook();
  const gstSheet = target.addWorksheet('GST Analysis');
  const itrSheet = target.addWorksheet('ITR Analysis');

  const gstSource = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(gstSource, XLSX.utils.aoa_to_sheet([['Account Details'], ['PAN', 'AAAAA0000A']]), 'Account Details');
  XLSX.utils.book_append_sheet(gstSource, XLSX.utils.aoa_to_sheet([['Particulars', 'FY 2024-25'], ['Sales', 1000]]), 'Overview Yearly');
  XLSX.utils.book_append_sheet(gstSource, XLSX.utils.aoa_to_sheet([['Particulars', 'Total'], ['Sales', 1000]]), 'Overview Monthly');
  XLSX.utils.book_append_sheet(gstSource, XLSX.utils.aoa_to_sheet([['Customer Summary'], ['A', 1]]), 'Customer Summary');

  const itrSource = XLSX.utils.book_new();
  ['General Information', 'Tax Calculation', 'Balance Sheet', 'Profit and Loss Statement', 'Ratio Analysis', 'Appendix-1'].forEach((name) => {
    XLSX.utils.book_append_sheet(itrSource, XLSX.utils.aoa_to_sheet([[name], ['Value', 1]]), name);
  });

  assert.equal(copySourceWorkbookToSheet(gstSheet, gstSource, 'gst'), true);
  assert.equal(copySourceWorkbookToSheet(itrSheet, itrSource, 'itr'), true);

  const gstValues = JSON.stringify(gstSheet.getSheetValues());
  const itrValues = JSON.stringify(itrSheet.getSheetValues());

  assert.match(gstValues, /Account Details/);
  assert.match(gstValues, /Overview Yearly/);
  assert.match(gstValues, /Overview Monthly/);
  assert.doesNotMatch(gstValues, /Customer Summary/);
  ['General Information', 'Tax Calculation', 'Balance Sheet', 'Profit and Loss Statement', 'Ratio Analysis'].forEach((name) => {
    assert.match(itrValues, new RegExp(name));
  });
  assert.doesNotMatch(itrValues, /Appendix-1/);
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

test('loan application summary maps GST annual and last 12 month sales from source sheets', () => {
  const gstWorkbook = makeWorkbook({
    'Overview Yearly': [
      ['Particulars', 'Total', 'FY 2023-24', 'FY 2024-25'],
      ['GSTR 1 Gross Sales (E=A+B-C+D)', 3000, 1000, 2000]
    ],
    'Overview Monthly': [
      ['Particulars', 'Total', 'Apr 2025', 'May 2025'],
      ['GSTR 1 Gross Sales (E=A+B-C+D)', 300, 100, 200]
    ]
  });

  assert.equal(extractAnnualGstrSales(gstWorkbook), 2000);
  assert.equal(extractLast12MonthGstrSales(gstWorkbook), 300);
});

test('loan application summary maps ITR profit and revenue from Profit and Loss Statement', () => {
  const itrWorkbook = makeWorkbook({
    'Profit and Loss Statement': [
      ['Sl. No.', 'Particulars', '2023', '2024', '2025'],
      [1, 'Revenue from Operations', 1000, 2000, 3000],
      [2, 'Depreciation and Amortization', 10, 20, 30],
      [3, 'Finance Cost', 11, 22, 33],
      [4, 'Profit After Tax', 100, 200, 300]
    ]
  });

  const pnl = extractProfitAndLoss(itrWorkbook);
  assert.equal(pnl.netProfitAfterTax, 300);
  assert.equal(pnl.revenueFromOperations, 3000);
  assert.equal(pnl.depreciation, 30);
  assert.equal(pnl.interestOnLoan, 33);
});

test('loan application summary maps Bank credit total and average monthly balance', () => {
  const bankWorkbook = makeWorkbook({
    Summary: [
      ['Description', 'Apr 2025', 'May 2025', 'Jun 2025', 'Total'],
      ['Credit Txns', 100, 200, 300, 600],
      ['Monthly Average Balance', 10, 20, 30, 20]
    ]
  });

  assert.equal(extractCreditTxnTotal(bankWorkbook), 600);
  assert.equal(extractMonthlyAverageBalance(bankWorkbook), 20);
});

test('loan application summary calculates bank average balance from monthly cells instead of total', () => {
  const bankWorkbook = makeWorkbook({
    Summary: [
      ['Description', 'Apr 2025', 'May 2025', 'Jun 2025', 'Total'],
      ['Monthly Average Balance', 10, 20, 30, 999999]
    ]
  });

  assert.equal(extractMonthlyAverageBalance(bankWorkbook), 20);
});

test('loan application summary divides average balance total by detected month count when monthly cells are blank', () => {
  const bankWorkbook = makeWorkbook({
    Summary: [
      ['Description', 'Apr 2025', 'May 2025', 'Jun 2025', 'Total'],
      ['Monthly Average Balance', '', '', '', 60]
    ]
  });

  assert.equal(extractMonthlyAverageBalance(bankWorkbook), 20);
});

test('loan application summary returns no bank average balance when no monthly values are available', () => {
  const bankWorkbook = makeWorkbook({
    Summary: [
      ['Description', 'Value'],
      ['Monthly Average Balance', 60]
    ]
  });

  assert.equal(extractMonthlyAverageBalance(bankWorkbook), null);
});

test('loan application summary maps combined financial snapshot from source workbooks', () => {
  const mapped = mapSourceWorkbooks({
    gst: makeWorkbook({
      'Overview Yearly': [
        ['Particulars', 'Total', 'FY 2024-25'],
        ['GSTR 1 Gross Sales (E=A+B-C+D)', 9000, 9000]
      ],
      'Overview Monthly': [
        ['Particulars', 'Total', 'Apr 2025'],
        ['GSTR 1 Gross Sales (E=A+B-C+D)', 750, 750]
      ]
    }),
    itr: makeWorkbook({
      'Profit and Loss Statement': [
        ['Particulars', '2025'],
        ['Profit After Tax', 123],
        ['Revenue from Operations', 456]
      ],
      'Tax Calculation': [
        ['Particulars', '2025'],
        ['Income from Salary', 1200],
        ['Net Agricultural Income', 800]
      ]
    }),
    bank: makeWorkbook({
      Summary: [
        ['Description', 'Apr 2025', 'May 2025', 'Total'],
        ['Credit Txns', 11, 22, 33],
        ['Monthly Average Balance', 100, 200, 150]
      ]
    })
  });

  assert.equal(mapped.financialSnapshot.annualGstrSales, 9000);
  assert.equal(mapped.financialSnapshot.last12MonthGstrSales, 750);
  assert.equal(mapped.financialSnapshot.netProfitAfterTax, 123);
  assert.equal(mapped.financialSnapshot.turnoverReceiptItr, 456);
  assert.equal(mapped.financialSnapshot.annualBusinessReceiptBank, 33);
  assert.equal(mapped.financialSnapshot.averageBankBalance, 150);
  assert.equal(mapped.financialSnapshot.salaryIncome, 1200);
  assert.equal(mapped.financialSnapshot.agriculturalIncome, 800);
});

test('loan application summary uses empty mapped values when Bank GST or ITR source is missing', () => {
  const mapped = mapSourceWorkbooks({});

  assert.deepEqual(mapped.gst, {});
  assert.deepEqual(mapped.itr, {});
  assert.deepEqual(mapped.bank, {});
  assert.equal(mapped.financialSnapshot.annualGstrSales, undefined);
  assert.equal(mapped.financialSnapshot.netProfitAfterTax, undefined);
  assert.equal(mapped.financialSnapshot.annualBusinessReceiptBank, undefined);
});
