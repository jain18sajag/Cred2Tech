'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBulkUploadedCase, markEsrInputsChanged } = require('../src/services/esrSnapshotMutation.service');

test('bulk upload detection supports notes and snapshot methods', () => {
  assert.equal(isBulkUploadedCase({ dsa_notes: '[Bulk Upload] Case Ref: A1' }, { selected_income_method: 'NET_PROFIT' }), true);
  assert.equal(isBulkUploadedCase({}, { selected_income_method: 'ANY' }), true);
  assert.equal(isBulkUploadedCase({}, { selected_income_method: 'LEGACY_UPLOAD' }), true);
  assert.equal(isBulkUploadedCase({}, { selected_income_method: 'NET_PROFIT' }), false);
});

test('bulk mutations preserve snapshot values and mark it completed', async () => {
  let updateData;
  const tx = {
    case: { findUnique: async () => ({ dsa_notes: '[Bulk Upload]' }) },
    caseEsrFinancials: {
      findUnique: async () => ({ selected_income_method: 'NET_PROFIT' }),
      updateMany: async ({ data }) => { updateData = data; }
    }
  };

  await markEsrInputsChanged(tx, 10);
  assert.equal(updateData.extraction_status, 'COMPLETED');
  assert.ok(updateData.extracted_at instanceof Date);
  assert.equal(Object.hasOwn(updateData, 'itr_pat'), false);
});

test('non-bulk mutations request normal extraction refresh', async () => {
  let updateData;
  const tx = {
    case: { findUnique: async () => ({ dsa_notes: null }) },
    caseEsrFinancials: {
      findUnique: async () => ({ selected_income_method: 'NET_PROFIT' }),
      updateMany: async ({ data }) => { updateData = data; }
    }
  };

  await markEsrInputsChanged(tx, 11);
  assert.deepEqual(updateData, { extraction_status: 'PENDING' });
});
