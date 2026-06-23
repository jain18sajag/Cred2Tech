const prisma = require('../../config/db');

async function enforceMsmeCaseOwnership(req, res, next) {
  if (req.user.role !== 'MSME_CUSTOMER') {
    return next(); // non-MSME users rely on existing hierarchy checks
  }

  // Find the case id from params, body, or query
  let caseId = req.params?.id || req.params?.caseId || req.body?.case_id || req.query?.case_id;
  
  if (!caseId && req.body?.report?.case_id) caseId = req.body.report.case_id;

  if (!caseId) {
    // Some routes like /cases/new or /cases?pipeline don't have a specific case ID
    // If it's a GET /cases (pipeline), we should intercept the controller instead.
    // We'll let the controller or service layer handle it if caseId is missing.
    return next();
  }

  try {
    const existingCase = await prisma.case.findFirst({
      where: { id: parseInt(caseId, 10), tenant_id: req.user.tenant_id }
    });

    if (!existingCase) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (existingCase.msme_customer_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to access this case' });
    }

    next();
  } catch (error) {
    console.error('Enforce ownership error:', error);
    return res.status(500).json({ error: 'Internal server error checking case ownership' });
  }
}

module.exports = enforceMsmeCaseOwnership;
