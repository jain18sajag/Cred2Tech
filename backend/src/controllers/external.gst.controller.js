const prisma = require('../../config/db');
const { executePaidApi } = require('../services/wallet.service');
const gstService = require('../services/externalApis/gst.service');
const documentService = require('../services/document.service');
const { extractGstDetails } = require('../services/financial.extractor');
const { determineNotificationRecipient } = require('../services/notification.service');
const { safeGet } = require('../utils/ssrf');
const { generateWebhookToken, appendWebhookToken, verifyWebhookToken } = require('../utils/webhookToken');
const { sendCaughtError } = require('../utils/sendError');
const pullSync = require('../services/pullSync.service');
const { notifyCasePullUpdate } = require('../services/socket.service');
const { getBestUsableGstSnapshot } = require('../services/gstAnalyticsSnapshot.service');


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

        // AUTH_LINK needs someone to actually deliver the link to — Signzy sends it to
        // whatever's in emails/mobileNumbers, so an empty payload here means the link
        // is generated but never reaches the customer (or Signzy rejects it outright).
        if (mode === 'AUTH_LINK') {
            const hasEmail = Array.isArray(emails) && emails.some(e => e && e.trim());
            const hasMobile = Array.isArray(mobile_numbers) && mobile_numbers.some(m => m && m.trim());
            if (!hasEmail && !hasMobile) {
                return res.status(400).json({ error: "Enter at least one customer email or mobile number to send the auth link to" });
            }
        }

        // Use wallet wrapper (charging strictly once for the creation loop)
        const result = await executePaidApi({
            apiCode: 'GST_FETCH',
            tenantId: tenantId,
            userId: userId,
            customerId: parseInt(customer_id, 10),
            caseId: case_id ? parseInt(case_id, 10) : null,
            requestPayload: req.body,
            // Guards against rapid double-taps only (not a permanent per-GSTIN lock):
            // from_date/to_date are a fixed rolling window computed once at server
            // startup, so without the time bucket this key never changes for a given
            // customer+gstin — every later legitimate resubmission (retry, retry after
            // cancelling, a deliberate second pull) would silently replay the FIRST
            // request's cached result via executePaidApi's idempotency check instead
            // of actually running again. A 5s bucket still catches genuine doubletaps
            // (two near-simultaneous clicks) while letting real retries through.
            idempotencyKey: `gst_${customer_id}_${gstin}_${from_date}_${to_date}_${Math.floor(Date.now() / 5000)}`,
            userRole: req.user.role,
            handlerFunction: async () => {

                let providerRes;
                let status = 'INITIATED';
                let authLink = null;
                let requestId = null;
                let message = '';
                // Generated before we know Signzy's requestId, so it has to be an
                // opaque secret we mint ourselves rather than derived from the ID.
                const webhookToken = generateWebhookToken();

                if (mode === 'AUTH_LINK') {
                    // Signzy will ping the callback URL synchronously to verify reachability.
                    // If we pass http://localhost:5000, Signzy will hang trying to hit its own internal server loopback.
                    const isLocal = process.env.APP_BASE_URL && process.env.APP_BASE_URL.includes('localhost');
                    const callbackUrl = isLocal
                        ? "https://webhook.site/dummy-callback-for-localhost"
                        : appendWebhookToken(process.env.APP_BASE_URL + "/api/external/webhooks/signzy/gst", webhookToken);

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
                    const callbackUrl = appendWebhookToken(process.env.APP_BASE_URL + "/api/external/webhooks/signzy/gst", webhookToken);
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
                        callback_url: mode === 'AUTH_LINK' || mode === 'IN_SYSTEM'
                            ? appendWebhookToken(process.env.APP_BASE_URL + "/api/external/webhooks/signzy/gst", webhookToken)
                            : null,
                        webhook_token: webhookToken,
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

        if (case_id) notifyCasePullUpdate(case_id);

        res.json({ success: true, data: result });
    } catch (error) {
        const explicitStatus = error?.status || error?.statusCode;
        if (explicitStatus) return res.status(explicitStatus).json({ error: error.message, status: "FAILED" });
        if (error?.name === 'Error') return res.status(500).json({ error: error.message, status: "FAILED" });
        console.error('[createGstRequest]', error);
        res.status(500).json({ error: 'Failed to create GST request', status: "FAILED" });
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

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true, status: 'PROCESSING', message: providerRes.message });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to submit GST OTP');
    }
}

async function syncGstData(req, res) {
    try {
        const { request_id } = req.body;
        const dbReq = await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: parseInt(request_id, 10), tenant_id: req.user.tenant_id }
        });

        if (!dbReq) return res.status(404).json({ error: 'GST Request not found' });

        // Shared with the realtime supervisor, which now drives this loop
        // server-side — this endpoint stays for manual retries and for the
        // background worker.
        const result = await pullSync.syncGstRequest(dbReq);

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true, status: result.status, dataSynced: result.dataSynced });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to sync GST data', 500);
    }
}

// Unauthenticated endpoint — the only thing authenticating a delivery is the
// HMAC token we embedded in the callbackUrl at request-creation time (Signzy
// itself signs nothing).
async function handleSignzyCallback(req, res) {
    let claimedRequestId = null; // set once we successfully claim the row, used to release it if processing crashes
    try {
        const payload = req.body;
        // e.g., payload = { result: { requestId, status, ... } }
        const resultObj = payload.result || payload;

        const providerRequestId = resultObj.requestId;
        if (!providerRequestId) return res.status(400).json({ error: "Missing requestId in webhook payload" });
        console.log(`[GST Webhook] Received callback for requestId=${providerRequestId}, status=${resultObj.status || 'unknown'}`);

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

        if (!verifyWebhookToken(dbReq.webhook_token, req.query.wt)) {
            console.warn(`[GST Webhook] Invalid/missing webhook token for requestId=${providerRequestId}. Rejecting.`);
            return res.status(403).json({ error: 'Invalid webhook token' });
        }

        // Atomic claim: a plain read-then-branch (the old `dbReq.status === ...`
        // check alone) is a TOCTOU race — Signzy retries webhooks liberally, and
        // two near-simultaneous deliveries could both read a non-terminal status
        // and both proceed to re-download + re-process. This single UPDATE only
        // succeeds for whichever request is first to move the row out of every
        // non-terminal state; Postgres row locking guarantees only one concurrent
        // UPDATE can win that WHERE clause.
        const claim = await prisma.gstrAnalyticsRequest.updateMany({
            where: {
                provider_request_id: providerRequestId,
                status: { notIn: ['COMPLETED', 'REPORT_READY', 'CALLBACK_RECEIVED'] }
            },
            data: { status: 'CALLBACK_RECEIVED' }
        });
        if (claim.count === 0) {
            console.log(`[Webhook] Duplicate/concurrent callback ignored (already claimed or terminal) for DB ID: ${dbReq.id}`);
            return res.status(200).send("OK");
        }
        claimedRequestId = providerRequestId;

        const jUrl = resultObj.data?.jsonDataUrl || resultObj.jsonDataUrl;
        const pUrl = resultObj.data?.pdfUrl || resultObj.pdfUrl;
        const eUrl = resultObj.data?.excelUrl || resultObj.excelUrl;

        let rawReportData = dbReq.raw_report_data;
        let dataDownloaded = false;
        if (jUrl) {
            try {
                const downloader = await safeGet(jUrl, { timeout: 30000 });
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

        // Push to any browser watching this case. The webhook already announces
        // terminal transitions on the pg channel, but this covers the
        // intermediate ones (CALLBACK_RECEIVED / DATA_READY) too, so the UI
        // tracks the journey rather than only its ending.
        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error("Signzy GST Webhook Error:", error);
        if (claimedRequestId) {
            // Release the claim so Signzy's retry (it gets a 500 here) can
            // actually reprocess instead of being permanently stuck at
            // CALLBACK_RECEIVED by the atomic-claim check above.
            await prisma.gstrAnalyticsRequest.updateMany({
                where: { provider_request_id: claimedRequestId, status: 'CALLBACK_RECEIVED' },
                data: { status: 'PROCESSING' }
            }).catch((releaseErr) => console.error('[GST Webhook] Failed to release claim:', releaseErr.message));
        }
        return res.status(500).json({ error: "Internal processing error" });
    }
}

const TERMINAL_GST_STATUSES = ['REPORT_READY', 'COMPLETED', 'FAILED', 'EXPIRED'];

async function cancelGstRequest(req, res) {
    try {
        const { request_id } = req.body;
        const dbReq = await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: parseInt(request_id, 10), tenant_id: req.user.tenant_id }
        });

        if (!dbReq) return res.status(404).json({ error: 'GST Request not found' });
        if (TERMINAL_GST_STATUSES.includes(dbReq.status)) {
            return res.status(400).json({ error: `Cannot cancel a request that is already ${dbReq.status}` });
        }

        // GstrAnalyticsStatus has no CANCELLED value — FAILED is the closest terminal,
        // non-success state, so polling/UI treats it the same as any other dead end.
        await prisma.gstrAnalyticsRequest.update({
            where: { id: dbReq.id },
            data: { status: 'FAILED', provider_message: `Cancelled by ${req.user.name || 'user'}` }
        });

        await prisma.dataPullBackgroundJob.updateMany({
            where: {
                module_request_id: dbReq.id,
                pull_type: 'GST',
                status: { in: ['PENDING', 'PROCESSING', 'AWAITING_CUSTOMER_ACTION'] }
            },
            data: { status: 'CANCELLED' }
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true, status: 'FAILED' });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to cancel GST request', 500);
    }
}

const SUCCESSFUL_GST_STATUSES = ['REPORT_READY', 'COMPLETED'];

// Deletes an already-pulled GST record (old/wrong data, or a retry is needed
// under a different GSTIN). `cancelGstRequest` above only touches in-flight
// requests and explicitly refuses anything terminal — this is its
// counterpart for the terminal, successful case, following the same
// reset-in-place pattern `bankController.deleteRequest` uses rather than a
// hard delete (a hard delete would need to cascade GstFinancialYearSummary
// rows first, since that relation has no onDelete: Cascade).
async function deleteGstRequest(req, res) {
    try {
        const { request_id } = req.body;
        if (!request_id) return res.status(400).json({ error: 'request_id is required' });

        const dbReq = await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: parseInt(request_id, 10), tenant_id: req.user.tenant_id }
        });
        if (!dbReq) return res.status(404).json({ error: 'GST request not found' });

        if (!SUCCESSFUL_GST_STATUSES.includes(dbReq.status)) {
            return res.status(400).json({ error: `Only a completed GST pull can be removed this way — this request is ${dbReq.status}. Use cancel for an in-progress request.` });
        }

        await prisma.$transaction(async (tx) => {
            await tx.gstFinancialYearSummary.deleteMany({ where: { gst_request_id: dbReq.id } });

            const docIds = [dbReq.gst_pdf_document_id, dbReq.gst_excel_document_id, dbReq.gst_json_document_id].filter(Boolean);
            if (docIds.length) {
                await tx.document.updateMany({
                    where: { id: { in: docIds } },
                    data: { status: 'DELETED' }
                });
            }

            await tx.gstrAnalyticsRequest.update({
                where: { id: dbReq.id },
                data: {
                    // GstrAnalyticsStatus has no CANCELLED/DELETED value —
                    // FAILED is the closest terminal, non-success state,
                    // mirroring cancelGstRequest's own convention above.
                    status: 'FAILED',
                    provider_message: `Removed by ${req.user.name || 'user'}`,
                    report_json_url: null,
                    report_excel_url: null,
                    report_pdf_url: null,
                    gst_pdf_document_id: null,
                    gst_excel_document_id: null,
                    gst_json_document_id: null,
                    turnover_latest_year: null,
                    turnover_previous_year: null,
                    financial_year_latest: null,
                    financial_year_previous: null,
                    avg_monthly_turnover: null,
                    selected_turnover_latest_fy: null,
                    selected_turnover_previous_fy: null,
                    rolling_12_month_turnover: null,
                    // These three MUST also be cleared — getBestUsableGstSnapshot's
                    // rolling-snapshot builder re-derives turnover straight from
                    // raw_report_data whenever it's present, so leaving it behind
                    // would silently resurrect the "deleted" turnover figures the
                    // moment the snapshot is next read (ESR, Income Summary, this
                    // very preview panel), regardless of every field nulled above.
                    raw_report_data: null,
                    raw_gst_data: null,
                    raw_fetch_data: null,
                    provider_callback_payload: null,
                    callback_payload: null,
                    // metrics_status is what getBestUsableGstSnapshot actually
                    // checks to pick its "bestRequest" among a case's requests
                    // (ahead of `status`) — leaving it COMPLETED would let this
                    // now-emptied row keep winning that selection.
                    metrics_status: 'PENDING',
                    report_status: 'PENDING',
                }
            });

            // GST turnover feeds directly into ESR (Income from API Pulls,
            // financial ratios) — a cached ESR snapshot must be invalidated so
            // it re-extracts and reflects this removal rather than continuing
            // to show numbers pulled from data that no longer exists.
            if (dbReq.case_id) {
                const { markEsrInputsChanged } = require('../services/esrSnapshotMutation.service');
                await markEsrInputsChanged(tx, dbReq.case_id);
            }
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to remove GST record', 500);
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

        // Turnover preview — REST fallback path for when websockets are
        // blocked (see useCasePullStatus); mirrors what the realtime
        // snapshot (casePullSnapshot.service.js) already attaches, using the
        // same corrected snapshot rather than the request's own raw
        // turnover_previous_year column (frequently unpopulated for a
        // rolling-window pull). Only computed for the one most-recent
        // completed request — that's the only row the UI ever renders.
        const mostRecentCompleted = requests.find(r => ['REPORT_READY', 'COMPLETED'].includes(r.status));
        if (mostRecentCompleted) {
            try {
                const snapshot = await getBestUsableGstSnapshot({ tenantId: req.user.tenant_id, caseId: mostRecentCompleted.case_id });
                if (snapshot) {
                    mostRecentCompleted.turnover_preview = {
                        turnover_latest_year: snapshot.turnover_latest_year != null ? Number(snapshot.turnover_latest_year) : null,
                        turnover_previous_year: snapshot.turnover_previous_year != null ? Number(snapshot.turnover_previous_year) : null,
                        financial_year_latest: snapshot.financial_year_latest || null,
                        financial_year_previous: snapshot.financial_year_previous || null,
                        avg_monthly_turnover: snapshot.avg_monthly_turnover != null ? Number(snapshot.avg_monthly_turnover) : null,
                        months_filed_12m: snapshot.months_filed_12m ?? null,
                    };
                }
            } catch (err) {
                console.warn(`[GST] turnover preview lookup failed for request ${mostRecentCompleted.id}: ${err.message}`);
            }
        }

        res.json({ success: true, data: requests });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to fetch GST request details', 500);
    }
}

module.exports = {
    createGstRequest,
    submitGstOtp,
    syncGstData,
    cancelGstRequest,
    deleteGstRequest,
    handleSignzyCallback,
    getRequestDetails
};
