const prisma = require('../../config/db');
const { executePaidApi } = require('../services/wallet.service');
const gstService = require('../services/externalApis/gst.service');
const documentService = require('../services/document.service');
const { extractGstDetails } = require('../services/financial.extractor');
const { determineNotificationRecipient } = require('../services/notification.service');


// Helper: extract latest + previous financial year turnover from raw GST JSON
function extractGstFySnapshot(rawGstData) {
    const result = { latest: null, previous: null, fy_latest: null, fy_previous: null };
    if (!rawGstData) return result;

    // Format 1: Overview_Monthly -> "Overview of GST Returns"
    const overviewRows = rawGstData?.Overview_Monthly?.['Overview of GST Returns'];

    if (Array.isArray(overviewRows)) {
        // Each row has "Month Year" like "Apr-2023", "May-2024" etc.
        // Group by financial year: Apr YYYY -> FY YYYY to YYYY+1
        const fyTotals = {};
        for (const row of overviewRows) {
            const monthYear = row['Month Year'];
            if (!monthYear || monthYear === 'Total') continue;

            // Parse month-year e.g. "Apr-2023"
            const parts = monthYear.split('-');
            if (parts.length !== 2) continue;
            const month = parts[0];
            const year = parseInt(parts[1], 10);
            if (!Number.isFinite(year)) continue;

            // Financial year: Apr-Mar. Apr-2023 belongs to FY 2023-24
            const fyStart = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].includes(month) ? year : year - 1;
            const fyKey = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;

            const sales = Number(row['Total Value of Sales (A)']) || 0;
            fyTotals[fyKey] = (fyTotals[fyKey] || 0) + sales;
        }

        const sortedFYs = Object.keys(fyTotals).sort().reverse(); // Latest first
        if (sortedFYs.length > 0) {
            result.fy_latest = sortedFYs[0];
            result.latest = fyTotals[sortedFYs[0]];
        }
        if (sortedFYs.length > 1) {
            result.fy_previous = sortedFYs[1];
            result.previous = fyTotals[sortedFYs[1]];
        }
    }

    // Format 2: Fallback from old Monthly Sales&Purchase format
    if (result.latest === null && Array.isArray(rawGstData?.data)) {
        const monthlyBlock = rawGstData.data.find(x => x['Monthly Sales&Purchase']);
        const rows = monthlyBlock?.['Monthly Sales&Purchase']
            ?.find(x => x['Monthly Sale Summary'])
            ?.['Monthly Sale Summary']
            ?.find(x => Array.isArray(x.data))?.data || [];

        const dataRows = rows.filter(x => !String(x.Month || '').toLowerCase().includes('total'));
        if (dataRows.length > 0) {
            const total = dataRows.reduce((s, r) => s + (Number(r['Taxable Value']) || 0), 0);
            result.latest = total;
            result.fy_latest = 'FY (aggregated)';
        }
    }

    return result;
}

async function createGstRequest(req, res) {
    try {
        const {
            customer_id,
            case_id,
            applicant_id,
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
            userRole: req.user.role,
            handlerFunction: async () => {

                let providerRes;
                let status = 'INITIATED';
                let authLink = null;
                let requestId = null;
                let message = '';

                if (mode === 'AUTH_LINK') {
                    // Signzy will ping the callback URL synchronously to verify reachability.
                    // If we pass http://localhost:5000, Signzy will hang trying to hit its own internal server loopback.
                    const isLocal = process.env.APP_BASE_URL && process.env.APP_BASE_URL.includes('localhost');
                    const callbackUrl = isLocal
                        ? "https://webhook.site/dummy-callback-for-localhost"
                        : process.env.APP_BASE_URL + "/api/v1/external/webhooks/signzy/gst";

                    const authLinkPayload = {
                        gstin,
                        fromDate: from_date,
                        toDate: to_date,
                        entityDetails: entity_details || false,
                        pdfUrl: pdf_url || false,
                        callbackUrl: callbackUrl,
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
                    const callbackUrl = process.env.APP_BASE_URL + "/api/v1/external/webhooks/signzy/gst";
                    const payload = {
                        gstin,
                        username,
                        fromDate: from_date,
                        toDate: to_date,
                        entityDetails: entity_details || false,
                        pdfUrl: pdf_url || false,
                        // callbackUrl: "https://client-specific.callback.url",
                        callbackUrl: callbackUrl,
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
                        applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
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
                        callback_url: mode === 'AUTH_LINK' || mode === 'IN_SYSTEM' ? (process.env.APP_BASE_URL + "/api/v1/external/webhooks/signzy/gst") : null,
                        provider_request_id: requestId,
                        auth_link: authLink,
                        status: status,
                        provider_message: message,
                        created_by_user_id: userId
                    }
                });

                if (case_id) {
                    await prisma.dataPullBackgroundJob.create({
                        data: {
                            tenant_id: tenantId,
                            case_id: parseInt(case_id, 10),
                            applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                            pull_type: 'GST',
                            module_request_id: dbRequest.id,
                            provider_request_id: requestId,
                            flow_type: mode === 'AUTH_LINK' ? 'GST_AUTH_LINK' : (auth_type === 'OTP' ? 'GST_OTP' : 'GST_PASSWORD'),
                            status: (auth_type === 'OTP' || mode === 'AUTH_LINK') ? 'AWAITING_CUSTOMER_ACTION' : 'PENDING',
                            next_run_at: new Date(Date.now() + 15 * 60000),
                            maximum_attempts: 3,
                            processing_deadline_at: new Date(Date.now() + 120 * 60000)
                        }
                    });
                }

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

        await prisma.dataPullBackgroundJob.updateMany({
            where: { 
                module_request_id: dbReq.id, 
                pull_type: 'GST', 
                flow_type: 'GST_OTP',
                status: 'AWAITING_CUSTOMER_ACTION'
            },
            data: { status: 'PENDING', next_run_at: new Date() }
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
                    
                    const updateData = { 
                        raw_fetch_data: dataRes, 
                        status: 'DATA_READY'
                    };
                    
                    await prisma.gstrAnalyticsRequest.update({
                        where: { id: dbReq.id },
                        data: updateData
                    });
                    dataSynced = true;
                }
            } catch (err) {
                // Ignore, maybe not ready
                console.error("Fetch Data Sync Error: ", err.message);
            }
        }

        // Fetch Report JSON links safely (triggered if status is terminal but documents are missing)
        if (['PROCESSING', 'DATA_READY', 'REPORT_READY'].includes(currentStatus)) {
            try {
                const reportRes = await gstService.fetchReport(dbReq.provider_request_id);
                if (reportRes.pdfUrl || reportRes.jsonDataUrl || reportRes.excelUrl) {
                    currentStatus = 'REPORT_READY';

                    // Ingest vendor report URLs into our storage (non-fatal if fails)
                    let pdfDocId = dbReq.gst_pdf_document_id;
                    let excelDocId = dbReq.gst_excel_document_id;
                    let jsonDocId = dbReq.gst_json_document_id;

                    const ingestionBase = {
                        tenantId: dbReq.tenant_id,
                        customerId: dbReq.customer_id,
                        caseId: dbReq.case_id,
                        uploadedByUserId: dbReq.created_by_user_id,
                        metadata: { gst_request_id: dbReq.id, gstin: dbReq.gstin, source: 'signzy_gst_sync' }
                    };

                    const gstIngestionJobs = [];
                    if (reportRes.pdfUrl && !pdfDocId) {
                        gstIngestionJobs.push(
                            documentService.ingestFromUrl({ ...ingestionBase, vendorUrl: reportRes.pdfUrl, documentType: 'GST_REPORT_PDF', originalFileName: `gst_report_${dbReq.gstin}.pdf` })
                                .then(doc => { pdfDocId = doc.id; })
                                .catch(e => console.error('[gst.controller] PDF ingestion failed:', e.message))
                        );
                    }
                    if (reportRes.excelUrl && !excelDocId) {
                        gstIngestionJobs.push(
                            documentService.ingestFromUrl({ ...ingestionBase, vendorUrl: reportRes.excelUrl, documentType: 'GST_REPORT_EXCEL', originalFileName: `gst_report_${dbReq.gstin}.xlsx` })
                                .then(doc => { excelDocId = doc.id; })
                                .catch(e => console.error('[gst.controller] Excel ingestion failed:', e.message))
                        );
                    }
                    if (reportRes.jsonDataUrl && !jsonDocId) {
                        gstIngestionJobs.push(
                            documentService.ingestFromUrl({ ...ingestionBase, vendorUrl: reportRes.jsonDataUrl, documentType: 'GST_REPORT_JSON', originalFileName: `gst_report_${dbReq.gstin}.json` })
                                .then(doc => { jsonDocId = doc.id; })
                                .catch(e => console.error('[gst.controller] JSON ingestion failed:', e.message))
                        );
                    }
                    await Promise.allSettled(gstIngestionJobs);

                    let rawReportData = undefined;
                    if (reportRes.jsonDataUrl) {
                        try {
                            const axios = require('axios');
                            const downloader = await axios.get(reportRes.jsonDataUrl);
                            rawReportData = downloader.data;
                        } catch (err) { console.error("[Sync] Failed to download JSON payload:", err.message); }
                    }

                    await prisma.gstrAnalyticsRequest.update({
                        where: { id: dbReq.id },
                        data: {
                            report_json_url: reportRes.jsonDataUrl || dbReq.report_json_url,   
                            report_excel_url: reportRes.excelUrl || dbReq.report_excel_url,   
                            report_pdf_url: reportRes.pdfUrl || dbReq.report_pdf_url,         
                            status: 'REPORT_READY',
                            provider_callback_payload: reportRes,
                            raw_report_data: rawReportData || undefined,
                            gst_pdf_document_id: pdfDocId || undefined,
                            gst_excel_document_id: excelDocId || undefined,
                            gst_json_document_id: jsonDocId || undefined,
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

                        // Extract ESR financials asynchronously
                        const { extractEsrFinancials } = require('../services/esrFinancials.service');
                        extractEsrFinancials(dbReq.case_id, dbReq.tenant_id).catch(err => console.error(err));
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
        
        if (dataSynced) {
            const { finalizeGstAnalyticsRequest } = require('../services/gst.service');
            await finalizeGstAnalyticsRequest(dbReq.id, dbReq.tenant_id).catch(e => console.error("Finalize error:", e.message));
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
        console.log("GST Webhook Payload: ", payload);
        // e.g., payload = { result: { requestId, status, ... } }
        const resultObj = payload.result || payload;

        const providerRequestId = resultObj.requestId;
        if (!providerRequestId) return res.status(400).json({ error: "Missing requestId in webhook payload" });

        let dbReq = await prisma.gstrAnalyticsRequest.findUnique({
            where: { provider_request_id: providerRequestId }
        });

        if (!dbReq) {
            // SECURITY FIX: Do NOT fallback to searching by status without tenant_id.
            // A missing provider_request_id mapping means this is an orphaned/late callback.
            // Acknowledge receipt to stop Signzy from retrying, but take no action.
            console.warn(`[GST Webhook] Unmapped provider_request_id: ${providerRequestId}. No DB record found. Ignoring safely.`);
            return res.status(200).send("OK");
        }

        if (dbReq.status === 'COMPLETED' || dbReq.status === 'REPORT_READY') {
            console.log(`[Webhook] Duplicate callback ignored for DB ID: ${dbReq.id}`);
            return res.status(200).send("OK");
        }

        const jUrl = resultObj.data?.jsonDataUrl || resultObj.jsonDataUrl;
        const pUrl = resultObj.data?.pdfUrl || resultObj.pdfUrl;
        const eUrl = resultObj.data?.excelUrl || resultObj.excelUrl;

        let rawReportData = dbReq.raw_report_data;
        let dataDownloaded = false;
        if (jUrl) {
            try {
                const axios = require('axios');
                const downloader = await axios.get(jUrl);
                rawReportData = downloader.data;
                dataDownloaded = true;
                console.log(`[Webhook] Successfully downloaded JSON data. Size: ${JSON.stringify(rawReportData).length} chars`);
            } catch (err) {
                console.error("[Webhook] Failed to download JSON payload:", err.message);
            }
        }

        const updateData = {
            provider_callback_payload: payload,
            status: 'CALLBACK_RECEIVED',
            provider_message: resultObj.message || 'Callback Received'
        };
        if (dataDownloaded) updateData.raw_report_data = rawReportData;

        if (jUrl || pUrl || eUrl) {
            updateData.report_json_url = jUrl || dbReq.report_json_url;
            updateData.report_pdf_url = pUrl || dbReq.report_pdf_url;
            updateData.report_excel_url = eUrl || dbReq.report_excel_url;
            updateData.status = 'REPORT_READY';
        } else if (resultObj.status === 'FAILED' || resultObj.message?.toLowerCase().includes('failed')) {
            updateData.status = 'FAILED';
        }

        await prisma.$transaction(async (tx) => {
            await tx.gstrAnalyticsRequest.update({
                where: { id: dbReq.id },
                data: updateData
            });

            if (updateData.status === 'REPORT_READY' || updateData.status === 'FAILED') {
                const termStatus = updateData.status === 'REPORT_READY' ? 'COMPLETED' : 'FAILED';
                
                await tx.dataPullBackgroundJob.updateMany({
                    where: { pull_type: 'GST', module_request_id: dbReq.id, status: { in: ['PENDING', 'PROCESSING', 'AWAITING_CUSTOMER_ACTION'] } },
                    data: { status: termStatus }
                });

                if (dbReq.case_id) {
                    const initiatorId = dbReq.created_by_user_id || null;
                    const { recipient_user_id, audience_type } = await determineNotificationRecipient(dbReq.tenant_id, dbReq.case_id, initiatorId);

                    const notification = await tx.systemNotification.create({
                        data: {
                            tenant_id: dbReq.tenant_id,
                            case_id: dbReq.case_id,
                            pull_type: 'GST',
                            status: termStatus,
                            audience_type: audience_type,
                            recipient_user_id: recipient_user_id,
                            message: `GST pull ${termStatus} via webhook`,
                            deduplication_key: `GST_${dbReq.id}_${termStatus}_webhook`
                        }
                    });
                    const pgPayload = { event_id: notification.id, tenant_id: dbReq.tenant_id, case_id: dbReq.case_id, pull_type: 'GST', status: termStatus };
                    await tx.$executeRawUnsafe(`SELECT pg_notify('case_status_updates', $1)`, JSON.stringify(pgPayload));
                }
            }
        });

        if (dataDownloaded || updateData.status === 'REPORT_READY') {
            const { finalizeGstAnalyticsRequest } = require('../services/gst.service');
            await finalizeGstAnalyticsRequest(dbReq.id, dbReq.tenant_id).catch(e => console.error("Finalize error:", e.message));
        }

        // Setup success cases
        if (updateData.status === 'REPORT_READY' && dbReq.case_id) {
            await prisma.caseDataPullStatus.upsert({
                where: { case_id: dbReq.case_id },
                create: { case_id: dbReq.case_id, gst_status: 'COMPLETE' },
                update: { gst_status: 'COMPLETE' }
            });
        }

        // Auto-extract ESR when report is entirely ready natively via Webhook!
        if (updateData.status === 'REPORT_READY' && dbReq.case_id) {
            try {
                const esrFinancialsService = require('../services/esrFinancials.service');
                await esrFinancialsService.extractEsrFinancials(dbReq.case_id, dbReq.tenant_id);
                console.log(`[Webhook] Triggered automated ESR Extraction for Case ID: ${dbReq.case_id}`);
            } catch (e) {
                console.error(`[Webhook] ESR Extraction error post-webhook:`, e);
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("Signzy GST Webhook Error:", error);
        return res.status(500).json({ error: "Internal processing error" });
    }
}

async function getRequestDetails(req, res) {
    try {
        const { case_id, applicant_id } = req.query;
        if (!case_id) return res.status(400).json({ error: "case_id required" });

        let whereClause = { case_id: parseInt(case_id, 10), tenant_id: req.user.tenant_id };
        if (applicant_id === 'null') {
            whereClause.applicant_id = null;
        } else if (applicant_id) {
            whereClause.applicant_id = parseInt(applicant_id, 10);
        }

        const requests = await prisma.gstrAnalyticsRequest.findMany({
            where: whereClause,
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
