const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const disbursementService = require('./disbursement.service');

const parseNum = (val, fallback = null) => {
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val === 'number') return val;
    const stripped = String(val).replace(/[^0-9.-]+/g, '');
    const num = parseFloat(stripped);
    return isNaN(num) ? fallback : num;
};

const parseDate = (val) => {
    if (!val) return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
};

class BulkDisbursementUploadService {
    async generateTemplate() {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Cred2Tech';
        
        const sheet = workbook.addWorksheet('Disbursements');
        sheet.columns = [
            { header: 'Case ID', key: 'case_id', width: 15 },
            { header: 'Disbursement Amount', key: 'amount', width: 20 },
            { header: 'Disbursement Date (YYYY-MM-DD)', key: 'date', width: 35 },
            { header: 'Next Disbursement Due Date (YYYY-MM-DD)', key: 'next_date', width: 40 },
            { header: 'Remarks', key: 'remarks', width: 40 },
            { header: 'Idempotency Key', key: 'idempotency_key', width: 30 }
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.addRow([123, 50000, '2023-10-01', '2023-11-01', 'First tranche', 'TRX-12345']);

        return await workbook.xlsx.writeBuffer();
    }

    async processUpload(fileBuffer, tenantId, userId) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileBuffer);
        
        const sheet = workbook.getWorksheet('Disbursements');
        if (!sheet) throw new Error('Missing "Disbursements" sheet.');

        const rows = [];
        let headers = [];
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                headers = row.values.map(v => typeof v === 'string' ? v.trim() : v);
            } else {
                const rowData = {};
                row.eachCell((cell, colNumber) => {
                    const header = headers[colNumber];
                    if (header) {
                        rowData[header] = cell.value;
                    }
                });
                rows.push(rowData);
            }
        });

        const result = {
            totalRows: rows.length,
            successRows: 0,
            failedRows: 0,
            errors: []
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const caseId = parseNum(row['Case ID']);
            const amount = parseNum(row['Disbursement Amount']);
            const date = parseDate(row['Disbursement Date (YYYY-MM-DD)']);
            const nextDate = parseDate(row['Next Disbursement Due Date (YYYY-MM-DD)']);
            const remarks = row['Remarks']?.toString() || '';
            const idempotencyKey = row['Idempotency Key']?.toString() || null;

            try {
                if (!caseId) throw new Error('Case ID is missing or invalid.');
                if (!amount || amount <= 0) throw new Error('Amount must be greater than 0.');
                if (!date) throw new Error('Disbursement Date is missing or invalid.');

                await disbursementService.recordDisbursement(
                    caseId,
                    tenantId,
                    {
                        amount,
                        disbursement_date: date,
                        next_disbursement_due_date: nextDate,
                        remarks
                    },
                    userId,
                    idempotencyKey
                );

                result.successRows++;
            } catch (err) {
                result.failedRows++;
                result.errors.push({
                    row: i + 2,
                    caseId: caseId || 'Unknown',
                    message: err.message
                });
            }
        }

        return result;
    }
}

module.exports = new BulkDisbursementUploadService();
