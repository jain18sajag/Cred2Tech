const prisma = require('../../config/db');
const { executePaidApi } = require('../services/wallet.service');
const gstService = require('../services/externalApis/gst.service');

async function createGstRequest(req, res) {
    try {
        const {
            customer_id,
            case_id,
            mode,
            auth_type,
            gstin,
            username,
            from_date,
            to_date,
            entity_details,
            pdf_url,
            emails,
            mobile_numbers
        } = req.body;

        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!gstin || !from_date || !to_date) {
            return res.status(400).json({ error: "Missing required basic fields: gstin, from_date, to_date" });
        }

        if (mode === 'IN_SYSTEM' && !username) {
            return res.status(400).json({ error: "Username is required for IN_SYSTEM mode" });
        }

        if (mode === 'IN_SYSTEM' && auth_type === 'PASSWORD' && !req.body.password) {
            return res.status(400).json({ error: "Password is required when auth_type is PASSWORD" });
        }

        // Use wallet wrapper (charging strictly once for the creation loop)
        const result = await executePaidApi({
            apiCode: 'GST_FETCH',
            tenantId: tenantId,
            userId: userId,
            customerId: parseInt(customer_id, 10),
            caseId: case_id ? parseInt(case_id, 10) : null,
            requestPayload: req.body,
            // Provide an idempotency key if we want to guard against rapid doubletaps for same case context. We can use customerId+gstin
            idempotencyKey: `gst_${customer_id}_${gstin}_${from_date}_${to_date}`,
            handlerFunction: async () => {

                let providerRes;
                let status = 'INITIATED';
                let authLink = null;
                let requestId = null;
                let message = '';
                
                if (mode === 'AUTH_LINK') {
                    const authLinkPayload = {
                        gstin,
                        fromDate: from_date,
                        toDate: to_date,
                        entityDetails: entity_details || false,
                        pdfUrl: pdf_url || false,
                        callbackUrl: "https://client-specific.callback.url",
                        emails: emails || [],
                        mobileNumbers: mobile_numbers || []
                    };
                    if (username) authLinkPayload.username = username;
                    
                    providerRes = await gstService.createAuthLink(authLinkPayload);
                    requestId = providerRes.requestId;
                    authLink = providerRes.authLink;
                    message = providerRes.message;
                    status = 'AUTH_LINK_CREATED';
                } else {
                    // IN_SYSTEM setup
                    const callbackUrl = process.env.APP_BASE_URL + "/api/webhooks/signzy/gst";
                    const payload = {
                        gstin,
                        username,
                        fromDate: from_date,
                        toDate: to_date,
                        entityDetails: entity_details || false,
                        pdfUrl: pdf_url || false,
                        callbackUrl: "https://client-specific.callback.url",
                        // callbackUrl: callbackUrl,
                        authType: auth_type
                    };
                    if (auth_type === 'PASSWORD') {
                        payload.password = req.body.password;
                    }

                    providerRes = await gstService.createRequest(payload);
                    requestId = providerRes.requestId;
                    message = providerRes.message;

                    if (auth_type === 'OTP') {
                        status = 'OTP_PENDING';
                    } else {
                        status = 'PROCESSING'; // Password goes natively to processing sync if no OTP needed.
                    }
                }

                // DB Insertion
                const dbRequest = await prisma.gstrAnalyticsRequest.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: parseInt(customer_id, 10),
                        case_id: case_id ? parseInt(case_id, 10) : null,
                        mode,
                        auth_type: auth_type || null,
                        gstin,
                        username,
                        from_date,
                        to_date,
                        entity_details: entity_details || false,
                        pdf_url_requested: pdf_url || false,
                        emails: emails || [],
                        mobile_numbers: mobile_numbers || [],
                        callback_url: mode === 'AUTH_LINK' || mode === 'IN_SYSTEM' ? (process.env.APP_BASE_URL + "/api/webhooks/signzy/gst") : null,
                        provider_request_id: requestId,
                        auth_link: authLink,
                        status: status,
                        provider_message: message,
                        created_by_user_id: userId
                    }
                });

                // Also sync to CustomerGSTProfile to initialize a ghost record mapped for legacy usages if desired, or skip.
                // Let's rely entirely on GstrAnalyticsRequest table as the golden source now.

                // We'll update the status on the Case metadata
                if (case_id) {
                    await prisma.caseDataPullStatus.upsert({
                        where: { case_id: parseInt(case_id, 10) },
                        create: { case_id: parseInt(case_id, 10), gst_status: 'PENDING' },
                        update: { gst_status: 'PENDING' }
                    });
                }

                return { dbId: dbRequest.id, requestId, authLink, status, message };
            }
        });

        res.json({ success: true, data: result });
    } catch (error) {
        if (error.status === 402) return res.status(402).json({ error: error.message });
        res.status(500).json({ error: error.message, status: "FAILED" });
    }
}

async function submitGstOtp(req, res) {
    try {
        const { request_id, otp } = req.body;
        const dbReq = await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: parseInt(request_id, 10), tenant_id: req.user.tenant_id }
        });

        if (!dbReq) return res.status(404).json({ error: 'GST Request not found' });
        if (!dbReq.provider_request_id) return res.status(400).json({ error: 'Missing provider mapping ID' });

        const providerRes = await gstService.submitOtp(dbReq.provider_request_id, otp);

        await prisma.gstrAnalyticsRequest.update({
            where: { id: dbReq.id },
            data: {
                status: 'PROCESSING',
                provider_message: providerRes.message,
                otp_attempts: { increment: 1 }
            }
        });

        res.json({ success: true, status: 'PROCESSING', message: providerRes.message });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
}

async function syncGstData(req, res) {
    try {
        const { request_id } = req.body;
        const dbReq = await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: parseInt(request_id, 10), tenant_id: req.user.tenant_id }
        });

        if (!dbReq) return res.status(404).json({ error: 'GST Request not found' });

        let currentStatus = dbReq.status;
        let dataSynced = false;

        // Fetch Data safely without re-billing (Data is raw payload)
        if (['PROCESSING', 'DATA_READY', 'REPORT_READY'].includes(currentStatus)) {
            try {
                const dataRes = await gstService.fetchData(dbReq.provider_request_id);
                // "message": "Request is in progress." vs actual data obj payload "gstr1"
                if (dataRes.status === "SUCCESS" && dataRes.message === "Request is in progress.") {
                    // Still processing
                } else if (dataRes.gstin) {
                    currentStatus = 'DATA_READY';
                    await prisma.gstrAnalyticsRequest.update({
                        where: { id: dbReq.id },
                        data: { raw_gst_data: dataRes }
                    });
                    dataSynced = true;
                }
            } catch (err) {
                // Ignore, maybe not ready
                console.error("Fetch Data Sync Error: ", err.message);
            }
        }

        // Fetch Report JSON links safely
        if (['PROCESSING', 'DATA_READY'].includes(currentStatus)) {
            try {
                const reportRes = await gstService.fetchReport(dbReq.provider_request_id);
                if (reportRes.status === 'SUCCESS' && reportRes.message === 'Completed') {
                    currentStatus = 'REPORT_READY';
                    await prisma.gstrAnalyticsRequest.update({
                        where: { id: dbReq.id },
                        data: {
                            report_json_url: reportRes.jsonUrl || dbReq.report_json_url,
                            report_excel_url: reportRes.excelUrl || dbReq.report_excel_url,
                            report_pdf_url: reportRes.pdfUrl || dbReq.report_pdf_url,
                            status: 'REPORT_READY'
                        }
                    });
                    dataSynced = true;

                    // Also set case to COMPLETE now
                    if (dbReq.case_id) {
                        await prisma.caseDataPullStatus.upsert({
                            where: { case_id: dbReq.case_id },
                            create: { case_id: dbReq.case_id, gst_status: 'COMPLETE' },
                            update: { gst_status: 'COMPLETE' }
                        });
                    }
                }
            } catch (err) {
                console.error("Fetch Report Sync Error: ", err.message);
            }
        }

        if (currentStatus !== dbReq.status) {
            await prisma.gstrAnalyticsRequest.update({
                where: { id: dbReq.id },
                data: { status: currentStatus }
            });
        }

        res.json({ success: true, status: currentStatus, dataSynced });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Webhook Receiver (No JWT verify)
async function handleSignzyCallback(req, res) {
    try {
        const payload = req.body;
        // e.g., payload = { result: { requestId, status, ... } }
        const resultObj = payload.result || payload;

        const providerRequestId = resultObj.requestId;
        if (!providerRequestId) return res.status(400).json({ error: "Missing requestId in webhook payload" });

        const dbReq = await prisma.gstrAnalyticsRequest.findUnique({
            where: { provider_request_id: providerRequestId }
        });

        if (!dbReq) {
            console.warn(`[Webhook] Unmapped GST Request: ${providerRequestId}`);
            return res.status(200).send("Unmapped but OK");
        }

        if (dbReq.status === 'COMPLETED' || dbReq.status === 'REPORT_READY') {
            console.log(`[Webhook] Duplicate callback ignored for DB ID: ${dbReq.id}`);
            return res.status(200).send("OK");
        }

        const updateData = {
            callback_payload: payload,
            status: 'CALLBACK_RECEIVED',
            provider_message: resultObj.message || 'Callback Received'
        };

        if (resultObj.jsonUrl || resultObj.pdfUrl || resultObj.excelUrl) {
            updateData.report_json_url = resultObj.jsonUrl || dbReq.report_json_url;
            updateData.report_pdf_url = resultObj.pdfUrl || dbReq.report_pdf_url;
            updateData.report_excel_url = resultObj.excelUrl || dbReq.report_excel_url;
            updateData.status = 'REPORT_READY';
        } else if (resultObj.status === 'FAILED' || resultObj.message?.toLowerCase().includes('failed')) {
            updateData.status = 'FAILED';
        }

        await prisma.gstrAnalyticsRequest.update({
            where: { id: dbReq.id },
            data: updateData
        });

        // Setup success cases
        if (updateData.status === 'REPORT_READY' && dbReq.case_id) {
            await prisma.caseDataPullStatus.upsert({
                where: { case_id: dbReq.case_id },
                create: { case_id: dbReq.case_id, gst_status: 'COMPLETE' },
                update: { gst_status: 'COMPLETE' }
            });
        }

        // Technically we could instantly trigger a syncGstData fetch here locally as an async detached job, but we'll let polling solve it

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("Signzy GST Webhook Error:", error);
        return res.status(500).json({ error: "Internal processing error" });
    }
}

async function getRequestDetails(req, res) {
    try {
        const { case_id } = req.query;
        if (!case_id) return res.status(400).json({ error: "case_id required" });

        const requests = await prisma.gstrAnalyticsRequest.findMany({
            where: { case_id: parseInt(case_id, 10), tenant_id: req.user.tenant_id },
            orderBy: { created_at: 'desc' }
        });

        res.json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    createGstRequest,
    submitGstOtp,
    syncGstData,
    handleSignzyCallback,
    getRequestDetails
};
