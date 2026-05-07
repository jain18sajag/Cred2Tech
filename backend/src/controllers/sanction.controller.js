const sanctionService = require('../services/sanction.service');

async function sanctionCase(req, res) {
    try {
        const caseId = parseInt(req.params.id, 10);
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;
        const payload = req.body;

        // Basic validation
        const requiredFields = ['loan_account_number', 'sanction_date', 'sanctioned_amount', 'confirmed_roi', 'lender_name', 'product_type'];
        for (const field of requiredFields) {
            if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
                return res.status(400).json({ error: `${field} is required.` });
            }
        }

        const result = await sanctionService.sanctionCase(caseId, tenantId, payload, userId);
        res.status(200).json(result);
    } catch (error) {
        console.error('[SANCTION CONTROLLER] Error:', error);
        const status = error.message.includes('not found') ? 404 : 400;
        res.status(status).json({ error: error.message });
    }
}

module.exports = {
    sanctionCase
};
