'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const prisma = require('../../../config/db');
const { getStorageProvider } = require('../storage');
const { getLocalEsrLogsDir } = require('./esrTraceLogger');
const LOG_DIR = getLocalEsrLogsDir();
const CALCULATION_VERSION = 'ESR_DYNAMIC_V1';

async function persistEsrCalculationLog({
    caseId,
    tenantId,
    userId,
    esrReport,
    lenderResults,
    inputSnapshot,
    incomeCalculationLog,
    structuredAuditLog
}) {
    const calculationRunId = crypto.randomUUID();
    const createdAt = new Date();
    const sourceBundle = await _loadSourceBundle(caseId, tenantId);
    const sourcePaths = _buildSourcePaths(inputSnapshot, sourceBundle);
    const warningBundle = _collectWarnings(lenderResults, inputSnapshot, sourceBundle);
    const exportPayload = _maskSensitive(_safeJson({
        calculation_run_id: calculationRunId,
        calculation_version: CALCULATION_VERSION,
        created_at: createdAt.toISOString(),
        created_by: userId || null,
        case_inputs: {
            case_id: caseId,
            tenant_id: tenantId,
            application_number: _applicationNumber(sourceBundle.caseRecord, caseId),
            requested_loan_amount: inputSnapshot?.requested_loan_amount || null,
            requested_tenure_months: inputSnapshot?.requested_tenure_months || null,
            product_type: inputSnapshot?.product_type || null,
            property_value: inputSnapshot?.property_value || inputSnapshot?.market_value || null
        },
        source_inputs: {
            salary_trace: sourceBundle.salaryInputs,
            gst_trace: inputSnapshot ? _pick(inputSnapshot, ['gst_avg_monthly_sales', 'gst_industry_type', 'gst_industry_margin', 'gst_income']) : {},
            itr_trace: inputSnapshot ? _pick(inputSnapshot, ['itr_pat', 'itr_depreciation', 'itr_finance_cost', 'itr_gross_receipts']) : {},
            bank_trace: inputSnapshot ? _pick(inputSnapshot, ['bank_avg_balance', 'bank_monthly_income', 'bank_net_salary_monthly', 'bank_salary_months_available']) : {},
            bureau_obligations: inputSnapshot?.obligations_detail || inputSnapshot?.editable_obligations || [],
            manual_income_entries: inputSnapshot?.manual_income_entries || []
        },
        income_calculation_log: incomeCalculationLog || null,
        formula_steps: _buildFormulaStepRows(lenderResults),
        lender_method_calculations: _buildLenderMethodCalculationRows(lenderResults, inputSnapshot),
        lender_results: _buildLenderExportRows(lenderResults, inputSnapshot),
        warnings_and_exclusions: warningBundle,
        source_paths: sourcePaths,
        structured_audit_log: structuredAuditLog || null
    }));

    const fileMeta = await _writeExportFiles(exportPayload, sourceBundle.caseRecord, calculationRunId, createdAt);
    const rows = _buildDbRows({
        caseId,
        tenantId,
        userId,
        calculationRunId,
        esrReport,
        lenderResults,
        inputSnapshot,
        sourcePaths,
        fileMeta,
        warningsAndExclusions: warningBundle
    });

    if (rows.length) {
        await prisma.caseEsrCalculationLog.createMany({ data: rows });
    }

    return {
        calculation_run_id: calculationRunId,
        rows_created: rows.length,
        json_file_name: fileMeta.jsonFileName,
        xlsx_file_name: fileMeta.xlsxFileName,
        json_file_path: fileMeta.jsonFilePath,
        xlsx_file_path: fileMeta.xlsxFilePath
    };
}

async function listCalculationLogs(caseId, tenantId) {
    const rows = await prisma.caseEsrCalculationLog.findMany({
        where: { case_id: caseId },
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        select: {
            id: true,
            calculation_run_id: true,
            calculation_status: true,
            lender_code: true,
            lender_name: true,
            scheme_code: true,
            scheme_name: true,
            final_eligible_amount: true,
            manual_review_required: true,
            configuration_error: true,
            json_file_name: true,
            xlsx_file_name: true,
            created_at: true,
            created_by: true
        }
    });

    const grouped = new Map();
    rows.forEach(row => {
        if (!grouped.has(row.calculation_run_id)) {
            grouped.set(row.calculation_run_id, {
                calculation_run_id: row.calculation_run_id,
                created_at: row.created_at,
                created_by: row.created_by,
                json_file_name: row.json_file_name,
                xlsx_file_name: row.xlsx_file_name,
                lender_count: 0,
                scheme_count: 0,
                eligible_scheme_count: 0,
                manual_review_required: false,
                configuration_error: false,
                lenders: []
            });
        }
        const group = grouped.get(row.calculation_run_id);
        group.scheme_count += 1;
        if (!group.lenders.some(l => l.lender_code === row.lender_code && l.lender_name === row.lender_name)) {
            group.lender_count += 1;
            group.lenders.push({ lender_code: row.lender_code, lender_name: row.lender_name });
        }
        if (row.calculation_status === 'ELIGIBLE') group.eligible_scheme_count += 1;
        group.manual_review_required = group.manual_review_required || row.manual_review_required;
        group.configuration_error = group.configuration_error || row.configuration_error;
    });

    return Array.from(grouped.values());
}

async function getCalculationLog(caseId, tenantId, calculationRunId) {
    const rows = await prisma.caseEsrCalculationLog.findMany({
        where: { case_id: caseId, calculation_run_id: calculationRunId },
        orderBy: [{ lender_name: 'asc' }, { scheme_name: 'asc' }]
    });
    if (!rows.length) {
        throw new Error('ESR calculation log not found.');
    }
    return {
        calculation_run_id: calculationRunId,
        created_at: rows[0].created_at,
        json_file_name: rows[0].json_file_name,
        xlsx_file_name: rows[0].xlsx_file_name,
        rows
    };
}

async function getCalculationLogDownload(caseId, tenantId, calculationRunId, format) {
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (!['json', 'xlsx'].includes(normalizedFormat)) {
        throw new Error('Unsupported ESR log download format.');
    }

    const row = await prisma.caseEsrCalculationLog.findFirst({
        where: { case_id: caseId, calculation_run_id: calculationRunId },
        orderBy: { id: 'asc' }
    });
    if (!row) {
        throw new Error('ESR calculation log not found.');
    }

    const filePath = normalizedFormat === 'xlsx' ? row.xlsx_file_path : row.json_file_path;
    const fileName = normalizedFormat === 'xlsx' ? row.xlsx_file_name : row.json_file_name;
    const fileUrl = normalizedFormat === 'xlsx' ? row.xlsx_file_url : row.json_file_url;
    const contentType = normalizedFormat === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/json';

    if (filePath && fs.existsSync(filePath)) {
        return { filePath, fileName, contentType };
    }

    const storageKey = _storageKeyFromUrl(fileUrl);
    if (storageKey) {
        const stream = await getStorageProvider('S3').getStream(storageKey);
        return { stream, fileName, contentType };
    }

    throw new Error('ESR calculation log file not found.');
}

async function _loadSourceBundle(caseId, tenantId) {
    const [caseRecord, salaryRows] = await Promise.all([
        prisma.case.findFirst({
            where: { id: caseId, tenant_id: tenantId },
            select: {
                id: true,
                customer_name: true,
                product_type: true,
                loan_amount: true,
                customer: {
                    select: {
                        id: true,
                        business_name: true,
                        legal_business_name: true,
                        trade_name: true,
                        business_pan: true
                    }
                }
            }
        }),
        prisma.salarySlipOcrResult.findMany({
            where: { case_id: caseId, tenant_id: tenantId },
            orderBy: [{ year: 'asc' }, { month: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                applicant_id: true,
                document_id: true,
                month: true,
                year: true,
                salary_period: true,
                gross_salary: true,
                net_salary: true,
                deductions: true,
                deductions_is_derived: true,
                employer_name: true,
                employee_name: true,
                employee_pan: true,
                net_salary_words_match: true,
                pages_processed: true,
                ocr_confidence: true,
                extraction_source: true,
                extraction_checks: true,
                extraction_warnings: true,
                name_match_status: true,
                pan_match_status: true,
                ocr_status: true,
                source: true,
                raw_ocr_response: true,
                extracted_json: true,
                applicant: {
                    select: { id: true, name: true, pan_number: true, type: true, is_primary: true }
                }
            }
        })
    ]);

    return {
        caseRecord,
        salaryInputs: salaryRows.map(row => _maskSensitive(_safeJson(row)))
    };
}

async function _writeExportFiles(payload, caseRecord, calculationRunId, createdAt) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
    const applicationNumber = _sanitizeFileToken(_applicationNumber(caseRecord, caseRecord?.id || 'CASE'));
    const baseName = `ESR_Log_${applicationNumber}_${calculationRunId}_${timestamp}`;
    const jsonFileName = `${baseName}.json`;
    const xlsxFileName = `${baseName}.xlsx`;
    const jsonFilePath = path.join(LOG_DIR, jsonFileName);
    const xlsxFilePath = path.join(LOG_DIR, xlsxFileName);

    const jsonBuffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(jsonFilePath, jsonBuffer);
    const workbook = _buildWorkbook(payload);
    XLSX.writeFile(workbook, xlsxFilePath);
    const xlsxBuffer = fs.readFileSync(xlsxFilePath);
    const storageMeta = await _uploadExportFilesToStorage({
        jsonBuffer,
        xlsxBuffer,
        jsonFileName,
        xlsxFileName
    });

    return {
        jsonFileName,
        xlsxFileName,
        jsonFilePath,
        xlsxFilePath,
        jsonFileUrl: storageMeta.jsonFileUrl,
        xlsxFileUrl: storageMeta.xlsxFileUrl,
        jsonChecksum: _sha256(jsonBuffer),
        xlsxChecksum: _sha256(xlsxBuffer)
    };
}

async function _uploadExportFilesToStorage({ jsonBuffer, xlsxBuffer, jsonFileName, xlsxFileName }) {
    const provider = String(process.env.STORAGE_PROVIDER || '').toUpperCase();
    if (provider !== 'S3' || process.env.ESR_CALC_LOG_STORAGE === 'false') {
        return { jsonFileUrl: null, xlsxFileUrl: null };
    }

    const bucket = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
    const storage = getStorageProvider('S3');
    const jsonKey = path.posix.join('logs', 'esr', jsonFileName);
    const xlsxKey = path.posix.join('logs', 'esr', xlsxFileName);

    try {
        await Promise.all([
            storage.save(jsonBuffer, jsonKey, 'application/json; charset=utf-8'),
            storage.save(xlsxBuffer, xlsxKey, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        ]);
        return {
            jsonFileUrl: bucket ? `s3://${bucket}/${jsonKey}` : jsonKey,
            xlsxFileUrl: bucket ? `s3://${bucket}/${xlsxKey}` : xlsxKey
        };
    } catch (err) {
        console.warn(`[ESR CALC LOG WARNING] Failed to upload calculation log exports to S3: ${err.message}`);
        return { jsonFileUrl: null, xlsxFileUrl: null };
    }
}

function _buildWorkbook(payload) {
    const wb = XLSX.utils.book_new();
    _appendSheet(wb, 'Summary', _objectToKeyValueRows({
        calculation_run_id: payload.calculation_run_id,
        calculation_version: payload.calculation_version,
        created_at: payload.created_at,
        case_id: payload.case_inputs?.case_id,
        application_number: payload.case_inputs?.application_number,
        requested_loan_amount: payload.case_inputs?.requested_loan_amount,
        requested_tenure_months: payload.case_inputs?.requested_tenure_months,
        product_type: payload.case_inputs?.product_type,
        property_value: payload.case_inputs?.property_value
    }));
    _appendSheet(wb, 'Lender Results', payload.lender_results || []);
    _appendSheet(wb, 'Salary Inputs', payload.source_inputs?.salary_trace || []);
    _appendSheet(wb, 'GST Inputs', [_flatten(payload.source_inputs?.gst_trace || {})]);
    _appendSheet(wb, 'ITR Inputs', [_flatten(payload.source_inputs?.itr_trace || {})]);
    _appendSheet(wb, 'Bank Inputs', [_flatten(payload.source_inputs?.bank_trace || {})]);
    _appendSheet(wb, 'Bureau Obligations', (payload.source_inputs?.bureau_obligations || []).map(_flatten));
    _appendSheet(wb, 'Lender Method Calculations', payload.lender_method_calculations || []);
    _appendSheet(wb, 'Source Paths', (payload.source_paths || []).map(_flatten));
    return wb;
}

function _buildDbRows({ caseId, tenantId, userId, calculationRunId, esrReport, lenderResults, inputSnapshot, sourcePaths, fileMeta, warningsAndExclusions }) {
    const rows = [];
    (lenderResults || []).forEach(lender => {
        const evaluations = Array.isArray(lender.scheme_evaluations) && lender.scheme_evaluations.length
            ? lender.scheme_evaluations
            : [lender];

        evaluations.forEach((evaluation, index) => {
            const warnings = _compactArray([
                ...(evaluation.warnings || []),
                ...(evaluation.policy_warnings || []),
                ...(evaluation.obligation_exclusion_notes || []),
                ...(lender.policy_warnings || []),
                ...(lender.obligation_exclusion_notes || [])
            ]);
            const errors = _compactArray([
                ...(evaluation.failure_reasons || []),
                lender.ineligibility_reason || null
            ]);
            const finalEligibleAmount = _numberOrNull(evaluation.final_eligible_loan_amount ?? lender.final_eligible_loan_amount);
            const proposedEmi = _numberOrNull(evaluation.proposed_emi ?? evaluation.max_eligible_emi ?? lender.max_eligible_emi);

            rows.push({
                tenant_id: tenantId,
                case_id: caseId,
                esr_id: esrReport?.id || null,
                calculation_run_id: calculationRunId,
                lender_code: lender.lender_id || evaluation.lender_id || null,
                lender_name: lender.lender_name || evaluation.lender_name || null,
                scheme_code: _stringOrNull(evaluation.scheme_code ?? evaluation.scheme_id),
                scheme_name: evaluation.scheme_name || lender.best_scheme_name || null,
                selected_method: evaluation.selected_method || evaluation.method || inputSnapshot?.selected_income_method || null,
                calculation_status: _calculationStatus(evaluation, lender),
                calculation_version: CALCULATION_VERSION,
                policy_version: evaluation.policy_version || evaluation.lender_policy_key || null,
                source_snapshot_id: inputSnapshot?.case_esr_financial_id || null,
                requested_loan_amount: _numberOrNull(inputSnapshot?.requested_loan_amount),
                requested_tenure_months: _intOrNull(inputSnapshot?.requested_tenure_months),
                final_tenure_months: _intOrNull(evaluation.final_tenure_used ?? evaluation.max_tenure_months ?? lender.max_tenure_months),
                roi_annual: _numberOrNull(evaluation.underwriting_roi_used ?? evaluation.roi ?? lender.roi_min),
                emi_per_lakh: _emiPerLakh(proposedEmi, finalEligibleAmount),
                eligible_monthly_income: _numberOrNull(evaluation.monthly_income_used ?? inputSnapshot?.selected_monthly_income),
                eligible_emi_capacity: _numberOrNull(evaluation.maximum_eligible_emi ?? evaluation.max_eligible_emi ?? lender.max_eligible_emi),
                income_based_eligibility: _numberOrNull(evaluation.foir_based_eligible_loan_amount ?? evaluation.dscr_eligible_loan_amount),
                ltv_based_eligibility: _numberOrNull(evaluation.ltv_based_eligible_loan_amount ?? evaluation.max_loan_by_ltv),
                product_cap: _numberOrNull(evaluation.product_cap ?? evaluation.max_loan_amount),
                exposure_deduction: _numberOrNull(evaluation.exposure_deduction ?? evaluation.hdfc_unsecured_pos_deduction),
                pos_deduction: _numberOrNull(evaluation.pos_deduction ?? evaluation.hdfc_unsecured_pos_deduction),
                final_eligible_amount: finalEligibleAmount,
                manual_review_required: _manualReviewRequired(evaluation, lender),
                configuration_error: Boolean(evaluation.configuration_error || evaluation.parameter_error),
                warnings_json: _maskSensitive(_safeJson(warnings)),
                errors_json: _maskSensitive(_safeJson(errors)),
                input_snapshot_json: _maskSensitive(_safeJson(inputSnapshot || {})),
                source_paths_json: _maskSensitive(_safeJson(sourcePaths)),
                calculation_steps_json: _maskSensitive(_safeJson(_calculationSteps(evaluation, lender, index))),
                excluded_records_json: _maskSensitive(_safeJson(warningsAndExclusions)),
                json_file_name: fileMeta.jsonFileName,
                json_file_path: fileMeta.jsonFilePath,
                json_file_url: fileMeta.jsonFileUrl,
                json_checksum_sha256: fileMeta.jsonChecksum,
                xlsx_file_name: fileMeta.xlsxFileName,
                xlsx_file_path: fileMeta.xlsxFilePath,
                xlsx_file_url: fileMeta.xlsxFileUrl,
                xlsx_checksum_sha256: fileMeta.xlsxChecksum,
                created_by: userId || null
            });
        });
    });
    return rows;
}

function _buildLenderExportRows(lenderResults, inputSnapshot) {
    return (lenderResults || []).flatMap(lender => {
        const evaluations = Array.isArray(lender.scheme_evaluations) && lender.scheme_evaluations.length
            ? lender.scheme_evaluations
            : [lender];
        return evaluations.map((evaluation, index) => _flatten({
            lender_code: lender.lender_id || evaluation.lender_id || null,
            lender_name: lender.lender_name || evaluation.lender_name || null,
            scheme_code: _stringOrNull(evaluation.scheme_code ?? evaluation.scheme_id),
            scheme_name: evaluation.scheme_name || lender.best_scheme_name || null,
            selected_method: evaluation.selected_method || evaluation.method || inputSnapshot?.selected_income_method || null,
            status: _calculationStatus(evaluation, lender),
            final_eligible_amount: evaluation.final_eligible_loan_amount ?? lender.final_eligible_loan_amount ?? null,
            final_tenure_months: evaluation.final_tenure_used ?? evaluation.max_tenure_months ?? lender.max_tenure_months ?? null,
            roi_annual: evaluation.underwriting_roi_used ?? evaluation.roi ?? lender.roi_min ?? null,
            monthly_income_used: evaluation.monthly_income_used ?? null,
            eligible_emi_capacity: evaluation.maximum_eligible_emi ?? evaluation.max_eligible_emi ?? lender.max_eligible_emi ?? null,
            manual_review_required: _manualReviewRequired(evaluation, lender),
            scheme_index: index + 1
        }));
    });
}

function _buildFormulaStepRows(lenderResults) {
    return (lenderResults || []).flatMap(lender => {
        const evaluations = Array.isArray(lender.scheme_evaluations) ? lender.scheme_evaluations : [];
        return evaluations.map((evaluation, index) => _flatten({
            lender_name: lender.lender_name,
            scheme_name: evaluation.scheme_name,
            scheme_index: index + 1,
            selected_income_method: evaluation.selected_method || evaluation.method || null,
            foir_breakdown: evaluation.foir_breakdown || null,
            eligible_income_breakdown: evaluation.eligible_income_breakdown || null,
            dscr_breakdown: evaluation.dscr_breakdown || null,
            ltv_breakdown: evaluation.ltv_breakdown || null,
            failure_reasons: evaluation.failure_reasons || null,
            warnings: evaluation.warnings || evaluation.policy_warnings || null
        }));
    });
}

function _buildLenderMethodCalculationRows(lenderResults, inputSnapshot) {
    return (lenderResults || []).flatMap(lender => {
        const evaluations = Array.isArray(lender.scheme_evaluations) && lender.scheme_evaluations.length
            ? lender.scheme_evaluations
            : [lender];

        return evaluations.map((evaluation, index) => {
            const methodName = evaluation.scheme_name || lender.best_scheme_name || evaluation.method || inputSnapshot?.selected_income_method || null;
            const foir = evaluation.foir_breakdown || {};
            const dscr = evaluation.dscr_breakdown || foir.dscr_breakdown || null;
            const coApp = evaluation.co_applicant_salary_addon || null;
            const monthlyIncome = _numberOrNull(evaluation.monthly_income_used ?? foir.composed_income ?? inputSnapshot?.selected_monthly_income);
            const primaryIncome = _numberOrNull(evaluation.primary_monthly_income_used ?? foir.primary_composed_income);
            const coApplicantIncome = _numberOrNull(foir.co_applicant_salary_income);
            const obligations = _numberOrNull(foir.net_obligations ?? inputSnapshot?.existing_obligations);
            const maxEmi = _numberOrNull(evaluation.maximum_eligible_emi ?? evaluation.max_eligible_emi ?? foir.maximum_eligible_emi ?? lender.max_eligible_emi);
            const incomeBasedLoan = _numberOrNull(evaluation.foir_based_eligible_loan_amount ?? evaluation.dscr_eligible_loan_amount);
            const ltvPercent = _numberOrNull(evaluation.applicable_ltv_percent);
            const propertyValue = _numberOrNull(inputSnapshot?.property_value ?? inputSnapshot?.market_value);
            const ltvLoan = _numberOrNull(evaluation.ltv_based_eligible_loan_amount ?? evaluation.max_loan_by_ltv);
            const productCap = _numberOrNull(evaluation.product_cap ?? evaluation.max_loan_amount);
            const requestedCap = _numberOrNull(inputSnapshot?.requested_loan_amount);
            const businessCreditCap = _numberOrNull(evaluation.banking_business_credit_cap);
            const posDeduction = _numberOrNull(evaluation.hdfc_unsecured_pos_deduction ?? evaluation.pos_deduction);
            const finalEligible = _numberOrNull(evaluation.final_eligible_loan_amount ?? lender.final_eligible_loan_amount);
            const proposedEmi = _numberOrNull(evaluation.proposed_emi ?? foir.proposed_emi);
            const roi = _numberOrNull(evaluation.underwriting_roi_used ?? evaluation.roi ?? lender.roi_min);
            const tenure = _intOrNull(evaluation.final_tenure_used ?? evaluation.max_tenure_months ?? lender.max_tenure_months);
            const lenderMaxTenure = _intOrNull(evaluation.lender_max_tenure_months ?? evaluation.max_tenure_months ?? lender.max_tenure_months);
            const ageBasedTenure = _intOrNull(evaluation.age_based_tenure_limit_months);
            const foirPercent = _numberOrNull(evaluation.foir_allowed_percent ?? foir.foir_allowed_percent);
            const actualFoir = _numberOrNull(evaluation.foir_actual_percent ?? foir.foir_actual_percent);

            const incomeFormula = _incomeFormulaForEvaluation(methodName, evaluation, inputSnapshot, monthlyIncome, primaryIncome, coApplicantIncome, dscr);
            const emiCapacityFormula = _emiCapacityFormulaForEvaluation(methodName, foir, dscr, monthlyIncome, foirPercent, obligations, maxEmi);
            const foirFormula = _foirAllowedFormulaForEvaluation(evaluation, foirPercent);
            const actualFoirFormula = _actualFoirFormulaForEvaluation(methodName, obligations, proposedEmi, monthlyIncome, actualFoir);
            const tenureFormula = _tenureFormulaForEvaluation(inputSnapshot, lenderMaxTenure, ageBasedTenure, tenure);
            const ltvFormula = ltvPercent !== null && propertyValue !== null
                ? `${_money(propertyValue)} x ${_percent(ltvPercent)} = ${_money(ltvLoan)}`
                : 'No LTV value available';
            const loanFormula = _loanFormulaForEvaluation(methodName, evaluation, incomeBasedLoan, proposedEmi, tenure, roi, coApp);
            const finalFormula = _finalEligibilityFormula({
                incomeBasedLoan,
                ltvLoan,
                productCap,
                requestedCap,
                businessCreditCap,
                posDeduction,
                finalEligible
            });

            return _flatten({
                lender_name: lender.lender_name || evaluation.lender_name || null,
                scheme_name: methodName,
                scheme_index: index + 1,
                status: _calculationStatus(evaluation, lender),
                data_taken: _dataTakenForEvaluation(methodName, evaluation, inputSnapshot),
                income_formula: incomeFormula,
                income_used: _money(monthlyIncome),
                foir_allowed_formula: foirFormula,
                foir_allowed_percent: _percent(foirPercent),
                foir_or_dscr_formula: emiCapacityFormula,
                eligible_emi_capacity: _money(maxEmi),
                actual_foir_formula: actualFoirFormula,
                actual_foir_percent: _percent(actualFoir),
                age_tenure_formula: tenureFormula,
                applicant_age: inputSnapshot?.applicant_age ?? null,
                lender_max_tenure_months: lenderMaxTenure,
                age_based_tenure_limit_months: ageBasedTenure,
                tenure_months: tenure,
                roi_percent: roi,
                income_based_loan_formula: loanFormula,
                income_based_loan: _money(incomeBasedLoan),
                property_ltv_formula: ltvFormula,
                ltv_based_loan: _money(ltvLoan),
                product_cap: _money(productCap),
                requested_loan_cap: _money(requestedCap),
                business_credit_cap: _money(businessCreditCap),
                pos_deduction: _money(posDeduction),
                final_eligibility_formula: finalFormula,
                final_eligible_amount: _money(finalEligible),
                dynamic_npm_foir_percent: _percent(evaluation.dynamic_npm_foir_percent),
                actual_final_ltv_percent: _percent(evaluation.actual_final_ltv_percent),
                double_whammy_total_percent: _percent(evaluation.double_whammy_total_percent),
                combined_household_foir_percent: _percent(actualFoir),
                co_applicant_salary_addon: coApp ? _money(coApp.eligibleLoanAmount) : null,
                income_breakdown: evaluation.eligible_income_breakdown || null
            });
        });
    });
}

function _dataTakenForEvaluation(methodName, evaluation, inputSnapshot) {
    const method = String(methodName || '').toUpperCase();
    const parts = [
        `Property ${_money(inputSnapshot?.property_value ?? inputSnapshot?.market_value)}`,
        `Obligations ${_money(evaluation.foir_breakdown?.net_obligations ?? inputSnapshot?.existing_obligations)}`,
        `LTV ${_percent(evaluation.applicable_ltv_percent)}`
    ];

    if (method.includes('SALAR')) {
        parts.push(`Salary gross ${_money(inputSnapshot?.salaried_gross_monthly)}`);
        parts.push(`Salary net ${_money(inputSnapshot?.salaried_net_monthly ?? inputSnapshot?.salaried_income)}`);
    } else if (method.includes('GST')) {
        parts.push(`GST avg monthly sales ${_money(inputSnapshot?.gst_avg_monthly_sales)}`);
        parts.push(`GST margin ${_percent(inputSnapshot?.gst_industry_margin)}`);
    } else if (method.includes('BANK')) {
        parts.push(`ABB ${_money(inputSnapshot?.bank_avg_balance)}`);
        parts.push(`Banking income ${_money(inputSnapshot?.banking_income ?? inputSnapshot?.bank_monthly_income)}`);
    } else if (method.includes('GRP') || method.includes('GROSS RECEIPT')) {
        parts.push(`Gross receipts ${_money(inputSnapshot?.itr_gross_receipts)}`);
    } else if (method.includes('DSCR')) {
        parts.push(`Annual income ${_money(evaluation.dscr_breakdown?.annualIncome)}`);
        parts.push(`DSCR min ${evaluation.dscr_breakdown?.minRatio ?? null}`);
    } else {
        parts.push(`PAT ${_money(inputSnapshot?.itr_pat)}`);
        parts.push(`Depreciation ${_money(inputSnapshot?.itr_depreciation)}`);
        parts.push(`Finance cost ${_money(inputSnapshot?.itr_finance_cost)}`);
    }

    return parts.filter(part => !part.endsWith('N/A') && !part.endsWith('null')).join('; ');
}

function _incomeFormulaForEvaluation(methodName, evaluation, inputSnapshot, monthlyIncome, primaryIncome, coApplicantIncome, dscr) {
    const method = String(methodName || '').toUpperCase();
    if (method.includes('GST')) {
        const baseFormula = `GST Avg Monthly Sales ${_money(inputSnapshot?.gst_avg_monthly_sales)} x Margin ${_percent(inputSnapshot?.gst_industry_margin)} = ${_money(primaryIncome ?? monthlyIncome)}`;
        const isIciciGst = String(evaluation?.lender_policy_key || '').toUpperCase() === 'ICICI';
        const includedCoApplicantSalary = isIciciGst && monthlyIncome !== null && primaryIncome !== null
            ? Math.max(0, monthlyIncome - primaryIncome)
            : 0;
        return includedCoApplicantSalary > 0
            ? `${baseFormula}; + 100% co-applicant net salary ${_money(includedCoApplicantSalary)} = total eligible monthly income ${_money(monthlyIncome)}`
            : baseFormula;
    }
    if (method.includes('BANK')) {
        return `ABB/Banking policy income = ${_money(inputSnapshot?.bank_avg_balance)} based income ${_money(primaryIncome ?? monthlyIncome)}`;
    }
    if (method.includes('GRP') || method.includes('GROSS RECEIPT')) {
        const grossReceipts = _numberOrNull(inputSnapshot?.itr_gross_receipts);
        return `Gross Receipts based method uses ${_money(grossReceipts)} and lender multiplier/exposure rules; monthly FOIR income is not used`;
    }
    if (method.includes('DSCR') && dscr) {
        return `Annual income ${_money(dscr.annualIncome)} tested against debt service; monthly equivalent ${_money(monthlyIncome)}`;
    }
    if (method.includes('SALAR')) {
        return `Verified salary income ${_money(inputSnapshot?.salaried_net_monthly ?? inputSnapshot?.salaried_income)} with lender salary policy = ${_money(primaryIncome ?? monthlyIncome)}`;
    }

    const pat = _numberOrNull(inputSnapshot?.itr_pat);
    const dep = _numberOrNull(inputSnapshot?.itr_depreciation);
    const fin = _numberOrNull(inputSnapshot?.itr_finance_cost);
    const total = [pat, dep, fin].filter(v => v !== null).reduce((sum, value) => sum + value, 0);
    const baseFormula = `PAT ${_money(pat)} + depreciation ${_money(dep)} + finance cost ${_money(fin)} = ${_money(total)} / 12 = ${_money(primaryIncome ?? monthlyIncome)}`;
    if (coApplicantIncome && coApplicantIncome > 0) {
        return `${baseFormula}; co-applicant monthly salary considered ${_money(coApplicantIncome)}; total ${_money(monthlyIncome)}`;
    }
    return baseFormula;
}

function _emiCapacityFormulaForEvaluation(methodName, foir, dscr, monthlyIncome, foirPercent, obligations, maxEmi) {
    const method = String(methodName || '').toUpperCase();
    if (method.includes('DSCR') && dscr) {
        return `DSCR capacity from annual income ${_money(dscr.annualIncome)} and min DSCR ${dscr.minRatio ?? 'N/A'} = ${_money(maxEmi)}`;
    }
    if (foir?.skip_foir_check) {
        return `No DBR/FOIR deduction; eligible EMI from method = ${_money(maxEmi)}`;
    }
    return `(${_money(monthlyIncome)} x ${_percent(foirPercent)}) - obligations ${_money(obligations)} = ${_money(maxEmi)}`;
}

function _foirAllowedFormulaForEvaluation(evaluation, foirPercent) {
    const flags = evaluation.conditional_underwriting_flags || {};
    if (flags.special_program === 'double_wammy') {
        const specialLimit = _numberOrNull(flags.special_limit) || 140;
        const ltv = _numberOrNull(evaluation.applicable_ltv_percent);
        return `Double Whammy FOIR = ${specialLimit.toFixed(2)}% - LTV ${_percent(ltv)} = ${_percent(foirPercent)}`;
    }
    if (evaluation.foir_breakdown?.skip_foir_check) {
        return 'No DBR/FOIR check for this method';
    }
    return `FOIR allowed from lender policy = ${_percent(foirPercent)}`;
}

function _actualFoirFormulaForEvaluation(methodName, obligations, proposedEmi, monthlyIncome, actualFoir) {
    const method = String(methodName || '').toUpperCase();
    if (method.includes('DSCR')) return 'N/A - DSCR method uses DSCR ratio';
    if (method.includes('GRP') || method.includes('GROSS RECEIPT')) return 'N/A - GRP direct method / No DBR';
    return `(obligations ${_money(obligations)} + proposed EMI ${_money(proposedEmi)}) / income ${_money(monthlyIncome)} = ${_percent(actualFoir)}`;
}

function _tenureFormulaForEvaluation(inputSnapshot, lenderMaxTenure, ageBasedTenure, finalTenure) {
    const age = _numberOrNull(inputSnapshot?.applicant_age);
    const ageText = age !== null ? `Applicant age ${age}` : 'Applicant age N/A';
    const ageLimitText = ageBasedTenure !== null
        ? `age based tenure ${ageBasedTenure} months`
        : 'no age based restriction available';
    return `${ageText}; final tenure = MIN(lender max ${lenderMaxTenure ?? 'N/A'} months, ${ageLimitText}) = ${finalTenure ?? 'N/A'} months`;
}

function _loanFormulaForEvaluation(methodName, evaluation, incomeBasedLoan, proposedEmi, tenure, roi, coApp) {
    const method = String(methodName || '').toUpperCase();
    if (evaluation.combined_double_whammy_breakdown) {
        const dw = evaluation.combined_double_whammy_breakdown;
        const isIciciNpm = String(evaluation.lender_policy_key || '').toUpperCase() === 'ICICI'
            && (method.includes('NET PROFIT') || method.includes('NPM'));
        const incomeLabel = isIciciNpm ? 'Combined NPM income' : 'Primary income';
        const otherEmiTerm = Number(dw.otherEmiCapacity || 0) > 0
            ? ` + Other EMI ${_money(dw.otherEmiCapacity)}`
            : '';
        return `Combined Double Whammy: K ${Number(dw.emiMultiplier || 0).toFixed(4)} x (${incomeLabel} ${_money(dw.primaryMonthlyIncome ?? dw.netProfitMonthly)} x DW ${_percent(dw.doubleWhammyPercent)}${otherEmiTerm}) / (1 + K x ${incomeLabel} / Property ${_money(dw.propertyValue)}) = ${_money(dw.doubleWhammyEligibleLoan)}; FOIR cap <= ${_percent(dw.maxFoirPercent)} gives ${_money(dw.foirCapEligibleLoan)}; Income eligible = ${_money(dw.incomeEligibleLoan)}`;
    }
    if (method.includes('GRP') || method.includes('GROSS RECEIPT')) {
        return `Gross Receipts x lender multiplier - exposure = ${_money(incomeBasedLoan)}`;
    }
    if (method.includes('DSCR')) {
        return `DSCR eligible debt service converted to loan at ROI ${roi ?? 'N/A'}% and tenure ${tenure ?? 'N/A'} months = ${_money(incomeBasedLoan)}`;
    }
    const addon = coApp?.eligibleLoanAmount ? ` + co-app salary add-on ${_money(coApp.eligibleLoanAmount)}` : '';
    return `Eligible EMI ${_money(evaluation.maximum_eligible_emi ?? evaluation.max_eligible_emi)} converted at ROI ${roi ?? 'N/A'}% and tenure ${tenure ?? 'N/A'} months = ${_money(incomeBasedLoan)}${addon}`;
}

function _finalEligibilityFormula({ incomeBasedLoan, ltvLoan, productCap, requestedCap, businessCreditCap, posDeduction, finalEligible }) {
    const candidates = [
        ['income eligibility', incomeBasedLoan],
        ['LTV eligibility', ltvLoan],
        ['product cap', productCap],
        ['requested cap', requestedCap],
        ['business credit cap', businessCreditCap]
    ].filter(([, value]) => value !== null && value !== undefined && Number(value) > 0);

    const candidateText = candidates.map(([label, value]) => `${label} ${_money(value)}`).join(', ');
    const posText = posDeduction && posDeduction > 0 ? `; POS deduction ${_money(posDeduction)}` : '';
    return `MIN(${candidateText || 'no valid candidates'})${posText} = ${_money(finalEligible)}`;
}

function _buildSourcePaths(inputSnapshot, sourceBundle) {
    const rows = [
        { section: 'Case Inputs', field: 'requested_loan_amount', source_path: 'case_esr_financials.requested_loan_amount' },
        { section: 'Case Inputs', field: 'requested_tenure_months', source_path: 'case_esr_financials.requested_tenure_months' },
        { section: 'Property', field: 'property_value', source_path: 'case_property_details.market_value / case_esr_financials.property_value' },
        { section: 'Salary', field: 'salaried_gross_monthly', source_path: 'case_esr_financials.salaried_gross_monthly' },
        { section: 'Salary', field: 'salaried_net_monthly', source_path: 'case_esr_financials.salaried_net_monthly' },
        { section: 'Salary', field: 'salaried_deductions_monthly', source_path: 'case_esr_financials.salaried_deductions_monthly' },
        { section: 'GST', field: 'gst_avg_monthly_sales', source_path: 'case_esr_financials.gst_avg_monthly_sales' },
        { section: 'GST', field: 'gst_industry_type', source_path: 'case_esr_financials.gst_industry_type' },
        { section: 'GST', field: 'gst_industry_margin', source_path: 'case_esr_financials.gst_industry_margin' },
        { section: 'GST', field: 'gst_income', source_path: 'case_esr_financials.gst_income' },
        { section: 'ITR', field: 'itr_pat', source_path: 'case_esr_financials.itr_pat' },
        { section: 'Bank', field: 'bank_avg_balance', source_path: 'case_esr_financials.bank_avg_balance' },
        { section: 'Bureau Obligations', field: 'obligations_detail', source_path: 'case_credit_obligations' }
    ];

    (sourceBundle.salaryInputs || []).forEach(row => {
        rows.push({
            section: 'Salary OCR',
            field: `salary_slip_ocr_results.${row.id}`,
            source_path: `salary_slip_ocr_results[id=${row.id}]`,
            document_id: row.document_id || null,
            salary_period: row.salary_period || `${row.year || ''}-${row.month || ''}`.replace(/-$/, ''),
            value: {
                gross_salary: row.gross_salary ?? null,
                net_salary: row.net_salary ?? null,
                deductions: row.deductions ?? null,
                deductions_is_derived: row.deductions_is_derived ?? null,
                employee_name: row.employee_name || null,
                employee_pan: row.employee_pan || null,
                salary_period: row.salary_period || null,
                source: row.extraction_source || row.source || null
            }
        });
    });

    return rows.map(row => ({
        ...row,
        value: row.value ?? _resolvePathValue(inputSnapshot, row.field, row.source_path) ?? null
    }));
}

function _collectWarnings(lenderResults, inputSnapshot, sourceBundle) {
    const rows = [];
    if (inputSnapshot?.salary_audit_summary?.warnings) {
        inputSnapshot.salary_audit_summary.warnings.forEach(warning => rows.push({ section: 'Salary', type: 'WARNING', message: warning }));
    }
    (sourceBundle.salaryInputs || []).forEach(row => {
        (row.extraction_warnings || []).forEach(warning => rows.push({ section: 'Salary OCR', type: 'WARNING', message: warning, record_id: row.id }));
    });
    (lenderResults || []).forEach(lender => {
        (lender.scheme_evaluations || []).forEach(evaluation => {
            _compactArray([...(evaluation.failure_reasons || []), ...(evaluation.warnings || []), ...(evaluation.policy_warnings || [])])
                .forEach(message => rows.push({
                    section: 'Lender Result',
                    type: evaluation.failure_reasons?.includes(message) ? 'EXCLUSION' : 'WARNING',
                    lender_name: lender.lender_name,
                    scheme_name: evaluation.scheme_name,
                    message
                }));
        });
    });
    return rows.map(row => _flatten(row));
}

function _calculationSteps(evaluation, lender, index) {
    return {
        lender_name: lender.lender_name,
        scheme_name: evaluation.scheme_name || lender.best_scheme_name || null,
        scheme_index: index + 1,
        foir_breakdown: evaluation.foir_breakdown || null,
        eligible_income_breakdown: evaluation.eligible_income_breakdown || null,
        dscr_breakdown: evaluation.dscr_breakdown || null,
        ltv_breakdown: evaluation.ltv_breakdown || null,
        final_evaluation: evaluation
    };
}

function _calculationStatus(evaluation, lender) {
    if (typeof evaluation?.is_eligible === 'boolean') {
        if (evaluation.manual_review_required) return 'MANUAL_REVIEW';
        if (evaluation.configuration_error || evaluation.parameter_error) return 'CONFIGURATION_ERROR';
        return evaluation.is_eligible ? 'ELIGIBLE' : 'INELIGIBLE';
    }
    if (lender?.manual_review_required) return 'MANUAL_REVIEW';
    if (lender?.is_eligible === true) return 'ELIGIBLE';
    if (evaluation.configuration_error || evaluation.parameter_error) return 'CONFIGURATION_ERROR';
    return 'INELIGIBLE';
}

function _manualReviewRequired(evaluation, lender) {
    if (typeof evaluation?.manual_review_required === 'boolean') return evaluation.manual_review_required;
    return Boolean(lender?.manual_review_required);
}

function _maskSensitive(value) {
    if (Array.isArray(value)) return value.map(_maskSensitive);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, _maskSensitive(entry)]));
    }
    if (typeof value !== 'string') return value;
    return value
        .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, match => `${match.slice(0, 3)}****${match.slice(-1)}`)
        .replace(/\b[0-9]{12}\b/g, match => `********${match.slice(-4)}`)
        .replace(/\b[0-9]{9,18}\b/g, match => `${'*'.repeat(Math.max(0, match.length - 4))}${match.slice(-4)}`);
}

function _safeJson(value) {
    return JSON.parse(JSON.stringify(value, (_key, entry) => {
        if (typeof entry === 'bigint') return entry.toString();
        if (entry instanceof Date) return entry.toISOString();
        if (entry && typeof entry === 'object' && typeof entry.toNumber === 'function') return entry.toNumber();
        return entry;
    }));
}

function _flatten(row) {
    if (!row || typeof row !== 'object') return { value: row };
    const out = {};
    Object.entries(row).forEach(([key, value]) => {
        out[key] = value && typeof value === 'object' ? JSON.stringify(value) : value;
    });
    return out;
}

function _appendSheet(workbook, name, rows) {
    const safeRows = Array.isArray(rows) && rows.length ? rows : [{ note: 'No data available' }];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(safeRows), name.slice(0, 31));
}

function _objectToKeyValueRows(obj) {
    return Object.entries(obj || {}).map(([field, value]) => ({ field, value: value ?? null }));
}

function _pick(obj, keys) {
    return keys.reduce((acc, key) => {
        acc[key] = obj?.[key] ?? null;
        return acc;
    }, {});
}

function _numberOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function _intOrNull(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : null;
}

function _stringOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    return String(value);
}

function _emiPerLakh(emi, loanAmount) {
    if (!emi || !loanAmount || loanAmount <= 0) return null;
    return Number((emi / (loanAmount / 100000)).toFixed(2));
}

function _money(value) {
    const num = _numberOrNull(value);
    if (num === null) return null;
    return `INR ${Math.round(num).toLocaleString('en-IN')}`;
}

function _percent(value) {
    const num = _numberOrNull(value);
    if (num === null) return null;
    const normalized = Math.abs(num) <= 1 ? num * 100 : num;
    return `${normalized.toFixed(2)}%`;
}

function _sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function _compactArray(arr) {
    return (arr || []).filter(value => value !== null && value !== undefined && value !== '');
}

function _applicationNumber(caseRecord, fallbackCaseId) {
    return caseRecord?.application_number || caseRecord?.id || `CASE_${fallbackCaseId}`;
}

function _sanitizeFileToken(value) {
    return String(value || 'CASE').replace(/[^A-Za-z0-9_-]/g, '_');
}

function _storageKeyFromUrl(fileUrl) {
    if (!fileUrl) return null;
    const value = String(fileUrl);
    if (value.startsWith('s3://')) {
        const withoutScheme = value.slice('s3://'.length);
        const firstSlash = withoutScheme.indexOf('/');
        return firstSlash >= 0 ? withoutScheme.slice(firstSlash + 1) : null;
    }
    if (value.startsWith('logs/')) return value;
    return null;
}

function _resolvePathValue(inputSnapshot, field, sourcePath) {
    if (!inputSnapshot || !field) return null;
    if (Object.prototype.hasOwnProperty.call(inputSnapshot, field)) return inputSnapshot[field];
    if (sourcePath && sourcePath.startsWith('case_esr_financials.')) {
        return inputSnapshot[sourcePath.replace('case_esr_financials.', '')] ?? null;
    }
    return null;
}

module.exports = {
    persistEsrCalculationLog,
    listCalculationLogs,
    getCalculationLog,
    getCalculationLogDownload
};
