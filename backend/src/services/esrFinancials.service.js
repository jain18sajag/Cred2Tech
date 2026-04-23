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
            const gstData = rawGst?.data || rawGst;
            console.log("\n[EXTRACTION DIAGNOSTIC] RAW GST PAYLOAD:\n", JSON.stringify(gstData).substring(0, 500) + '...');

            const monthlyB = gstData.find && gstData.find(b => b['Overview_Monthly'] || b['Monthly Sales&Purchase'] || b['Monthly Sale Summary']);
            if (monthlyB) {
                const salesRoot = monthlyB['Overview_Monthly'] || monthlyB['Monthly Sales&Purchase'] || monthlyB['Monthly Sale Summary'];
                if (Array.isArray(salesRoot)) {
                    // Extract the "Monthly Sales Summary" (if it is grouped with Purchases) or fallback
                    let dataArray = salesRoot;
                    const nestedSalesBlock = salesRoot.find(x => x['Monthly Sales Summary']);
                    if (nestedSalesBlock) {
                        dataArray = nestedSalesBlock['Monthly Sales Summary'].find(x => x.data)?.data || [];
                    } else {
                        // Sometimes it's directly inside the root if it's Overview_Monthly
                        const dBlock = salesRoot.find(x => x.data);
                        if (dBlock) dataArray = dBlock.data;
                    }

                    if (Array.isArray(dataArray)) {
                        let sumSales = 0;
                        let countMonths = 0;
                        dataArray.forEach(m => {
                            const totalSales = m.totalSales || m.TotalSales || m['Total Sales'] || m.grossSales || m['Gross Sales'] || m['Taxable Value'] || m['TaxableValue'];
                            // Allow processing of 0 mathematically, but ignore undefined
                            if (totalSales !== undefined && totalSales !== null) {
                                sumSales += Number(totalSales) || 0;
                                countMonths++;
                            }
                        });
                        gst_avg_monthly_sales = countMonths > 0 ? (sumSales / countMonths) : null;
                    }
                }
            }

            const entityBlock = gstData.find && gstData.find(b => b['Entity Details']);
            if (entityBlock && Array.isArray(entityBlock['Entity Details'])) {
                gst_industry_type = entityBlock['Entity Details'][0]?.natureOfBusinessActivities || null;
                gst_industry_margin = entityBlock['Entity Details'][0]?.industryMargin || 0.10;
            } else if (entityBlock) {
                 gst_industry_type = entityBlock['Entity Details']?.natureOfBusinessActivities || null;
                 gst_industry_margin = entityBlock['Entity Details']?.industryMargin || 0.10;
            }
        }

        // 3. ITR Analytics
        let itr_pat = null;
        let itr_depreciation = null;
        let itr_finance_cost = null;
        let itr_gross_receipts = null;

        const itrReq = caseRecord.itr_analytics[0];
        if (itrReq && itrReq.analytics_payload) {
            const rawItr = typeof itrReq.analytics_payload === 'string' ? JSON.parse(itrReq.analytics_payload) : itrReq.analytics_payload;
            const actualItr = rawItr?.result || rawItr;
            const itrKey = actualItr?.iTR || actualItr?.ITR;

            if (itrKey?.profitAndLossStatement && Array.isArray(itrKey.profitAndLossStatement)) {
                // Usually we want the latest year.
                const plList = [...itrKey.profitAndLossStatement];
                const latestYear = plList.sort((a,b) => b.year - a.year)[0];
                if (latestYear) {
                    itr_pat = latestYear.profitAfterTax !== undefined && latestYear.profitAfterTax !== "" ? Number(latestYear.profitAfterTax) : null;
                    itr_depreciation = latestYear.depreciationAndAmortisation !== undefined && latestYear.depreciationAndAmortisation !== "" ? Number(latestYear.depreciationAndAmortisation) : null;
                    itr_finance_cost = latestYear.financeCost !== undefined && latestYear.financeCost !== "" ? Number(latestYear.financeCost) : null;
                    itr_gross_receipts = latestYear.receiptsFromProfession !== undefined && latestYear.receiptsFromProfession !== "" ? Number(latestYear.receiptsFromProfession) : null;
                }
            } else {
                // Fallback for legacy JSON structures
                const pL = itrKey?.ITR3?.PARTA_PL;
                itr_pat = pL?.ProfitAfterTax !== undefined ? Number(pL.ProfitAfterTax) : null;
                itr_depreciation = pL?.DebitsToPL?.DepreciationAmort !== undefined ? Number(pL.DebitsToPL.DepreciationAmort) : null;
                itr_finance_cost = pL?.DebitsToPL?.InterestExpdrtDtls?.InterestExpdr !== undefined ? Number(pL.DebitsToPL.InterestExpdrtDtls.InterestExpdr) : null;
                itr_gross_receipts = itrKey?.ITR3?.TradingAccount?.GrossRcptFromProfession !== undefined ? Number(itrKey.ITR3.TradingAccount.GrossRcptFromProfession) : null;
            }
        }

        // 4. Bank Analytics
        let bank_avg_balance = null;

        const bankReq = caseRecord.bank_statements[0];
        if (bankReq) {
            let rawBank = bankReq.raw_download_response;
            if (bankReq.bank_json_document_id) {
                // Read physical file from disk instead of relying on vendor URL proxy.
                try {
                    const docInf = await prisma.document.findUnique({ where: { id: bankReq.bank_json_document_id } });
                    if (docInf && docInf.storage_path) {
                        const { getStorageProvider } = require('./storage/index');
                        const storage = getStorageProvider();
                        const stream = await storage.getStream(docInf.storage_path);
                        const streamToString = (s) => new Promise((resolve, reject) => {
                            const chunks = [];
                            s.on('data', chunk => chunks.push(Buffer.from(chunk)));
                            s.on('error', err => reject(err));
                            s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                        });
                        rawBank = JSON.parse(await streamToString(stream));
                    }
                } catch(e) {
                    console.error("[ESR Bank Extraction] Failed to read doc ID", bankReq.bank_json_document_id, e);
                }
            } else if (rawBank) {
                rawBank = typeof rawBank === 'string' ? JSON.parse(rawBank) : rawBank;
            }

            if (rawBank) {
                let list = rawBank;
                if (list.result && Array.isArray(list.result)) list = list.result;

                let bankElement = Array.isArray(list) ? list[0] : list;
                console.log("\n[EXTRACTION DIAGNOSTIC] BANK IDENTIFIED KEYS:\n", Object.keys(bankElement || {}));

                // Native V3 fields: averageDailyBalance
                if (bankElement && bankElement.overview && bankElement.overview.averageDailyBalance !== undefined) {
                    bank_avg_balance = Number(bankElement.overview.averageDailyBalance);
                } 
                else {
                    // Fallback to manually summing array
                    const mArray = bankElement?.overview?.monthlyAverageDailyBalance || bankElement?.monthlyAverageDailyBalance;
                    if (mArray && Array.isArray(mArray)) {
                        let sumBal = 0;
                        let countBal = 0;
                        mArray.forEach(m => {
                            // Extract averageDailyBalance which can be nested directly or inside objects
                            const avgBal = typeof m === 'object' ? m.averageDailyBalance : m;
                            if (avgBal !== undefined && avgBal !== null) {
                                sumBal += Number(avgBal) || 0;
                                countBal++;
                            }
                        });
                        bank_avg_balance = countBal > 0 ? (sumBal / countBal) : null;
                    }
                }
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
            ? ((itr_pat + ((2 / 3) * itr_depreciation) + itr_finance_cost) / 12)
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
        console.log('payload', payload);

    } catch (error) {
        console.error(`[ESR Extraction Failed] Case ${case_id}:`, error);
        // We do not throw to prevent breaking the main sync flows
    }
}

module.exports = { extractEsrFinancials };
