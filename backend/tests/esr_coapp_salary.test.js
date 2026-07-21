'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { __testables } = require('../src/services/esr/dynamicEligibility.service');

const applicants = [
  { id: 780, is_primary: true, type: 'PRIMARY', employment_type: 'NA' },
  { id: 781, is_primary: false, type: 'CO_APPLICANT', employment_type: 'SALARIED' }
];

test('case-level bank salary snapshot is not assigned to a co-applicant', () => {
  const result = __testables.getCoApplicantSalaryMonthly({
    esr: { salaried_income: 1666.666666666667, bank_net_salary_monthly: 1666.666666666667 },
    incomeEntries: [],
    applicants
  });

  assert.deepEqual(result, { monthlySalary: 0, source: 'NONE' });
});

test('applicant-linked co-applicant salary remains eligible at its monthly value', () => {
  const result = __testables.getCoApplicantSalaryMonthly({
    esr: { salaried_income: 1666.666666666667 },
    incomeEntries: [{ applicant_id: 781, income_type: 'Salary', annual_amount: 254400 }],
    applicants
  });

  assert.deepEqual(result, {
    monthlySalary: 21200,
    source: 'CO_APPLICANT_MANUAL_SALARY_ENTRY'
  });
});

test('ICICI salary-slip-only mode rejects manual and bank salary fallbacks', () => {
  const result = __testables.getCoApplicantSalaryMonthly({
    esr: { salaried_income: 1666.666666666667, bank_net_salary_monthly: 1666.666666666667 },
    incomeEntries: [{ applicant_id: 781, income_type: 'Salary', annual_amount: 254400 }],
    applicants,
    requireSalarySlipOcr: true
  });

  assert.deepEqual(result, {
    monthlySalary: 0,
    source: 'NONE',
    slipCount: 0,
    applicantIds: []
  });
});

test('ICICI salary-slip-only mode averages completed OCR months for the co-applicant', () => {
  const result = __testables.getCoApplicantSalaryMonthly({
    esr: { salaried_income: 1666.666666666667 },
    incomeEntries: [],
    applicants: [
      applicants[0],
      {
        ...applicants[1],
        salary_ocr_results: [
          { id: 1, ocr_status: 'COMPLETED', salary_period: '2026-02', net_salary: 21000 },
          { id: 2, ocr_status: 'COMPLETED', salary_period: '2026-03', net_salary: 21400 }
        ]
      }
    ],
    requireSalarySlipOcr: true
  });

  assert.deepEqual(result, {
    monthlySalary: 21200,
    source: 'CO_APPLICANT_SALARY_SLIP_OCR',
    slipCount: 2,
    applicantIds: [781]
  });
});
