'use strict';

function isBulkUploadedCase(caseRecord, snapshot) {
  const notes = String(caseRecord?.dsa_notes || '').toUpperCase();
  const method = String(snapshot?.selected_income_method || '').toUpperCase();
  return notes.includes('[BULK UPLOAD]') || notes.includes('[LEGACY UPLOAD]') || method === 'ANY' || method === 'LEGACY_UPLOAD';
}

async function markEsrInputsChanged(tx, caseId, snapshotPatch = {}) {
  const [caseRecord, snapshot] = await Promise.all([
    tx.case.findUnique({ where: { id: caseId }, select: { dsa_notes: true } }),
    tx.caseEsrFinancials.findUnique({ where: { case_id: caseId }, select: { selected_income_method: true } })
  ]);

  const bulkUpload = isBulkUploadedCase(caseRecord, snapshot);
  await tx.caseEsrFinancials.updateMany({
    where: { case_id: caseId },
    data: {
      ...snapshotPatch,
      extraction_status: bulkUpload ? 'COMPLETED' : 'PENDING',
      ...(bulkUpload ? { extracted_at: new Date() } : {})
    }
  });
  return { bulkUpload };
}

module.exports = { isBulkUploadedCase, markEsrInputsChanged };
