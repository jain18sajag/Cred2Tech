// case.sendToLender.controller.js
// Handles: POST /api/cases/:id/send-to-lender
//          POST /api/cases/:id/send-to-other-lender

const prisma = require('../../config/db');
const { resolveContactForLender, resolveContactById } = require('../services/tenantLender.service');
const { dispatchProposalEmail }                       = require('../services/proposal.email.service');

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
// Resolves contact automatically from tenant config using lender_name + product_type.
async function sendToLender(req, res) {
  try {
    const caseId    = parseInt(req.params.id);
    const tenantId  = req.user.tenant_id;
    const userId    = req.user.id;
    const { lender_name, product_type, loan_amount } = req.body;

    if (!lender_name)  return res.status(400).json({ error: 'lender_name is required' });

    // Verify case belongs to tenant
    const caseEntity = await prisma.case.findFirst({
      where: {
        id: Number(caseId),
        tenant_id: Number(tenantId)
      },
      select: { id: true, loan_amount: true, product_type: true }
    });
    if (!caseEntity) return res.status(404).json({ error: 'Case not found' });
    if (!caseEntity.product_type) return res.status(400).json({ error: 'Case does not have a product type' });

    // Resolve contact using CASE product type
    const contact = await resolveContactForLender({ tenantId, lenderName: lender_name, productType: caseEntity.product_type });
    if (!contact) {
      return res.status(404).json({
        error: `No contact configured for this lender/product. Please configure contact in Lender Contacts.`,
        redirect_hint: '/settings/lender-contacts',
      });
    }

    const result = await performSend({
      caseId,
      tenantId,
      userId,
      contact,
      lenderName: lender_name,
      loanAmount: loan_amount || caseEntity.loan_amount,
      productType: caseEntity.product_type
    });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[sendToLender] error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ── POST /api/cases/:id/send-to-other-lender ─────────────────────────────────
// User manually selects from tenant's configured lenders in the modal.
async function sendToOtherLender(req, res) {
  try {
    const caseId   = parseInt(req.params.id);
    const tenantId = req.user.tenant_id;
    const userId   = req.user.id;
    const { contact_id, loan_amount } = req.body;

    if (!contact_id) return res.status(400).json({ error: 'contact_id is required' });

    // Verify case
    const caseEntity = await prisma.case.findFirst({
      where: {
        id: Number(caseId),
        tenant_id: Number(tenantId)
      },
      select: { id: true, loan_amount: true, product_type: true }
    });
    if (!caseEntity) return res.status(404).json({ error: 'Case not found' });
    if (!caseEntity.product_type) return res.status(400).json({ error: 'Case does not have a product type' });

    // Resolve contact (tenant-scoped)
    const contact = await resolveContactById(parseInt(contact_id), tenantId);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found or not accessible' });
    }

    const result = await performSend({
      caseId,
      tenantId,
      userId,
      contact,
      lenderName: contact.lender_name,
      loanAmount: loan_amount || caseEntity.loan_amount,
      productType: caseEntity.product_type
    });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[sendToOtherLender] error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { sendToLender, sendToOtherLender };
