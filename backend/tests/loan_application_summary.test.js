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
  setFinancialCell,
  applyCanonicalSummaryData,
  validateCanonicalWorkbook,
  buildCanonicalLoanApplicationSummaryData,
  writeNoDataMessage,
  findStoredExcelDocument,
  isSafeHttpsSourceUrl,
  mapSourceWorkbooks,
  extractAnnualGstrSales,
  extractLast12MonthGstrSales,
  extractProfitAndLoss,
  extractCreditTxnTotal,
  extractMonthlyAverageBalance
} = require('../src/services/reports/loanApplicationSummary.service');

// Builds an ExcelJS workbook from a { sheetName: [[row1cells], [row2cells], ...] }
// shape — matches what readSourceExcelWorkbook now returns in production
// (migrated off `xlsx`/SheetJS, see loanApplicationSummary.service.js header).
function addAoaSheet(workbook, name, rows) {
  const ws = workbook.addWorksheet(name);
  rows.forEach((row, rIdx) => {
    row.forEach((value, cIdx) => {
      if (value !== undefined && value !== '') ws.getCell(rIdx + 1, cIdx + 1).value = value;
    });
  });
  return ws;
}

function makeWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();
  Object.entries(sheets).forEach(([name, rows]) => {
    addAoaSheet(workbook, name, rows);
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

  const source = new ExcelJS.Workbook();
  addAoaSheet(source, 'Summary', [
    ['Description', 'HDFC - 123 - Savings'],
    ['Account Holders', 'Elevate Consulting'],
    ['Account Number', 50200080231149]
  ]);
  addAoaSheet(source, 'Monthly summary', [
    ['Month', 'Credit', 'Debit'],
    ['Apr 2025', 1000, 500]
  ]);

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

  const gstSource = new ExcelJS.Workbook();
  addAoaSheet(gstSource, 'Account Details', [['Account Details'], ['PAN', 'AAAAA0000A']]);
  addAoaSheet(gstSource, 'Overview Yearly', [['Particulars', 'FY 2024-25'], ['Sales', 1000]]);
  addAoaSheet(gstSource, 'Overview Monthly', [['Particulars', 'Total'], ['Sales', 1000]]);
  addAoaSheet(gstSource, 'Customer Summary', [['Customer Summary'], ['A', 1]]);

  const itrSource = new ExcelJS.Workbook();
  ['General Information', 'Tax Calculation', 'Balance Sheet', 'Profit and Loss Statement', 'Ratio Analysis', 'Appendix-1'].forEach((name) => {
    addAoaSheet(itrSource, name, [[name], ['Value', 1]]);
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

test('loan application summary leaves missing financial values blank for report cells', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Summary');

  setFinancialCell(sheet, 'B26', null);
  setFinancialCell(sheet, 'B27', undefined);
  setFinancialCell(sheet, 'B28', Number.NaN);

  assert.equal(sheet.getCell('B26').value, '');
  assert.equal(sheet.getCell('B27').value, '');
  assert.equal(sheet.getCell('B28').value, '');
});

test('loan application summary uses a styled blank sheet when source data is missing', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('GST Analysis');

  writeNoDataMessage(sheet, 'GST Analysis data is not available for this case.');

  assert.equal(sheet.getCell('A1').value, 'GST Analysis');
  assert.equal(sheet.getCell('A3').value, 'Particulars');
  assert.equal(sheet.getCell('A4').value, '');
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      assert.doesNotMatch(String(cell.value || ''), /not available|null|undefined|NaN|None/i);
    });
  });
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

function itrYear(profitAfterTax, depreciation, grossReceipts, salaryIncome = 9999999) {
  return [{ json: { ITR: { ITR3: {
    PARTA_PL: {
      TaxProvAppr: { ProfitAfterTax: profitAfterTax },
      DebitsToPL: { DepreciationAmort: depreciation, InterestExpdrtDtls: { InterestExpdr: 12345 } }
    },
    TradingAccount: { TotRevenueFrmOperations: grossReceipts },
    PartB_TI: { Salary: salaryIncome }
  } } } }];
}

function canonicalCaseFixture() {
  const monthlyTurnover = 8211259.75 / 12;
  const gstMonths = ['Apr 2024', 'May 2024', 'Jun 2024', 'Jul 2024', 'Aug 2024', 'Sep 2024', 'Oct 2024', 'Nov 2024', 'Dec 2024', 'Jan 2025', 'Feb 2025', 'Mar 2025']
    .map(Month => ({ Month, 'Taxable Value': monthlyTurnover }));
  return {
    id: 578,
    tenant_id: 7,
    customer_id: 70,
    customer_name: 'Current Customer',
    product_type: 'LAP',
    loan_amount: null,
    customer: { id: 70, business_name: 'Current Customer', business_pan: 'ABCDE1234F' },
    applicants: [
      {
        id: 701, is_primary: true, type: 'PRIMARY', name: 'Current Customer', pan_number: 'ABCDE1234F',
        salary_ocr_results: [{ id: 1, ocr_status: 'COMPLETED', net_salary: 21200, updated_at: '2026-01-05' }],
        bureau_checks: [{ id: 'b1', status: 'SUCCESS', score: '780', updated_at: '2026-01-05' }], documents: []
      },
      { id: 702, is_primary: false, type: 'CO_APPLICANT', name: 'Only Co Borrower', bureau_checks: [], documents: [] }
    ],
    itr_analytics: [{
      id: 1001, tenant_id: 7, customer_id: 70, case_id: 578, applicant_id: 701, status: 'COMPLETED', pan: 'ABCDE1234F', updated_at: '2026-01-05',
      analytics_payload: {
        '2024-2025': itrYear(1437483, 47693, 6266702),
        '2023-2024': itrYear(1200000, 40000, 5500000),
        '2022-2023': itrYear(1100000, 30000, 5000000)
      }
    }],
    gst_requests: [{
      id: 1002, tenant_id: 7, customer_id: 70, case_id: 578, applicant_id: 701, status: 'COMPLETED', gstin: '27ABCDE1234F1Z5', updated_at: '2026-01-05',
      raw_report_data: { 'Monthly Sales&Purchase': [{ 'Monthly Sale Summary': { data: gstMonths } }] },
      gst_financial_year_summaries: []
    }],
    bank_statements: [{
      id: 1003, tenant_id: 7, customer_id: 70, case_id: 578, applicant_id: 701, status: 'COMPLETED', updated_at: '2026-01-05',
      raw_retrieve_response: {
        overview: { monthlyAverageDailyBalance: [{ month: 'Apr 2024', averageDailyBalance: 311811.42 }] },
        accountLevelAnalysis: [{ bankName: 'Test Bank', accountNumber: '1234567890', avgMonthlyCredit: 1000000, totalCreditAmount: 12000000 }]
      }
    }],
    income_entries: [{ id: 10, applicant_id: 701, income_type: 'Agriculture', annual_amount: 600000 }],
    property: { id: 12, market_value: 20000000, property_type: 'Residential', property_address: 'Verified Property Address', remarks: 'DO NOT USE AS ADDRESS' },
    esr_financials: { requested_loan_amount: null, requested_tenure_months: null },
    documents: [], esrs: []
  };
}

test('canonical LAS mapper uses applicant-scoped JSON and case-578 regression facts', () => {
  const report = buildCanonicalLoanApplicationSummaryData(canonicalCaseFixture());
  assert.equal(report.financials.itr.latest.profitAfterTax, 1437483);
  assert.equal(report.financials.itr.latest.depreciation, 47693);
  assert.equal(report.financials.itr.latest.grossReceipts, 6266702);
  assert.ok(Math.abs(report.financials.gst.rolling12Months.turnover - 8211259.75) < 0.01);
  assert.ok(Math.abs(report.financials.gst.rolling12Months.averageMonthlySales - 684271.6458333334) < 0.01);
  assert.equal(report.financials.salary.monthlyNet, 21200);
  assert.equal(report.case.requestedAmount, null);
  assert.equal(report.case.requestedTenureMonths, null);
  assert.equal(report.property.address, 'Verified Property Address');
  assert.notEqual(report.property.address, report.property.remarks);
});

test('canonical LAS mapper keeps three ITR years independent', () => {
  const itr = buildCanonicalLoanApplicationSummaryData(canonicalCaseFixture()).financials.itr;
  assert.deepEqual([itr.latest.profitAfterTax, itr.previous.profitAfterTax, itr.older.profitAfterTax], [1437483, 1200000, 1100000]);
  assert.deepEqual([itr.latest.grossReceipts, itr.previous.grossReceipts, itr.older.grossReceipts], [6266702, 5500000, 5000000]);
});

test('canonical LAS mapper rejects cross-tenant case customer and applicant records', () => {
  const fixture = canonicalCaseFixture();
  fixture.itr_analytics.unshift({ ...fixture.itr_analytics[0], id: 9999, tenant_id: 8, applicant_id: 999, analytics_payload: { '2024-2025': itrYear(99999999, 9, 9) }, updated_at: '2027-01-01' });
  fixture.gst_requests.unshift({ ...fixture.gst_requests[0], id: 9998, case_id: 999, applicant_id: 999, updated_at: '2027-01-01' });
  fixture.bank_statements.unshift({ ...fixture.bank_statements[0], id: 9997, customer_id: 999, applicant_id: 999, updated_at: '2027-01-01' });
  const report = buildCanonicalLoanApplicationSummaryData(fixture);
  assert.equal(report.financials.itr.latest.profitAfterTax, 1437483);
  assert.equal(report.sourceTrace['financials.itr.latest.profitAfterTax'].sourceRecordId, 1001);
  assert.equal(report.sourceTrace['financials.gst.rolling12Months.turnover'].sourceRecordId, 1002);
  assert.equal(report.sourceTrace['financials.banking.latest.averageBalance'].sourceRecordId, 1003);
});

test('canonical LAS mapper gives raw JSON priority over conflicting structured snapshots', () => {
  const fixture = canonicalCaseFixture();
  Object.assign(fixture.itr_analytics[0], { net_profit_latest_year: 1, gross_receipts_latest_year: 2 });
  Object.assign(fixture.gst_requests[0], { turnover_latest_year: 3, rolling_12_month_turnover: 4 });
  Object.assign(fixture.bank_statements[0], { avg_bank_balance_latest_year: 5 });
  const report = buildCanonicalLoanApplicationSummaryData(fixture);
  assert.equal(report.financials.itr.latest.profitAfterTax, 1437483);
  assert.ok(report.financials.gst.rolling12Months.turnover > 8000000);
  assert.equal(report.financials.banking.latest.averageBalance, 311811.42);
  assert.deepEqual(report.sourceAvailability, { itrJson: true, gstJson: true, bankJson: true });
});

test('canonical LAS does not suppress Excel fallback for empty or unusable JSON payloads', () => {
  const fixture = canonicalCaseFixture();
  fixture.loan_amount = 0;
  fixture.esr_financials.requested_loan_amount = 0;
  fixture.esr_financials.requested_tenure_months = 0;
  fixture.itr_analytics[0].analytics_payload = {};
  fixture.gst_requests[0].raw_report_data = {};
  fixture.bank_statements[0].raw_analyze_response = {};
  fixture.bank_statements[0].raw_retrieve_response = null;

  const report = buildCanonicalLoanApplicationSummaryData(fixture);
  assert.deepEqual(report.sourceAvailability, { itrJson: false, gstJson: false, bankJson: false });
  assert.equal(report.case.requestedAmount, null);
  assert.equal(report.case.requestedTenureMonths, null);
});

test('pay-slip salary is not replaced by ITR salary or manual agriculture', () => {
  const report = buildCanonicalLoanApplicationSummaryData(canonicalCaseFixture());
  assert.equal(report.financials.salary.monthlyNet, 21200);
  assert.notEqual(report.financials.salary.monthlyNet, 9999999 / 12);
  assert.equal(report.financials.agriculturalIncome.itrAnnual, null);
  assert.equal(report.financials.agriculturalIncome.manualMonthly, 50000);
});

test('canonical Summary writes numeric financial cells and clears unused co-borrower 2', () => {
  const report = buildCanonicalLoanApplicationSummaryData(canonicalCaseFixture());
  const workbook = new ExcelJS.Workbook();
  SHEET_NAMES.forEach(name => workbook.addWorksheet(name));
  const summary = workbook.getWorksheet('Summary');
  summary.getCell('A11').value = 'Co-Applicant 2';
  summary.getCell('B11').value = 'Deepika';
  summary.getCell('A47').value = 'PAN Card';
  applyCanonicalSummaryData(workbook, report);
  assert.equal(summary.getCell('B26').value, 1437483);
  assert.equal(typeof summary.getCell('B26').value, 'number');
  assert.equal(summary.getCell('F38').value, 21200);
  assert.equal(summary.getCell('B15').value, '');
  assert.equal(summary.getCell('D15').value, '');
  assert.equal(summary.getCell('D18').value, 'Verified Property Address');
  assert.equal(summary.getCell('A11').value, 'Co-Applicant 2');
  assert.equal(summary.getCell('A47').value, 'PAN Card');
  assert.deepEqual(['B11', 'C11', 'D11', 'E11', 'F11', 'G11', 'B47', 'C47', 'E47', 'F47'].map(addr => summary.getCell(addr).value), Array(10).fill(''));
  assert.equal(summary.getCell('B20').value, 'Current Customer');
  assert.equal(summary.getCell('C20').value, 'Only Co Borrower');
  assert.equal(summary.getCell('B21').value, '780');
  assert.equal(summary.getCell('C45').value, 'Pending');
  assert.equal(summary.getCell('F45').value, 'Pending');
  assert.doesNotThrow(() => validateCanonicalWorkbook(workbook, report));
});

test('canonical LAS creates source trace for every populated key financial source', () => {
  const trace = buildCanonicalLoanApplicationSummaryData(canonicalCaseFixture()).sourceTrace;
  [
    'financials.itr.latest.profitAfterTax',
    'financials.itr.latest.depreciation',
    'financials.gst.rolling12Months.turnover',
    'financials.banking.latest.averageBalance',
    'financials.salary.monthlyNet',
    'property.marketValue'
  ].forEach(field => assert.ok(trace[field], `missing trace for ${field}`));
});
