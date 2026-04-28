// case.sendToLender.controller.js
// Handles: POST /api/cases/:id/send-to-lender
//          POST /api/cases/:id/send-to-other-lender

const prisma = require('../../config/db');
const { resolveContactForLender, resolveContactById } = require('../services/tenantLender.service');
const { dispatchProposalEmail }                       = require('../services/proposal.email.service');

// ── Shared: perform the dispatch + post-send updates ─────────────────────────
async function performSend({ caseId, tenantId, userId, contact, lenderName, loanAmount }) {
  // 1. Dispatch email + SMS
  const result = await dispatchProposalEmail({
    caseId, tenantId, userId, contact, lenderName, loanAmount
  });

  // 2. Update case stage and proposal tracking
  await prisma.$executeRawUnsafe(`
    UPDATE cases
    SET stage = 'LEAD_SENT_TO_LENDER',
        proposal_sent_at = NOW(),
        proposal_sent_by_user_id = $1,
        updated_at = NOW()
    WHERE id = $2 AND tenant_id = $3
  `, userId, caseId, tenantId);

  // 3. Insert activity log
  const description = result.emailSent
    ? `Proposal sent to ${lenderName} (${contact.contact_name} — ${contact.contact_email})`
    : `Proposal send attempted to ${lenderName} — email delivery failed`;

  await prisma.$executeRawUnsafe(`
    INSERT INTO activity_logs (case_id, activity_type, description, performed_by_user_id, created_at)
    VALUES ($1, 'PROPOSAL_SENT', $2, $3, NOW())
  `, caseId, description, userId);

  return result;
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
    if (!product_type) return res.status(400).json({ error: 'product_type is required' });

    // Verify case belongs to tenant
    const caseRows = await prisma.$queryRawUnsafe(
      `SELECT id, loan_amount FROM cases WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      caseId, tenantId
    );
    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

    // Resolve contact
    const contact = await resolveContactForLender({ tenantId, lenderName: lender_name, productType: product_type });
    if (!contact) {
      return res.status(404).json({
        error: `No contact configured for lender "${lender_name}" / product "${product_type}". Please add one in Settings → Lender Contacts.`,
        redirect_hint: '/settings/lender-contacts',
      });
    }

    const result = await performSend({
      caseId,
      tenantId,
      userId,
      contact,
      lenderName: lender_name,
      loanAmount: loan_amount || caseRows[0].loan_amount,
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
    const caseRows = await prisma.$queryRawUnsafe(
      `SELECT id, loan_amount FROM cases WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      caseId, tenantId
    );
    if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

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
      loanAmount: loan_amount || caseRows[0].loan_amount,
    });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error('[sendToOtherLender] error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { sendToLender, sendToOtherLender };
