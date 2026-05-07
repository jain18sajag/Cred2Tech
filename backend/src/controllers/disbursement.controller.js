const disbursementService = require('../services/disbursement.service');

async function recordDisbursement(req, res) {
    try {
        const caseId = parseInt(req.params.id, 10);
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;
        const payload = req.body;
        const idempotencyKey = req.headers['idempotency-key'];

        if (!payload.amount || !payload.disbursement_date) {
            return res.status(400).json({ error: 'amount and disbursement_date are required.' });
        }

        const result = await disbursementService.recordDisbursement(caseId, tenantId, payload, userId, idempotencyKey);
        res.status(201).json(result);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Error:', error);
        res.status(400).json({ error: error.message });
    }
}

async function getCaseSummary(req, res) {
    try {
        const caseId = parseInt(req.params.id, 10);
        const tenantId = req.user.tenant_id;
        const result = await disbursementService.getCaseDisbursementSummary(caseId, tenantId);
        res.json(result);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Error:', error);
        res.status(404).json({ error: error.message });
    }
}

async function listPartialDisbursements(req, res) {
    try {
        const tenantId = req.user.tenant_id;
        const result = await disbursementService.listPartialDisbursements(tenantId);
        res.json(result);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Error:', error);
        res.status(500).json({ error: 'Failed to fetch partial disbursements.' });
    }
}

module.exports = {
    recordDisbursement,
    getCaseSummary,
    listPartialDisbursements
};
