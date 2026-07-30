/**
 * Vendor-sync logic for the three data pulls (GST / ITR / Bank), lifted out of
 * the HTTP controllers so it can run without a `req`.
 *
 * Why: the browser used to drive these by POSTing /sync every 15s per open
 * component. That meant N open tabs = N vendor calls, nothing advanced while
 * the user was on another wizard step, and status only moved when somebody was
 * looking. These functions let the realtime layer (socket.service) do the same
 * work server-side, once per case, for however many viewers are attached —
 * and let the controllers keep their existing endpoints as thin wrappers so
 * webhooks, the background worker and manual retries all share one code path.
 *
 * Every function is idempotent and safe to call repeatedly on an in-flight
 * request; each returns `{ changed }` so callers can skip broadcasting when
 * nothing actually moved.
 */
const prisma = require('../../config/db');
const documentService = require('./document.service');
const { safeGet } = require('../utils/ssrf');

const itrAnalyticsService = require('./externalApis/itrAnalytics.service');
const bankService = require('./externalApis/bank.service');
const gstService = require('./externalApis/gst.service');
const { extractBankFySnapshot } = require('./bankParser.service');

// ---------------------------------------------------------------------------
// ITR
// ---------------------------------------------------------------------------

/**
 * Extract latest & previous FY net profit / gross receipts from the
 * ITR-analytics payload (password flow).
 */
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
 * Extract data from raw ITR JSON (ITR-1, ITR-4 etc.) — the OTP/form flow.
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
 * Pull the latest ITR state from the provider and persist it.
 *
 * @param {object} existing - the ItrAnalyticsRequest row
 * @returns {{changed: boolean, status: string, documentId: number|null,
 *            excel_url: string|null, analytics_payload: any}}
 */
async function syncItrRequest(existing) {
    if (!existing) throw new Error('ITR analytics request not found');

    // Already finished and stored — nothing to ask the provider about.
    if (existing.status === 'COMPLETED' && existing.itr_document_id) {
        return {
            changed: false,
            status: 'COMPLETED',
            documentId: existing.itr_document_id,
            excel_url: existing.excel_url,
            analytics_payload: existing.analytics_payload
        };
    }

    const referenceId = existing.reference_id;

    // SMART SYNC: Detect flow type
    let providerRes;
    let analyticsData;
    let excelUrl = null;

    try {
        if (existing.auth_mode === 'OTP') {
            providerRes = await itrAnalyticsService.fetchItrForm(referenceId);
            analyticsData = providerRes; // The whole result object

            // The getitrform API returns PDF URLs inside the result object for each year.
            // We'll take the latest available form URL.
            const actualData = providerRes.result || providerRes;
            const fies = Object.keys(actualData || {});
            if (fies.length > 0) excelUrl = actualData[fies[0]][0]?.form || null;
        } else {
            providerRes = await itrAnalyticsService.getAnalytics(referenceId);
            excelUrl = providerRes.excelUrl || null;
            analyticsData = providerRes.data || providerRes;
        }
    } catch (error) {
        // A 4xx/5xx from the provider is a hard failure; anything softer just
        // means "not ready yet" and we leave the record on PROCESSING so the
        // next tick tries again.
        if (error.status >= 400) {
            await prisma.itrAnalyticsRequest.update({
                where: { id: existing.id },
                data: { status: 'FAILED', provider_message: error.message }
            }).catch(() => { });
            const failure = new Error(error.message);
            failure.status = error.status;
            failure.terminal = true;
            throw failure;
        }
        throw error;
    }

    const statusMessage = providerRes.statusMessage || null;

    // Extract FY snapshots based on flow type. Done BEFORE deciding whether the
    // request is finished, because the extraction result is also the readiness
    // signal — see below.
    const itrSnapshot = (existing.auth_mode === 'OTP')
        ? extractDataFromRawItrJson(analyticsData)
        : extractItrFySnapshot(analyticsData);

    // Is the provider actually done?
    //
    // This used to write status: 'COMPLETED' unconditionally, as soon as the
    // call returned without throwing. But the provider answers "still working"
    // with a perfectly successful 200 carrying no excelUrl and no filings — so
    // a request got marked COMPLETED with nothing in it, the realtime
    // supervisor stopped polling (it only polls PROCESSING), and the report was
    // never collected. That is why a manual re-fetch was needed to finish a
    // pull that should have completed on its own.
    //
    // Treat it as finished only when there is something real: a report file, or
    // filings the FY extractor could actually read. Otherwise leave it on
    // PROCESSING so the next supervisor tick tries again.
    const ready = !!excelUrl || itrSnapshot.financial_year_latest != null;

    if (!ready) {
        if (existing.status !== 'PROCESSING' || existing.provider_message !== statusMessage) {
            await prisma.itrAnalyticsRequest.update({
                where: { id: existing.id },
                data: { status: 'PROCESSING', provider_message: statusMessage }
            });
        }
        return {
            changed: existing.status !== 'PROCESSING',
            status: 'PROCESSING',
            documentId: null,
            excel_url: null,
            analytics_payload: null,
        };
    }

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
                metadata: { reference_id: referenceId, pan: existing.pan, source: 'signzy_itr_analytics' }
            });
            itrDocumentId = doc.id;
        } catch (ingestionErr) {
            console.error('[pullSync] ITR excel ingestion failed:', ingestionErr.message);
            // Non-fatal: continue to mark as COMPLETED even if storage fails
        }
    }

    // itrSnapshot was already extracted above (it doubles as the readiness check).
    await prisma.itrAnalyticsRequest.update({
        where: { id: existing.id },
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
        await prisma.caseDataPullStatus.upsert({
            where: { case_id: existing.case_id },
            create: { case_id: existing.case_id, itr_status: 'COMPLETE' },
            update: { itr_status: 'COMPLETE' }
        });

        // Extract ESR financials asynchronously
        const { extractEsrFinancials } = require('./esrFinancials.service');
        extractEsrFinancials(existing.case_id, existing.tenant_id).catch(err => console.error(err));
    }

    return {
        changed: existing.status !== 'COMPLETED' || !existing.itr_document_id,
        status: 'COMPLETED',
        documentId: itrDocumentId || null,
        excel_url: excelUrl,
        analytics_payload: analyticsData
    };
}

// ---------------------------------------------------------------------------
// BANK
// ---------------------------------------------------------------------------

/**
 * Pull the latest bank-analysis state from the provider and persist it,
 * ingesting the report files as soon as they exist.
 *
 * @param {object} existingRequest - the BankStatementAnalysisRequest row
 * @param {object} [actor] - { tenantId, userId } of the human driving this, if
 *   any; falls back to the values recorded on the request for server-driven runs.
 */
async function syncBankRequest(existingRequest, actor = {}) {
    if (!existingRequest) throw new Error('Bank request log not found');

    const report_id = existingRequest.report_id;
    const providerRes = await bankService.retrieveWorkOrder(report_id);
    const resultPayload = providerRes.result || providerRes;
    const statusStr = providerRes.report?.reportStatus || providerRes.status || resultPayload.status;

    // Map provider status
    let mappedStatus = existingRequest.status;
    if (statusStr === 'COMPLETED' || statusStr === 'ANALYSED') mappedStatus = 'COMPLETED';
    else if (statusStr === 'IN PROGRESS') mappedStatus = 'ANALYZING';
    else if (statusStr === 'FAILED' || statusStr === 'REJECTED') mappedStatus = 'FAILED';

    let excelDocId = existingRequest.bank_excel_document_id;
    let jsonDocId = existingRequest.bank_json_document_id;
    const excelUrl = resultPayload.excelUrl || resultPayload.excel;
    const jsonUrl = resultPayload.jsonUrl || resultPayload.json;

    let rawRetrieveData = providerRes;

    // Automatically download URLs just like the webhook path does.
    if (mappedStatus === 'COMPLETED') {
        const ingestionJobs = [];

        const tenantId = actor.tenantId || existingRequest.tenant_id;
        const userId = actor.userId || existingRequest.created_by_user_id;

        if (excelUrl && !excelDocId) {
            ingestionJobs.push(documentService.ingestFromUrl({
                vendorUrl: excelUrl,
                documentType: 'BANK_EXCEL',
                tenantId,
                customerId: existingRequest.customer_id,
                caseId: existingRequest.case_id,
                applicantId: existingRequest.applicant_id,
                uploadedByUserId: userId,
                originalFileName: `bank_statement_${report_id}.xlsx`,
                metadata: { report_id, source: 'bank_sync_auto_download' }
            }).then(doc => { excelDocId = doc.id; }).catch(err => {
                console.error('[pullSync] Auto-Excel ingestion failed:', err.message);
            }));
        }

        if (jsonUrl && !jsonDocId) {
            ingestionJobs.push(documentService.ingestFromUrl({
                vendorUrl: jsonUrl,
                documentType: 'BANK_JSON',
                tenantId,
                customerId: existingRequest.customer_id,
                caseId: existingRequest.case_id,
                applicantId: existingRequest.applicant_id,
                uploadedByUserId: userId,
                originalFileName: `bank_statement_${report_id}.json`,
                metadata: { report_id, source: 'bank_sync_auto_download' }
            }).then(doc => { jsonDocId = doc.id; }).catch(err => {
                console.error('[pullSync] Auto-JSON ingestion failed:', err.message);
            }));
        }

        await Promise.allSettled(ingestionJobs);

        if (jsonUrl) {
            try {
                const downRes = await safeGet(jsonUrl, { timeout: 30000 });
                rawRetrieveData = downRes.data;
            } catch (e) {
                console.error('[pullSync] Failed to buffer json payload into string:', e.message);
            }
        }
    }

    // Extract FY ABB snapshot and persist alongside the regular fields
    let bankFySnapshot = { latest: null, previous: null, fy_latest: null, fy_previous: null };
    if (mappedStatus === 'COMPLETED') {
        try {
            bankFySnapshot = extractBankFySnapshot(rawRetrieveData);
        } catch (fyErr) {
            console.error('[pullSync] Bank FY snapshot extraction error:', fyErr.message);
        }
    }

    const updated = await prisma.bankStatementAnalysisRequest.update({
        where: { report_id },
        data: {
            status: mappedStatus,
            provider_message: statusStr,
            raw_retrieve_response: rawRetrieveData,
            raw_download_response: rawRetrieveData,
            bank_excel_document_id: excelDocId || undefined,
            bank_json_document_id: jsonDocId || undefined,
            report_excel_url: excelUrl,
            report_json_url: jsonUrl,
            avg_bank_balance_latest_year: bankFySnapshot.latest,
            avg_bank_balance_previous_year: bankFySnapshot.previous,
            financial_year_latest: bankFySnapshot.fy_latest,
            financial_year_previous: bankFySnapshot.fy_previous,
        }
    });

    if (mappedStatus === 'COMPLETED' || mappedStatus === 'FAILED') {
        if (existingRequest.case_id) {
            await prisma.caseDataPullStatus.upsert({
                where: { case_id: existingRequest.case_id },
                create: { case_id: existingRequest.case_id, bank_status: mappedStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' },
                update: { bank_status: mappedStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' }
            });

            if (mappedStatus === 'COMPLETED') {
                // Extract ESR financials asynchronously
                const { extractEsrFinancials } = require('./esrFinancials.service');
                extractEsrFinancials(existingRequest.case_id, existingRequest.tenant_id).catch(err => console.error(err));
            }
        }
    }

    const changed = mappedStatus !== existingRequest.status
        || excelDocId !== existingRequest.bank_excel_document_id
        || jsonDocId !== existingRequest.bank_json_document_id;

    return { changed, status: mappedStatus, rawStatus: statusStr, requestData: updated };
}

/**
 * Ask the provider for the finished report files. The vendor keeps returning
 * 202/"IN PROGRESS" for a while after analysis completes, so this reports
 * `pending: true` rather than failing — callers retry.
 */
async function fetchBankReportLinks(existingRequest, actor = {}) {
    if (!existingRequest) throw new Error('Bank request log not found');
    if (existingRequest.status !== 'COMPLETED') {
        const err = new Error('Report is not yet completed natively.');
        err.status = 400;
        throw err;
    }

    const report_id = existingRequest.report_id;
    const providerRes = await bankService.downloadReport(report_id, 'excel and json');
    const resultPayload = providerRes.result || providerRes;

    if (resultPayload.statusCode === 202 || resultPayload.status === 'IN PROGRESS') {
        return {
            pending: true,
            changed: false,
            message: resultPayload.message || 'Report is still generating. Please try again in a few moments.'
        };
    }

    const excelUrl = resultPayload.excelUrl || resultPayload.excel;
    const jsonUrl = resultPayload.jsonUrl || resultPayload.json;

    if (!excelUrl && !jsonUrl) {
        const err = new Error('Download links are missing from vendor response.');
        err.status = 400;
        err.response = resultPayload;
        throw err;
    }

    // Buffer raw JSON natively into DB if available
    let rawRetrieveData = null;
    if (jsonUrl) {
        try {
            const jsonRes = await safeGet(jsonUrl, { timeout: 30000 });
            rawRetrieveData = jsonRes.data;
        } catch (e) {
            console.error('[pullSync] Failed to buffer json payload into string:', e.message);
        }
    }

    // Re-extract FY snapshot from downloaded JSON if we have it
    let bankFySnapshot = { latest: null, previous: null, fy_latest: null, fy_previous: null };
    if (rawRetrieveData) {
        try {
            bankFySnapshot = extractBankFySnapshot(rawRetrieveData);
        } catch (fyErr) {
            console.error('[pullSync] Bank FY extraction error:', fyErr.message);
        }
    }

    const tenantId = actor.tenantId || existingRequest.tenant_id;
    const userId = actor.userId || existingRequest.created_by_user_id;

    let excelDocId = existingRequest.bank_excel_document_id;
    let jsonDocId = existingRequest.bank_json_document_id;

    const ingestionJobs = [];

    if (excelUrl && !excelDocId) {
        ingestionJobs.push(
            documentService.ingestFromUrl({
                vendorUrl: excelUrl,
                documentType: 'BANK_EXCEL',
                tenantId,
                customerId: existingRequest.customer_id,
                caseId: existingRequest.case_id,
                applicantId: existingRequest.applicant_id,
                uploadedByUserId: userId,
                originalFileName: `bank_statement_${report_id}.xlsx`,
                metadata: { report_id, source: 'signzy_bank_download' }
            }).then(doc => { excelDocId = doc.id; }).catch(err => {
                console.error('[pullSync] Excel ingestion failed:', err.message);
            })
        );
    }

    if (jsonUrl && !jsonDocId) {
        ingestionJobs.push(
            documentService.ingestFromUrl({
                vendorUrl: jsonUrl,
                documentType: 'BANK_JSON',
                tenantId,
                customerId: existingRequest.customer_id,
                caseId: existingRequest.case_id,
                applicantId: existingRequest.applicant_id,
                uploadedByUserId: userId,
                originalFileName: `bank_statement_${report_id}.json`,
                metadata: { report_id, source: 'signzy_bank_download' }
            }).then(doc => { jsonDocId = doc.id; }).catch(err => {
                console.error('[pullSync] JSON ingestion failed:', err.message);
            })
        );
    }

    await Promise.allSettled(ingestionJobs);

    const updated = await prisma.bankStatementAnalysisRequest.update({
        where: { report_id },
        data: {
            report_excel_url: excelUrl,        // Audit/source — NOT used for serving
            report_json_url: jsonUrl,          // Audit/source — NOT used for serving
            raw_retrieve_response: rawRetrieveData || existingRequest.raw_retrieve_response,
            raw_download_response: providerRes,
            bank_excel_document_id: excelDocId || undefined,
            bank_json_document_id: jsonDocId || undefined,
            avg_bank_balance_latest_year: bankFySnapshot.latest || existingRequest.avg_bank_balance_latest_year,
            avg_bank_balance_previous_year: bankFySnapshot.previous || existingRequest.avg_bank_balance_previous_year,
            financial_year_latest: bankFySnapshot.fy_latest || existingRequest.financial_year_latest,
            financial_year_previous: bankFySnapshot.fy_previous || existingRequest.financial_year_previous,
        }
    });

    const changed = excelDocId !== existingRequest.bank_excel_document_id
        || jsonDocId !== existingRequest.bank_json_document_id;

    return {
        pending: false,
        changed,
        documentIds: { excel: excelDocId || null, json: jsonDocId || null },
        sourceUrls: { excel: excelUrl || null, json: jsonUrl || null },
        requestData: updated
    };
}

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

function hasUsableGstFetchPayload(dataRes) {
    if (!dataRes || typeof dataRes !== 'object') return false;
    if (dataRes.gstin || dataRes.gstr1 || dataRes.gstr3b) return true;
    if (dataRes.data?.gstin || dataRes.data?.gstr1 || dataRes.data?.gstr3b) return true;
    if (dataRes.result?.gstin || dataRes.result?.gstr1 || dataRes.result?.gstr3b) return true;
    return false;
}

/**
 * Advance a GST journey: fetch the raw return data, then the generated report
 * bundle, ingesting each into our own document storage as it appears.
 *
 * @param {object} dbReq - the GstrAnalyticsRequest row
 */
async function syncGstRequest(dbReq) {
    if (!dbReq) throw new Error('GST Request not found');

    let currentStatus = dbReq.status;
    let dataSynced = false;

    // Fetch data safely without re-billing (data is the raw payload)
    if (['PROCESSING', 'DATA_READY', 'REPORT_READY'].includes(currentStatus)) {
        try {
            const dataRes = await gstService.fetchData(dbReq.provider_request_id);
            // "message": "Request is in progress." vs an actual data payload ("gstr1")
            if (dataRes.status === 'SUCCESS' && dataRes.message === 'Request is in progress.') {
                // Still processing
            } else if (hasUsableGstFetchPayload(dataRes)) {
                currentStatus = 'DATA_READY';

                await prisma.gstrAnalyticsRequest.update({
                    where: { id: dbReq.id },
                    data: { raw_fetch_data: dataRes, status: 'DATA_READY' }
                });
                dataSynced = true;
            }
        } catch (err) {
            // Ignore — most likely just not ready yet
            console.error('[pullSync] GST fetch-data error:', err.message);
        }
    }

    // Fetch report links (triggered while in flight, and again if the record is
    // terminal but its documents were never ingested)
    if (['PROCESSING', 'DATA_READY', 'REPORT_READY'].includes(currentStatus)) {
        try {
            const reportRes = await gstService.fetchReport(dbReq.provider_request_id);
            if (reportRes.pdfUrl || reportRes.jsonDataUrl || reportRes.excelUrl) {
                currentStatus = 'REPORT_READY';

                // Ingest vendor report URLs into our storage (non-fatal if it fails)
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
                            .catch(e => console.error('[pullSync] GST PDF ingestion failed:', e.message))
                    );
                }
                if (reportRes.excelUrl && !excelDocId) {
                    gstIngestionJobs.push(
                        documentService.ingestFromUrl({ ...ingestionBase, vendorUrl: reportRes.excelUrl, documentType: 'GST_REPORT_EXCEL', originalFileName: `gst_report_${dbReq.gstin}.xlsx` })
                            .then(doc => { excelDocId = doc.id; })
                            .catch(e => console.error('[pullSync] GST Excel ingestion failed:', e.message))
                    );
                }
                if (reportRes.jsonDataUrl && !jsonDocId) {
                    gstIngestionJobs.push(
                        documentService.ingestFromUrl({ ...ingestionBase, vendorUrl: reportRes.jsonDataUrl, documentType: 'GST_REPORT_JSON', originalFileName: `gst_report_${dbReq.gstin}.json` })
                            .then(doc => { jsonDocId = doc.id; })
                            .catch(e => console.error('[pullSync] GST JSON ingestion failed:', e.message))
                    );
                }
                await Promise.allSettled(gstIngestionJobs);

                let rawReportData = undefined;
                if (reportRes.jsonDataUrl) {
                    try {
                        const downloader = await safeGet(reportRes.jsonDataUrl, { timeout: 30000 });
                        rawReportData = downloader.data;
                    } catch (err) { console.error('[pullSync] Failed to download GST JSON payload:', err.message); }
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
                    const { extractEsrFinancials } = require('./esrFinancials.service');
                    extractEsrFinancials(dbReq.case_id, dbReq.tenant_id).catch(err => console.error(err));
                }
            }
        } catch (err) {
            console.error('[pullSync] GST fetch-report error:', err.message);
        }
    }

    if (currentStatus !== dbReq.status) {
        await prisma.gstrAnalyticsRequest.update({
            where: { id: dbReq.id },
            data: { status: currentStatus }
        });
    }

    if (dataSynced) {
        const { finalizeGstAnalyticsRequest } = require('./gst.service');
        await finalizeGstAnalyticsRequest(dbReq.id, dbReq.tenant_id).catch(e => console.error('[pullSync] GST finalize error:', e.message));
    }

    return { changed: dataSynced || currentStatus !== dbReq.status, status: currentStatus, dataSynced };
}

module.exports = {
    syncItrRequest,
    syncBankRequest,
    fetchBankReportLinks,
    syncGstRequest,
    hasUsableGstFetchPayload,
    extractItrFySnapshot,
    extractDataFromRawItrJson,
};
