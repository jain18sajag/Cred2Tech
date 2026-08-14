const prisma = require('../../config/db');
const { assertCaseNotPurged } = require('../utils/casePurgeGuard');

async function requireCaseAccess(req, res, next) {
  try {
    // Determine the case ID from params, body, or query safely
    let caseId = req.params?.caseId || req.params?.id || req.body?.caseId || req.body?.case_id || req.query?.caseId || req.query?.case_id;

    if (!caseId) {
      // If there's no case ID in the request, this middleware isn't applicable, just pass through.
      return next();
    }

    caseId = parseInt(caseId, 10);
    if (isNaN(caseId)) {
      return res.status(400).json({ error: 'Invalid case ID format.' });
    }

    const { user } = req;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized. User not found in request.' });
    }

    const isBypassed = ['DSA_ADMIN', 'SUPER_ADMIN'].includes(user.role);
    // Distinct from isBypassed above: DSA_ADMIN bypasses hierarchy but is
    // still one specific tenant's admin and must stay tenant_id-scoped.
    // SUPER_ADMIN is the only role that's genuinely platform-wide (e.g. the
    // cross-tenant "Case Feedback" admin tab links into cases here).
    const isPlatformAdmin = user.role === 'SUPER_ADMIN';

    let msmeFilter = {};
    if (user.role === 'MSME_CUSTOMER') {
      msmeFilter = { msme_customer_user_id: user.id };
    }

    const hierarchyFilter = isBypassed ? {} : {
      OR: [
        {
          created_by: {
            hierarchy_path: { startsWith: user.hierarchy_path || '' }
          }
        },
        {
          assigned_dsa_user: {
            hierarchy_path: { startsWith: user.hierarchy_path || '' }
          }
        }
      ]
    };

    const filter = (user.role === 'MSME_CUSTOMER') ? msmeFilter : hierarchyFilter;

    // tenant_id scoping only makes sense for DSA-side hierarchy checks —
    // allocating a case to a DSA moves it into that DSA's own tenant (see
    // admin.direct.customer.controller.js#allocateDirectCase), so an MSME
    // customer's own case stops matching their signup tenant_id as soon as
    // it's allocated. msme_customer_user_id (already in msmeFilter) is the
    // ownership signal that survives that reassignment.
    const caseRecord = await prisma.case.findFirst({
      where: {
        id: caseId,
        ...(user.role === 'MSME_CUSTOMER' || isPlatformAdmin ? {} : { tenant_id: user.tenant_id }),
        ...filter
      },
      select: { id: true, data_purged_at: true }
    });

    if (!caseRecord) {
      return res.status(403).json({ error: 'Case not found or access denied due to permissions.' });
    }

    // Reads (GET) always stay allowed — a purged case must remain fully
    // viewable, only mutations are blocked. This single check covers every
    // route wired through this middleware (case.routes.js, onboarding.routes.js
    // — stage/applicant/product/document/income/obligation/ESR/proposal/
    // send-to-lender/sanction/disbursement/allocation mutations all funnel
    // through here) — see src/utils/casePurgeGuard.js.
    if (req.method !== 'GET') {
      assertCaseNotPurged(caseRecord);
    }

    req.verifiedCaseId = caseId;
    next();
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[requireCaseAccess] Error checking case access:', err);
    res.status(500).json({ error: 'Internal server error during access verification.' });
  }
}

module.exports = {
  requireCaseAccess
};
