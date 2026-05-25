const fs = require('fs');
const path = require('path');

class EsrTraceLogger {
    constructor() {
        this.enabled = process.env.ESR_TRACE_LOGGING === 'true';
        this.buffer = [];
        this.startTime = Date.now();
        this.caseId = null;
        this.lastStepTime = Date.now();
    }

    // Safely format data as string
    _format(payload) {
        if (!payload) return '';
        if (typeof payload === 'object') {
            return JSON.stringify(payload, null, 2);
        }
        return String(payload);
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
        try {
            const logsDir = path.join(process.cwd(), 'logs', 'esr');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T');
            const fileName = `ESR_CASE_${this.caseId || 'UNKNOWN'}_${timestamp[0]}T${timestamp[1]}.log`;
            const filePath = path.join(logsDir, fileName);

            fs.writeFileSync(filePath, this.buffer.join('\n'), 'utf8');
            console.log(`\n[ESR TRACE] Generated: logs/esr/${fileName}`);
        } catch (err) {
            console.warn(`[ESR TRACE WARNING] Failed to write trace log: ${err.message}`);
        }
    }
}

module.exports = EsrTraceLogger;
