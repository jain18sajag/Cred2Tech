const fs = require('fs');
const path = require('path');
const { getStorageProvider } = require('../storage');

const BACKEND_ROOT = path.resolve(__dirname, '../../..');

function getLocalEsrLogsDir() {
    if (process.env.ESR_TRACE_LOG_DIR) {
        return path.resolve(process.env.ESR_TRACE_LOG_DIR);
    }

    if (process.env.ESR_LOG_DIR) {
        return path.resolve(process.env.ESR_LOG_DIR);
    }

    if (process.env.LOGS_DIR) {
        return path.resolve(process.env.LOGS_DIR, 'esr');
    }

    return path.join(BACKEND_ROOT, 'logs', 'esr');
}

function shouldUploadTraceToStorage() {
    const provider = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
    return provider === 'S3' && process.env.ESR_TRACE_STORAGE !== 'false';
}

class EsrTraceLogger {
    constructor(options = {}) {
        this.enabled = process.env.ESR_TRACE_LOGGING === 'true' || options.enabled === true;
        this.verbose = process.env.ESR_TRACE_LEVEL === 'verbose' || options.traceLevel === 'verbose';
        this.buffer = [];
        this.startTime = Date.now();
        this.caseId = null;
        this.lastStepTime = Date.now();
    }

    // Scrub sensitive info (PAN, GSTIN, accounts, AWS URLs, emails/phones)
    _maskSensitive(str) {
        if (!str) return str;
        let masked = String(str);
        
        // Mask AWS S3 Signed URLs
        masked = masked.replace(/(https?:\/\/[^\s"'<>]+\.s3\.[^\s"'<>]+\.amazonaws\.com[^\s"'<>]+X-Amz-Credential=)[^\s"'<>]+/gi, '$1[MASKED_CREDENTIALS]');
        masked = masked.replace(/(https?:\/\/[^\s"'<>]+\.s3\.[^\s"'<>]+\.amazonaws\.com[^\s"'<>]+X-Amz-Signature=)[^\s"'<>]+/gi, '$1[MASKED_SIGNATURE]');
        
        // Mask PAN (e.g. ABCDE1234F -> AXXXXXX34F)
        masked = masked.replace(/\b([a-zA-Z]{5})(\d{4})([a-zA-Z]{1})\b/g, (m, p1, p2, p3) => {
            return p1[0] + 'XXXX' + p2.slice(-2) + p3;
        });
        
        // Mask GSTIN (e.g. 27ABCDE1234F1Z5 -> 27AXXXXXX34F1Z5)
        masked = masked.replace(/\b(\d{2})([a-zA-Z]{5})(\d{4})([a-zA-Z]{1})([1-9a-zA-Z]{1})([zZ]{1})([0-9a-zA-Z]{1})\b/g, (m, p1, p2, p3, p4, p5, p6, p7) => {
            return p1 + p2[0] + 'XXXX' + p3.slice(-2) + p4 + p5 + p6 + p7;
        });

        // Mask Account numbers (mask all but last 4)
        masked = masked.replace(/\b(\d{6,18})\b/g, (m, acc) => {
            if (acc.length < 8) return acc;
            return 'X'.repeat(acc.length - 4) + acc.slice(-4);
        });

        return masked;
    }

    // Safely format data as string
    _format(payload) {
        if (!payload) return '';
        let str = '';
        if (typeof payload === 'object') {
            str = JSON.stringify(payload, null, 2);
        } else {
            str = String(payload);
        }
        return this._maskSensitive(str);
    }

    startTrace(caseId, tenantName, productType, inputs) {
        if (!this.enabled) return;
        this.caseId = caseId;
        const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
        this.buffer.push(`====================================================`);
        this.buffer.push(`ESR UNDERWRITING TRACE`);
        this.buffer.push(`======================`);
        this.buffer.push(`Case ID: ${caseId}`);
        this.buffer.push(`Tenant: ${tenantName || 'Unknown'}`);
        this.buffer.push(`Product: ${productType || 'Unknown'}`);
        this.buffer.push(`Generated At: ${ts}`);
        this.buffer.push(`\n====================================================`);
        this.buffer.push(`INPUT SNAPSHOT`);
        this.buffer.push(`==============`);
        
        for (const [key, val] of Object.entries(inputs || {})) {
            this.buffer.push(`${key}: ${val}`);
        }
        this.buffer.push('');
    }

    startSchemeTrace(lenderName, schemeName) {
        if (!this.enabled) return;
        this.buffer.push(`\n====================================================`);
        this.buffer.push(`LENDER: ${lenderName?.toUpperCase()}`);
        this.buffer.push(`SCHEME: ${schemeName?.toUpperCase()}`);
        this.buffer.push(`====================================================\n`);
    }

    traceStep(stepName, details) {
        if (!this.enabled) return;
        const now = Date.now();
        const duration = now - this.lastStepTime;
        this.lastStepTime = now;
        
        this.buffer.push(`---`);
        this.buffer.push(`## ${stepName}`);
        this.buffer.push(`Duration: ${duration}ms\n`);
        if (details) {
            this.buffer.push(this._format(details));
            this.buffer.push('');
        }
    }

    traceFormula(calculationName, formulaText, calculationText, resultText) {
        if (!this.enabled) return;
        this.buffer.push(`${calculationName}:\n`);
        if (formulaText) {
            this.buffer.push(`Formula:\n${formulaText}\n`);
        }
        if (calculationText) {
            this.buffer.push(`Calculation:\n${calculationText}\n`);
        }
        if (resultText !== undefined) {
            this.buffer.push(`= ${resultText}\n`);
        }
    }

    traceFailure(category, message, payload) {
        if (!this.enabled) return;
        this.buffer.push(`[FAILURE: ${category}] ${message}`);
        if (payload) this.buffer.push(this._format(payload));
        this.buffer.push('');
    }

    traceWarning(message, payload) {
        if (!this.enabled) return;
        this.buffer.push(`[WARNING] ${message}`);
        if (payload) this.buffer.push(this._format(payload));
        this.buffer.push('');
    }

    traceSuccess(message, payload) {
        if (!this.enabled) return;
        this.buffer.push(`[SUCCESS] ${message}`);
        if (payload) this.buffer.push(this._format(payload));
        this.buffer.push('');
    }

    traceVerbose(message, payload) {
        if (!this.enabled || !this.verbose) return;
        this.buffer.push(this._format(message));
        if (payload) this.buffer.push(this._format(payload));
        this.buffer.push('');
    }

    traceExtraction(category, details) {
        if (!this.enabled) return;
        this.buffer.push(`${category.toUpperCase()} SOURCE TRACE\n`);
        
        for (const [section, data] of Object.entries(details || {})) {
            this.buffer.push(`${section}:`);
            
            if (data === null || data === undefined) {
                this.buffer.push(`  N/A`);
                this.buffer.push('');
                continue;
            }

            if (typeof data !== 'object' || Array.isArray(data)) {
                // If it's a primitive or an array at the section level
                if (Array.isArray(data)) {
                    data.forEach(v => this.buffer.push(`  - ${this._maskSensitive(String(v))}`));
                } else {
                    this.buffer.push(`  ${this._maskSensitive(String(data))}`);
                }
            } else {
                for (const [key, val] of Object.entries(data)) {
                    if (Array.isArray(val)) {
                        this.buffer.push(`  ${key}:`);
                        val.forEach(v => this.buffer.push(`    - ${this._maskSensitive(String(v))}`));
                    } else if (val !== null && typeof val === 'object') {
                        // Stringify inner objects nicely
                        this.buffer.push(`  ${key}: ${JSON.stringify(val)}`);
                    } else if (val !== undefined && val !== null) {
                        this.buffer.push(`  ${key}: ${this._maskSensitive(String(val))}`);
                    }
                }
            }
            this.buffer.push('');
        }
    }

    traceTable(tableName, headers, rows) {
        if (!this.enabled) return;
        this.buffer.push(`${tableName}:`);
        
        // Calculate column widths
        const colWidths = headers.map((h, i) => {
            let max = String(h).length;
            rows.forEach(r => {
                const len = String(r[i] || '').length;
                if (len > max) max = len;
            });
            return max + 2; // padding
        });

        const headerStr = headers.map((h, i) => String(h).padEnd(colWidths[i])).join(' | ');
        this.buffer.push(`  ${headerStr}`);
        
        rows.forEach(r => {
            const rowStr = r.map((c, i) => this._maskSensitive(String(c || '')).padEnd(colWidths[i])).join(' | ');
            this.buffer.push(`  ${rowStr}`);
        });
        this.buffer.push('');
    }

    traceParser(parserName, paramKey, rawValue, result) {
        if (!this.enabled) return;
        const rawType = (rawValue === null || rawValue === undefined) ? 'null' : typeof rawValue;
        const isMissing = rawValue === null || rawValue === undefined || rawValue === '' || rawValue === '---';

        this.buffer.push(`[PARSER] ${parserName} for ${paramKey}`);
        this.buffer.push(`  Raw Type:        ${rawType}`);
        this.buffer.push(`  Raw Value:       "${rawValue}"`);

        if (isMissing) {
            this.buffer.push(`  Status:          CONFIG_MISSING (no lender value configured)`);
        } else if (result && !result.ok) {
            this.buffer.push(`  Status:          CONFIG_PARSE_ERROR`);
            this.buffer.push(`  Error:           ${result.error}`);
        } else if (result) {
            let normVal = result.value;
            if (normVal && typeof normVal === 'object' && normVal.type) {
                normVal = JSON.stringify(normVal);
            }
            this.buffer.push(`  Status:          OK`);
            this.buffer.push(`  Normalized:      ${normVal !== null && normVal !== undefined ? normVal : 'null'}`);
            if (result.warning) this.buffer.push(`  Note:            ${result.warning}`);
        }
        this.buffer.push('');
    }

    flushTrace() {
        if (!this.enabled) return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
        const fileName = `ESR_CASE_${this.caseId || 'UNKNOWN'}_${timestamp[0]}T${timestamp[1]}.log`;
        const content = this.buffer.join('\n');

        try {
            const logsDir = getLocalEsrLogsDir();
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const filePath = path.join(logsDir, fileName);

            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`\n[ESR TRACE] Generated: ${filePath}`);
        } catch (err) {
            console.warn(`[ESR TRACE WARNING] Failed to write local trace log to ${getLocalEsrLogsDir()}: ${err.message}`);
        }

        if (shouldUploadTraceToStorage()) {
            const storageKey = path.posix.join('logs', 'esr', fileName);
            getStorageProvider('S3')
                .save(Buffer.from(content, 'utf8'), storageKey, 'text/plain; charset=utf-8')
                .then(() => {
                    console.log(`[ESR TRACE] Uploaded: s3://${process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET}/${storageKey}`);
                })
                .catch((err) => {
                    console.warn(`[ESR TRACE WARNING] Failed to upload trace log to S3 (${storageKey}): ${err.message}`);
                });
        }
    }
}

module.exports = EsrTraceLogger;
