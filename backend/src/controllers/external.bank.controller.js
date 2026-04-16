const prisma = require('../../config/db');
const bankService = require('../services/externalApis/bank.service');
const { executePaidApi } = require('../services/wallet.service');

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
                
                // Assuming providerRes returns an object with reportId
                const reportId = providerRes.reportId || providerRes.result?.reportId || providerRes.id;
                
                if (!reportId) {
                    throw new Error("Failed to extract reportId from provider response");
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
        if (error.status === 402) statusCode = 402;
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
        const statusStr = providerRes.status || providerRes.result?.status;

        // Map provider status
        let mappedStatus = existingRequest.status;
        if (statusStr === 'COMPLETED' || statusStr === 'ANALYSED') mappedStatus = 'COMPLETED';
        else if (statusStr === 'IN PROGRESS') mappedStatus = 'ANALYZING';
        else if (statusStr === 'FAILED' || statusStr === 'REJECTED') mappedStatus = 'FAILED';

        const updated = await prisma.bankStatementAnalysisRequest.update({
            where: { report_id },
            data: { 
                status: mappedStatus,
                provider_message: statusStr
            }
        });

        if (mappedStatus === 'COMPLETED' || mappedStatus === 'FAILED') {
             if (existingRequest.case_id) {
                 await prisma.caseDataPullStatus.update({
                     where: { case_id: existingRequest.case_id },
                     data: { bank_status: mappedStatus === 'COMPLETED' ? 'COMPLETE' : 'FAILED' }
                 });
             }
        }

        res.status(200).json({ success: true, status: mappedStatus, rawStatus: statusStr, requestData: updated });
    } catch (error) {
        console.error("Bank Sync Error: ", error);
        res.status(error.status || 500).json({ error: error.message || "Failed to sync status" });
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
        // Signzy returns { result: { excelUrl: "...", jsonUrl: "..." } } typically, adjust based on exact payload
        
        const resultPayload = providerRes.result || providerRes;
        const excelUrl = resultPayload.excelUrl || resultPayload.excel;
        const jsonUrl = resultPayload.jsonUrl || resultPayload.json;

        const updated = await prisma.bankStatementAnalysisRequest.update({
            where: { report_id },
            data: {
                report_excel_url: excelUrl,
                report_json_url: jsonUrl
            }
        });

        res.status(200).json({ success: true, downloadUrls: { excel: excelUrl, json: jsonUrl }, requestData: updated });
    } catch (error) {
         console.error("Bank Download Error: ", error);
         res.status(error.status || 500).json({ error: error.message || "Failed to download URLs" });
    }
}

module.exports = {
    analyze,
    syncStatus,
    downloadData
};
