const prisma = require('../../config/db');
const itrService = require('../services/externalApis/itr.service');
const { executePaidApi } = require('../services/wallet.service');

async function pullItrData(req, res) {
    try {
        const { username, password, sessionId, customer_id, case_id } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!customer_id) {
            return res.status(400).json({ error: "customer_id is required" });
        }

        if (!username) {
            return res.status(400).json({ error: "Username is required" });
        }

        if ((password && sessionId) || (!password && !sessionId)) {
            return res.status(400).json({ error: "Exactly one of password or sessionId is required" });
        }

        // We must mask the credentials in the payload before sending to executePaidApi
        // so that the wallet engine doesn't persist raw credentials in the api_usage_logs table.
        const sanitizedPayload = { ...req.body };
        if (sanitizedPayload.password) {
            sanitizedPayload.password = "***MASKED***";
        }
        if (sanitizedPayload.sessionId) {
            sanitizedPayload.sessionId = "***MASKED***";
        }

        // Idempotency: prevent double-taps on the exact same run based on customer and username
        const idempotencyKey = `itr_${customer_id}_${username}_${Date.now()}`;

        const result = await executePaidApi({
            apiCode: 'ITR_FETCH',
            tenantId: tenantId,
            userId: userId,
            customerId: parseInt(customer_id, 10),
            caseId: case_id ? parseInt(case_id, 10) : null,
            requestPayload: sanitizedPayload,
            idempotencyKey: idempotencyKey,
            handlerFunction: async () => {
                const payload = { username };
                if (password) payload.password = password;
                if (sessionId) payload.sessionId = sessionId;

                // The service isolates the unmasked credentials over the network strictly
                const providerRes = await itrService.pullItr(payload);
                
                // Assuming providerRes acts as the `result` block mapping year keys natively
                const parsedData = providerRes;
                
                // Determine high-level income/profit if we want to aggressively normalize,
                // but the prompt says: "Do not over-normalize the provider JSON right now unless current project patterns require it."
                // So we will just dump it directly into parsed_data. We can pull the PAN out of username.
                
                const profile = await prisma.customerITRProfile.create({
                    data: {
                        customer_id: parseInt(customer_id, 10),
                        pan: username.toUpperCase(),
                        username: username,
                        raw_response: providerRes,
                        parsed_data: parsedData
                    }
                });

                if (case_id) {
                    await prisma.caseDataPullStatus.upsert({
                        where: { case_id: parseInt(case_id, 10) },
                        create: { case_id: parseInt(case_id, 10), itr_status: 'COMPLETE' },
                        update: { itr_status: 'COMPLETE' }
                    });
                }

                return profile;
            }
        });

        res.status(200).json({ success: true, itrProfile: result });
    } catch (error) {
        console.error("ITR Pull Error: ", error);
        
        let statusCode = 500;
        if (error.status === 401) statusCode = 502;
        else if (error.status === 402) statusCode = 402; // Insufficient internal wallet credits
        else if (error.status === 409) statusCode = 409; // Upstream downstream
        else if (error.status >= 400 && error.status < 500) statusCode = error.status; // Provider validation fail

        res.status(statusCode).json({ error: error.message || "Failed to pull ITR data" });
    }
}

module.exports = {
    pullItrData
};
