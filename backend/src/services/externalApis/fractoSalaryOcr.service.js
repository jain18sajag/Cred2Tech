const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { processSalarySlipOcr: mockProcessSalarySlipOcr } = require('./salaryOcr.service');

// Use the new Cred2Tech OCR URL and API Key
const getBaseUrl = () => process.env.CRED2TECH_OCR_BASE_URL || 'https://ocr.api.cred2tech.com';
const getApiKey = () => process.env.CRED2TECH_OCR_API_KEY || 'Fu65SDEeUKmXNvfZdBzwM_NNpuJ_LFYgKsPrfbvKBrQ';

/**
 * Validates the file extension and size before hitting API.
 */
const validateFile = (filePath, mimeType) => {
    if (!fs.existsSync(filePath)) {
        throw new Error('No file uploaded');
    }

    const stats = fs.statSync(filePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    if (fileSizeInMB > 10) {
        throw new Error('File size exceeds 10 MB.');
    }

    const ext = path.extname(filePath).toLowerCase();
    const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

    if (!allowedExtensions.includes(ext)) {
        throw new Error('Unsupported file type. Upload PDF, PNG, JPEG, or WEBP.');
    }
};

/**
 * Maps HTTP/Axios errors to user-friendly messages.
 */
const handleOcrError = (error) => {
    console.error('[fractoSalaryOcr.service] Cred2Tech API Error:', error.response?.data || error.message);

    if (error.response) {
        const status = error.response.status;
        const data = error.response.data || {};
        const msg = String(data.message || data.Error || data.error || '').toLowerCase();
        const rawMsg = String(data.message || data.Error || data.error || JSON.stringify(data));

        if (status === 400) {
            if (msg.includes('file') || msg.includes('read')) {
                return new Error(`OCR service error: ${rawMsg}`);
            }
            if (msg.includes('size')) {
                return new Error('File size exceeds 10 MB.');
            }
            return new Error(`Invalid OCR payload. Vendor says: ${rawMsg}`);
        }
        if (status === 403 || status === 401) {
            return new Error('OCR service is not configured correctly (Invalid API Key).');
        }
        if (status === 422) {
            const detail = data.detail || JSON.stringify(data);
            return new Error(`OCR service validation error: ${detail}`);
        }
        if (status >= 500) {
            return new Error('OCR service is temporarily unavailable.');
        }
        
        const detail = data.detail || JSON.stringify(data);
        return new Error(`OCR service error (${status}): ${detail}`);
    }

    return new Error('Unknown OCR error occurred.');
};

/**
 * Normalizes Cred2Tech parsed data.
 */
const VALID_PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MATCH_STATUS = {
    MATCHED: 'MATCHED',
    MISMATCHED: 'MISMATCHED',
    NOT_AVAILABLE: 'NOT_AVAILABLE',
    MANUAL_REVIEW: 'MANUAL_REVIEW'
};

const toNumberOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsedNum = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsedNum) ? parsedNum : null;
};

const extractValue = (obj) => {
    if (obj && typeof obj === 'object' && obj.value !== undefined) return obj.value;
    return obj ?? null;
};

const extractNumericValue = (obj) => toNumberOrNull(extractValue(obj));

const parseSalaryPeriod = (salaryDate) => {
    const rawValue = salaryDate && typeof salaryDate === 'object' ? salaryDate.value : salaryDate;
    if (typeof rawValue !== 'string') return { salary_period: null, month: null, year: null };
    const match = rawValue.trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return { salary_period: null, month: null, year: null };
    return { salary_period: rawValue.trim(), month: match[2], year: match[1] };
};

const normalizeCallerMonth = (month) => {
    if (month === null || month === undefined) return null;
    const raw = String(month).trim();
    if (!raw) return null;

    const monthNameMap = {
        january: '01',
        february: '02',
        march: '03',
        april: '04',
        may: '05',
        june: '06',
        july: '07',
        august: '08',
        september: '09',
        october: '10',
        november: '11',
        december: '12'
    };
    const lower = raw.toLowerCase();
    if (monthNameMap[lower]) return monthNameMap[lower];

    const numericMatch = raw.match(/^0?([1-9])$|^(1[0-2])$/);
    if (!numericMatch) return null;

    return String(Number(raw)).padStart(2, '0');
};

const findValidPan = (...sources) => {
    for (const source of sources) {
        if (!source) continue;
        const candidates = String(source).toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/g) || [];
        const valid = candidates.find(candidate => VALID_PAN_REGEX.test(candidate));
        if (valid) return valid;
    }
    return null;
};

const normalizeNameForMatch = (name) => String(name || '').toLowerCase().replace(/[^a-z]/g, '');

const resolveNameMatchStatus = (employeeName, applicant = {}) => {
    if (!employeeName || !applicant?.name) return MATCH_STATUS.NOT_AVAILABLE;
    return normalizeNameForMatch(employeeName) === normalizeNameForMatch(applicant.name)
        ? MATCH_STATUS.MATCHED
        : MATCH_STATUS.MISMATCHED;
};

const resolvePanMatchStatus = (employeePan, applicant = {}) => {
    if (!employeePan || !applicant?.pan_number) return MATCH_STATUS.NOT_AVAILABLE;
    return String(employeePan).toUpperCase() === String(applicant.pan_number).toUpperCase()
        ? MATCH_STATUS.MATCHED
        : MATCH_STATUS.MISMATCHED;
};

const normalizeSalarySlipResponse = (parsedData, options = {}) => {
    const callerMonth = normalizeCallerMonth(options.month);
    const callerYear = options.year ? String(options.year) : null;
    const applicant = options.applicant || null;

    if (!parsedData || typeof parsedData !== 'object') {
        return {
            gross_salary: null,
            net_salary: null,
            deductions: null,
            deductions_is_derived: false,
            employer_name: null,
            employee_name: null,
            employee_pan: null,
            salary_period: null,
            month: callerMonth,
            year: callerYear,
            validation: {
                period_match_status: MATCH_STATUS.NOT_AVAILABLE,
                manual_review_required: true,
                warnings: ['OCR response is empty or invalid.']
            },
            name_match_status: MATCH_STATUS.NOT_AVAILABLE,
            pan_match_status: MATCH_STATUS.NOT_AVAILABLE
        };
    }

    const gross_salary = extractNumericValue(parsedData.gross_salary);
    const net_salary = extractNumericValue(parsedData.net_salary);
    const explicitDeductions = extractNumericValue(parsedData.deductions);
    
    let deductions = explicitDeductions;
    let deductions_is_derived = false;
    const warnings = Array.isArray(parsedData.warnings) ? [...parsedData.warnings] : [];

    if (deductions === null && gross_salary !== null && net_salary !== null && gross_salary >= net_salary) {
        deductions = gross_salary - net_salary;
        deductions_is_derived = true;
    } else if (deductions === null && gross_salary !== null && net_salary !== null && gross_salary < net_salary) {
        warnings.push('Gross salary is lower than net salary; deductions were not derived.');
    }

    const employer_name = extractValue(parsedData.employer_name) || null;
    const employee_name = extractValue(parsedData.name) || null;
    const employee_pan = findValidPan(
        extractValue(parsedData.employee_pan),
        parsedData.name?.raw_line,
        parsedData.pan?.raw_line,
        parsedData.raw_line
    );
    const period = parseSalaryPeriod(parsedData.salary_date);

    let period_match_status = MATCH_STATUS.NOT_AVAILABLE;
    let manual_review_required = false;

    if (!period.salary_period) {
        warnings.push('Salary period is missing or not in YYYY-MM format.');
        manual_review_required = true;
    } else if (callerMonth && callerYear) {
        period_match_status = period.month === callerMonth && period.year === callerYear
            ? MATCH_STATUS.MATCHED
            : MATCH_STATUS.MISMATCHED;
        if (period_match_status === MATCH_STATUS.MISMATCHED) {
            warnings.push(`Caller period ${callerYear}-${callerMonth} differs from OCR period ${period.salary_period}.`);
            manual_review_required = true;
        }
    }

    const name_match_status = resolveNameMatchStatus(employee_name, applicant);
    const pan_match_status = resolvePanMatchStatus(employee_pan, applicant);
    if (name_match_status === MATCH_STATUS.MISMATCHED || pan_match_status === MATCH_STATUS.MISMATCHED) {
        manual_review_required = true;
    }

    return {
        gross_salary,
        net_salary,
        deductions,
        deductions_is_derived,
        employer_name,
        employee_name,
        employee_pan,
        salary_period: period.salary_period,
        month: period.month || callerMonth,
        year: period.year || callerYear,
        net_salary_words_match: parsedData.net_salary?.words_match ?? null,
        pages_processed: Number.isInteger(parsedData.meta?.pages_processed) ? parsedData.meta.pages_processed : null,
        extraction_source: parsedData.meta?.source || null,
        ocr_confidence: parsedData.meta?.ocr_confidence ?? null,
        extraction_checks: Array.isArray(parsedData.checks) ? parsedData.checks : [],
        extraction_warnings: warnings,
        name_match_status,
        pan_match_status,
        validation: {
            period_match_status,
            caller_period: callerMonth && callerYear ? `${callerYear}-${callerMonth}` : null,
            ocr_period: period.salary_period,
            manual_review_required,
            warnings
        }
    };
};

const buildSalarySlipOcrDbData = (ocrResultData) => ({
    ocr_status: ocrResultData.status,
    vendor_job_id: ocrResultData.vendor_job_id,
    raw_ocr_response: ocrResultData.raw_ocr_response,
    extracted_json: ocrResultData.extracted_json,
    gross_salary: ocrResultData.gross_salary,
    net_salary: ocrResultData.net_salary,
    deductions: ocrResultData.deductions,
    deductions_is_derived: ocrResultData.deductions_is_derived || false,
    employer_name: ocrResultData.employer_name,
    employee_name: ocrResultData.employee_name,
    employee_pan: ocrResultData.employee_pan,
    salary_period: ocrResultData.salary_period,
    month: ocrResultData.month,
    year: ocrResultData.year,
    net_salary_words_match: ocrResultData.net_salary_words_match,
    pages_processed: ocrResultData.pages_processed,
    extraction_source: ocrResultData.extraction_source,
    ocr_confidence: ocrResultData.ocr_confidence,
    extraction_checks: ocrResultData.extraction_checks,
    extraction_warnings: ocrResultData.extraction_warnings,
    name_match_status: ocrResultData.name_match_status,
    pan_match_status: ocrResultData.pan_match_status
});

const hasDuplicateSalaryPeriod = (records = [], candidate = {}) => {
    return records.some(record =>
        record &&
        record.id !== candidate.id &&
        record.case_id === candidate.case_id &&
        record.applicant_id === candidate.applicant_id &&
        String(record.month) === String(candidate.month) &&
        String(record.year) === String(candidate.year)
    );
};

/**
 * Synchronous Upload to Cred2Tech
 */
async function processSalarySlipSync({ filePath, mimeType, originalName, document_id, case_id, applicant_id, month, year, tenant_id, applicant = null }) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        console.log('[fractoSalaryOcr.service] Running in MOCK mode.');
        return mockProcessSalarySlipOcr({ tenant_id, case_id, applicant_id, document_id, month, year });
    }

    validateFile(filePath, mimeType);

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { contentType: mimeType, filename: originalName });

    try {
        const response = await axios.post(`${getBaseUrl()}/extract?date_order=auto`, form, {
            headers: {
                'X-API-Key': getApiKey(),
                'accept': 'application/json',
                ...form.getHeaders()
            },
            timeout: 60000 
        });

        const data = response.data;
        const normalized = normalizeSalarySlipResponse(data, { month, year, applicant });

        return {
            status: 'COMPLETED',
            vendor_job_id: `C2T-SYNC-${Date.now()}`,
            raw_ocr_response: data,
            extracted_json: data,
            validation: normalized.validation,
            ...normalized
        };
    } catch (error) {
        throw handleOcrError(error);
    }
}

/**
 * Asynchronous Upload (Shim for Synchronous API)
 */
async function startSalarySlipAsync(params) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        console.log('[fractoSalaryOcr.service] Running in MOCK mode.');
        return mockProcessSalarySlipOcr({ ...params });
    }

    // Since Cred2Tech API is synchronous, we process it synchronously right away
    const syncResult = await processSalarySlipSync(params);
    const jobId = `C2T-ASYNC-${Date.now()}`;

    // Return it in the shape expected by the async polling UI
    return {
        status: 'PROCESSING',
        vendor_job_id: jobId,
        // We embed the final result inside raw_ocr_response so getJobStatus can retrieve it from the DB
        raw_ocr_response: {
            ...syncResult.raw_ocr_response,
            _cred2tech_shim_completed: true
        }
    };
}

/**
 * Synchronous Batch Upload
 */
async function processSalarySlipBatchSync(params) {
    const { files, case_id, applicant_id, tenant_id, applicant = null } = params;

    if (process.env.FRACTO_OCR_MODE === 'mock') {
        return {
            status: 'COMPLETED',
            vendor_job_id: `MOCK-SYNC-BATCH-${Date.now()}`,
            extracted_json: { net_salary: 50000, gross_salary: 60000 },
            net_salary: 50000,
            gross_salary: 60000
        };
    }

    try {
        console.log(`[fractoSalaryOcr.service] Processing batch of ${files.length} files in parallel...`);

        const results = await Promise.all(files.map(async (file) => {
            try {
                return await processSalarySlipSync({
                    ...file,
                    case_id,
                    applicant_id,
                    tenant_id,
                    applicant
                });
            } catch (err) {
                console.error(`[fractoSalaryOcr.service] Single file OCR failed during batch:`, err.message);
                return { status: 'FAILED', error_message: err.message, month: file.month, year: file.year };
            }
        }));

        const successful = results.filter(r => r.status === 'COMPLETED');
        if (successful.length === 0) {
            throw new Error('All files in the batch failed to process.');
        }

        return {
            status: 'COMPLETED',
            batchResults: results,
            ...successful[0],
            vendor_job_id: successful[0].vendor_job_id,
            raw_ocr_response: successful[0].raw_ocr_response,
            extracted_json: successful[0].extracted_json
        };
    } catch (error) {
        throw handleOcrError(error);
    }
}

/**
 * Asynchronous Batch Upload (Shim)
 */
async function startSalarySlipBatchAsync(params) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        return { status: 'PROCESSING', vendor_job_id: `MOCK-BATCH-${Date.now()}` };
    }

    // Process immediately
    const syncBatchResult = await processSalarySlipBatchSync(params);
    const jobId = `C2T-BATCH-${Date.now()}`;

    // Pass the completed batchResults embedded in raw response
    return {
        status: 'PROCESSING',
        vendor_job_id: jobId,
        raw_ocr_response: {
            _cred2tech_shim_completed: true,
            batchResults: syncBatchResult.batchResults
        }
    };
}

/**
 * Check Async Job Status
 */
async function getJobStatus(jobId, options = {}) {
    if (!jobId) throw new Error('Job ID is required to check status.');

    // We fetch the record from the DB to see our shimmed completed result
    const prisma = require('../../../config/db');
    const record = await prisma.salarySlipOcrResult.findFirst({
        where: { vendor_job_id: jobId }
    });

    if (!record || !record.raw_ocr_response) {
        return { status: 'PROCESSING', raw_ocr_response: {} };
    }

    const data = record.raw_ocr_response;
    
    // Check if it's our completed shim
    if (data._cred2tech_shim_completed) {
        // Handle batch vs single
        if (data.batchResults) {
            // For batch, we just say completed. The controller doesn't usually poll batch but if it does, this handles it.
            return {
                status: 'COMPLETED',
                raw_ocr_response: data
            };
        }

        const normalized = normalizeSalarySlipResponse(data, options);
        return {
            status: 'COMPLETED',
            raw_ocr_response: data,
            extracted_json: data,
            validation: normalized.validation,
            ...normalized
        };
    }

    return { status: 'PROCESSING', raw_ocr_response: data };
}

module.exports = {
    processSalarySlipSync,
    processSalarySlipBatchSync,
    startSalarySlipAsync,
    startSalarySlipBatchAsync,
    getJobStatus,
    normalizeSalarySlipResponse,
    buildSalarySlipOcrDbData,
    hasDuplicateSalaryPeriod
};
