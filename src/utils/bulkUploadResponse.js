function buildBulkUploadResponse(result, success, message) {
  const createdCases = (result.createdCaseRefs || []).map((createdCase) => {
    const esr = createdCase.esr || {};
    return {
      ...createdCase,
      esrGenerated: Boolean(esr.esrGenerated),
      eligibleLenderCount: esr.eligibleCount || 0,
      totalLenderCount: esr.totalLendersEvaluated || 0,
      finalLoanEligibility: esr.finalEligibleLoanAmount || 0,
      finalEligibilityStatus: esr.finalEligibilityStatus || (esr.esrGenerated ? 'Generated' : 'ESR_FAILED'),
      bestLender: esr.bestLender || null,
      bestScheme: esr.bestScheme || null,
      esrError: esr.error || null
    };
  });

  const esrGeneratedCases = createdCases.filter(c => c.esrGenerated).length;
  const esrFailedCases = createdCases.filter(c => !c.esrGenerated).length;

  return {
    success,
    message,
    summary: {
      totalRows: result.totalRows || 0,
      createdCases: result.createdCases || 0,
      failedRows: result.failedRows || 0,
      esrGeneratedCases,
      esrFailedCases
    },
    createdCases,
    errors: result.errors || []
  };
}

module.exports = { buildBulkUploadResponse };
