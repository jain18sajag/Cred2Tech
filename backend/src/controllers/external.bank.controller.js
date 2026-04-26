const prisma = require('../../config/db');
const bankService = require('../services/externalApis/bank.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');

// Helper: extract latest & previous FY Average Bank Balance from bank JSON report
function extractBankFySnapshot(rawRetrieveData) {
    const result = { latest: null, previous: null, fy_latest: null, fy_previous: null };
    if (!rawRetrieveData) return result;

    const toNum = v => {
        if (v === undefined || v === null) return null;
        const n = Number(String(v).replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
    };

    // Support both rawBank.overview and rawBank.result[0].overview
    const overview = rawRetrieveData?.overview
        ?? rawRetrieveData?.result?.[0]?.overview
        ?? rawRetrieveData?.[0]?.overview;

    const balances = overview?.monthlyAverageDailyBalance;

    if (Array.isArray(balances) && balances.length > 0) {
        // Group by financial year
        const fyTotals = {};
        const fyCounts = {};

        for (const entry of balances) {
            // entry may have month/year fields or just averageDailyBalance
            const dateStr = entry.month || entry.date || '';
            const avgBal = toNum(entry.averageDailyBalance);
            if (avgBal === null) continue;

            // Try to determine financial year from date string
            let fyKey = 'FY (aggregated)';
            if (dateStr) {
                // dateStr may be "2023-04" or "Apr-2023" etc.
                const match = dateStr.match(/(\d{4})[\-\/](\d{1,2})/) || dateStr.match(/(\w{3})[\-\/](\d{4})/);
                if (match) {
                    let year, month;
                    if (!isNaN(match[1])) {
                        year = parseInt(match[1]); month = parseInt(match[2]);
                    } else {
                        const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
                        month = monthMap[match[1]] || 1; year = parseInt(match[2]);
                    }
                    const fyStart = month >= 4 ? year : year - 1;
                    fyKey = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;
                }
            }

            fyTotals[fyKey] = (fyTotals[fyKey] || 0) + avgBal;
            fyCounts[fyKey] = (fyCounts[fyKey] || 0) + 1;
        }

        const sortedFYs = Object.keys(fyTotals).sort().reverse();
        if (sortedFYs.length > 0) {
            result.fy_latest = sortedFYs[0];
            result.latest = fyTotals[sortedFYs[0]] / fyCounts[sortedFYs[0]]; // Monthly average
        }
        if (sortedFYs.length > 1) {
            result.fy_previous = sortedFYs[1];
            result.previous = fyTotals[sortedFYs[1]] / fyCounts[sortedFYs[1]];
        }
    }

    return result;
}

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
            handlerFunction: async () => {
                // Trigger provider API securely isolated in backend
                const providerRes = await bankService.analyzeStatement(files);

                // Assuming providerRes returns an object with report or result
                const reportId = providerRes.report?.reportId || providerRes.reportId || providerRes.result?.reportId || providerRes.id;

                if (!reportId) {
                    console.error("[SIGNZY BANK ANALYZE - UNEXPECTED RESPONSE PAYLOAD]:", JSON.stringify(providerRes, null, 2));
                    throw new Error(`Failed to extract reportId from provider response. Provider returned: ${JSON.stringify(providerRes).substring(0, 150)}`);
                }

                const bankRequest = await prisma.bankStatementAnalysisRequest.create({
                    data: {
                        tenant_id: tenantId,
                        customer_id: parseInt(customer_id, 10),
                        case_id: case_id ? parseInt(case_id, 10) : null,
                        applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                        report_id: reportId.toString(),
                        status: 'ANALYZING',
                        files_payload: files,
                        raw_analyze_response: providerRes,
                        created_by_user_id: userId
                    }
                });

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

        res.status(200).json({ success: true, bankRequest: result });
    } catch (error) {
        console.error("Bank Analyze Error: ", error);

        let statusCode = 500;
        if (error.status === 401) statusCode = 502; // Prevents frontend JWT interceptor logout
        else if (error.status === 402) statusCode = 402;
        else if (error.status === 409) statusCode = 409;
        else if (error.status >= 400 && error.status < 500) statusCode = error.status;

        res.status(statusCode).json({ error: error.message || "Failed to start bank analysis" });
    }
}

async function syncStatus(req, res) {
    try {
        const { report_id } = req.body;

        if (!report_id) {
            return res.status(400).json({ error: "report_id is required" });
        }

        const existingRequest = await prisma.bankStatementAnalysisRequest.findUnique({
            where: { report_id: report_id }
        });

        if (!existingRequest) {
            return res.status(404).json({ error: "Bank request log not found" });
        }

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

        // Automatically download URLs just like the Webhooks do!
        if (mappedStatus === 'COMPLETED') {
            const ingestionJobs = [];

            // Note: Since syncStatus is authenticated in our route, req.user is guaranteed.
            // When building true webhooks, you pull tenant_id from the existingRequest instead.
            const tenantId = req.user ? req.user.tenant_id : existingRequest.tenant_id;
            const userId = req.user ? req.user.id : existingRequest.created_by_user_id;

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
                    console.error('[bank.controller] Auto-Excel ingestion failed:', err.message);
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
                    console.error('[bank.controller] Auto-JSON ingestion failed:', err.message);
                }));
            }

            // Await parallel system injections
            await Promise.allSettled(ingestionJobs);

            // User dynamically requested raw JSON bytes natively loaded into raw_retrieve_response field
            if (jsonUrl) {
                try {
                    const axios = require('axios');
                    const downRes = await axios.get(jsonUrl);
                    rawRetrieveData = downRes.data;
                } catch (e) {
                    console.error("[Bank Sync] Failed to buffer json payload into string:", e.message);
                }
            }
        }

        // Extract FY ABB snapshot and persist alongside the regular fields
        let bankFySnapshot = { latest: null, previous: null, fy_latest: null, fy_previous: null };
        if (mappedStatus === 'COMPLETED') {
            try {
                bankFySnapshot = extractBankFySnapshot(rawRetrieveData);
                console.log('[Bank FY Snapshot]', bankFySnapshot);
            } catch (fyErr) {
                console.error('[Bank FY Snapshot] Extraction error:', fyErr.message);
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
                await prisma.caseDataPullStatus.update({
                    where: { case_id: existingRequest.case_id },
                    data: { bank_status: mappedStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' }
                });

                if (mappedStatus === 'COMPLETED') {
                    // Extract ESR financials asynchronously
                    const { extractEsrFinancials } = require('../services/esrFinancials.service');
                    extractEsrFinancials(existingRequest.case_id).catch(err => console.error(err));
                }
            }
        }

        res.status(200).json({ success: true, status: mappedStatus, rawStatus: statusStr, requestData: updated });
    } catch (error) {
        console.error("Bank Sync Error: ", error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        res.status(statusCode).json({ error: error.message || "Failed to sync status" });
    }
}

async function downloadData(req, res) {
    try {
        const { report_id } = req.body;

        if (!report_id) {
            return res.status(400).json({ error: "report_id is required" });
        }

        const existingRequest = await prisma.bankStatementAnalysisRequest.findUnique({
            where: { report_id }
        });

        if (!existingRequest || existingRequest.status !== 'COMPLETED') {
            return res.status(400).json({ error: "Report is not yet completed natively." });
        }

        const providerRes = await bankService.downloadReport(report_id, 'excel and json');

        const resultPayload = providerRes.result || providerRes;

        if (resultPayload.statusCode === 202 || resultPayload.status === 'IN PROGRESS') {
            return res.status(202).json({
                success: false,
                message: resultPayload.message || "Report is still generating. Please try again in a few moments."
            });
        }

        const excelUrl = resultPayload.excelUrl || resultPayload.excel;
        const jsonUrl = resultPayload.jsonUrl || resultPayload.json;

        if (!excelUrl && !jsonUrl) {
            return res.status(400).json({
                error: "Download links are missing from vendor response.",
                response: resultPayload
            });
        }

        // Ingest vendor URLs into our own storage (runs in parallel for speed)
        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

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
                    console.error('[bank.controller] Excel ingestion failed:', err.message);
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
                    console.error('[bank.controller] JSON ingestion failed:', err.message);
                })
            );
        }

        await Promise.allSettled(ingestionJobs);

        // Persist document IDs + keep vendor URLs in source fields for audit
        const updated = await prisma.bankStatementAnalysisRequest.update({
            where: { report_id },
            data: {
                report_excel_url: excelUrl,        // Audit/source — NOT used for serving
                report_json_url: jsonUrl,          // Audit/source — NOT used for serving
                raw_download_response: providerRes,
                bank_excel_document_id: excelDocId || undefined,
                bank_json_document_id: jsonDocId || undefined,
            }
        });

        // Return document IDs for frontend to use our endpoints — NOT vendor URLs
        res.status(200).json({
            success: true,
            documentIds: {
                excel: excelDocId || null,
                json: jsonDocId || null,
            },
            // Preserve for backward compatibility: still include vendor URLs but label them clearly
            sourceUrls: { excel: excelUrl, json: jsonUrl },
            requestData: updated
        });
    } catch (error) {
        console.error("Bank Download Error: ", error);
        const statusCode = error.status === 401 ? 502 : (error.status || 500);
        res.status(statusCode).json({ error: error.message || "Failed to download URLs" });
    }
}

async function handleSignzyCallback(req, res) {
    try {
        const payload = req.body;
        console.log('[Bank Webhook] Received payload:', JSON.stringify(payload));

        // Extract reportId — Signzy sends it in multiple possible shapes
        const resultObj = payload.result || payload;
        const reportId = payload.report_id
            || payload.reportId
            || resultObj.reportId
            || resultObj.report_id
            || req.query.report_id;

        if (!reportId) {
            console.error('[Bank Webhook] Could not deduce reportId. Payload:', JSON.stringify(payload));
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

        if (existingRequest.status === 'COMPLETED') {
            console.log(`[Bank Webhook] Duplicate callback ignored for report_id: ${reportId}`);
            return res.status(200).json({ received: true, note: 'Already completed' });
        }

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
                const axios = require('axios');
                const response = await axios.get(jsonUrl, { timeout: 30000 });
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
                console.log('[Bank Webhook][FY Snapshot]', bankFySnapshot);
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

        // Persist everything — status, files, and FY snapshot columns
        await prisma.bankStatementAnalysisRequest.update({
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
                await extractEsrFinancials(existingRequest.case_id);
                console.log(`[Bank Webhook] ESR extraction triggered for case ${existingRequest.case_id}`);
            } catch (esrErr) {
                console.error('[Bank Webhook] ESR extraction error:', esrErr.message);
            }
        }

        return res.status(200).json({ received: true });

    } catch (err) {
        console.error('[Bank Webhook] Unhandled error:', err);
        return res.status(500).json({ error: 'Internal processing error' });
    }
}

module.exports = {
    analyze,
    syncStatus,
    downloadData,
    handleSignzyCallback
};
