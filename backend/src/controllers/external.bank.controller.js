const prisma = require('../../config/db');
const bankService = require('../services/externalApis/bank.service');
const { executePaidApi } = require('../services/wallet.service');
const documentService = require('../services/document.service');

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
                } catch(e) {
                    console.error("[Bank Sync] Failed to buffer json payload into string:", e.message);
                }
            }
        }

        const updated = await prisma.bankStatementAnalysisRequest.update({
            where: { report_id },
            data: { 
                status: mappedStatus,
                provider_message: statusStr,
                raw_retrieve_response: rawRetrieveData, // Extracted full JSON payload via User Request
                raw_download_response: rawRetrieveData,
                bank_excel_document_id: excelDocId || undefined,
                bank_json_document_id: jsonDocId || undefined,
                report_excel_url: excelUrl,
                report_json_url: jsonUrl
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
        let jsonDocId  = existingRequest.bank_json_document_id;

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
                bank_json_document_id:  jsonDocId  || undefined,
            }
        });

        // Return document IDs for frontend to use our endpoints — NOT vendor URLs
        res.status(200).json({
            success: true,
            documentIds: {
                excel: excelDocId || null,
                json:  jsonDocId  || null,
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
        console.log(`[Bank Webhook] Signature received`);
        const payload = req.body;
        
        let reportId = req.query.report_id || payload.reportId || payload.id || payload.requestId;
        
        // Sometimes the payload sends reportId safely tucked inside result block
        if (!reportId && payload.result) {
            reportId = payload.result.reportId || payload.result.id;
        }

        if (!reportId) {
            console.error("[Bank Webhook] Unmapped Bank Webhook received and reportId could not be deduced. Raw:", JSON.stringify(payload));
            return res.status(400).json({ status: 'FAILED', error: "Could not deduce report_id mapping." });
        }

        console.log(`[Bank Webhook] Processing background sync for report: ${reportId}`);

        // Directly mimic the polling user to trigger our own synchronized sync logic inside controller natively!
        // This invokes existing logic strictly on server side context safely.
        req.body.report_id = reportId;
        req.user = req.user || null; // Will safely inherit logic blocks natively
        
        return await syncStatus(req, res);

    } catch (err) {
        console.error("[Bank Webhook Endpoint Failure]:", err);
        return res.status(500).json({ status: 'FAILED', error: err.message });
    }
}

module.exports = {
    analyze,
    syncStatus,
    downloadData,
    handleSignzyCallback
};
