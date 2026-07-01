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
        const result = await disbursementService.listPartialDisbursements(tenantId, req.user);
        res.json(result);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Error:', error);
        res.status(500).json({ error: 'Failed to fetch partial disbursements.' });
    }
}

const bulkDisbursementUploadService = require('../services/bulkDisbursementUpload.service');

async function downloadTemplate(req, res) {
    try {
        const buffer = await bulkDisbursementUploadService.generateTemplate();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="disbursement_upload_template.xlsx"');
        res.send(buffer);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Template Error:', error);
        res.status(500).json({ error: 'Failed to generate template' });
    }
}

async function uploadBulkDisbursements(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;
        
        const result = await bulkDisbursementUploadService.processUpload(req.file.buffer, tenantId, userId);
        res.json(result);
    } catch (error) {
        console.error('[DISBURSEMENT CONTROLLER] Upload Error:', error);
        res.status(400).json({ error: error.message });
    }
}

module.exports = {
    recordDisbursement,
    getCaseSummary,
    listPartialDisbursements,
    downloadTemplate,
    uploadBulkDisbursements
};
