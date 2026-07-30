const prisma = require('../../config/db');
const bankService = require('../services/externalApis/bank.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');
const { determineNotificationRecipient } = require('../services/notification.service');

const { extractBankFySnapshot } = require('../services/bankParser.service');
const { safeGet } = require('../utils/ssrf');
const { verifyWebhookToken } = require('../utils/webhookToken');
const pullSync = require('../services/pullSync.service');
const { notifyCasePullUpdate } = require('../services/socket.service');

// Note: Pre-analysis is optional and can be skipped. We will directly analyze here.
async function analyze(req, res) {
    try {
        const { customer_id, case_id, applicant_id, files } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!customer_id || !files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: "customer_id and files array are required" });
        }

        const idempotencyKey = `bank_analyze_${customer_id}_${applicant_id || 'primary'}_${Date.now()}`;

        const result = await executePaidApi({
            apiCode: 'BANK_ANALYSIS',
            tenantId: tenantId,
            userId: userId,
            customerId: parseInt(customer_id, 10),
            caseId: case_id ? parseInt(case_id, 10) : null,
            requestPayload: req.body,
            idempotencyKey: idempotencyKey,
            userRole: req.user.role,
            handlerFunction: async () => {
                // Trigger provider API securely isolated in backend
                const providerRes = await bankService.analyzeStatement(files);

                // Assuming providerRes returns an object with report or result
                const reportId = providerRes.report?.reportId || providerRes.reportId || providerRes.result?.reportId || providerRes.id;

                if (!reportId) {
                    console.error("[SIGNZY BANK ANALYZE - UNEXPECTED RESPONSE PAYLOAD]:", JSON.stringify(providerRes, null, 2));
                    throw new Error(`Failed to extract reportId from provider response. Provider returned: ${JSON.stringify(providerRes).substring(0, 150)}`);
                }

                // Never persist the webhook auth secret inside the raw vendor-response
                // blob — it gets stored/returned as opaque JSON elsewhere.
                const { __webhookToken: webhookToken, ...rawAnalyzeResponse } = providerRes;

                const bankRequest = await prisma.bankStatementAnalysisRequest.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: parseInt(customer_id, 10),
                        case_id: case_id ? parseInt(case_id, 10) : null,
                        applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                        report_id: reportId.toString(),
                        webhook_token: webhookToken,
                        status: 'ANALYZING',
                        files_payload: files,
                        raw_analyze_response: rawAnalyzeResponse,
                        created_by_user_id: userId
                    }
                });

                if (case_id) {
                    await prisma.dataPullBackgroundJob.create({
                        data: {
                            tenant_id: tenantId,
                            case_id: parseInt(case_id, 10),
                            applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                            pull_type: 'BANK',
                            module_request_id: bankRequest.id,
                            provider_request_id: reportId.toString(),
                            status: 'PENDING',
                            next_run_at: new Date(Date.now() + 15 * 60000),
                            maximum_attempts: 3,
                            processing_deadline_at: new Date(Date.now() + 120 * 60000)
                        }
                    });
                }

                if (case_id) {
                    await prisma.caseDataPullStatus.upsert({
                        where: { case_id: parseInt(case_id, 10) },
                        create: { case_id: parseInt(case_id, 10), bank_status: 'PENDING' },
                        update: { bank_status: 'PENDING' }
                    });
                }

                return bankRequest;
            }
        });

        if (case_id) notifyCasePullUpdate(case_id);

        res.status(200).json({ success: true, bankRequest: result });
    } catch (error) {
        console.error("Bank Analyze Error: ", error);

        let statusCode = 500;
        if (error.status === 401) statusCode = 502; // Prevents frontend JWT interceptor logout
        else if (error.status === 402) statusCode = 402;
        else if (error.status === 409) statusCode = 409;
        else if (error.status >= 400 && error.status < 500) statusCode = error.status;

        const safeMessage = error.status && error.name === 'Error' ? error.message : "Failed to start bank analysis";
        res.status(statusCode).json({ error: safeMessage });
    }
}

/**
 * Delete a completed (or otherwise no-longer-wanted) bank statement analysis
 * so the applicant can upload a fresh one — a soft reset (status back to
 * INITIATED, result fields cleared) rather than removing the row outright,
 * consistent with how GST requests are "cancelled" rather than hard-deleted.
 */
async function deleteRequest(req, res) {
    try {
        const { report_id } = req.body;
        if (!report_id) return res.status(400).json({ error: 'report_id is required' });

        const dbReq = await prisma.bankStatementAnalysisRequest.findFirst({
            where: { report_id, tenant_id: req.user.tenant_id }
        });
        if (!dbReq) return res.status(404).json({ error: 'Bank statement request not found' });

        await prisma.$transaction(async (tx) => {
            await tx.bankStatementAnalysisRequest.update({
                where: { id: dbReq.id },
                data: {
                    status: 'INITIATED',
                    provider_message: `Deleted by ${req.user.name || 'user'}`,
                    report_json_url: null,
                    report_excel_url: null,
                    files_payload: null,
                    avg_bank_balance_latest_year: null,
                    avg_bank_balance_previous_year: null,
                    financial_year_latest: null,
                    financial_year_previous: null,
                }
            });

            const docIds = [dbReq.bank_excel_document_id, dbReq.bank_json_document_id].filter(Boolean);
            if (docIds.length) {
                await tx.document.updateMany({
                    where: { id: { in: docIds } },
                    data: { status: 'DELETED' }
                });
            }
            await tx.bankStatementAnalysisRequest.update({
                where: { id: dbReq.id },
                data: { bank_excel_document_id: null, bank_json_document_id: null }
            });
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true });
    } catch (error) {
        console.error('[Bank] deleteRequest error:', error.message);
        res.status(500).json({ error: 'Failed to delete bank statement request' });
    }
}

async function syncStatus(req, res) {
    try {
        const { report_id } = req.body;

        if (!report_id) {
            return res.status(400).json({ error: 'report_id is required' });
        }

        const existingRequest = await prisma.bankStatementAnalysisRequest.findUnique({
            where: { report_id: report_id }
        });

        if (!existingRequest) {
            return res.status(404).json({ error: 'Bank request log not found' });
        }

        // Shared with the realtime supervisor, which now drives this loop
        // server-side — this endpoint stays for manual retries and for the
        // background worker.
        const result = await pullSync.syncBankRequest(existingRequest, {
            tenantId: req.user?.tenant_id,
            userId: req.user?.id
        });

        if (existingRequest.case_id) notifyCasePullUpdate(existingRequest.case_id);

        res.status(200).json({
            success: true,
            status: result.status,
            rawStatus: result.rawStatus,
            requestData: result.requestData
        });
    } catch (error) {
        console.error('Bank Sync Error: ', error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        const safeMessage = error.status && error.name === 'Error' ? error.message : 'Failed to sync status';
        res.status(statusCode).json({ error: safeMessage });
    }
}

async function downloadData(req, res) {
    try {
        const { report_id } = req.body;

        if (!report_id) {
            return res.status(400).json({ error: 'report_id is required' });
        }

        const existingRequest = await prisma.bankStatementAnalysisRequest.findUnique({
            where: { report_id }
        });

        if (!existingRequest) {
            return res.status(404).json({ error: 'Bank request log not found' });
        }

        const result = await pullSync.fetchBankReportLinks(existingRequest, {
            tenantId: req.user?.tenant_id,
            userId: req.user?.id
        });

        // The vendor keeps answering "in progress" for a while after analysis
        // itself completes; 202 tells the caller to come back later. The
        // realtime supervisor retries this automatically, so the UI no longer
        // has to.
        if (result.pending) {
            return res.status(202).json({ success: false, message: result.message });
        }

        if (existingRequest.case_id) notifyCasePullUpdate(existingRequest.case_id);

        // Return document IDs for frontend to use our endpoints — NOT vendor URLs
        res.status(200).json({
            success: true,
            documentIds: result.documentIds,
            // Preserve for backward compatibility: still include vendor URLs but label them clearly
            sourceUrls: result.sourceUrls,
            requestData: result.requestData
        });
    } catch (error) {
        console.error('Bank Download Error: ', error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        const safeMessage = error.status && error.name === 'Error' ? error.message : 'Failed to download URLs';
        res.status(statusCode).json({ error: safeMessage, response: error.response });
    }
}

async function handleSignzyCallback(req, res) {
    let claimedReportId = null; // set once we successfully claim the row, used to release it if processing crashes
    try {
        const payload = req.body;

        // Extract reportId — Signzy sends it in multiple possible shapes
        const resultObj = payload.result || payload;
        const reportId = payload.report_id
            || payload.reportId
            || resultObj.reportId
            || resultObj.report_id
            || req.query.report_id;

        if (!reportId) {
            console.error('[Bank Webhook] Could not deduce reportId from payload');
            return res.status(400).json({ error: 'reportId missing from webhook payload' });
        }

        console.log(`[Bank Webhook] Processing for report_id: ${reportId}`);

        const existingRequest = await prisma.bankStatementAnalysisRequest.findUnique({
            where: { report_id: reportId.toString() }
        });

        if (!existingRequest) {
            console.warn(`[Bank Webhook] No DB record found for report_id: ${reportId}`);
            return res.status(200).json({ received: true, note: 'Unknown report_id, ignored' });
        }

        // Signzy webhooks carry no signature scheme — this is the only thing
        // authenticating the callback (see `webhook_token`, set at request time).
        if (!verifyWebhookToken(existingRequest.webhook_token, req.query.wt)) {
            console.warn(`[Bank Webhook] Invalid/missing webhook token for report_id=${reportId}. Rejecting.`);
            return res.status(403).json({ error: 'Invalid webhook token' });
        }

        if (
            existingRequest.status === 'COMPLETED' &&
            existingRequest.raw_retrieve_response &&
            existingRequest.avg_bank_balance_latest_year
        ) {
            console.log(`[Bank Webhook] Duplicate callback ignored for report_id: ${reportId}`);
            return res.status(200).json({ received: true, note: 'Already completed with raw JSON stored' });
        }

        // Atomic claim: the read-then-branch check above is a TOCTOU race —
        // Signzy retries webhooks liberally, and two near-simultaneous
        // deliveries could both read a non-completed state and both proceed
        // to re-download + re-process. This single UPDATE only succeeds for
        // whichever request is first to claim the row; Postgres row locking
        // guarantees only one concurrent UPDATE can win the WHERE clause.
        const claim = await prisma.bankStatementAnalysisRequest.updateMany({
            where: { report_id: reportId.toString(), webhook_claimed_at: null },
            data: { webhook_claimed_at: new Date() }
        });
        if (claim.count === 0) {
            console.log(`[Bank Webhook] Duplicate/concurrent callback ignored (already claimed) for report_id: ${reportId}`);
            return res.status(200).json({ received: true, note: 'Already being processed' });
        }
        claimedReportId = reportId.toString();

        // Extract file URLs — Signzy bank webhook format:
        // { result: { json: "url", excel: "url", accountLevelAnalysis: [...] } }
        const jsonUrl = resultObj.json || resultObj.jsonUrl || resultObj.json_url || null;
        const excelUrl = resultObj.excel || resultObj.excelUrl || resultObj.excel_url || null;

        if (!jsonUrl && !excelUrl) {
            console.warn('[Bank Webhook] No file URLs in payload, marking as FAILED');
            await prisma.bankStatementAnalysisRequest.update({
                where: { report_id: reportId.toString() },
                data: { status: 'FAILED', provider_message: 'No file URLs in webhook payload' }
            });
            return res.status(200).json({ received: true });
        }

        // Download JSON report for FY analysis
        let rawRetrieveData = null;
        if (jsonUrl) {
            try {
                const response = await safeGet(jsonUrl, { timeout: 30000 });
                rawRetrieveData = response.data;
                console.log(`[Bank Webhook] JSON downloaded. Size: ${JSON.stringify(rawRetrieveData).length} chars`);
            } catch (dlErr) {
                console.error('[Bank Webhook] JSON download failed:', dlErr.message);
            }
        }

        // Extract FY ABB snapshot from downloaded JSON
        let bankFySnapshot = { latest: null, previous: null, fy_latest: null, fy_previous: null };
        if (rawRetrieveData) {
            try {
                bankFySnapshot = extractBankFySnapshot(rawRetrieveData);
                console.log('[Bank JSON] latest ABB:', bankFySnapshot.latest);
            } catch (fyErr) {
                console.error('[Bank Webhook][FY Snapshot] Extraction error:', fyErr.message);
            }
        }

        // Ingest files into local/R2 storage
        let excelDocId = existingRequest.bank_excel_document_id;
        let jsonDocId = existingRequest.bank_json_document_id;

        const ingestionBase = {
            tenantId: existingRequest.tenant_id,
            customerId: existingRequest.customer_id,
            caseId: existingRequest.case_id,
            applicantId: existingRequest.applicant_id,
            uploadedByUserId: existingRequest.created_by_user_id,
            metadata: { report_id: reportId, source: 'signzy_bank_webhook' }
        };

        const ingestionJobs = [];
        if (excelUrl && !excelDocId) {
            ingestionJobs.push(
                documentService.ingestFromUrl({
                    ...ingestionBase,
                    vendorUrl: excelUrl,
                    documentType: 'BANK_EXCEL',
                    originalFileName: `bank_statement_${reportId}.xlsx`
                }).then(doc => { excelDocId = doc.id; })
                    .catch(e => console.error('[Bank Webhook] Excel ingestion failed:', e.message))
            );
        }
        if (jsonUrl && !jsonDocId) {
            ingestionJobs.push(
                documentService.ingestFromUrl({
                    ...ingestionBase,
                    vendorUrl: jsonUrl,
                    documentType: 'BANK_JSON',
                    originalFileName: `bank_statement_${reportId}.json`
                }).then(doc => { jsonDocId = doc.id; })
                    .catch(e => console.error('[Bank Webhook] JSON ingestion failed:', e.message))
            );
        }
        await Promise.allSettled(ingestionJobs);

        await prisma.$transaction(async (tx) => {
            await tx.bankStatementAnalysisRequest.update({
                where: { report_id: reportId.toString() },
                data: {
                    status: 'COMPLETED',
                    provider_message: 'Completed via webhook callback',
                    report_json_url: jsonUrl || existingRequest.report_json_url,
                    report_excel_url: excelUrl || existingRequest.report_excel_url,
                    raw_retrieve_response: rawRetrieveData || existingRequest.raw_retrieve_response,
                    bank_excel_document_id: excelDocId || undefined,
                    bank_json_document_id: jsonDocId || undefined,
                    avg_bank_balance_latest_year: bankFySnapshot.latest,
                    avg_bank_balance_previous_year: bankFySnapshot.previous,
                    financial_year_latest: bankFySnapshot.fy_latest,
                    financial_year_previous: bankFySnapshot.fy_previous,
                }
            });

            await tx.dataPullBackgroundJob.updateMany({
                where: { pull_type: 'BANK', module_request_id: existingRequest.id, status: { in: ['PENDING', 'PROCESSING'] } },
                data: { status: 'COMPLETED' }
            });

            if (existingRequest.case_id) {
                const initiatorId = existingRequest.created_by_user_id || null;
                const { recipient_user_id, audience_type } = await determineNotificationRecipient(existingRequest.tenant_id, existingRequest.case_id, initiatorId);

                const notification = await tx.systemNotification.create({
                    data: {
                        tenant_id: existingRequest.tenant_id,
                        case_id: existingRequest.case_id,
                        pull_type: 'BANK',
                        status: 'COMPLETED',
                        audience_type: audience_type,
                        recipient_user_id: recipient_user_id,
                        message: `Bank Statement analysis COMPLETED via webhook`,
                        deduplication_key: `BANK_${existingRequest.id}_COMPLETED_webhook`
                    }
                });
                const pgPayload = { event_id: notification.id, tenant_id: existingRequest.tenant_id, case_id: existingRequest.case_id, pull_type: 'BANK', status: 'COMPLETED' };
                await tx.$executeRawUnsafe(`SELECT pg_notify('case_status_updates', $1)`, JSON.stringify(pgPayload));
            }
        });

        // Update case data pull status
        if (existingRequest.case_id) {
            await prisma.caseDataPullStatus.upsert({
                where: { case_id: existingRequest.case_id },
                create: { case_id: existingRequest.case_id, bank_status: 'COMPLETE' },
                update: { bank_status: 'COMPLETE' }
            });

            // Trigger ESR financials extraction
            try {
                const { extractEsrFinancials } = require('../services/esrFinancials.service');
                await extractEsrFinancials(existingRequest.case_id, existingRequest.tenant_id);
                console.log(`[Bank Webhook] ESR extraction triggered for case ${existingRequest.case_id}`);
            } catch (esrErr) {
                console.error('[Bank Webhook] ESR extraction error:', esrErr.message);
            }
        }

        // Push to any browser watching this case rather than waiting for its
        // next supervisor tick.
        if (existingRequest.case_id) notifyCasePullUpdate(existingRequest.case_id);

        return res.status(200).json({ received: true });

    } catch (err) {
        console.error('[Bank Webhook] Unhandled error:', err);
        if (claimedReportId) {
            // Release the claim so Signzy's retry (it gets a 500 here) can
            // actually reprocess instead of being silently swallowed forever
            // by the atomic-claim check above.
            await prisma.bankStatementAnalysisRequest.updateMany({
                where: { report_id: claimedReportId },
                data: { webhook_claimed_at: null }
            }).catch((releaseErr) => console.error('[Bank Webhook] Failed to release claim:', releaseErr.message));
        }
        return res.status(500).json({ error: 'Internal processing error' });
    }
}

module.exports = {
    analyze,
    syncStatus,
    downloadData,
    deleteRequest,
    handleSignzyCallback
};
