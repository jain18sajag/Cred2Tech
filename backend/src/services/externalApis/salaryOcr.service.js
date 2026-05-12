const prisma = require('../../../config/db');

/**
 * Mock OCR Service for Salary Slips
 * 
 * Simulates a vendor API call (like Signzy or similar) that parses a salary slip
 * document and extracts financial fields.
 */
async function processSalarySlipOcr({ tenant_id, customer_id, case_id, applicant_id, document_id, month, year }) {
    // 1. Mark as PROCESSING or create new record if it doesn't exist
    const ocrRecord = await prisma.salarySlipOcrResult.upsert({
        where: {
            case_id_applicant_id_month_year: {
                case_id,
                applicant_id,
                month,
                year
            }
        },
        update: {
            ocr_status: 'PROCESSING',
            document_id: document_id
        },
        create: {
            tenant_id,
            customer_id,
            case_id,
            applicant_id,
            document_id,
            month,
            year,
            ocr_status: 'PROCESSING'
        }
    });

    // 2. Simulate network / processing delay (2.5 seconds)
    if (process.env.NODE_ENV !== 'production') {
        await new Promise(resolve => setTimeout(resolve, 2500));
    }

    try {
        // 3. Mock extraction logic (in a real app, this would call the vendor API)
        const mockGross = 93700;
        const mockNet = 78450;
        const mockDeductions = mockGross - mockNet;

        // 4. Save results to DB
        const completedRecord = await prisma.salarySlipOcrResult.update({
            where: { id: ocrRecord.id },
            data: {
                ocr_status: 'COMPLETED',
                gross_salary: mockGross,
                net_salary: mockNet,
                deductions: mockDeductions,
                employer_name: 'TechCorp India Ltd',
                employee_name: 'Arjun Sharma',
                extracted_json: {
                    gross: mockGross,
                    net: mockNet,
                    deductions: mockDeductions,
                    employer: 'TechCorp India Ltd',
                    employee: 'Arjun Sharma',
                    confidence: 0.98
                }
            }
        });

        // 5. Recalculate average income and update CaseIncomeEntry
        await recalculateApplicantIncome(tenant_id, case_id, applicant_id);

        return completedRecord;
    } catch (error) {
        console.error('[salaryOcr.service] Error processing OCR:', error);
        await prisma.salarySlipOcrResult.update({
            where: { id: ocrRecord.id },
            data: {
                ocr_status: 'FAILED',
                error_message: error.message
            }
        });
        throw error;
    }
}

/**
 * Calculates the average annualized salary from all COMPLETED OCR results 
 * for a specific applicant, and updates the CaseIncomeEntry.
 */
async function recalculateApplicantIncome(tenant_id, case_id, applicant_id) {
    const completedSlips = await prisma.salarySlipOcrResult.findMany({
        where: {
            tenant_id,
            case_id,
            applicant_id,
            ocr_status: 'COMPLETED'
        }
    });

    if (completedSlips.length === 0) return;

    // Calculate average net monthly salary
    const totalNet = completedSlips.reduce((sum, slip) => sum + (slip.net_salary || 0), 0);
    const avgNetMonthly = totalNet / completedSlips.length;
    const annualizedIncome = avgNetMonthly * 12;

    // Upsert the CaseIncomeEntry for this applicant
    // We use source="SALARY_SLIP_OCR" to identify this entry
    const existingEntry = await prisma.caseIncomeEntry.findFirst({
        where: {
            case_id,
            applicant_id,
            source: 'SALARY_SLIP_OCR'
        }
    });

    if (existingEntry) {
        await prisma.caseIncomeEntry.update({
            where: { id: existingEntry.id },
            data: {
                amount: annualizedIncome,
                raw_data: { average_net_monthly: avgNetMonthly, slip_count: completedSlips.length }
            }
        });
    } else {
        await prisma.caseIncomeEntry.create({
            data: {
                case_id,
                tenant_id,
                applicant_id,
                income_type: 'SALARY',
                source: 'SALARY_SLIP_OCR',
                amount: annualizedIncome,
                year: new Date().getFullYear().toString(),
                raw_data: { average_net_monthly: avgNetMonthly, slip_count: completedSlips.length }
            }
        });
    }
}

module.exports = {
    processSalarySlipOcr,
    recalculateApplicantIncome
};
