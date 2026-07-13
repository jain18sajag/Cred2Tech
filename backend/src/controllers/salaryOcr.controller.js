const prisma = require('../../config/db');
const path = require('path');
const {
    processSalarySlipSync,
    processSalarySlipBatchSync,
    startSalarySlipAsync,
    startSalarySlipBatchAsync,
    getJobStatus,
    buildSalarySlipOcrDbData
} = require('../services/externalApis/fractoSalaryOcr.service');

async function getApplicantForSalaryValidation(applicantId, caseId, tenantId) {
    return prisma.applicant.findFirst({
        where: {
            id: parseInt(applicantId),
            case_id: parseInt(caseId),
            case: { tenant_id: tenantId }
        },
        select: { id: true, name: true, pan_number: true }
    });
}

async function applySalaryOcrResult(record, ocrResultData) {
    const dbData = buildSalarySlipOcrDbData(ocrResultData);
    const targetMonth = dbData.month || record.month;
    const targetYear = dbData.year || record.year;

    const duplicate = await prisma.salarySlipOcrResult.findFirst({
        where: {
            case_id: record.case_id,
            applicant_id: record.applicant_id,
            month: targetMonth,
            year: targetYear,
            NOT: { id: record.id }
        },
        select: { id: true }
    });

    if (duplicate) {
        const errorMessage = `Duplicate salary period ${targetYear}-${targetMonth} for applicant ${record.applicant_id}.`;
        await prisma.salarySlipOcrResult.update({
            where: { id: record.id },
            data: {
                ocr_status: 'FAILED',
                error_message: errorMessage,
                raw_ocr_response: dbData.raw_ocr_response,
                extracted_json: dbData.extracted_json,
                extraction_warnings: [
                    ...(Array.isArray(dbData.extraction_warnings) ? dbData.extraction_warnings : []),
                    errorMessage
                ]
            }
        });
        const err = new Error(errorMessage);
        err.statusCode = 409;
        throw err;
    }

    // Remove fields that might not be in the old Prisma client
    const safeData = { ...dbData };
    delete safeData.deductions_is_derived;
    delete safeData.salary_period;
    delete safeData.extraction_source;
    delete safeData.extraction_checks;
    delete safeData.extraction_warnings;
    delete safeData.net_salary_words_match;
    delete safeData.name_match_status;
    delete safeData.pan_match_status;

    return prisma.salarySlipOcrResult.update({
        where: { id: record.id },
        data: {
            ...safeData,
            month: targetMonth,
            year: targetYear
        }
    });
}

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

        const applicant = await getApplicantForSalaryValidation(applicantId, caseId, tenant_id);
        if (!applicant) {
            return res.status(404).json({ error: 'Applicant not found or unauthorized.' });
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
                tenant_id,
                applicant
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
                tenant_id,
                applicant
            });

            // Save completed status
            await applySalaryOcrResult(ocrRecord, ocrResultData);

            if (ocrResultData.status === 'COMPLETED') {
                await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));
            }
        }

        const updatedRecord = await prisma.salarySlipOcrResult.findUnique({ where: { id: ocrRecord.id } });
        res.json({ success: true, data: updatedRecord, validation: ocrResultData?.validation || null });

    } catch (error) {
        console.error('[salaryOcr.controller] triggerSalarySlipOcr error:', error);

        if (error.statusCode === 409) {
            return res.status(409).json({ error: error.message, validation: { duplicate_salary_period: true } });
        }

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

        const applicant = await getApplicantForSalaryValidation(applicantId, caseId, tenant_id);
        if (!applicant) {
            return res.status(404).json({ error: 'Applicant not found or unauthorized.' });
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
                tenant_id,
                applicant
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

                if ((specificResult.status || ocrResultData.status) === 'COMPLETED') {
                    await applySalaryOcrResult(record, specificResult);
                } else {
                    await prisma.salarySlipOcrResult.update({
                        where: { id: record.id },
                        data: {
                            ocr_status: specificResult.status || 'FAILED',
                            vendor_job_id: specificResult.vendor_job_id ? String(specificResult.vendor_job_id) : null,
                            raw_ocr_response: specificResult.raw_ocr_response || null,
                            extracted_json: specificResult.extracted_json || null,
                            error_message: specificResult.error_message || null
                        }
                    });
                }
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

        res.json({
            success: true,
            message: ocrMode === 'async' ? 'Batch OCR triggered' : 'Batch OCR completed',
            job_id: ocrResultData.vendor_job_id,
            data: updatedRecords,
            validation: (ocrResultData.batchResults || []).map(r => ({
                month: r.month,
                year: r.year,
                validation: r.validation || null
            }))
        });

    } catch (error) {
        console.error('[salaryOcr.controller] processSalarySlipOcrBatch error:', error);
        if (error.statusCode === 409) {
            return res.status(409).json({ error: error.message, validation: { duplicate_salary_period: true } });
        }
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

        const applicant = await getApplicantForSalaryValidation(applicantId, caseId, tenant_id);
        const statusResult = await getJobStatus(ocrRecord.vendor_job_id, {
            month: ocrRecord.month,
            year: ocrRecord.year,
            applicant
        });

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
            return res.json({ success: true, data: updated, validation: statusResult.validation || null });
        }

        if (statusResult.status === 'COMPLETED') {
            const updated = await applySalaryOcrResult(ocrRecord, statusResult);

            await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));

            return res.json({ success: true, data: updated });
        }

        res.json({ success: true, data: ocrRecord });
    } catch (error) {
        console.error('[salaryOcr.controller] pollSalarySlipOcr error:', error);
        if (error.statusCode === 409) {
            return res.status(409).json({ error: error.message, validation: { duplicate_salary_period: true } });
        }
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
                deductions_is_derived: false,
                employer_name: employer_name || null,
                employee_name: employee_name || null,
                name_match_status: employee_name ? 'MANUAL_REVIEW' : 'NOT_AVAILABLE',
                pan_match_status: 'NOT_AVAILABLE'
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
                deductions_is_derived: false,
                employer_name: employer_name || null,
                employee_name: employee_name || null,
                name_match_status: employee_name ? 'MANUAL_REVIEW' : 'NOT_AVAILABLE',
                pan_match_status: 'NOT_AVAILABLE'
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
