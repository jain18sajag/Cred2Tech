const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { processSalarySlipOcr: mockProcessSalarySlipOcr } = require('./salaryOcr.service');

// Normalize Base URL to avoid trailing slashes
const getBaseUrl = () => {
    let url = process.env.FRACTO_OCR_BASE_URL || 'https://prod-ml.fracto.tech';
    return url.replace(/\/+$/, '');
};

const getApiKey = () => process.env.FRACTO_OCR_API_KEY;
const getParserApp = () => process.env.FRACTO_SALARY_PARSER_APP;
const getModel = () => process.env.FRACTO_OCR_MODEL || 'v1';
const getExtraAccuracy = () => process.env.FRACTO_OCR_EXTRA_ACCURACY === 'true' ? 'true' : 'false';

/**
 * Validates the file extension and size before hitting Fracto API.
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
 * Maps Fracto HTTP/Axios errors to user-friendly messages.
 */
const handleFractoError = (error) => {
    console.error('[fractoSalaryOcr.service] Vendor API Error:', error.response?.data || error.message);

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
            return new Error(`Invalid OCR configuration or file payload. Vendor says: ${rawMsg}`);
        }
        if (status === 403) {
            if (msg.includes('funds') || msg.includes('wallet') || msg.includes('balance')) {
                return new Error('OCR service is temporarily unavailable.');
            }
            return new Error('OCR service is not configured correctly.');
        }
        if (status >= 500) {
            return new Error('OCR service is temporarily unavailable.');
        }
    }

    return new Error('Unknown OCR error occurred.');
};

/**
 * Normalizes Fracto parsed data safely, guarding against missing fields.
 */
const normalizeSalarySlipResponse = (parsedData) => {
    if (!parsedData || typeof parsedData !== 'object') {
        return { gross_salary: null, net_salary: null, deductions: null, employer_name: null, employee_name: null };
    }

    // Attempt to extract fields dynamically (defensive matching against varying key names)
    const findValue = (keys, isNumeric = false) => {
        // Expand keys to include PascalCase and lowercase versions
        const allKeys = [...keys];
        keys.forEach(k => {
            allKeys.push(k.charAt(0).toUpperCase() + k.slice(1));
            allKeys.push(k.toLowerCase());
        });

        for (const key of allKeys) {
            if (parsedData[key] !== undefined && parsedData[key] !== null) {
                let val = parsedData[key];
                if (isNumeric && typeof val === 'string') {
                    // Strip everything except numbers and decimal points
                    const parsedNum = parseFloat(val.replace(/[^0-9.]/g, ''));
                    return !isNaN(parsedNum) ? parsedNum : null;
                }
                return val;
            }
        }
        return null;
    };

    const gross_salary = findValue(['gross_salary', 'Gross_salary', 'grossPay', 'grossEarnings', 'grossAmount'], true);
    const net_salary = findValue(['net_salary', 'Net_salary', 'netPay', 'salary payable', 'netAmount'], true);
    const deductions = findValue(['deductions', 'Deductions', 'total_deductions', 'totalDeductions'], true);
    const employer_name = findValue(['employer_name', 'Employer_name', 'company_name', 'organization', 'companyName']);
    const employee_name = findValue(['employee_name', 'Employee_name', 'name', 'employeeName']);

    return {
        gross_salary,
        net_salary,
        deductions,
        employer_name,
        employee_name
    };
};

/**
 * Synchronous Upload to Fracto (blocks until parsed)
 */
async function processSalarySlipSync({ filePath, mimeType, originalName, document_id, case_id, applicant_id, month, year, tenant_id }) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        console.log('[fractoSalaryOcr.service] Running in MOCK mode.');
        return mockProcessSalarySlipOcr({ tenant_id, case_id, applicant_id, document_id, month, year });
    }

    validateFile(filePath, mimeType);

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { contentType: mimeType, filename: originalName });
    form.append('parserApp', getParserApp());
    form.append('model', getModel());
    form.append('extra_accuracy', getExtraAccuracy());

    try {
        const response = await axios.post(`${getBaseUrl()}/upload-file-smart-ocr`, form, {
            headers: {
                'x-api-key': getApiKey(),
                ...form.getHeaders()
            },
            timeout: 60000 // 60s timeout for sync OCR
        });

        const data = response.data;
        const normalized = normalizeSalarySlipResponse(data.parsedData);

        return {
            status: 'COMPLETED',
            vendor_job_id: data.job_id || null,
            raw_ocr_response: data,
            extracted_json: normalized,
            ...normalized
        };
    } catch (error) {
        throw handleFractoError(error);
    }
}

/**
 * Asynchronous Upload to Fracto (returns Job ID immediately)
 */
async function startSalarySlipAsync({ filePath, mimeType, originalName, document_id, case_id, applicant_id, month, year, tenant_id }) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        console.log('[fractoSalaryOcr.service] Running in MOCK mode.');
        return mockProcessSalarySlipOcr({ tenant_id, case_id, applicant_id, document_id, month, year });
    }

    validateFile(filePath, mimeType);

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { contentType: mimeType, filename: originalName });
    form.append('parserApp', getParserApp());
    form.append('model', getModel());
    form.append('extra_accuracy', getExtraAccuracy());

    try {
        const response = await axios.post(`${getBaseUrl()}/upload-file-smart-ocr-async`, form, {
            headers: {
                'x-api-key': getApiKey(),
                ...form.getHeaders()
            },
            timeout: 30000 // 30s timeout for async kick-off
        });

        const data = response.data;

        return {
            status: 'PROCESSING',
            vendor_job_id: data.job_id,
            raw_ocr_response: data
        };
    } catch (error) {
        throw handleFractoError(error);
    }
}

/**
 * Synchronous Batch Upload to Fracto
 * We process them in parallel to satisfy the user's batch request while bypassing 
 * the vendor's multi-part upload limitations.
 */
async function processSalarySlipBatchSync({ files, case_id, applicant_id, tenant_id }) {
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

        // Execute all OCRs in parallel
        const results = await Promise.all(files.map(async (file) => {
            try {
                return await processSalarySlipSync({
                    ...file,
                    case_id,
                    applicant_id,
                    tenant_id
                });
            } catch (err) {
                console.error(`[fractoSalaryOcr.service] Single file OCR failed during batch:`, err.message);
                return { status: 'FAILED', error_message: err.message, month: file.month, year: file.year };
            }
        }));

        // Check if any succeeded
        const successful = results.filter(r => r.status === 'COMPLETED');

        if (successful.length === 0) {
            throw new Error('All files in the batch failed to process.');
        }

        // Return the first successful one as a representative, but the controller will handle individual records
        return {
            status: 'COMPLETED',
            batchResults: results, // Pass all results back to the controller
            vendor_job_id: successful[0].vendor_job_id,
            raw_ocr_response: successful[0].raw_ocr_response,
            extracted_json: successful[0].extracted_json,
            ...successful[0].extracted_json
        };
    } catch (error) {
        throw handleFractoError(error);
    }
}

/**
 * Asynchronous Batch Upload to Fracto (multiple files)
 */
async function startSalarySlipBatchAsync({ files, case_id, applicant_id, tenant_id }) {
    if (process.env.FRACTO_OCR_MODE === 'mock') {
        console.log('[fractoSalaryOcr.service] Running in MOCK mode for batch.');
        // For mock, just return a single dummy job ID
        return { status: 'PROCESSING', vendor_job_id: `MOCK-BATCH-${Date.now()}` };
    }

    const form = new FormData();

    // Append each file
    for (const f of files) {
        validateFile(f.filePath, f.mimeType);
        form.append('file', fs.createReadStream(f.filePath), { contentType: f.mimeType, filename: f.originalName });
    }

    form.append('parserApp', getParserApp());
    form.append('model', getModel());
    form.append('extra_accuracy', getExtraAccuracy());

    try {
        const response = await axios.post(`${getBaseUrl()}/upload-file-smart-ocr-async`, form, {
            headers: {
                'x-api-key': getApiKey(),
                ...form.getHeaders()
            },
            timeout: 60000 // higher timeout since we're uploading multiple files
        });

        const data = response.data;

        return {
            status: 'PROCESSING',
            vendor_job_id: data.job_id,
            raw_ocr_response: data
        };
    } catch (error) {
        throw handleFractoError(error);
    }
}

/**
 * Check Async Job Status
 */
async function getJobStatus(jobId) {
    if (!jobId) throw new Error('Job ID is required to check status.');

    try {
        const response = await axios.get(`${getBaseUrl()}/get-job-status`, {
            params: { job_id: jobId },
            headers: { 'x-api-key': getApiKey() },
            timeout: 30000
        });

        const data = response.data;

        // Assuming Fracto returns a recognizable completion status or raw data
        if (data.status && data.status.toLowerCase() === 'processing') {
            return { status: 'PROCESSING', raw_ocr_response: data };
        }

        if (data.status && data.status.toLowerCase() === 'failed') {
            return { status: 'FAILED', error_message: 'Vendor OCR processing failed.', raw_ocr_response: data };
        }

        // If parsedData exists, assume it's done
        if (data.parsedData) {
            const normalized = normalizeSalarySlipResponse(data.parsedData);
            return {
                status: 'COMPLETED',
                raw_ocr_response: data,
                extracted_json: normalized,
                ...normalized
            };
        }

        // Catch-all
        return { status: 'PROCESSING', raw_ocr_response: data };

    } catch (error) {
        throw handleFractoError(error);
    }
}

module.exports = {
    processSalarySlipSync,
    processSalarySlipBatchSync,
    startSalarySlipAsync,
    startSalarySlipBatchAsync,
    getJobStatus,
    normalizeSalarySlipResponse
};
