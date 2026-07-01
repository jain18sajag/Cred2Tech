const { generateAndSaveLoanApplicationSummary } = require('../services/reports/loanApplicationSummary.service');

async function generate(req, res) {
  try {
    const caseId = parseInt(req.params.caseId, 10);
    if (!caseId) return res.status(400).json({ error: 'Invalid case id.' });

    const result = await generateAndSaveLoanApplicationSummary({
      caseId,
      tenantId: req.user.tenant_id,
      user: req.user
    });

    res.status(201).json({
      success: true,
      caseId,
      fileName: result.fileName,
      filePath: result.storageKey,
      storageKey: result.storageKey,
      fileSizeBytes: result.sizeBytes,
      mimeType: result.mimeType,
      downloadUrl: result.downloadUrl
    });
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Case not found or unauthorized.') {
      return res.status(404).json({ error: 'Case not found or unauthorized.' });
    }
    console.error('[LoanApplicationSummary] Generate failed:', error);
    res.status(500).json({ error: 'Failed to generate Loan Application Summary.' });
  }
}

module.exports = {
  generate
};
