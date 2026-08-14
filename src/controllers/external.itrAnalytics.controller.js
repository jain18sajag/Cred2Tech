const prisma = require('../../config/db');
const itrAnalyticsService = require('../services/externalApis/itrAnalytics.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');
const { sendCaughtError } = require('../utils/sendError');
const pullSync = require('../services/pullSync.service');
const { notifyCasePullUpdate } = require('../services/socket.service');

/**
 * POST /external/itr/analyze
 * Validates inputs, deducts wallet credits, calls get-reference-id, stores ItrAnalyticsRequest.
 */
async function analyze(req, res) {
    // Keep existing analyze for password flow...
    // (Existing analyze logic remains unchanged here)
    try {
        const { customer_id, case_id, applicant_id, pan, password } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
        if (!pan) return res.status(400).json({ error: 'pan is required' });
        if (!password) return res.status(400).json({ error: 'ITR portal password is required' });

        const sanitizedPayload = { ...req.body, password: '***MASKED***' };
        const idempotencyKey = `itr_analytics_${customer_id}_${pan}_${applicant_id || 'primary'}_${Date.now()}`;

        const result = await executePaidApi({
            apiCode: 'ITR_ANALYTICS',
            tenantId,
            userId,
            customerId: parseInt(customer_id, 10),
            caseId: case_id ? parseInt(case_id, 10) : null,
            requestPayload: sanitizedPayload,
            idempotencyKey,
            userRole: req.user.role,
            handlerFunction: async () => {
                const providerRes = await itrAnalyticsService.getReferenceId(pan.toUpperCase(), password);
                const referenceId = providerRes.referenceId;
                if (!referenceId) throw new Error('Failed to obtain referenceId from provider');

                const itrRequest = await prisma.itrAnalyticsRequest.upsert({
                    where: { reference_id: referenceId },
                    update: {
                        status: 'PROCESSING',
                        provider_message: providerRes.statusMessage || null
                    },
                    create: {
                        tenant_id: tenantId,
                        customer_id: parseInt(customer_id, 10),
                        case_id: case_id ? parseInt(case_id, 10) : null,
                        applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                        pan: pan.toUpperCase(),
                        reference_id: referenceId,
                        status: 'PROCESSING',
                        auth_mode: 'PASSWORD',
                        provider_message: providerRes.statusMessage || null,
                        created_by_user_id: userId
                    }
                });

                if (case_id) {
                    await prisma.dataPullBackgroundJob.create({
                        data: {
                            tenant_id: tenantId,
                            case_id: parseInt(case_id, 10),
                            applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                            pull_type: 'ITR',
                            module_request_id: itrRequest.id,
                            provider_request_id: referenceId,
                            flow_type: 'ITR_ANALYTICS',
                            status: 'PENDING',
                            next_run_at: new Date(Date.now() + 2 * 60000),
                            maximum_attempts: 5,
                            processing_deadline_at: new Date(Date.now() + 120 * 60000)
                        }
                    });

                    await prisma.caseDataPullStatus.upsert({
                        where: { case_id: parseInt(case_id, 10) },
                        create: { case_id: parseInt(case_id, 10), itr_status: 'PENDING' },
                        update: { itr_status: 'PENDING' }
                    });
                }
                return itrRequest;
            }
        });

        if (case_id) notifyCasePullUpdate(case_id);

        res.status(200).json({ success: true, requestId: result.id, referenceId: result.reference_id, status: result.status });
    } catch (error) {
        console.error('ITR Analytics Analyze Error:', error);
        const code = error.status === 401 ? 502 : error.status === 402 ? 402 : 500;
        const safeMessage = error.status && error.name === 'Error' ? error.message : 'Failed to initiate ITR analytics';
        res.status(code).json({ error: safeMessage });
    }
}

/**
 * NEW: Initiate ITR OTP Request ID
 */
async function initiate(req, res) {
    try {
        const { customer_id, case_id, applicant_id, pan } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!pan) return res.status(400).json({ error: 'pan is required' });

        const providerRes = await itrAnalyticsService.initiateRequestId(pan);
        const requestId = providerRes.requestId;

        const itrRequest = await prisma.itrAnalyticsRequest.upsert({
            where: { reference_id: requestId },
            update: {
                status: 'INITIATED',
                provider_message: providerRes.messageCode || null
            },
            create: {
                tenant_id: tenantId,
                customer_id: parseInt(customer_id, 10),
                case_id: case_id ? parseInt(case_id, 10) : null,
                applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                pan: pan.toUpperCase(),
                reference_id: requestId, // Mapping requestId to reference_id column
                status: 'INITIATED',
                auth_mode: 'OTP',
                provider_message: providerRes.messageCode || null,
                created_by_user_id: userId
            }
        });

        if (case_id) {
            await prisma.dataPullBackgroundJob.create({
                data: {
                    tenant_id: tenantId,
                    case_id: parseInt(case_id, 10),
                    applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                    pull_type: 'ITR',
                    module_request_id: itrRequest.id,
                    provider_request_id: requestId,
                    flow_type: 'ITR_FORM',
                    status: 'AWAITING_CUSTOMER_ACTION',
                    next_run_at: new Date(Date.now() + 2 * 60000),
                    maximum_attempts: 5,
                    processing_deadline_at: new Date(Date.now() + 120 * 60000)
                }
            });
        }

        if (case_id) notifyCasePullUpdate(case_id);

        res.status(200).json({
            success: true,
            requestId: itrRequest.id,
            referenceId: requestId,
            userFlow: providerRes.userFlow, // 'otp and password' or 'password'
            status: 'INITIATED'
        });
    } catch (error) {
        console.error('ITR Initiate Error:', error);
        sendCaughtError(res, error, 'Failed to initiate ITR request', 500);
    }
}

/**
 * NEW: Authorise ITR Session (OTP or Password)
 */
async function authorise(req, res) {
    try {
        const { reference_id, otp, password } = req.body;

        const providerRes = await itrAnalyticsService.submitAuthorisation(reference_id, { otp, password });

        const dbReq = await prisma.itrAnalyticsRequest.update({
            where: { reference_id },
            data: {
                status: 'PROCESSING',
                provider_message: providerRes.messageCode || null
            }
        });

        // Resume background polling for ITR_FORM
        await prisma.dataPullBackgroundJob.updateMany({
            where: { 
                module_request_id: dbReq.id, 
                pull_type: 'ITR', 
                flow_type: 'ITR_FORM',
                status: 'AWAITING_CUSTOMER_ACTION'
            },
            data: { status: 'PENDING', next_run_at: new Date() }
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.status(200).json({
            success: true,
            status: 'PROCESSING',
            message: providerRes.messageCode
        });
    } catch (error) {
        console.error('ITR Authorise Error:', error);
        sendCaughtError(res, error, 'Failed to authorise ITR session', 500);
    }
}

/**
 * POST /external/itr/sync
 * Not wallet-deducting. Fetches analytics from provider and stores to DB.
 */
async function sync(req, res) {
    try {
        const { reference_id } = req.body;

        if (!reference_id) {
            return res.status(400).json({ error: 'reference_id is required' });
        }

        const existing = await prisma.itrAnalyticsRequest.findUnique({
            where: { reference_id }
        });

        if (!existing) {
            return res.status(404).json({ error: 'ITR analytics request not found' });
        }

        // Shared with the realtime supervisor, which now drives this loop
        // server-side — this endpoint stays for manual retries and for the
        // background worker.
        const result = await pullSync.syncItrRequest(existing);

        if (existing.case_id) notifyCasePullUpdate(existing.case_id);

        res.status(200).json({
            success: true,
            status: result.status,
            documentId: result.documentId,   // Use /api/documents/:id/download to fetch
            excel_url: result.excel_url,     // Source URL for audit transparency
            analytics_payload: result.analytics_payload
        });
    } catch (error) {
        console.error('ITR Analytics Sync Error:', error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        const safeMessage = error.status && error.name === 'Error' ? error.message : 'Failed to sync ITR analytics';
        res.status(statusCode).json({ error: safeMessage });
    }
}

const TERMINAL_ITR_STATUSES = ['COMPLETED', 'FAILED'];

/**
 * POST /external/itr/cancel
 * Lets a stuck "Processing" request be manually abandoned instead of waiting
 * out the background worker's up-to-2-hour expiry deadline.
 */
async function cancel(req, res) {
    try {
        const { reference_id } = req.body;
        if (!reference_id) return res.status(400).json({ error: 'reference_id is required' });

        const dbReq = await prisma.itrAnalyticsRequest.findFirst({
            where: { reference_id, tenant_id: req.user.tenant_id }
        });
        if (!dbReq) return res.status(404).json({ error: 'ITR analytics request not found' });
        if (TERMINAL_ITR_STATUSES.includes(dbReq.status)) {
            return res.status(400).json({ error: `Cannot cancel a request that is already ${dbReq.status}` });
        }

        await prisma.itrAnalyticsRequest.update({
            where: { id: dbReq.id },
            data: { status: 'FAILED', provider_message: `Cancelled by ${req.user.name || 'user'}` }
        });

        await prisma.dataPullBackgroundJob.updateMany({
            where: {
                module_request_id: dbReq.id,
                pull_type: 'ITR',
                status: { in: ['PENDING', 'PROCESSING', 'AWAITING_CUSTOMER_ACTION'] }
            },
            data: { status: 'CANCELLED' }
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.status(200).json({ success: true, status: 'FAILED' });
    } catch (error) {
        console.error('ITR Cancel Error:', error);
        sendCaughtError(res, error, 'Failed to cancel ITR request', 500);
    }
}

const SUCCESSFUL_ITR_STATUSES = ['COMPLETED'];

/**
 * POST /external/itr/delete
 * Removes an already-completed ITR pull (old/wrong data, or a retry is
 * needed). `cancel` above only works on in-flight requests. Mirrors
 * deleteGstRequest's approach: reset in place rather than a hard delete,
 * and — critically — null the raw analytics_payload as well as the derived
 * numeric fields, since esrFinancials.service.js re-parses net profit
 * straight from analytics_payload when present. Leaving the raw payload
 * behind would silently resurrect "deleted" income figures.
 */
async function deleteItrRequest(req, res) {
    try {
        const { reference_id } = req.body;
        if (!reference_id) return res.status(400).json({ error: 'reference_id is required' });

        const dbReq = await prisma.itrAnalyticsRequest.findFirst({
            where: { reference_id, tenant_id: req.user.tenant_id }
        });
        if (!dbReq) return res.status(404).json({ error: 'ITR analytics request not found' });

        if (!SUCCESSFUL_ITR_STATUSES.includes(dbReq.status)) {
            return res.status(400).json({ error: `Only a completed ITR pull can be removed this way — this request is ${dbReq.status}. Use cancel for an in-progress request.` });
        }

        await prisma.$transaction(async (tx) => {
            if (dbReq.itr_document_id) {
                await tx.document.update({
                    where: { id: dbReq.itr_document_id },
                    data: { status: 'DELETED' }
                });
            }

            await tx.itrAnalyticsRequest.update({
                where: { id: dbReq.id },
                data: {
                    // ItrAnalyticsStatus has no CANCELLED/DELETED value — FAILED
                    // is the closest terminal, non-success state, matching the
                    // convention cancel() above already uses.
                    status: 'FAILED',
                    provider_message: `Removed by ${req.user.name || 'user'}`,
                    itr_document_id: null,
                    excel_url: null,
                    analytics_payload: null,
                    net_profit_latest_year: null,
                    net_profit_previous_year: null,
                    gross_receipts_latest_year: null,
                    gross_receipts_previous_year: null,
                    financial_year_latest: null,
                    financial_year_previous: null,
                }
            });

            // ITR net profit/gross receipts feed directly into ESR — invalidate
            // the cached snapshot so it re-extracts rather than continuing to
            // show numbers pulled from data that no longer exists.
            if (dbReq.case_id) {
                const { markEsrInputsChanged } = require('../services/esrSnapshotMutation.service');
                await markEsrInputsChanged(tx, dbReq.case_id);
            }
        });

        if (dbReq.case_id) notifyCasePullUpdate(dbReq.case_id);

        res.json({ success: true });
    } catch (error) {
        console.error('ITR Delete Error:', error);
        sendCaughtError(res, error, 'Failed to remove ITR record', 500);
    }
}

/**
 * POST /external/itr/download
 * Reads from DB only — no vendor call.
 */
async function download(req, res) {
    try {
        const { reference_id } = req.body;

        if (!reference_id) {
            return res.status(400).json({ error: 'reference_id is required' });
        }

        const record = await prisma.itrAnalyticsRequest.findUnique({
            where: { reference_id }
        });

        if (!record) {
            return res.status(404).json({ error: 'ITR analytics request not found' });
        }

        if (record.status !== 'COMPLETED') {
            return res.status(400).json({ error: `Report not ready yet. Current status: ${record.status}` });
        }

        res.status(200).json({
            success: true,
            documentId: record.itr_document_id || null,  // Use /api/documents/:id/download
            excel_url: record.excel_url,                  // Source URL for audit transparency
            analytics_payload: record.analytics_payload,
            pan: record.pan,
            status: record.status
        });
    } catch (error) {
        console.error('ITR Analytics Download Error:', error);
        sendCaughtError(res, error, 'Failed to retrieve ITR analytics data', 500);
    }
}

module.exports = { analyze, initiate, authorise, sync, cancel, deleteItrRequest, download };
