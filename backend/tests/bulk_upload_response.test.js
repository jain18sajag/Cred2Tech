const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBulkUploadResponse } = require('../src/utils/bulkUploadResponse');

test('buildBulkUploadResponse flattens ESR details for the bulk upload UI', () => {
  const response = buildBulkUploadResponse({
    totalRows: 2,
    createdCases: 2,
    failedRows: 0,
    createdCaseRefs: [
      {
        caseRef: 'CASE-001',
        caseId: 101,
        customerName: 'Acme Trading',
        esr: {
          esrGenerated: true,
          eligibleCount: 3,
          totalLendersEvaluated: 5,
          finalEligibilityStatus: 'Eligible',
          bestLender: 'HDFC Bank',
          bestScheme: 'LAP',
          finalEligibleLoanAmount: 2500000
        }
      },
      {
        caseRef: 'CASE-002',
        caseId: 102,
        customerName: 'Beta Services',
        esr: {
          esrGenerated: false,
          error: 'No income data found'
        }
      }
    ],
    errors: []
  }, true, 'Bulk upload completed');

  assert.equal(response.success, true);
  assert.deepEqual(response.summary, {
    totalRows: 2,
    createdCases: 2,
    failedRows: 0,
    esrGeneratedCases: 1,
    esrFailedCases: 1
  });
  assert.equal(response.createdCases[0].esrGenerated, true);
  assert.equal(response.createdCases[0].eligibleLenderCount, 3);
  assert.equal(response.createdCases[0].totalLenderCount, 5);
  assert.equal(response.createdCases[0].finalLoanEligibility, 2500000);
  assert.equal(response.createdCases[1].esrGenerated, false);
  assert.equal(response.createdCases[1].esrError, 'No income data found');
});

test('buildBulkUploadResponse returns empty ESR counts for full validation failure', () => {
  const response = buildBulkUploadResponse({
    totalRows: 1,
    createdCases: 0,
    failedRows: 1,
    createdCaseRefs: [],
    errors: [{ row: 2, caseRef: 'Unknown', message: 'Missing Case Ref' }]
  }, false, 'Bulk upload validation failed');

  assert.equal(response.success, false);
  assert.equal(response.summary.esrGeneratedCases, 0);
  assert.equal(response.summary.esrFailedCases, 0);
  assert.deepEqual(response.createdCases, []);
  assert.equal(response.errors[0].message, 'Missing Case Ref');
});
