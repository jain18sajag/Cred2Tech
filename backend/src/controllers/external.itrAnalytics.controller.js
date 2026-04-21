const prisma = require('../../config/db');
const itrAnalyticsService = require('../services/externalApis/itrAnalytics.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');

/**
 * POST /external/itr/analyze
 * Validates inputs, deducts wallet credits, calls get-reference-id, stores ItrAnalyticsRequest.
 */
async function analyze(req, res) {
    try {
        const { customer_id, case_id, applicant_id, pan, password } = req.body;
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        if (!customer_id) {
            return res.status(400).json({ error: 'customer_id is required' });
        }
        if (!pan) {
            return res.status(400).json({ error: 'pan is required' });
        }
        if (!password) {
            return res.status(400).json({ error: 'ITR portal password is required' });
        }

        // Mask credential in the payload stored in api_usage_logs
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
            handlerFunction: async () => {
                // Call vendor with real credentials (never stored)
                const providerRes = await itrAnalyticsService.getReferenceId(pan.toUpperCase(), password);
                const referenceId = providerRes.referenceId;

                if (!referenceId) {
                    throw new Error('Failed to obtain referenceId from provider');
                }

                const itrRequest = await prisma.itrAnalyticsRequest.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: parseInt(customer_id, 10),
                        case_id: case_id ? parseInt(case_id, 10) : null,
                        applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                        pan: pan.toUpperCase(),
                        reference_id: referenceId,
                        status: 'PROCESSING',
                        provider_message: providerRes.statusMessage || null,
                        created_by_user_id: userId
                    }
                });

                if (case_id) {
                    await prisma.caseDataPullStatus.upsert({
                        where: { case_id: parseInt(case_id, 10) },
                        create: { case_id: parseInt(case_id, 10), itr_status: 'PENDING' },
                        update: { itr_status: 'PENDING' }
                    });
                }

                return itrRequest;
            }
        });

        res.status(200).json({
            success: true,
            requestId: result.id,
            referenceId: result.reference_id,
            status: result.status
        });
    } catch (error) {
        console.error('ITR Analytics Analyze Error:', error);
        const code = error.status === 401 ? 502 : error.status === 402 ? 402 : error.status === 409 ? 409 : error.status >= 400 && error.status < 500 ? error.status : 500;
        res.status(code).json({ error: error.message || 'Failed to initiate ITR analytics' });
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

        // Return early only if completed AND document ID is stored
        if (existing.status === 'COMPLETED' && existing.itr_document_id) {
            return res.status(200).json({
                success: true,
                status: 'COMPLETED',
                documentId: existing.itr_document_id,
                excel_url: existing.excel_url,
                analytics_payload: existing.analytics_payload
            });
        }

        const providerRes = await itrAnalyticsService.getAnalytics(reference_id);

        const excelUrl = providerRes.excelUrl || null;
        const analyticsData = providerRes.data || providerRes;
        const statusMessage = providerRes.statusMessage || null;

        // Ingest vendor excel URL into our own storage
        let itrDocumentId = existing.itr_document_id;
        if (excelUrl && !itrDocumentId) {
            try {
                const doc = await documentService.ingestFromUrl({
                    vendorUrl: excelUrl,
                    documentType: 'ITR_EXCEL',
                    tenantId: existing.tenant_id,
                    customerId: existing.customer_id,
                    caseId: existing.case_id,
                    applicantId: existing.applicant_id,
                    uploadedByUserId: existing.created_by_user_id,
                    originalFileName: `itr_analytics_${existing.pan}.xlsx`,
                    metadata: { reference_id, pan: existing.pan, source: 'signzy_itr_analytics' }
                });
                itrDocumentId = doc.id;
            } catch (ingestionErr) {
                console.error('[itr.controller] ITR excel ingestion failed:', ingestionErr.message);
                // Non-fatal: continue to mark as COMPLETED even if storage fails
            }
        }

        const updated = await prisma.itrAnalyticsRequest.update({
            where: { reference_id },
            data: {
                status: 'COMPLETED',
                excel_url: excelUrl,          // Kept for audit — NOT used for serving
                analytics_payload: analyticsData,
                provider_message: statusMessage,
                itr_document_id: itrDocumentId || undefined,
            }
        });

        if (existing.case_id) {
            await prisma.caseDataPullStatus.update({
                where: { case_id: existing.case_id },
                data: { itr_status: 'COMPLETE' }
            });
            
            // Extract ESR financials asynchronously
            const { extractEsrFinancials } = require('../services/esrFinancials.service');
            extractEsrFinancials(existing.case_id).catch(err => console.error(err));
        }

        res.status(200).json({
            success: true,
            status: 'COMPLETED',
            documentId: itrDocumentId || null,   // Use /api/documents/:id/download to fetch
            excel_url: excelUrl,                  // Source URL for audit transparency
            analytics_payload: analyticsData
        });
    } catch (error) {
        console.error('ITR Analytics Sync Error:', error);

        // Mark as failed in DB if it's a hard provider error
        if (req.body.reference_id && error.status >= 400) {
            await prisma.itrAnalyticsRequest.update({
                where: { reference_id: req.body.reference_id },
                data: { status: 'FAILED', provider_message: error.message }
            }).catch(() => {});
        }

        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        res.status(statusCode).json({ error: error.message || 'Failed to sync ITR analytics' });
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
        res.status(500).json({ error: error.message || 'Failed to retrieve ITR analytics data' });
    }
}

module.exports = { analyze, sync, download };
