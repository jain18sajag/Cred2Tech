const bureauController = require('./bureau.controller');

/**
 * Legacy endpoint (POST /api/external/bureau-pull, body-based) reconciled
 * onto the real, audited bureau flow (POST /api/verification/bureau/run/:caseId)
 * instead of maintaining a second, divergent implementation. Previously this
 * called a stub that returned `Math.floor(Math.random() * (850-300) + 300)`
 * and billed the wallet for it — see VAPT finding C-6. A case_id is now
 * required since a real bureau check needs case/applicant context (PAN,
 * mobile, DOB) that a bare customer_id doesn't carry.
 */
async function bureauPull(req, res) {
  const { case_id, applicant_id } = req.body;
  if (!case_id) {
    return res.status(400).json({ error: 'case_id is required for bureau verification.' });
  }
  req.params.caseId = case_id;
  if (applicant_id) req.body.applicantId = applicant_id;
  return bureauController.runBureauVerification(req, res);
}

module.exports = {
  bureauPull
};
