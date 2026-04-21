const prisma = require('../../config/db');

/**
 * Normalizes ESR Financials by parsing all raw responses for a given case
 * and pushing the summarized variables into the CaseEsrFinancials table.
 * 
 * Supports idempotency via upsert.
 */
async function extractEsrFinancials(case_id) {
    try {
        const caseRecord = await prisma.case.findUnique({
            where: { id: case_id },
            include: {
                property: true,
                obligations: true,
                gst_requests: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                },
                itr_analytics: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                },
                bank_statements: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                },
                bureau_checks: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                },
                applicants: {
                    where: { type: 'PRIMARY' }
                }
            }
        });

        if (!caseRecord) {
            console.log(`[ESR Extraction] Case ${case_id} not found.`);
            return;
        }

        // 1. Obligations and ICICI Exposure
        let existing_obligations = 0;
        let icici_exposure = 0;

        caseRecord.obligations.forEach(obl => {
            if (obl.include_in_foir) {
                existing_obligations += (obl.emi_per_month || 0);
            }
            if (obl.lender_name && obl.lender_name.toUpperCase().includes('ICICI')) {
                icici_exposure += (obl.outstanding_amount || 0);
            }
        });

        // 2. GST Analytics
        let gst_avg_monthly_sales = null;
        let gst_industry_type = null;
        let gst_industry_margin = 0.10; // Default 10% 
        
        const gstReq = caseRecord.gst_requests[0];
        if (gstReq && gstReq.raw_gst_data) {
            const rawGst = typeof gstReq.raw_gst_data === 'string' ? JSON.parse(gstReq.raw_gst_data) : gstReq.raw_gst_data;
            console.log("\n[EXTRACTION DIAGNOSTIC] RAW GST PAYLOAD:\n", JSON.stringify(rawGst, null, 2));
            
            // Average of monthly sales from "Monthly Sale Summary" array
            if (rawGst["Monthly Sale Summary"] && Array.isArray(rawGst["Monthly Sale Summary"])) {
                const salesArr = rawGst["Monthly Sale Summary"];
                let sumSales = 0;
                let countMonths = 0;
                salesArr.forEach(m => {
                    if (m && m.totalSales !== undefined) {
                        sumSales += Number(m.totalSales) || 0;
                        countMonths++;
                    }
                });
                gst_avg_monthly_sales = countMonths > 0 ? (sumSales / countMonths) : null;
            }

            gst_industry_type = rawGst["Entity Details"]?.natureOfBusinessActivities || null;
            // industry_margin can be defaulted if not explicitly requested
            gst_industry_margin = rawGst.industryMargin || 0.10;
        }

        // 3. ITR Analytics
        let itr_pat = null;
        let itr_depreciation = null;
        let itr_finance_cost = null;
        let itr_gross_receipts = null;

        const itrReq = caseRecord.itr_analytics[0];
        if (itrReq && itrReq.analytics_payload) {
            const rawItr = typeof itrReq.analytics_payload === 'string' ? JSON.parse(itrReq.analytics_payload) : itrReq.analytics_payload;
            console.log("\n[EXTRACTION DIAGNOSTIC] RAW ITR PAYLOAD:\n", JSON.stringify(rawItr, null, 2));
            
            const pL = rawItr?.ITR?.ITR3?.PARTA_PL;
            itr_pat = pL?.ProfitAfterTax !== undefined ? Number(pL.ProfitAfterTax) : null;
            itr_depreciation = pL?.DebitsToPL?.DepreciationAmort !== undefined ? Number(pL.DebitsToPL.DepreciationAmort) : null;
            itr_finance_cost = pL?.DebitsToPL?.InterestExpdrtDtls?.InterestExpdr !== undefined ? Number(pL.DebitsToPL.InterestExpdrtDtls.InterestExpdr) : null;
            
            itr_gross_receipts = rawItr?.ITR?.ITR3?.TradingAccount?.GrossRcptFromProfession !== undefined ? Number(rawItr.ITR.ITR3.TradingAccount.GrossRcptFromProfession) : null;
        }

        // 4. Bank Analytics
        let bank_avg_balance = null;

        const bankReq = caseRecord.bank_statements[0];
        if (bankReq && bankReq.raw_download_response) {
            const rawBank = typeof bankReq.raw_download_response === 'string' ? JSON.parse(bankReq.raw_download_response) : bankReq.raw_download_response;
            console.log("\n[EXTRACTION DIAGNOSTIC] RAW BANK PAYLOAD:\n", JSON.stringify(rawBank, null, 2));
            
            if (rawBank.monthlyAverageDailyBalance && Array.isArray(rawBank.monthlyAverageDailyBalance)) {
                let sumBal = 0;
                let countBal = 0;
                rawBank.monthlyAverageDailyBalance.forEach(m => {
                    if (m && m.averageDailyBalance !== undefined) {
                        sumBal += Number(m.averageDailyBalance) || 0;
                        countBal++;
                    }
                });
                bank_avg_balance = countBal > 0 ? (sumBal / countBal) : null;
            }
        }

        // 7. Bureau Details
        let bureau_score = null;
        let applicant_age = null;

        const bureauReq = caseRecord.bureau_checks[0];
        if (bureauReq && bureauReq.raw_response) {
            const rawBureau = typeof bureauReq.raw_response === 'string' ? JSON.parse(bureauReq.raw_response) : bureauReq.raw_response;
            console.log("\n[EXTRACTION DIAGNOSTIC] RAW BUREAU PAYLOAD:\n", JSON.stringify(rawBureau, null, 2));

            const bData = rawBureau?.verifiedData?.ResponseData?.data;
            bureau_score = bData?.score !== undefined ? Number(bData.score) : null;
            applicant_age = bData?.age !== undefined ? Number(bData.age) : null;
        }

        // Fallback for bureau score if not pulled from raw JSON but saved in app profile natively
        const primaryApplicant = caseRecord.applicants[0];
        if (bureau_score === null && primaryApplicant && primaryApplicant.cibil_score !== null) {
            bureau_score = primaryApplicant.cibil_score;
        }

        // 5. Computed Incomes
        // Avoid NaN if values are null by using fallback logic
        const net_profit_income = (itr_pat !== null && itr_depreciation !== null && itr_finance_cost !== null) 
            ? ((itr_pat + ((2/3) * itr_depreciation) + itr_finance_cost) / 12) 
            : null;
            
        const gst_income = (gst_avg_monthly_sales !== null) 
            ? (gst_avg_monthly_sales * gst_industry_margin)
            : null;
            
        const banking_income = (bank_avg_balance !== null) 
            ? (bank_avg_balance / 2.0)
            : null;

        const incomes = {
            'NET_PROFIT': net_profit_income || 0,
            'GST': gst_income || 0,
            'BANKING': banking_income || 0
        };

        // 6. Selected Method
        let selected_income_method = null;
        let selected_monthly_income = 0;

        for (const [method, value] of Object.entries(incomes)) {
            if (value > selected_monthly_income) {
                selected_monthly_income = value;
                selected_income_method = method;
            }
        }

        // Upsert into case_esr_financials
        const payload = {
            requested_loan_amount: caseRecord.loan_amount || null,
            product_type: caseRecord.product_type || null,
            
            property_type: caseRecord.property?.property_type || null,
            occupancy_type: caseRecord.property?.occupancy_status || null,
            property_value: caseRecord.property?.market_value || null,

            bureau_score,
            applicant_age,
            existing_obligations,
            icici_exposure,
            
            itr_pat,
            itr_depreciation,
            itr_finance_cost,
            itr_gross_receipts,
            
            gst_avg_monthly_sales,
            gst_industry_type,
            gst_industry_margin,
            
            bank_avg_balance,
            bank_monthly_income: banking_income,
            
            net_profit_income,
            gst_income,
            banking_income,
            
            selected_income_method,
            selected_monthly_income,
        };

        await prisma.$executeRaw`
            INSERT INTO case_esr_financials (
                case_id, 
                requested_loan_amount, product_type, property_type, occupancy_type, property_value,
                bureau_score, applicant_age, existing_obligations, icici_exposure,
                itr_pat, itr_depreciation, itr_finance_cost, itr_gross_receipts,
                gst_avg_monthly_sales, gst_industry_type, gst_industry_margin,
                bank_avg_balance, bank_monthly_income,
                net_profit_income, gst_income, banking_income,
                selected_income_method, selected_monthly_income,
                updated_at
            ) VALUES (
                ${case_id}, 
                ${payload.requested_loan_amount}, ${payload.product_type}, ${payload.property_type}, ${payload.occupancy_type}, ${payload.property_value},
                ${payload.bureau_score}, ${payload.applicant_age}, ${payload.existing_obligations}, ${payload.icici_exposure},
                ${payload.itr_pat}, ${payload.itr_depreciation}, ${payload.itr_finance_cost}, ${payload.itr_gross_receipts},
                ${payload.gst_avg_monthly_sales}, ${payload.gst_industry_type}, ${payload.gst_industry_margin},
                ${payload.bank_avg_balance}, ${payload.bank_monthly_income},
                ${payload.net_profit_income}, ${payload.gst_income}, ${payload.banking_income},
                ${payload.selected_income_method}, ${payload.selected_monthly_income},
                NOW()
            )
            ON CONFLICT (case_id) DO UPDATE SET
                requested_loan_amount = EXCLUDED.requested_loan_amount,
                product_type = EXCLUDED.product_type,
                property_type = EXCLUDED.property_type,
                occupancy_type = EXCLUDED.occupancy_type,
                property_value = EXCLUDED.property_value,
                bureau_score = EXCLUDED.bureau_score,
                applicant_age = EXCLUDED.applicant_age,
                existing_obligations = EXCLUDED.existing_obligations,
                icici_exposure = EXCLUDED.icici_exposure,
                itr_pat = EXCLUDED.itr_pat,
                itr_depreciation = EXCLUDED.itr_depreciation,
                itr_finance_cost = EXCLUDED.itr_finance_cost,
                itr_gross_receipts = EXCLUDED.itr_gross_receipts,
                gst_avg_monthly_sales = EXCLUDED.gst_avg_monthly_sales,
                gst_industry_type = EXCLUDED.gst_industry_type,
                gst_industry_margin = EXCLUDED.gst_industry_margin,
                bank_avg_balance = EXCLUDED.bank_avg_balance,
                bank_monthly_income = EXCLUDED.bank_monthly_income,
                net_profit_income = EXCLUDED.net_profit_income,
                gst_income = EXCLUDED.gst_income,
                banking_income = EXCLUDED.banking_income,
                selected_income_method = EXCLUDED.selected_income_method,
                selected_monthly_income = EXCLUDED.selected_monthly_income,
                updated_at = NOW();
        `;

        console.log(`[ESR Extraction] Successfully extracted financials for Case ${case_id}`);

    } catch (error) {
        console.error(`[ESR Extraction Failed] Case ${case_id}:`, error);
        // We do not throw to prevent breaking the main sync flows
    }
}

module.exports = { extractEsrFinancials };
