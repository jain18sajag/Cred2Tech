const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSalarySlipResponse,
  buildSalarySlipOcrDbData,
  hasDuplicateSalaryPeriod
} = require('../src/services/externalApis/fractoSalaryOcr.service');

const marchPayload = {
  meta: {
    source: 'pdf_text',
    filename: 'PaySlips_None_FM687_Mar_2026.pdf',
    ocr_confidence: null,
    pages_processed: 2
  },
  name: {
    value: 'Rohit Joshi',
    raw_line: 'Name Rohit Joshi PAN CYPPC6932A'
  },
  checks: ['net_salary matches the amount written in words (21200).'],
  warnings: [],
  net_salary: {
    value: 21200,
    raw_line: 'Net Salary 21,200.00',
    words_match: true
  },
  salary_date: {
    raw: 'Mar 2026',
    value: '2026-03'
  },
  gross_salary: {
    value: 23200,
    raw_line: 'Gross Salary 23,200.00 Gross Deduction -2,000.00'
  }
};

test('normalizes supplied March 2026 OCR payload', () => {
  const result = normalizeSalarySlipResponse(marchPayload, {
    month: '03',
    year: '2026',
    applicant: { name: 'Rohit Joshi', pan_number: 'CYPPC6932A' }
  });

  assert.equal(result.gross_salary, 23200);
  assert.equal(result.net_salary, 21200);
  assert.equal(result.deductions, 2000);
  assert.equal(result.deductions_is_derived, true);
  assert.equal(result.employee_name, 'Rohit Joshi');
  assert.equal(result.employee_pan, 'CYPPC6932A');
  assert.equal(result.salary_period, '2026-03');
  assert.equal(result.month, '03');
  assert.equal(result.year, '2026');
  assert.equal(result.net_salary_words_match, true);
  assert.equal(result.pages_processed, 2);
  assert.equal(result.extraction_source, 'pdf_text');
  assert.equal(result.ocr_confidence, null);
  assert.deepEqual(result.extraction_checks, marchPayload.checks);
  assert.deepEqual(result.extraction_warnings, []);
  assert.equal(result.name_match_status, 'MATCHED');
  assert.equal(result.pan_match_status, 'MATCHED');
});

test('preserves null OCR confidence and missing employer name', () => {
  const result = normalizeSalarySlipResponse(marchPayload, { month: '03', year: '2026' });

  assert.equal(result.ocr_confidence, null);
  assert.equal(result.employer_name, null);
});

test('stores explicit deductions without marking them derived', () => {
  const result = normalizeSalarySlipResponse({
    ...marchPayload,
    deductions: { value: 1999 }
  }, { month: '03', year: '2026' });

  assert.equal(result.deductions, 1999);
  assert.equal(result.deductions_is_derived, false);
});

test('does not store invalid or absent PAN', () => {
  const invalid = normalizeSalarySlipResponse({
    ...marchPayload,
    name: { value: 'Rohit Joshi', raw_line: 'Name Rohit Joshi PAN CYPPC693A' }
  }, { month: '03', year: '2026' });
  const absent = normalizeSalarySlipResponse({
    ...marchPayload,
    name: { value: 'Rohit Joshi', raw_line: 'Name Rohit Joshi' }
  }, { month: '03', year: '2026' });

  assert.equal(invalid.employee_pan, null);
  assert.equal(absent.employee_pan, null);
});

test('detects caller period match and mismatch', () => {
  const matched = normalizeSalarySlipResponse(marchPayload, { month: '03', year: '2026' });
  const mismatched = normalizeSalarySlipResponse(marchPayload, { month: '04', year: '2026' });

  assert.equal(matched.validation.period_match_status, 'MATCHED');
  assert.equal(mismatched.validation.period_match_status, 'MISMATCHED');
  assert.equal(mismatched.validation.manual_review_required, true);
  assert.match(mismatched.extraction_warnings.join(' '), /differs from OCR period/);
});

test('ignores placeholder month slots when comparing OCR period', () => {
  const result = normalizeSalarySlipResponse(marchPayload, { month: 'M2', year: '2026' });

  assert.equal(result.month, '03');
  assert.equal(result.year, '2026');
  assert.equal(result.validation.period_match_status, 'NOT_AVAILABLE');
  assert.equal(result.validation.manual_review_required, false);
  assert.deepEqual(result.extraction_warnings, []);
});

test('stores applicant name and PAN match statuses', () => {
  const matched = normalizeSalarySlipResponse(marchPayload, {
    month: '03',
    year: '2026',
    applicant: { name: 'Rohit Joshi', pan_number: 'CYPPC6932A' }
  });
  const mismatched = normalizeSalarySlipResponse(marchPayload, {
    month: '03',
    year: '2026',
    applicant: { name: 'Different Name', pan_number: 'AAAAA1111A' }
  });
  const unavailable = normalizeSalarySlipResponse({
    ...marchPayload,
    name: { value: null, raw_line: 'Name unavailable' }
  }, { month: '03', year: '2026', applicant: { name: 'Rohit Joshi', pan_number: 'CYPPC6932A' } });

  assert.equal(matched.name_match_status, 'MATCHED');
  assert.equal(matched.pan_match_status, 'MATCHED');
  assert.equal(mismatched.name_match_status, 'MISMATCHED');
  assert.equal(mismatched.pan_match_status, 'MISMATCHED');
  assert.equal(unavailable.name_match_status, 'NOT_AVAILABLE');
  assert.equal(unavailable.pan_match_status, 'NOT_AVAILABLE');
});

test('period mismatch marks validation for manual review', () => {
  const result = normalizeSalarySlipResponse(marchPayload, { month: '02', year: '2026' });

  assert.equal(result.validation.manual_review_required, true);
  assert.equal(result.validation.period_match_status, 'MISMATCHED');
});

test('does not derive deductions when gross salary is lower than net salary', () => {
  const result = normalizeSalarySlipResponse({
    ...marchPayload,
    gross_salary: { value: 20000 },
    net_salary: { value: 21200 }
  }, { month: '03', year: '2026' });

  assert.equal(result.deductions, null);
  assert.equal(result.deductions_is_derived, false);
});

test('missing salary date falls back to caller period and requires manual review', () => {
  const result = normalizeSalarySlipResponse({
    ...marchPayload,
    salary_date: null
  }, { month: '03', year: '2026' });

  assert.equal(result.salary_period, null);
  assert.equal(result.month, '03');
  assert.equal(result.year, '2026');
  assert.equal(result.validation.manual_review_required, true);
});

test('detects duplicate salary period for same applicant', () => {
  assert.equal(hasDuplicateSalaryPeriod([
    { id: 1, case_id: 578, applicant_id: 10, month: '03', year: '2026' }
  ], { id: 2, case_id: 578, applicant_id: 10, month: '03', year: '2026' }), true);

  assert.equal(hasDuplicateSalaryPeriod([
    { id: 1, case_id: 578, applicant_id: 10, month: '03', year: '2026' }
  ], { id: 1, case_id: 578, applicant_id: 10, month: '03', year: '2026' }), false);
});

test('DB mapper preserves raw and extracted JSON fields passed by caller', () => {
  const raw = { hello: 'world' };
  const dbData = buildSalarySlipOcrDbData({
    status: 'COMPLETED',
    raw_ocr_response: raw,
    extracted_json: raw,
    ...normalizeSalarySlipResponse(marchPayload, { month: '03', year: '2026' })
  });

  assert.equal(dbData.raw_ocr_response, raw);
  assert.equal(dbData.extracted_json, raw);
});
