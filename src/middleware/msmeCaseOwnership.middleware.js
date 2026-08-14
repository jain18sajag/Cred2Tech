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
    // Deliberately NOT scoped by tenant_id: allocating a case to a DSA moves
    // it into that DSA's own tenant (see admin.direct.customer.controller.js
    // #allocateDirectCase), which no longer matches the MSME customer's own
    // signup tenant. msme_customer_user_id is the field that actually tracks
    // ownership across that reassignment — the same field getDashboard/
    // getCases already filter on with no tenant_id constraint — so this must
    // match that, not re-add a tenant check that breaks as soon as a case is
    // allocated.
    const existingCase = await prisma.case.findFirst({
      where: { id: parseInt(caseId, 10) }
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
