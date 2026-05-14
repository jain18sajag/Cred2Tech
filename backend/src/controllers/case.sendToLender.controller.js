// case.sendToLender.controller.js
// Handles: POST /api/cases/:id/send-to-lender
//          POST /api/cases/:id/send-to-other-lender

const prisma = require('../../config/db');
const { resolveContactForLender, resolveContactById } = require('../services/tenantLender.service');
const { dispatchProposalEmail } = require('../services/proposal.email.service');

const { cloneCaseForLender } = require('../services/case.clone.service');

// ── Shared: perform the dispatch + post-send updates ─────────────────────────
async function performSend({ caseId, tenantId, userId, contact, lenderName, loanAmount, productType }) {
  // 1. Clone Case
  const lenderSnapshot = {
    product_type: productType,
    lender_name: lenderName,
    platform_lender_id: contact.platform_lender_id || null,
    tenant_lender_id: contact.tenant_lender_id || null,
    contact_id: contact.id,
    dsa_code: contact.dsa_code || null,
    contact_name: contact.contact_name,
    contact_email: contact.contact_email,
    contact_mobile: contact.contact_mobile
  };

  const cloneResult = await cloneCaseForLender(caseId, tenantId, lenderSnapshot, userId);
  const childCaseId = cloneResult.case.id;

  if (cloneResult.isDuplicate) {
    return { isDuplicate: true, childCaseId };
  }

  // 2. Dispatch email + SMS using childCaseId (but with parent case data if needed, or child case since it's identical)
  const result = await dispatchProposalEmail({
    caseId: childCaseId, tenantId, userId, contact, lenderName, loanAmount
  });

  // 3. Update case stage and proposal tracking on CHILD case using centralized logic
  // The clone function already sets stage to LEAD_SENT_TO_LENDER and logs history,
  // but if dispatch fails we might want to log it. The clone function sets it initially.

  // 4. Insert activity log on CHILD case
  const description = result.emailSent
    ? `Proposal sent to ${lenderName} (${contact.contact_name} — ${contact.contact_email})`
    : `Proposal send attempted to ${lenderName} — email delivery failed`;

  await prisma.activityLog.create({
    data: {
      case_id: Number(childCaseId),
      activity_type: 'PROPOSAL_SENT',
      description,
      performed_by_user_id: Number(userId)
    }
  });

  return { isDuplicate: false, childCaseId, ...result };
}

// ── POST /api/cases/:id/send-to-lender ────────────────────────────────────────
async function sendToLender(req, res) {
  res.status(400).json({
    error: 'Direct send is deprecated. Please use the "Prepare Proposal" workflow for professional email submission.'
  });
}

// ── POST /api/cases/:id/send-to-other-lender ──────────────────────────────────
async function sendToOtherLender(req, res) {
  res.status(400).json({
    error: 'Direct send is deprecated. Please use the "Prepare Proposal" workflow for professional email submission.'
  });
}

module.exports = { sendToLender, sendToOtherLender };
