// case.sendToLender.controller.js
// Handles: POST /api/cases/:id/send-to-lender
//          POST /api/cases/:id/send-to-other-lender
//
// Restored — these used to call a standalone ad-hoc dispatcher (old
// performSend) that cloned the case and emailed a hand-picked contact
// directly, with no Proposal record involved. That dispatcher's own
// dependency (proposal.email.service's old dispatchProposalEmail(caseId,
// contact, ...)) was removed when the Prepare-Proposal workflow shipped,
// replaced by dispatchProposalEmailByProposalId(proposalId, ...) — which only
// knows how to email FROM an existing Proposal (and requires it to have at
// least one attached document). Rather than resurrect the old ad-hoc path
// against a function that no longer exists (which is why these two routes
// were stubbed to a "deprecated" error instead), both routes now auto-create
// (or reuse) a Proposal for the resolved lender contact — createProposalDraft
// already auto-attaches every active case document — then dispatch through
// the exact same professional-email pipeline proposal.controller.js's own
// `send` endpoint uses. The "Send" / "Send to Other Lender" buttons keep
// working the same way from the DSA's point of view; they just go through
// the real proposal pipeline under the hood instead of a parallel one.

const prisma = require('../../config/db');
const { resolveContactForLender, resolveContactById } = require('../services/tenantLender.service');
const { dispatchProposalEmailByProposalId } = require('../services/proposal.email.service');
const { createProposalDraft, submitProposal } = require('../services/proposal.service');

// ── Shared: find-or-create a Proposal for this contact, then dispatch ────────
async function performSend({ caseId, tenantId, userId, contact }) {
  // Reuse an existing not-yet-submitted proposal for this exact lender contact
  // instead of creating a fresh one on every click — the lender card's own UI
  // already hides these buttons once a proposal exists, but this guards
  // against a stale render / double-click creating duplicates regardless.
  let proposal = contact.tenant_lender_id
    ? await prisma.proposal.findFirst({
        where: {
          case_id: Number(caseId),
          tenant_id: Number(tenantId),
          tenant_lender_id: Number(contact.tenant_lender_id),
          proposal_status: { not: 'submitted' },
        },
        orderBy: { created_at: 'desc' },
      })
    : null;

  if (!proposal) {
    // contact.platform_lender_id (joined from tenant_lenders — see
    // resolveContactForLender/resolveContactById) lets createProposalDraft
    // find this lender's EligibilityReportLender row and prefill
    // tenure_months/roi/eligible_amount from the actual ESR result. Passing
    // null here (as before) silently skipped all of that, leaving the
    // proposal's tenure blank no matter what the ESR had computed.
    proposal = await createProposalDraft({
      case_id: caseId,
      lender_id: contact.platform_lender_id || null,
      tenant_lender_id: contact.tenant_lender_id || null,
      scheme_id: null,
      user_id: userId,
      tenant_id: tenantId,
    });
  }

  const dispatchResult = await dispatchProposalEmailByProposalId({
    proposalId: proposal.id,
    tenantId,
    userId,
    contactId: contact.id,
  });

  await submitProposal({
    proposal_id: proposal.id,
    case_id: caseId,
    user_id: userId,
    tenant_id: tenantId,
    snapshot: dispatchResult,
  });

  // Shape matches what the frontend's SendConfirmationModal already renders
  // (result.to / contact_name / subject / body_preview / sms) — no frontend
  // change needed. `sms` is intentionally omitted: the new dispatcher fires
  // the SMS without returning a confirmation payload for it, and the modal's
  // SMS section is already conditional on `result.sms?.smsSent`.
  return {
    ...dispatchResult,
    proposalId: proposal.id,
    body_preview: dispatchResult.bodyText,
  };
}

// ── POST /api/cases/:id/send-to-lender ────────────────────────────────────────
// Resolves contact automatically from tenant config using lender_name + product_type.
async function sendToLender(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { lender_name } = req.body;

    if (!lender_name) return res.status(400).json({ error: 'lender_name is required' });

    const caseEntity = await prisma.case.findFirst({
      where: { id: Number(caseId), tenant_id: Number(tenantId) },
      select: { id: true, product_type: true },
    });
    if (!caseEntity) return res.status(404).json({ error: 'Case not found' });
    if (!caseEntity.product_type) return res.status(400).json({ error: 'Case does not have a product type' });

    const contact = await resolveContactForLender({ tenantId, lenderName: lender_name, productType: caseEntity.product_type });
    if (!contact) {
      return res.status(404).json({
        error: 'No contact configured for this lender/product. Please configure contact in Lender Contacts.',
        redirect_hint: '/settings/lender-contacts',
      });
    }

    const result = await performSend({ caseId, tenantId, userId, contact });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[sendToLender] error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to send proposal' });
  }
}

// ── POST /api/cases/:id/send-to-other-lender ─────────────────────────────────
// User manually selects from tenant's configured lenders in the modal.
async function sendToOtherLender(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { contact_id } = req.body;

    if (!contact_id) return res.status(400).json({ error: 'contact_id is required' });

    const caseEntity = await prisma.case.findFirst({
      where: { id: Number(caseId), tenant_id: Number(tenantId) },
      select: { id: true, product_type: true },
    });
    if (!caseEntity) return res.status(404).json({ error: 'Case not found' });
    if (!caseEntity.product_type) return res.status(400).json({ error: 'Case does not have a product type' });

    const contact = await resolveContactById(parseInt(contact_id, 10), tenantId);
    if (!contact) return res.status(404).json({ error: 'Contact not found or not accessible' });

    const result = await performSend({ caseId, tenantId, userId, contact });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[sendToOtherLender] error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to send proposal' });
  }
}

module.exports = { sendToLender, sendToOtherLender };
