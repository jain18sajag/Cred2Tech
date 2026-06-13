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
const normalizeSalarySlipResponse = (parsedData) => {
    if (!parsedData || typeof parsedData !== 'object') {
        return { gross_salary: null, net_salary: null, deductions: null, employer_name: null, employee_name: null };
    }

    const extractValue = (obj) => {
        if (obj && typeof obj === 'object' && obj.value !== undefined) {
            const val = obj.value;
            if (typeof val === 'string') {
                const parsedNum = parseFloat(val.replace(/[^0-9.-]/g, ''));
                return !isNaN(parsedNum) ? parsedNum : val;
            }
            return val;
        }
        return null;
    };

    const gross_salary = extractValue(parsedData.gross_salary);
    const net_salary = extractValue(parsedData.net_salary);
    
    // Deductions usually aren't returned explicitly by this endpoint, so we derive it if both gross and net are present
    let deductions = extractValue(parsedData.deductions);
    if (deductions === null && gross_salary !== null && net_salary !== null) {
        deductions = gross_salary - net_salary;
    }

    const employer_name = extractValue(parsedData.employer_name) || null; // Left null as it's not in the example payload
    const employee_name = extractValue(parsedData.name);

    return {
        gross_salary,
        net_salary,
        deductions,
        employer_name,
        employee_name
    };
};

/**
 * Synchronous Upload to Cred2Tech
 */
async function processSalarySlipSync({ filePath, mimeType, originalName, document_id, case_id, applicant_id, month, year, tenant_id }) {
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
        const normalized = normalizeSalarySlipResponse(data);

        return {
            status: 'COMPLETED',
            vendor_job_id: `C2T-SYNC-${Date.now()}`,
            raw_ocr_response: data,
            extracted_json: normalized,
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
    const { files, case_id, applicant_id, tenant_id } = params;

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
                    tenant_id
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
            vendor_job_id: successful[0].vendor_job_id,
            raw_ocr_response: successful[0].raw_ocr_response,
            extracted_json: successful[0].extracted_json,
            ...successful[0].extracted_json
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
async function getJobStatus(jobId) {
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

        const normalized = normalizeSalarySlipResponse(data);
        return {
            status: 'COMPLETED',
            raw_ocr_response: data,
            extracted_json: normalized,
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
    normalizeSalarySlipResponse
};
