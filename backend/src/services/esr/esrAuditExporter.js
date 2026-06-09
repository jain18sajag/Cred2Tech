const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

class EsrAuditExporter {
    constructor(caseId) {
        this.caseId = caseId;
        this.records = [];
    }

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

    addRecord(data) {
        this.records.push({
            Section: data.section || '',
            'ESR Field / Value Name': data.esrField || '',
            'Final ESR DB Field / Snapshot Field': data.dbField || '',
            'Source Type': data.sourceType || '',
            'Exact Source Path / Config Key / DB Field': this._maskSensitive(data.sourcePath) || '',
            'Raw Value Picked': this._maskSensitive(data.rawValue) || '',
            'Normalized Value': this._maskSensitive(data.normalizedValue) || '',
            'Formula Used, if any': data.formula || '',
            'Formula Inputs, if derived': this._maskSensitive(data.formulaInputs) || '',
            'Used In Which ESR Method': data.usedInMethod || '',
            'Included In Selected Monthly Income?': data.includedInMonthly || '',
            'Ignored Alternative Fields': data.ignoredFields || '',
            'Reason for Ignoring Alternative Fields': data.ignoredReason || '',
            'Notes / Warning': data.notes || ''
        });
    }

    generateMarkdown(outputPath) {
        let md = `# ESR Extracted Fields Path Report (Case ${this.caseId})\n\n`;
        
        const sections = {};
        for (const r of this.records) {
            if (!sections[r.Section]) sections[r.Section] = [];
            sections[r.Section].push(r);
        }

        for (const [sectionName, records] of Object.entries(sections)) {
            md += `## Section: ${sectionName}\n\n`;
            for (const r of records) {
                md += `ESR Field: ${r['ESR Field / Value Name']}\n`;
                if (r['Final ESR DB Field / Snapshot Field']) md += `Final DB/Snapshot Field: ${r['Final ESR DB Field / Snapshot Field']}\n`;
                md += `Source Type: ${r['Source Type']}\n`;
                if (r['Exact Source Path / Config Key / DB Field']) md += `Exact Source Path: ${r['Exact Source Path / Config Key / DB Field']}\n`;
                if (r['Raw Value Picked']) md += `Raw Value Picked:\n${r['Raw Value Picked']}\n`;
                if (r['Normalized Value']) md += `Normalized Value: ${r['Normalized Value']}\n`;
                if (r['Formula Used, if any']) md += `Formula: ${r['Formula Used, if any']}\n`;
                if (r['Formula Inputs, if derived']) md += `Formula Inputs:\n${r['Formula Inputs, if derived']}\n`;
                if (r['Used In Which ESR Method']) md += `Used In Method: ${r['Used In Which ESR Method']}\n`;
                if (r['Included In Selected Monthly Income?']) md += `Included In Selected Monthly Income: ${r['Included In Selected Monthly Income?']}\n`;
                if (r['Ignored Alternative Fields']) md += `Ignored Alternative Fields:\n${r['Ignored Alternative Fields']}\n`;
                if (r['Reason for Ignoring Alternative Fields']) md += `Reason for Ignoring:\n${r['Reason for Ignoring Alternative Fields']}\n`;
                if (r['Notes / Warning']) md += `Notes:\n${r['Notes / Warning']}\n`;
                md += `\n---\n\n`;
            }
        }
        
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, md, 'utf-8');
        return outputPath;
    }

    generateExcel(outputPath) {
        const sections = {};
        for (const r of this.records) {
            let s = r.Section.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 31);
            if (!s) s = "General";
            if (!sections[s]) sections[s] = [];
            sections[s].push(r);
        }

        const wb = xlsx.utils.book_new();
        
        // Create Summary Sheet
        const summaryData = this.records.map(r => ({
            Section: r.Section,
            Field: r['ESR Field / Value Name'],
            Value: r['Normalized Value'],
            SourceType: r['Source Type'],
            Path: r['Exact Source Path / Config Key / DB Field']
        }));
        const summaryWs = xlsx.utils.json_to_sheet(summaryData);
        xlsx.utils.book_append_sheet(wb, summaryWs, "Summary");

        // Create Section Sheets
        for (const [sheetName, records] of Object.entries(sections)) {
            const ws = xlsx.utils.json_to_sheet(records);
            // Auto width roughly
            const wscols = Object.keys(records[0]).map(() => ({ wch: 30 }));
            ws['!cols'] = wscols;
            xlsx.utils.book_append_sheet(wb, ws, sheetName);
        }

        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        xlsx.writeFile(wb, outputPath);
        return outputPath;
    }
}

module.exports = EsrAuditExporter;
