const prisma = require('../../config/db');
const path = require('path');
const { processSalarySlipSync, processSalarySlipBatchSync, startSalarySlipAsync, startSalarySlipBatchAsync, getJobStatus } = require('../services/externalApis/fractoSalaryOcr.service');

/**
 * Trigger OCR processing for a specific salary slip document.
 * POST /api/cases/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr
 */
async function triggerSalarySlipOcr(req, res) {
    try {
        const { caseId, applicantId, documentId } = req.params;
        const { month, year } = req.body;
        const tenant_id = req.user.tenant_id;

        if (!month || !year) {
            return res.status(400).json({ error: 'Month and year are required' });
        }

        // 1. Validate Ownership & Existence
        const document = await prisma.document.findFirst({
            where: {
                id: parseInt(documentId),
                tenant_id: tenant_id,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                document_type: 'SALARY_SLIP'
            }
        });

        if (!document) {
            return res.status(404).json({ error: 'Salary slip document not found or does not belong to this applicant' });
        }

        // 2. Locate File Path
        const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');
        const resolvedPath = path.resolve(UPLOADS_ROOT, document.storage_path);

        // Prevent path traversal
        if (!resolvedPath.startsWith(UPLOADS_ROOT)) {
            return res.status(400).json({ error: 'Invalid document storage path' });
        }

        // 3. Upsert PENDING OCR Record
        const ocrRecord = await prisma.salarySlipOcrResult.upsert({
            where: {
                case_id_applicant_id_month_year: {
                    case_id: parseInt(caseId),
                    applicant_id: parseInt(applicantId),
                    month,
                    year
                }
            },
            update: {
                ocr_status: 'PENDING',
                document_id: parseInt(documentId)
            },
            create: {
                tenant_id,
                customer_id: document.customer_id,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                document_id: parseInt(documentId),
                month,
                year,
                ocr_status: 'PENDING'
            }
        });

        const ocrMode = process.env.FRACTO_OCR_MODE || 'sync';
        let ocrResultData;

        // 4. Trigger OCR
        if (ocrMode === 'async') {
            ocrResultData = await startSalarySlipAsync({
                filePath: resolvedPath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: parseInt(documentId),
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                month,
                year,
                tenant_id
            });

            // Save processing status
            await prisma.salarySlipOcrResult.update({
                where: { id: ocrRecord.id },
                data: {
                    ocr_status: 'PROCESSING',
                    vendor_job_id: ocrResultData.vendor_job_id,
                    raw_ocr_response: ocrResultData.raw_ocr_response
                }
            });

        } else {
            // Sync mode
            ocrResultData = await processSalarySlipSync({
                filePath: resolvedPath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: parseInt(documentId),
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                month,
                year,
                tenant_id
            });

            // Save completed status
            await prisma.salarySlipOcrResult.update({
                where: { id: ocrRecord.id },
                data: {
                    ocr_status: ocrResultData.status,
                    vendor_job_id: ocrResultData.vendor_job_id,
                    raw_ocr_response: ocrResultData.raw_ocr_response,
                    extracted_json: ocrResultData.extracted_json,
                    gross_salary: ocrResultData.gross_salary,
                    net_salary: ocrResultData.net_salary,
                    deductions: ocrResultData.deductions,
                    employer_name: ocrResultData.employer_name,
                    employee_name: ocrResultData.employee_name
                }
            });

            if (ocrResultData.status === 'COMPLETED') {
                await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));
            }
        }

        const updatedRecord = await prisma.salarySlipOcrResult.findUnique({ where: { id: ocrRecord.id } });
        res.json({ success: true, data: updatedRecord });

    } catch (error) {
        console.error('[salaryOcr.controller] triggerSalarySlipOcr error:', error);

        // Handle Fracto errors securely
        if (error.message.includes('OCR service') || error.message.includes('File size')) {
            try {
                const { caseId, applicantId, documentId } = req.params;
                const { month, year } = req.body;

                await prisma.salarySlipOcrResult.updateMany({
                    where: {
                        case_id: parseInt(caseId), applicant_id: parseInt(applicantId), month, year
                    },
                    data: {
                        ocr_status: 'FAILED',
                        error_message: error.message
                    }
                });
            } catch (updateErr) {
                console.error('Failed to update OCR status to FAILED', updateErr);
            }
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Failed to process salary slip.' });
    }
}

/**
 * Trigger batch OCR processing for multiple salary slip documents.
 * POST /api/cases/:caseId/applicants/:applicantId/salary-slips/ocr-batch
 */
async function processSalarySlipOcrBatch(req, res) {
    try {
        const { caseId, applicantId } = req.params;
        const { documentIds } = req.body; // Array of { documentId, month, year }
        const tenant_id = req.user.tenant_id;

        if (!Array.isArray(documentIds) || documentIds.length === 0) {
            return res.status(400).json({ error: 'documentIds array is required' });
        }

        const filesToProcess = [];
        const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');

        for (const docObj of documentIds) {
            const document = await prisma.document.findFirst({
                where: {
                    id: parseInt(docObj.documentId),
                    tenant_id: tenant_id,
                    case_id: parseInt(caseId),
                    applicant_id: parseInt(applicantId),
                    document_type: 'SALARY_SLIP'
                }
            });

            if (!document) {
                return res.status(404).json({ error: `Document ${docObj.documentId} not found or unauthorized.` });
            }

            const resolvedPath = path.resolve(UPLOADS_ROOT, document.storage_path);
            if (!resolvedPath.startsWith(UPLOADS_ROOT)) {
                return res.status(400).json({ error: 'Invalid document storage path' });
            }

            filesToProcess.push({
                filePath: resolvedPath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: document.id,
                customer_id: document.customer_id,
                month: docObj.month,
                year: docObj.year
            });
        }

        // Upsert PENDING OCR Records for all files
        const ocrRecords = [];
        for (const f of filesToProcess) {
            const ocrRecord = await prisma.salarySlipOcrResult.upsert({
                where: {
                    case_id_applicant_id_month_year: {
                        case_id: parseInt(caseId),
                        applicant_id: parseInt(applicantId),
                        month: f.month,
                        year: f.year
                    }
                },
                update: {
                    ocr_status: 'PENDING',
                    document_id: f.document_id
                },
                create: {
                    tenant_id,
                    customer_id: f.customer_id,
                    case_id: parseInt(caseId),
                    applicant_id: parseInt(applicantId),
                    document_id: f.document_id,
                    month: f.month,
                    year: f.year,
                    ocr_status: 'PENDING'
                }
            });
            ocrRecords.push(ocrRecord);
        }

        const ocrMode = process.env.FRACTO_OCR_MODE || 'sync';
        let ocrResultData;

        if (ocrMode === 'async') {
            // Trigger Async Batch OCR
            ocrResultData = await startSalarySlipBatchAsync({
                files: filesToProcess,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                tenant_id
            });

            // Save processing status and the shared job_id for all records
            for (const record of ocrRecords) {
                await prisma.salarySlipOcrResult.update({
                    where: { id: record.id },
                    data: {
                        ocr_status: 'PROCESSING',
                        vendor_job_id: ocrResultData.vendor_job_id,
                        raw_ocr_response: ocrResultData.raw_ocr_response
                    }
                });
            }
        } else {
            // Sync mode
            ocrResultData = await processSalarySlipBatchSync({
                files: filesToProcess,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                tenant_id
            });

            // If we have individual batch results, use them
            const batchResults = ocrResultData.batchResults || [];

            // Save completed status for all records
            for (const record of ocrRecords) {
                // Find specific result for this month/year if available
                const specificResult = batchResults.find(r => r.month === record.month && r.year === record.year) || ocrResultData;

                await prisma.salarySlipOcrResult.update({
                    where: { id: record.id },
                    data: {
                        ocr_status: specificResult.status || 'FAILED',
                        vendor_job_id: specificResult.vendor_job_id ? String(specificResult.vendor_job_id) : null,
                        raw_ocr_response: specificResult.raw_ocr_response || null,
                        extracted_json: specificResult.extracted_json || null,
                        gross_salary: specificResult.gross_salary || null,
                        net_salary: specificResult.net_salary || null,
                        deductions: specificResult.deductions || null,
                        employer_name: specificResult.employer_name || null,
                        employee_name: specificResult.employee_name || null,
                        error_message: specificResult.error_message || null
                    }
                });
            }

            if (ocrResultData.status === 'COMPLETED') {
                await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));
            }
        }

        const updatedRecords = await prisma.salarySlipOcrResult.findMany({
            where: {
                id: { in: ocrRecords.map(r => r.id) }
            }
        });

        res.json({ success: true, message: ocrMode === 'async' ? 'Batch OCR triggered' : 'Batch OCR completed', job_id: ocrResultData.vendor_job_id, data: updatedRecords });

    } catch (error) {
        console.error('[salaryOcr.controller] processSalarySlipOcrBatch error:', error);
        res.status(500).json({ error: error.message || 'Failed to process salary slip batch.' });
    }
}

/**
 * Poll Async OCR Job Status
 * POST /api/cases/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr/poll
 */
async function pollSalarySlipOcr(req, res) {
    try {
        const { caseId, applicantId, documentId } = req.params;
        const tenant_id = req.user.tenant_id;

        const ocrRecord = await prisma.salarySlipOcrResult.findFirst({
            where: {
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                document_id: parseInt(documentId),
                tenant_id: tenant_id
            }
        });

        if (!ocrRecord) {
            return res.status(404).json({ error: 'Salary slip OCR record not found.' });
        }

        if (ocrRecord.ocr_status !== 'PROCESSING' || !ocrRecord.vendor_job_id) {
            return res.json({ success: true, data: ocrRecord });
        }

        const statusResult = await getJobStatus(ocrRecord.vendor_job_id);

        if (statusResult.status === 'PROCESSING') {
            // Still processing
            return res.json({ success: true, data: ocrRecord });
        }

        if (statusResult.status === 'FAILED') {
            const updated = await prisma.salarySlipOcrResult.update({
                where: { id: ocrRecord.id },
                data: {
                    ocr_status: 'FAILED',
                    error_message: statusResult.error_message || 'Vendor OCR processing failed.',
                    raw_ocr_response: statusResult.raw_ocr_response
                }
            });
            return res.json({ success: true, data: updated });
        }

        if (statusResult.status === 'COMPLETED') {
            const updated = await prisma.salarySlipOcrResult.update({
                where: { id: ocrRecord.id },
                data: {
                    ocr_status: 'COMPLETED',
                    raw_ocr_response: statusResult.raw_ocr_response,
                    extracted_json: statusResult.extracted_json,
                    gross_salary: statusResult.gross_salary,
                    net_salary: statusResult.net_salary,
                    deductions: statusResult.deductions,
                    employer_name: statusResult.employer_name,
                    employee_name: statusResult.employee_name
                }
            });

            await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));

            return res.json({ success: true, data: updated });
        }

        res.json({ success: true, data: ocrRecord });
    } catch (error) {
        console.error('[salaryOcr.controller] pollSalarySlipOcr error:', error);
        res.status(500).json({ error: 'Failed to poll OCR status.' });
    }
}

/**
 * Calculates the average annualized salary from all COMPLETED OCR results 
 * for a specific applicant, and updates the CaseIncomeEntry.
 */
async function recalculateApplicantIncome(tenant_id, case_id, applicant_id) {
    const completedSlips = await prisma.salarySlipOcrResult.findMany({
        where: { tenant_id, case_id, applicant_id, ocr_status: 'COMPLETED' }
    });

    if (completedSlips.length === 0) return;

    // Calculate average net monthly salary
    const totalNet = completedSlips.reduce((sum, slip) => sum + (slip.net_salary || 0), 0);
    const avgNetMonthly = totalNet / completedSlips.length;
    const annualizedIncome = avgNetMonthly * 12;

    const existingEntry = await prisma.caseIncomeEntry.findFirst({
        where: { 
            case_id: parseInt(case_id), 
            applicant_id: parseInt(applicant_id), 
            supporting_doc_type: 'Salary Slip',
            remarks: { contains: 'Generated from Salary Slip OCR' }
        }
    });

    if (existingEntry) {
        await prisma.caseIncomeEntry.update({
            where: { id: existingEntry.id },
            data: {
                annual_amount: annualizedIncome,
                remarks: `Generated from Salary Slip OCR (${completedSlips.length} slips)`
            }
        });
    } else {
        await prisma.caseIncomeEntry.create({
            data: {
                case_id: parseInt(case_id),
                applicant_id: parseInt(applicant_id),
                income_type: 'Salary',
                annual_amount: annualizedIncome,
                supporting_doc_type: 'Salary Slip',
                remarks: `Generated from Salary Slip OCR (${completedSlips.length} slips)`
            }
        });
    }
}

/**
 * Get salary summary (all OCR results) for a case/applicant
 * GET /api/cases/:caseId/salary-summary
 */
async function getSalarySummary(req, res) {
    try {
        const { caseId } = req.params;
        const { applicantId } = req.query;
        const tenant_id = req.user.tenant_id;

        const whereClause = {
            tenant_id,
            case_id: parseInt(caseId)
        };

        if (applicantId) {
            whereClause.applicant_id = parseInt(applicantId);
        }

        const results = await prisma.salarySlipOcrResult.findMany({
            where: whereClause,
            include: {
                applicant: {
                    select: { name: true, pan_number: true, is_primary: true }
                }
            },
            orderBy: [
                { applicant_id: 'asc' },
                { year: 'desc' },
                { month: 'desc' }
            ]
        });

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('[salaryOcr.controller] getSalarySummary error:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Add a manual salary entry, acting exactly like a completed OCR result downstream.
 * POST /api/cases/:caseId/applicants/:applicantId/salary-slips/manual
 */
async function addManualSalaryEntry(req, res) {
    try {
        const { caseId, applicantId } = req.params;
        const { month, year, gross_salary, net_salary, deductions, employer_name, employee_name } = req.body;
        const tenant_id = req.user.tenant_id;

        if (!month || !year) return res.status(400).json({ error: 'Month and year are required' });
        if (!gross_salary || !net_salary) return res.status(400).json({ error: 'Gross and Net salary are required' });

        const applicant = await prisma.applicant.findUnique({
            where: { id: parseInt(applicantId) },
            select: { case: { select: { customer_id: true } } }
        });

        if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

        const record = await prisma.salarySlipOcrResult.upsert({
            where: {
                case_id_applicant_id_month_year: {
                    case_id: parseInt(caseId),
                    applicant_id: parseInt(applicantId),
                    month,
                    year
                }
            },
            update: {
                source: 'MANUAL',
                ocr_status: 'COMPLETED',
                gross_salary: parseFloat(gross_salary),
                net_salary: parseFloat(net_salary),
                deductions: deductions ? parseFloat(deductions) : null,
                employer_name: employer_name || null,
                employee_name: employee_name || null
            },
            create: {
                tenant_id,
                customer_id: applicant.case.customer_id,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                month,
                year,
                source: 'MANUAL',
                ocr_status: 'COMPLETED',
                gross_salary: parseFloat(gross_salary),
                net_salary: parseFloat(net_salary),
                deductions: deductions ? parseFloat(deductions) : null,
                employer_name: employer_name || null,
                employee_name: employee_name || null
            }
        });

        // Sync to CaseIncomeEntry
        await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));

        res.json({ success: true, data: record });
    } catch (error) {
        console.error('[salaryOcr.controller] addManualSalaryEntry error:', error);
        res.status(500).json({ error: 'Failed to add manual salary entry.' });
    }
}

module.exports = {
    triggerSalarySlipOcr,
    processSalarySlipOcrBatch,
    pollSalarySlipOcr,
    getSalarySummary,
    addManualSalaryEntry
};
