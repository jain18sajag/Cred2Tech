const fs = require('fs');
const prisma = require('../../config/db');
const { sendCaughtError } = require('../utils/sendError');
const documentService = require('../services/document.service');
const { markEsrInputsChanged } = require('../services/esrSnapshotMutation.service');
const {
    processSalarySlipSync,
    processSalarySlipBatchSync,
    startSalarySlipAsync,
    startSalarySlipBatchAsync,
    getJobStatus,
    buildSalarySlipOcrDbData
} = require('../services/externalApis/cred2techSalaryOcr.service');

/**
 * Every document is stored in S3, never on this server's disk (see
 * document.controller.js#uploadDocument) - the OCR vendor call needs an
 * actual local file/stream, so pull the bytes down first. Always clean up
 * the temp file when done, success or failure.
 */
async function withLocalFile(document, fn) {
    const tmpPath = await documentService.downloadToTempFile(document);
    try {
        return await fn(tmpPath);
    } finally {
        fs.unlink(tmpPath, (err) => {
            if (err) console.error(`[salaryOcr.controller] Failed to clean up temp file ${tmpPath}: ${err.message}`);
        });
    }
}

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
        select: { id: true, ocr_status: true, document: { select: { original_file_name: true } } }
    });

    if (duplicate) {
        // Names the conflicting file/slot — without this, the only signal was
        // "Duplicate salary period 2025-10", which gives no way to tell which
        // of the other slots already has it (worse once a slot could be
        // sitting there PENDING/unprocessed and easy to miss — see
        // SalarySlipUploader.jsx's fetchSummary fix).
        const conflictDesc = duplicate.document?.original_file_name
            ? ` — already uploaded as "${duplicate.document.original_file_name}"${duplicate.ocr_status !== 'COMPLETED' ? ` (${duplicate.ocr_status.toLowerCase()})` : ''}.`
            : '.';
        const errorMessage = `Duplicate salary period ${targetYear}-${targetMonth} for applicant ${record.applicant_id}${conflictDesc}`;
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

        // 2. Upsert PENDING OCR Record
        // Keyed on document_id (unique per Document row), not month/year -
        // month/year are only known for certain once OCR actually runs, and
        // keying on them let an unrelated, previously-abandoned upload with
        // the same caller-supplied placeholder silently reuse that old row
        // (see SalarySlipUploader.jsx's handleRunAllOcr placeholders).
        const ocrRecord = await prisma.salarySlipOcrResult.upsert({
            where: {
                document_id: parseInt(documentId)
            },
            update: {
                ocr_status: 'PENDING'
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

        const ocrMode = process.env.SALARY_OCR_MODE || 'sync';
        let ocrResultData;

        // 3. Trigger OCR
        if (ocrMode === 'async') {
            ocrResultData = await withLocalFile(document, (filePath) => startSalarySlipAsync({
                filePath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: parseInt(documentId),
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                month,
                year,
                tenant_id,
                applicant
            }));

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
            ocrResultData = await withLocalFile(document, (filePath) => processSalarySlipSync({
                filePath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: parseInt(documentId),
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                month,
                year,
                tenant_id,
                applicant
            }));

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
    const tempFilePaths = [];
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

            // Every document lives in S3, not on this server's disk - pull it
            // down before handing it to the OCR vendor call.
            const tempPath = await documentService.downloadToTempFile(document);
            tempFilePaths.push(tempPath);

            filesToProcess.push({
                filePath: tempPath,
                mimeType: document.mime_type,
                originalName: document.original_file_name,
                document_id: document.id,
                customer_id: document.customer_id,
                month: docObj.month,
                year: docObj.year
            });
        }

        // Upsert PENDING OCR Records for all files
        // Keyed on document_id (unique per Document row) - see the same-shaped
        // fix in triggerSalarySlipOcr above for why month/year can't be the key.
        const ocrRecords = [];
        for (const f of filesToProcess) {
            const ocrRecord = await prisma.salarySlipOcrResult.upsert({
                where: {
                    document_id: f.document_id
                },
                update: {
                    ocr_status: 'PENDING'
                },
                // month/year still have a legacy DB-level @@unique([case_id,
                // applicant_id, month, year]) alongside document_id's own
                // unique constraint. f.month/f.year here are just the
                // frontend's placeholder ("M1"/current year, see
                // SalarySlipUploader.jsx's handleRunAllOcr) - reusing that
                // same placeholder for a brand new document collides with any
                // earlier (even abandoned/orphaned) row that placeholder was
                // ever used for. Keying the placeholder to this document's
                // own id keeps every new row unique until OCR fills in the
                // real extracted period.
                create: {
                    tenant_id,
                    customer_id: f.customer_id,
                    case_id: parseInt(caseId),
                    applicant_id: parseInt(applicantId),
                    document_id: f.document_id,
                    month: 'PENDING',
                    year: `DOC${f.document_id}`,
                    ocr_status: 'PENDING'
                }
            });
            ocrRecords.push(ocrRecord);
        }

        const ocrMode = process.env.SALARY_OCR_MODE || 'sync';
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
                // Match by document_id, not month/year - the caller-supplied
                // month/year on the record are just placeholders until OCR
                // fills in the real extracted period, so they never equal the
                // vendor-normalized month/year on the result (see
                // SalarySlipUploader.jsx's handleRunAllOcr). Matching on those
                // meant every record silently fell back to file #1's result,
                // corrupting months 2/3 and then tripping the duplicate-period
                // check as soon as two records shared that borrowed period.
                const specificResult = batchResults.find(r => r.document_id === record.document_id) || ocrResultData;

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
        sendCaughtError(res, error, 'Failed to process salary slip batch.', 500);
    } finally {
        for (const tempPath of tempFilePaths) {
            fs.unlink(tempPath, (err) => {
                if (err) console.error(`[salaryOcr.controller] Failed to clean up temp file ${tempPath}: ${err.message}`);
            });
        }
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

    if (completedSlips.length === 0) {
        // Deleting the last remaining slip must not leave a stale income
        // figure behind - the entry only exists because OCR put it there.
        await prisma.caseIncomeEntry.deleteMany({
            where: {
                case_id: parseInt(case_id),
                applicant_id: parseInt(applicant_id),
                supporting_doc_type: 'Salary Slip',
                remarks: { contains: 'salary slip', mode: 'insensitive' }
            }
        });
        // Salary income feeds ESR — invalidate the cached snapshot so it
        // re-extracts rather than continuing to show a figure derived from a
        // slip that's now gone. This function is the single place every
        // salary-slip upload/delete path (including deleteSalarySlip) funnels
        // through, so fixing it here covers all of them.
        await markEsrInputsChanged(prisma, parseInt(case_id));
        return;
    }

    // Calculate average net monthly salary
    const totalNet = completedSlips.reduce((sum, slip) => sum + (slip.net_salary || 0), 0);
    const avgNetMonthly = totalNet / completedSlips.length;
    const annualizedIncome = avgNetMonthly * 12;

    const slipWord = completedSlips.length === 1 ? 'slip' : 'slips';
    const remarksText = `Used ${completedSlips.length} salary ${slipWord} via OCR`;

    const existingEntry = await prisma.caseIncomeEntry.findFirst({
        where: {
            case_id: parseInt(case_id),
            applicant_id: parseInt(applicant_id),
            supporting_doc_type: 'Salary Slip',
            // Case-insensitive so this still matches pre-existing rows saved
            // under the old "Generated from Salary Slip OCR (...)" wording.
            remarks: { contains: 'salary slip', mode: 'insensitive' }
        }
    });

    if (existingEntry) {
        await prisma.caseIncomeEntry.update({
            where: { id: existingEntry.id },
            data: {
                annual_amount: annualizedIncome,
                remarks: remarksText
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
                remarks: remarksText
            }
        });
    }

    await markEsrInputsChanged(prisma, parseInt(case_id));
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
                },
                document: {
                    select: { id: true, original_file_name: true }
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
        sendCaughtError(res, error, 'Failed to fetch salary summary', 500);
    }
}

/**
 * Remove an uploaded salary slip: soft-deletes the Document (+ S3 cleanup,
 * via document.service.js) and hard-deletes its SalarySlipOcrResult row,
 * then recalculates income from whatever slips remain.
 *
 * The OCR result is hard-deleted (unlike the Document, which stays
 * soft-deleted for audit trail) because it's an internal derived record, not
 * a user-facing document - leaving it behind would keep permanently blocking
 * a future upload for the same real calendar month via the month/year
 * uniqueness check in applySalaryOcrResult.
 *
 * DELETE /api/cases/:caseId/applicants/:applicantId/salary-slips/:documentId
 */
async function deleteSalarySlip(req, res) {
    try {
        const { caseId, applicantId, documentId } = req.params;
        const tenant_id = req.user.tenant_id;

        const caseRecord = await prisma.case.findFirst({
            where: { id: parseInt(caseId), tenant_id }
        });
        if (!caseRecord) return res.status(404).json({ error: 'Case not found or unauthorized.' });

        const document = await prisma.document.findFirst({
            where: {
                id: parseInt(documentId),
                tenant_id,
                case_id: parseInt(caseId),
                applicant_id: parseInt(applicantId),
                document_type: 'SALARY_SLIP',
                status: 'ACTIVE'
            }
        });
        if (!document) {
            return res.status(404).json({ error: 'Salary slip document not found or does not belong to this applicant.' });
        }

        await documentService.deleteDocument(document.id, tenant_id);
        await prisma.salarySlipOcrResult.deleteMany({ where: { document_id: document.id } });
        await recalculateApplicantIncome(tenant_id, parseInt(caseId), parseInt(applicantId));

        res.json({ success: true, message: 'Salary slip removed.' });
    } catch (error) {
        console.error('[salaryOcr.controller] deleteSalarySlip error:', error);
        sendCaughtError(res, error, 'Failed to remove salary slip.', 500);
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
    addManualSalaryEntry,
    deleteSalarySlip
};
