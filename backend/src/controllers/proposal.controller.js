// proposal.controller.js
const proposalService = require('../services/proposal.service');
const { sendCaughtError } = require('../utils/sendError');

async function create(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const { lender_id, tenant_lender_id, scheme_id, other_lender } = req.body;

        // At least one must be provided
        if (!lender_id && !tenant_lender_id && !other_lender) {
            return res.status(400).json({ error: 'lender_id, tenant_lender_id, or other_lender is required' });
        }

        const proposal = await proposalService.createProposalDraft({
            case_id,
            lender_id,
            tenant_lender_id: tenant_lender_id ? parseInt(tenant_lender_id, 10) : null,
            scheme_id: scheme_id ? parseInt(scheme_id, 10) : null,
            other_lender,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
        });

        res.status(201).json({ success: true, proposal });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to create proposal', 500);
    }
}

async function listAll(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposals = await proposalService.listProposalsForCase({
            case_id,
            tenant_id: req.user.tenant_id,
        });
        res.json({ success: true, proposals });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to list proposals', 500);
    }
}

async function getOne(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const data = await proposalService.getProposalForPrep({
            proposal_id,
            case_id,
            tenant_id: req.user.tenant_id,
        });
        res.json({ success: true, ...data });
    } catch (err) {
        if (err.name === 'Error') {
            const status = err.message.includes('not found') ? 404 : 500;
            return res.status(status).json({ error: err.message });
        }
        sendCaughtError(res, err, 'Failed to fetch proposal', 500);
    }
}

async function update(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const updated = await proposalService.updateProposalDraft({
            proposal_id,
            case_id,
            tenant_id: req.user.tenant_id,
            user_id: req.user.id,
            user_role: req.user.role,
            fields: req.body,
        });
        res.json({ success: true, proposal: updated });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to update proposal');
    }
}

async function attachDocs(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const { document_ids } = req.body;
        if (!Array.isArray(document_ids) || document_ids.length === 0) {
            return res.status(400).json({ error: 'document_ids array is required' });
        }
        const docs = await proposalService.attachDocumentsToProposal({
            proposal_id,
            case_id,
            tenant_id: req.user.tenant_id,
            document_ids: document_ids.map(Number),
        });
        res.json({ success: true, documents: docs });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to attach documents to proposal', 500);
    }
}

async function detachDoc(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const document_id = parseInt(req.params.docId, 10);
        const result = await proposalService.detachDocumentFromProposal({
            proposal_id,
            document_id,
            case_id,
            tenant_id: req.user.tenant_id,
        });
        if (!result.success) {
            return res.status(404).json({ error: 'Proposal document not found' });
        }
        res.json({ success: true });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to detach document from proposal', 500);
    }
}

async function submit(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const result = await proposalService.submitProposal({
            proposal_id,
            case_id,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
        });
        res.json(result);
    } catch (err) {
        console.error('[Proposal] submit error:', err.message);
        if (err.name === 'Error') {
            return res.status(err.message.includes('already submitted') ? 409 : 500).json({ error: err.message });
        }
        sendCaughtError(res, err, 'Failed to submit proposal', 500);
    }
}

async function send(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);

        // dispatchProposalEmailByProposalId is the new orchestrator
        const { dispatchProposalEmailByProposalId } = require('../services/proposal.email.service');

        const result = await dispatchProposalEmailByProposalId({
            proposalId: proposal_id,
            tenantId: req.user.tenant_id,
            userId: req.user.id,
            contactId: req.body.contact_id
        });

        // After successful dispatch, mark as submitted if not already
        await proposalService.submitProposal({
            proposal_id,
            case_id,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
            snapshot: result // Save the snapshot of what was sent
        });

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Proposal] send error:', err.message);
        res.status(500).json({ error: 'Failed to send proposal.' });
    }
}

async function clone(req, res) {
    console.log('[Proposal] Clone API Hit:', { params: req.params, body: req.body });
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const { new_lender_id, new_tenant_lender_id, other_lender } = req.body;

        if (!new_lender_id && !new_tenant_lender_id && !other_lender) {
            return res.status(400).json({ error: 'new_lender_id, new_tenant_lender_id, or other_lender is required' });
        }

        const cloned = await proposalService.cloneProposalForLender({
            source_id: proposal_id,
            new_lender_id,
            new_tenant_lender_id: new_tenant_lender_id ? parseInt(new_tenant_lender_id, 10) : null,
            other_lender,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
        });
        res.status(201).json({ success: true, proposal: cloned });
    } catch (err) {
        sendCaughtError(res, err, 'Failed to clone proposal', 500);
    }
}

module.exports = { create, listAll, getOne, update, attachDocs, detachDoc, submit, send, clone };
