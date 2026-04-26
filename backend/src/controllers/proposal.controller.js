// proposal.controller.js
const proposalService = require('../services/proposal.service');

async function create(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const { lender_id, scheme_id } = req.body;
        if (!lender_id) return res.status(400).json({ error: 'lender_id is required' });

        const proposal = await proposalService.createProposalDraft({
            case_id,
            lender_id,
            scheme_id: scheme_id ? parseInt(scheme_id, 10) : null,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
        });

        res.status(201).json({ success: true, proposal });
    } catch (err) {
        console.error('[Proposal] create error:', err.message);
        res.status(500).json({ error: err.message });
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
        console.error('[Proposal] listAll error:', err.message);
        res.status(500).json({ error: err.message });
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
        console.error('[Proposal] getOne error:', err.message);
        const status = err.message.includes('not found') ? 404 : 500;
        res.status(status).json({ error: err.message });
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
            fields: req.body,
        });
        res.json({ success: true, proposal: updated });
    } catch (err) {
        console.error('[Proposal] update error:', err.message);
        res.status(400).json({ error: err.message });
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
        console.error('[Proposal] attachDocs error:', err.message);
        res.status(500).json({ error: err.message });
    }
}

async function detachDoc(req, res) {
    try {
        const proposal_id = parseInt(req.params.pid, 10);
        const document_id = parseInt(req.params.docId, 10);
        await proposalService.detachDocumentFromProposal({
            proposal_id,
            document_id,
            tenant_id: req.user.tenant_id,
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[Proposal] detachDoc error:', err.message);
        res.status(500).json({ error: err.message });
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
        res.status(err.message.includes('already submitted') ? 409 : 500).json({ error: err.message });
    }
}

async function clone(req, res) {
    try {
        const case_id = parseInt(req.params.id, 10);
        const proposal_id = parseInt(req.params.pid, 10);
        const { new_lender_id, new_scheme_id } = req.body;
        if (!new_lender_id) return res.status(400).json({ error: 'new_lender_id is required' });

        const cloned = await proposalService.cloneProposalForLender({
            proposal_id,
            new_lender_id,
            new_scheme_id: new_scheme_id ? parseInt(new_scheme_id, 10) : null,
            user_id: req.user.id,
            tenant_id: req.user.tenant_id,
        });
        res.status(201).json({ success: true, proposal: cloned });
    } catch (err) {
        console.error('[Proposal] clone error:', err.message);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { create, listAll, getOne, update, attachDocs, detachDoc, submit, clone };
