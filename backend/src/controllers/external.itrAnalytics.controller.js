const prisma = require('../../config/db');
const itrAnalyticsService = require('../services/externalApis/itrAnalytics.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');

// Helper: extract latest & previous FY net profit / gross receipts from ITR analytics payload
function extractItrFySnapshot(analyticsData) {
    const result = {
        net_profit_latest_year: null, net_profit_previous_year: null,
        gross_receipts_latest_year: null, gross_receipts_previous_year: null,
        financial_year_latest: null, financial_year_previous: null
    };
    if (!analyticsData) return result;

    const toNum = v => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(String(v).replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
    };

    const actual = analyticsData?.result || analyticsData;
    const itrKey = actual?.iTR || actual?.ITR;
    const plArray = itrKey?.profitAndLossStatement?.profitAndLossStatement || [];

    // Sort by year descending
    const sorted = [...plArray]
        .filter(x => x && x.year !== undefined)
        .sort((a, b) => Number(b.year) - Number(a.year));

    const extractRow = (row) => {
        if (!row) return { pat: null, receipts: null };
        const pat = toNum(row.profitAfterTax);
        const receipts = toNum(row.receiptsFromProfession)
            ?? toNum(row.revenueFromOperations)
            ?? toNum(row.saleOfServices)
            ?? toNum(row.saleOfGoods)
            ?? toNum(row.grossTotalIncome);
        return { pat, receipts };
    };

    const fyLabel = (yearStr) => {
        const y = parseInt(yearStr, 10);
        return Number.isFinite(y) ? `FY ${y}-${String(y + 1).slice(2)}` : String(yearStr);
    };

    if (sorted.length > 0) {
        const { pat, receipts } = extractRow(sorted[0]);
        result.net_profit_latest_year = pat;
        result.gross_receipts_latest_year = receipts;
        result.financial_year_latest = fyLabel(sorted[0].year);
    }
    if (sorted.length > 1) {
        const { pat, receipts } = extractRow(sorted[1]);
        result.net_profit_previous_year = pat;
        result.gross_receipts_previous_year = receipts;
        result.financial_year_previous = fyLabel(sorted[1].year);
    }

    return result;
}

/**
 * Helper: extract data from raw ITR JSON (ITR-1, ITR-4 etc.)
 */
function extractDataFromRawItrJson(apiResponse) {
    const result = {
        net_profit_latest_year: null, net_profit_previous_year: null,
        gross_receipts_latest_year: null, gross_receipts_previous_year: null,
        financial_year_latest: null, financial_year_previous: null
    };

    if (!apiResponse) return result;

    // Support both wrapped { result: {...} } and unwrapped payloads
    const actualData = apiResponse.result || apiResponse;
    if (typeof actualData !== 'object' || Object.keys(actualData).length === 0) return result;

    // Get all FYs and sort descending
    const fys = Object.keys(actualData).sort((a, b) => {
        const yearA = parseInt(a.split('-')[0]);
        const yearB = parseInt(b.split('-')[0]);
        return yearB - yearA;
    });

    const parseFy = (fy) => {
        const records = actualData[fy];
        if (!records || !records.length) return { pat: null, receipts: null };

        const record = records[0];
        const json = record.json?.ITR || record.json?.itr || record.json;
        if (!json) return { pat: null, receipts: null };

        console.log(`[ITR Debug] FY ${fy} top-level keys:`, Object.keys(json));

        // Recursive helper to find a key anywhere in the JSON
        const findKeyVal = (obj, searchKey) => {
            if (!obj || typeof obj !== 'object') return null;
            for (const [k, v] of Object.entries(obj)) {
                if (k.toLowerCase() === searchKey.toLowerCase() && (typeof v === 'number' || typeof v === 'string')) {
                    let cleanStr = String(v).replace(/,/g, '');
                    const num = Number(cleanStr);
                    if (!isNaN(num)) return num;
                }
                if (typeof v === 'object') {
                    const res = findKeyVal(v, searchKey);
                    if (res !== null) return res;
                }
            }
            return null;
        };

        const receipts = findKeyVal(json, 'GrossTotIncome') 
                      || findKeyVal(json, 'GrossTotalIncome') 
                      || findKeyVal(json, 'GrossSalary')
                      || findKeyVal(json, 'TotalIncome') 
                      || 0;
                      
        const totalIncome = findKeyVal(json, 'TotalIncome') || receipts;
        const taxPayable = findKeyVal(json, 'TotalTaxPayable') || findKeyVal(json, 'TotalTax') || 0;
        
        const pat = totalIncome - taxPayable;
        
        console.log(`[ITR Debug] FY ${fy} Extracted -> receipts: ${receipts}, totalIncome: ${totalIncome}, taxPayable: ${taxPayable}, pat: ${pat}`);

        return { pat, receipts };
    };

    if (fys.length > 0) {
        const { pat, receipts } = parseFy(fys[0]);
        result.net_profit_latest_year = pat;
        result.gross_receipts_latest_year = receipts;
        result.financial_year_latest = `FY ${fys[0]}`;
    }
    if (fys.length > 1) {
        const { pat, receipts } = parseFy(fys[1]);
        result.net_profit_previous_year = pat;
        result.gross_receipts_previous_year = receipts;
        result.financial_year_previous = `FY ${fys[1]}`;
    }

    return result;
}

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
            handlerFunction: async () => {
                const providerRes = await itrAnalyticsService.getReferenceId(pan.toUpperCase(), password);
                const referenceId = providerRes.referenceId;
                if (!referenceId) throw new Error('Failed to obtain referenceId from provider');

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

        res.status(200).json({ success: true, requestId: result.id, referenceId: result.reference_id, status: result.status });
    } catch (error) {
        console.error('ITR Analytics Analyze Error:', error);
        const code = error.status === 401 ? 502 : error.status === 402 ? 402 : 500;
        res.status(code).json({ error: error.message || 'Failed to initiate ITR analytics' });
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

        const itrRequest = await prisma.itrAnalyticsRequest.create({
            data: {
                tenant_id: tenantId,
                customer_id: parseInt(customer_id, 10),
                case_id: case_id ? parseInt(case_id, 10) : null,
                applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                pan: pan.toUpperCase(),
                reference_id: requestId, // Mapping requestId to reference_id column
                status: 'INITIATED',
                provider_message: providerRes.messageCode || null,
                created_by_user_id: userId
            }
        });

        res.status(200).json({
            success: true,
            requestId: itrRequest.id,
            referenceId: requestId,
            userFlow: providerRes.userFlow, // 'otp and password' or 'password'
            status: 'INITIATED'
        });
    } catch (error) {
        console.error('ITR Initiate Error:', error);
        res.status(500).json({ error: error.message || 'Failed to initiate ITR request' });
    }
}

/**
 * NEW: Authorise ITR Session (OTP or Password)
 */
async function authorise(req, res) {
    try {
        const { reference_id, otp, password } = req.body;

        const providerRes = await itrAnalyticsService.submitAuthorisation(reference_id, { otp, password });

        await prisma.itrAnalyticsRequest.update({
            where: { reference_id },
            data: {
                status: 'PROCESSING',
                provider_message: providerRes.messageCode || null
            }
        });

        res.status(200).json({
            success: true,
            status: 'PROCESSING',
            message: providerRes.messageCode
        });
    } catch (error) {
        console.error('ITR Authorise Error:', error);
        res.status(500).json({ error: error.message || 'Failed to authorise ITR session' });
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

        // SMART SYNC: Detect flow type
        let providerRes;
        let analyticsData;
        let excelUrl = null;

        if (existing.status === 'PROCESSING' || existing.status === 'INITIATED') {
            providerRes = await itrAnalyticsService.fetchItrForm(reference_id);
            analyticsData = providerRes; // The whole result object

            // The getitrform API returns PDF URLs inside the result object for each year
            // We'll take the latest available form URL
            const actualData = providerRes.result || providerRes;
            const fies = Object.keys(actualData || {});
            if (fies.length > 0) excelUrl = actualData[fies[0]][0]?.form || null;
        } else {
            providerRes = await itrAnalyticsService.getAnalytics(reference_id);
            excelUrl = providerRes.excelUrl || null;
            analyticsData = providerRes.data || providerRes;
        }
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

        // Extract FY snapshots based on flow type
        const itrSnapshot = (existing.status === 'PROCESSING' || existing.status === 'INITIATED')
            ? extractDataFromRawItrJson(analyticsData)
            : extractItrFySnapshot(analyticsData);

        console.log('[ITR FY Snapshot]', itrSnapshot);

        const updated = await prisma.itrAnalyticsRequest.update({
            where: { reference_id },
            data: {
                status: 'COMPLETED',
                excel_url: excelUrl,          // Kept for audit — NOT used for serving
                analytics_payload: analyticsData,
                provider_message: statusMessage,
                itr_document_id: itrDocumentId || undefined,
                net_profit_latest_year: itrSnapshot.net_profit_latest_year,
                net_profit_previous_year: itrSnapshot.net_profit_previous_year,
                gross_receipts_latest_year: itrSnapshot.gross_receipts_latest_year,
                gross_receipts_previous_year: itrSnapshot.gross_receipts_previous_year,
                financial_year_latest: itrSnapshot.financial_year_latest,
                financial_year_previous: itrSnapshot.financial_year_previous,
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
            }).catch(() => { });
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

module.exports = { analyze, initiate, authorise, sync, download };
