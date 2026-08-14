const { manualPurgeCase, getCasePurgeStatus } = require('../services/purge/dataRetentionPurge.service');
const { hardDeleteCase } = require('../services/purge/hardDeleteCase.service');

async function getStatus(req, res) {
  try {
    const status = await getCasePurgeStatus(req.params.caseId);
    res.json(status);
  } catch (error) {
    console.error('adminPurge.getStatus error:', error);
    res.status(500).json({ error: 'Failed to fetch case purge status' });
  }
}

async function purgeCase(req, res) {
  const { reason } = req.body || {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required to raise a manual purge request.' });
  }
  try {
    const result = await manualPurgeCase({
      caseId: req.params.caseId,
      triggeredByUserId: req.user.id,
      reason: String(reason).trim(),
    });
    res.json(result);
  } catch (error) {
    console.error('adminPurge.purgeCase error:', error);
    const statusCode = /not found/i.test(error.message) ? 404 : 500;
    res.status(statusCode).json({ error: error.message || 'Failed to purge case data' });
  }
}

async function hardDeleteCaseHandler(req, res) {
  const { reason, confirmCaseId } = req.body || {};
  const caseId = req.params.caseId;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required to permanently delete a case.' });
  }
  // Defense in depth — the frontend's type-to-confirm dialog already enforces
  // this, but a destructive, irreversible endpoint should never trust the
  // client alone to have gotten the confirmation UX right.
  if (String(confirmCaseId) !== String(caseId)) {
    return res.status(400).json({ error: 'Case ID confirmation does not match.' });
  }
  try {
    const result = await hardDeleteCase({
      caseId,
      triggeredByUserId: req.user.id,
      reason: String(reason).trim(),
    });
    res.json(result);
  } catch (error) {
    console.error('adminPurge.hardDeleteCase error:', error);
    const statusCode = error.statusCode || (/not found/i.test(error.message) ? 404 : 500);
    res.status(statusCode).json({ error: error.message || 'Failed to permanently delete case' });
  }
}

module.exports = { getStatus, purgeCase, hardDeleteCase: hardDeleteCaseHandler };
