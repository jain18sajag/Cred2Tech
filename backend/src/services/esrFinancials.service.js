/**
 * esrFinancials.service.js
 *
 * PURPOSE:
 *   Aggregate all financial signals for a case and persist them into the
 *   `case_esr_financials` table (CaseEsrFinancials).
 *
 * DESIGN PRINCIPLES:
 *   - Deterministic: identical input → identical output
 *   - Additive: never corrupts existing production data
 *   - Auditable: extraction_status + extracted_at give full lifecycle visibility
 *   - Safe for MSME and Salaried flows
 *   - Backward compatible with all existing MSME cases
 *
 * INCOME DERIVATION STRATEGY (intentional business logic):
 *   - SALARIED : avg(net_salary) from OCR slips + manual CaseIncomeEntry (type=Salary)
 *   - GST      : (avg_monthly_turnover * gst_industry_margin)  [margin: 10% placeholder]
 *   - BANKING  : bank_avg_balance / 2
 *   - NET_PROFIT: (PAT + 2/3*Depr + FinCost) / 12
 *   - SELECTED : highest non-zero monthly income among all derivations
 */

'use strict';

const prisma = require('../../config/db');
const { _parseBankFromRaw, extractBankFySnapshot } = require('./bankParser.service');

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const COMPLETED_STATUSES = new Set(['COMPLETED', 'COMPLETE', 'SUCCESS']);

/** Safe numeric coercion — returns null for NaN/undefined/empty, never 0 from nothing */
const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/,/g, '').replace(/₹/g, '').trim());
    return Number.isFinite(n) ? n : null;
};

/** Average of an array, ignoring nulls; returns null if empty */
const avg = (arr) => {
    const nums = arr.map(toNum).filter(v => v !== null && v > 0);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

/** Pick the most-recent COMPLETED record; fall back to first record */
const pickBestRecord = (records = []) => {
    if (!Array.isArray(records) || records.length === 0) return null;
    const completed = records.find(r => COMPLETED_STATUSES.has(String(r?.status || '').toUpperCase()));
    return completed || records[0];
};

/** Sort array descending by a numeric year field */
const latestByYear = (arr) => {
    if (!Array.isArray(arr)) return null;
    return [...arr]
        .filter(x => x && x.year !== undefined)
        .sort((a, b) => Number(b.year) - Number(a.year))[0] || null;
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXTRACTION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * extractEsrFinancials
 *
 * Compiles financial signals from all vendor tables + salaried income entries,
 * derives income using lender-approved formulas, and upserts into case_esr_financials.
 *
 * This function is idempotent — safe to call multiple times.
 *
 * @param {number} case_id
 * @param {number|null} tenant_id  Optional; if provided, enforces tenant ownership.
 * @returns {Promise<void>}
 */
async function extractEsrFinancials(case_id, tenant_id = null) {
    try {
        // ── 0. Fetch Case with all vendor data ──────────────────────────────────
        const caseWhere = (tenant_id !== null && tenant_id !== undefined)
            ? { id: case_id, tenant_id }
            : { id: case_id };

        const caseRecord = await prisma.case.findFirst({
            where: caseWhere,
            include: {
                property: true,
                // All ACTIVE obligations — include_in_foir filtering done in code below
                obligations: { where: { status: 'ACTIVE' } },
                // Vendor pull tables — ordered newest first
                gst_requests:    { orderBy: { created_at: 'desc' }, take: 10 },
                itr_analytics:   { orderBy: { created_at: 'desc' }, take: 10 },
                bank_statements: { orderBy: { created_at: 'desc' }, take: 10 },
                bureau_checks:   { orderBy: { created_at: 'desc' }, take: 10 },
                // Applicants with their salary data
                applicants: {
                    include: {
                        // Completed OCR results — primary source for salaried income
                        salary_ocr_results: {
                            where:    { ocr_status: 'COMPLETED' },
                            orderBy:  { created_at: 'desc' }
                        },
                        // Manual income entries — fallback source for salaried income
                        // Income types that indicate salary: 'Director Salary', 'Partner\'s Salary',
                        // 'Salary', 'Gross Salary', 'Net Salary', 'Form 16'
                        income_entries: true
                    }
                }
            }
        });

        if (!caseRecord) {
            console.warn(`[ESR Extraction] Case ${case_id} not found or tenant mismatch — aborting without touching snapshot.`);
            // Do NOT mark FAILED here — we never owned this snapshot.
            // The snapshot may belong to a legitimate prior extraction for a different tenant.
            return;
        }

        // Mark PENDING now that we have confirmed ownership of this case.
        // This signals to the ESR orchestrator that a fresh extraction is in progress.
        await prisma.caseEsrFinancials.upsert({
            where:  { case_id },
            update: { extraction_status: 'PENDING' },
            create: { case_id, extraction_status: 'PENDING' }
        });

        // ── 1. OBLIGATIONS ──────────────────────────────────────────────────────
        // Only obligations with include_in_foir=true count toward FOIR burden.
        // Filtering is done here in code (not in the Prisma where clause) to keep
        // the query simple and avoid schema-level filtering bugs.
        let existing_obligations = 0;
        let icici_exposure = 0;

        for (const obl of caseRecord.obligations) {
            const emi = toNum(obl.emi_per_month);
            // include_in_foir defaults to true; only sum it if the flag is not explicitly false
            if (emi !== null && emi > 0 && obl.include_in_foir !== false) {
                existing_obligations += emi;
            }
            if (obl.lender_name?.toUpperCase().includes('ICICI')) {
                icici_exposure += (toNum(obl.outstanding_amount) || 0);
            }
        }

        // ── 2. GST EXTRACTION ───────────────────────────────────────────────────
        let gst_avg_monthly_sales = null;
        let gst_industry_type = null;
        let gst_industry_margin = 0.10; // fallback default only

        const gstReq = pickBestRecord(caseRecord.gst_requests);

        if (gstReq?.turnover_latest_year != null) {
            // PRIMARY: use structured snapshot column (set at ingestion by extractGstDetails)
            const annualTurnover = toNum(gstReq.turnover_latest_year);
            if (annualTurnover !== null && annualTurnover > 0) {
                gst_avg_monthly_sales = annualTurnover / 12;
            }
        } else if (gstReq?.raw_gst_data) {
            // FALLBACK: parse raw vendor payload for legacy records
            gst_avg_monthly_sales = _parseGstFromRaw(gstReq.raw_gst_data);
        }

        // Industry type
        if (gstReq?.raw_gst_data) {
            gst_industry_type = _parseGstIndustryType(gstReq.raw_gst_data);
            gst_industry_margin = resolveGstIndustryMargin(gst_industry_type);
        }

        // ── 3. ITR EXTRACTION ───────────────────────────────────────────────────
        let itr_pat = null;
        let itr_depreciation = null;
        let itr_finance_cost = null;
        let itr_gross_receipts = null;

        const itrReq = pickBestRecord(caseRecord.itr_analytics);

        if (itrReq?.analytics_payload) {
            // FALLBACK: parse raw analytics payload
            const parsed = _parseItrFromRaw(itrReq.analytics_payload);
            itr_pat            = parsed.itr_pat;
            itr_depreciation   = parsed.itr_depreciation;
            itr_finance_cost   = parsed.itr_finance_cost;
            itr_gross_receipts = parsed.itr_gross_receipts;
        } else if (itrReq?.net_profit_latest_year != null) {
            // PRIMARY: structured snapshot column
            itr_pat           = toNum(itrReq.net_profit_latest_year);
            itr_gross_receipts = toNum(itrReq.gross_receipts_latest_year);
        }

        // ── 4. BANK EXTRACTION ──────────────────────────────────────────────────
        let bank_avg_balance = null;
        let bank_avg_monthly_credit = null;
        let bank_total_credits = null;

        const bankReq = pickBestRecord(caseRecord.bank_statements);

        // Priority: raw_retrieve_response > raw_download_response
        const rawBankPayload =
            bankReq?.raw_retrieve_response ||
            bankReq?.raw_download_response;

        if (bankReq?.avg_bank_balance_latest_year != null) {
            // PRIMARY: structured snapshot column
            bank_avg_balance = Number(bankReq.avg_bank_balance_latest_year);
            bank_avg_monthly_credit = bankReq.bank_avg_monthly_credit ? Number(bankReq.bank_avg_monthly_credit) : null;
            bank_total_credits = bankReq.bank_total_credits ? Number(bankReq.bank_total_credits) : null;
        } else if (rawBankPayload) {
            // FALLBACK: parse raw vendor payload and update request record snapshot fields
            const fySnapshot = extractBankFySnapshot(rawBankPayload);
            bank_avg_balance = fySnapshot.latest;
            bank_avg_monthly_credit = fySnapshot.avg_monthly_credit;
            bank_total_credits = fySnapshot.total_credits;

            // Optional: Persist derived fields back to bankReq if they were missing
            if (bank_avg_balance && bankReq.id) {
                prisma.bankStatementAnalysisRequest.update({
                    where: { id: bankReq.id },
                    data: {
                        avg_bank_balance_latest_year: bank_avg_balance,
                        financial_year_latest: fySnapshot.fy_latest,
                        avg_bank_balance_previous_year: fySnapshot.previous,
                        financial_year_previous: fySnapshot.fy_previous,
                        raw_retrieve_response: bankReq.raw_retrieve_response || (typeof rawBankPayload === 'object' ? rawBankPayload : undefined)
                    }
                }).catch(e => console.error('[ESR Bank Update] Failed:', e.message));
            }
        }

        // ── 5. BUREAU (for bureau_score + applicant_age fallback) ───────────────
        let bureau_score = null;
        let applicant_age = null;

        const bureauReq = pickBestRecord(caseRecord.bureau_checks);

        if (bureauReq?.raw_response) {
            const parsed = _parseBureauFromRaw(bureauReq.raw_response);
            bureau_score   = parsed.score;
            applicant_age  = parsed.age;
        }

        // Applicant-level fallback for bureau score
        const primaryApplicant = caseRecord.applicants.find(a => a.is_primary) || caseRecord.applicants[0];
        if (!bureau_score && primaryApplicant?.cibil_score) {
            bureau_score = primaryApplicant.cibil_score;
        }

        // ── 6. SALARIED INCOME ──────────────────────────────────────────────────
        //
        // STRATEGY: Aggregate net monthly salary across ALL applicants who have
        // salary data — whether they have OCR-completed slips or manual income entries
        // with salary-type income.
        //
        // Income types considered "salary" (matching what the UI allows users to enter):
        //   'Salary', 'Director Salary', 'Partner\'s Salary', 'Gross Salary', 'Net Salary'
        //
        // OCR slips take precedence over manual entries for the SAME applicant.
        // If both exist, only OCR slips are used to avoid double-counting.
        //
        // CaseIncomeEntry has ONLY annual_amount — monthly is derived as annual / 12.

        const SALARY_INCOME_TYPES = new Set([
            'salary', 'director salary', "partner's salary", 'gross salary',
            'net salary', 'form 16', 'basic salary'
        ]);

        let salaried_income = null;
        let salaried_income_source = null;
        let salaried_slip_count = 0;

        let totalSalariedMonthly = 0;
        let hasSalariedData = false;
        let hasOcrData = false;
        let hasManualData = false;

        for (const applicant of caseRecord.applicants) {
            const completedSlips = applicant.salary_ocr_results || [];

            // --- Path A: OCR salary slips (preferred) ---
            if (completedSlips.length > 0) {
                const slipNets = completedSlips
                    .map(s => toNum(s.net_salary))
                    .filter(v => v !== null && v > 0);

                if (slipNets.length > 0) {
                    // Average across this applicant's slips, then add to the running total
                    const avgNetForApplicant = slipNets.reduce((a, b) => a + b, 0) / slipNets.length;
                    totalSalariedMonthly += avgNetForApplicant;
                    salaried_slip_count += completedSlips.length;
                    hasSalariedData = true;
                    hasOcrData = true;
                    console.log(`[ESR Extraction] Applicant ${applicant.id} OCR salary: ₹${Math.round(avgNetForApplicant).toLocaleString('en-IN')}/mo (${completedSlips.length} slips)`);
                    continue; // OCR found — skip manual entries for this applicant
                }
            }

            // --- Path B: Manual income entries (fallback if no OCR slips) ---
            // Filter by income types that represent salaried income
            const salaryEntries = (applicant.income_entries || []).filter(e =>
                SALARY_INCOME_TYPES.has((e.income_type || '').toLowerCase())
            );

            if (salaryEntries.length > 0) {
                // Sum all salary-type entries for this applicant (annual → monthly)
                let applicantMonthly = 0;
                for (const entry of salaryEntries) {
                    const annual = toNum(entry.annual_amount);
                    if (annual !== null && annual > 0) {
                        applicantMonthly += annual / 12;
                    }
                }
                if (applicantMonthly > 0) {
                    totalSalariedMonthly += applicantMonthly;
                    hasSalariedData = true;
                    hasManualData = true;
                    console.log(`[ESR Extraction] Applicant ${applicant.id} manual salary: ₹${Math.round(applicantMonthly).toLocaleString('en-IN')}/mo (${salaryEntries.length} entries)`);
                }
            }
        }

        // --- Incentive income: separate OCR field or manual entries ---
        const INCENTIVE_TYPES = new Set(['incentive', 'bonus', 'variable pay', 'performance bonus']);
        const OTHER_ELIGIBLE_TYPES = new Set(['other eligible income', 'other income']);

        let totalIncentiveMonthly = 0;
        let totalOtherEligibleMonthly = 0;

        for (const applicant of caseRecord.applicants) {
            // Read incentive from OCR slip if available
            const completedSlips = applicant.salary_ocr_results || [];
            for (const slip of completedSlips) {
                const incentiveVal = toNum(slip.incentive_amount) || toNum(slip.bonus_amount) || 0;
                totalIncentiveMonthly += incentiveVal; // assumed monthly on slip
            }

            // Read from manual income entries
            for (const entry of (applicant.income_entries || [])) {
                const type = (entry.income_type || '').toLowerCase();
                const monthly = (toNum(entry.annual_amount) || 0) / 12;
                if (INCENTIVE_TYPES.has(type)) totalIncentiveMonthly += monthly;
                if (OTHER_ELIGIBLE_TYPES.has(type)) totalOtherEligibleMonthly += monthly;
            }
        }

        if (hasSalariedData && totalSalariedMonthly > 0) {
            salaried_income = totalSalariedMonthly;
            if (hasOcrData && hasManualData) salaried_income_source = 'MIXED';
            else if (hasOcrData)             salaried_income_source = 'OCR';
            else                             salaried_income_source = 'MANUAL';
        }

        // ── 7. INCOME METHOD DERIVATION ─────────────────────────────────────────
        // Calculate normalized monthly income for each valid method.
        // These normalized values are persisted so method-specific schemes don't have to guess.

        let normalized_salaried = salaried_income || 0;
        
        let normalized_gst = 0;
        if (gst_avg_monthly_sales !== null) {
            normalized_gst = gst_avg_monthly_sales * (gst_industry_margin || 0.10);
            console.log(`[ESR Extraction] GST Income - Type: ${gst_industry_type || 'UNKNOWN'}, Margin: ${gst_industry_margin}, AvgSales: ${gst_avg_monthly_sales}, MonthlyIncome: ${normalized_gst}`);
        }

        let normalized_net_profit = 0;
        if (itr_pat !== null) {
            const deprAddback = (itr_depreciation || 0) * 0.6667;
            const npmAnnual = itr_pat + deprAddback + (itr_finance_cost || 0);
            normalized_net_profit = Math.max(0, npmAnnual / 12);
        }

        let normalized_banking = 0;
        if (bank_avg_balance !== null || bank_avg_monthly_credit !== null) {
            const abbIncome = (bank_avg_balance || 0) * 2;
            const creditIncome = bank_avg_monthly_credit || 0;
            normalized_banking = Math.max(abbIncome, creditIncome);
        }

        let normalized_grp = 0;
        if (itr_gross_receipts !== null) {
            normalized_grp = (itr_gross_receipts * 0.08) / 12; // Default 8% margin
        }

        const incomeCandidates = {
            SALARIED:   normalized_salaried,
            GST:        normalized_gst, 
            BANKING:    normalized_banking,
            NET_PROFIT: normalized_net_profit,
            GRP:        normalized_grp
        };

        let selected_income_method = null;
        let selected_monthly_income = 0;

        for (const [method, value] of Object.entries(incomeCandidates)) {
            if (value !== null && value > selected_monthly_income) {
                selected_income_method = method;
                selected_monthly_income = value;
            }
        }

        // Guard: if nothing resolved, selected_monthly_income stays 0.
        // The ESR engine will detect this and throw a clear validation error
        // rather than silently generating a wrong ESR.
        if (selected_monthly_income <= 0) {
            selected_income_method = null;
            selected_monthly_income = 0;
        }

        // ── 8. DERIVED BANK MONTHLY (for snapshot completeness) ─────────────────
        const bank_monthly_income = normalized_banking;

        // ── 9. UPSERT ────────────────────────────────────────────────────────────
        const now = new Date();

        const payload = {
            requested_loan_amount: toNum(caseRecord.loan_amount),
            product_type:          caseRecord.product_type,

            property_type:   caseRecord.property?.property_type   || null,
            occupancy_type:  caseRecord.property?.occupancy_status || null,
            property_value:  toNum(caseRecord.property?.market_value) || null,

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
            bank_total_credits,
            bank_avg_monthly_credit,
            
            bank_monthly_income: normalized_banking || null,

            net_profit_income: normalized_net_profit || null,
            gst_income: normalized_gst || null,
            banking_income: normalized_banking || null,

            salaried_income: normalized_salaried || null,
            salaried_income_source,
            salaried_slip_count,
            salaried_incentive_income: totalIncentiveMonthly > 0 ? totalIncentiveMonthly : null,
            salaried_other_income: totalOtherEligibleMonthly > 0 ? totalOtherEligibleMonthly : null,

            selected_income_method,
            selected_monthly_income,

            // Lifecycle
            extraction_status: 'COMPLETED',
            extracted_at:      now
        };

        await prisma.caseEsrFinancials.upsert({
            where:  { case_id },
            update: payload,
            create: { case_id, ...payload }
        });

        console.log(`[ESR Extraction] ✅ Completed for Case ${case_id} | Method: ${selected_income_method} | Monthly: ₹${Math.round(selected_monthly_income).toLocaleString('en-IN')}`);

    } catch (err) {
        console.error(`[ESR Extraction] ❌ Failed for Case ${case_id}:`, err.message || err);
        // Mark snapshot as FAILED so the ESR engine's freshness guard blocks stale usage
        try {
            await prisma.caseEsrFinancials.updateMany({
                where: { case_id },
                data:  { extraction_status: 'FAILED' }
            });
        } catch (markErr) {
            console.error(`[ESR Extraction] Could not mark FAILED for case ${case_id}:`, markErr.message);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW PAYLOAD PARSERS (only used as legacy fallback when structured columns are null)
// These are intentionally isolated to prevent raw parsing spreading across services.
// ─────────────────────────────────────────────────────────────────────────────

function _parseGstFromRaw(raw_gst_data) {
    try {
        const rawGst = typeof raw_gst_data === 'string' ? JSON.parse(raw_gst_data) : raw_gst_data;

        // Format 1: Overview_Monthly
        const overview = rawGst?.Overview_Monthly?.['Overview of GST Returns'];
        if (Array.isArray(overview)) {
            const monthlyRows = overview.filter(r => r['Month Year'] !== 'Total');
            const totalSales = monthlyRows.reduce((sum, row) => sum + (Number(row['Total Value of Sales (A)']) || 0), 0);
            if (monthlyRows.length > 0 && totalSales > 0) {
                return totalSales / monthlyRows.length;
            }
        }

        // Format 2: Legacy Monthly Sales&Purchase
        const gstData = Array.isArray(rawGst?.data) ? rawGst.data : [];
        const monthlyBlock = gstData.find(x => x['Monthly Sales&Purchase']);
        const monthlySummary = monthlyBlock?.['Monthly Sales&Purchase']?.find(x => x['Monthly Sale Summary']);
        const monthlyRows = monthlySummary?.['Monthly Sale Summary']?.find(x => Array.isArray(x.data))?.data || [];
        const filtered = monthlyRows.filter(x => !String(x.Month || '').toLowerCase().includes('total'));
        if (filtered.length > 0) {
            const total = filtered.reduce((s, r) => s + (Number(r['Taxable Value']) || 0), 0);
            return total > 0 ? total / filtered.length : null;
        }
    } catch (e) {
        console.warn('[ESR Extraction] GST raw parse failed:', e.message);
    }
    return null;
}

function resolveGstIndustryMargin(industryType) {
    const text = String(industryType || '').toLowerCase();

    if (text.includes('manufactur') || text.includes('factory')) return 0.07;
    if (text.includes('retail')) return 0.05;
    if (text.includes('wholesale')) return 0.04;
    if (text.includes('special')) return 0.03;
    if (text.includes('service') || text.includes('supplier of service')) return 0.15;

    return 0.10; // fallback only when industry cannot be identified
}

function _parseGstIndustryType(raw_gst_data) {
    try {
        const rawGst = typeof raw_gst_data === 'string' ? JSON.parse(raw_gst_data) : raw_gst_data;
        
        let nature = null;
        let constitution = null;
        
        // 1. Try Entity Details block (often used in legacy JSON)
        const entityBlock = rawGst?.data?.find(x => x['Entity Details'])?.['Entity Details'];
        if (entityBlock) {
            const firstEntity = Object.values(entityBlock)[0];
            nature = firstEntity?.gstinDetails?.natureOfBusinessActivities;
            constitution = firstEntity?.gstinDetails?.constitutionOfBusiness;
        }

        // 2. Direct keys from modern/flattened JSON
        if (!nature) {
            nature = rawGst?.natureOfBusinessActivities || rawGst?.natureOfBusiness || rawGst?.industryType;
        }
        if (!constitution) {
            constitution = rawGst?.constitutionOfBusiness;
        }

        const natureStr = Array.isArray(nature) ? nature.join(', ') : (nature || '');
        const constitutionStr = constitution || '';
        
        const combined = [natureStr, constitutionStr].filter(Boolean).join(' | ');
        return combined || null;
    } catch {
        return null;
    }
}

function _parseItrFromRaw(analytics_payload) {
    const result = { itr_pat: null, itr_depreciation: null, itr_finance_cost: null, itr_gross_receipts: null, itr_remuneration: null };
    try {
        const rawItr = typeof analytics_payload === 'string' ? JSON.parse(analytics_payload) : analytics_payload;
        
        let latestItr = null;
        
        // 1. Year-indexed structure (e.g., {"2024-2025": [{ "json": { "ITR": ... } }]})
        const yearIndexedRoot = rawItr?.data || rawItr;
        if (yearIndexedRoot && typeof yearIndexedRoot === 'object' && !yearIndexedRoot.result && !yearIndexedRoot.iTR && !yearIndexedRoot.ITR) {
            const years = Object.keys(yearIndexedRoot).filter(k => k.match(/^\d{4}-\d{4}$/)).sort().reverse();
            if (years.length > 0) {
                const yearData = yearIndexedRoot[years[0]];
                if (Array.isArray(yearData) && yearData.length > 0) {
                    latestItr = yearData[0].json?.ITR || yearData[0].json?.iTR || yearData[0].json;
                }
            }
        } 
        
        // 2. Legacy flat structure
        if (!latestItr) {
             latestItr = rawItr?.result || rawItr;
        }

        if (latestItr) {
            const itr3 = latestItr.ITR3 || latestItr.iTR3 || latestItr.ITR?.ITR3 || latestItr.ITR?.iTR3;
            if (itr3) {
                const pl = itr3.PARTA_PL || itr3.PartA_PL;
                if (pl) {
                    result.itr_pat = toNum(pl.TaxProvAppr?.ProfitAfterTax) 
                                  ?? toNum(pl.TaxProvAppr?.ProprietorAccBalTrf) 
                                  ?? toNum(pl.PBT);
                    result.itr_depreciation = toNum(pl.DebitsToPL?.DepreciationAmort) ?? toNum(pl.DebitsToPL?.Depreciation);
                    result.itr_finance_cost = toNum(pl.DebitsToPL?.InterestExpdrtDtls?.InterestExpdr) ?? toNum(pl.DebitsToPL?.Interest);
                    result.itr_remuneration = toNum(pl.DebitsToPL?.RemunerationToPartners) ?? toNum(pl.DebitsToPL?.Remuneration);
                }
                const trading = itr3.TradingAccount || itr3.PartA_Trading;
                if (trading) {
                    result.itr_gross_receipts = toNum(trading.TotRevenueFrmOperations) 
                                             ?? toNum(trading.SalesGrossReceiptsTotal)
                                             ?? toNum(trading.TardingAccTotCred)
                                             ?? toNum(trading.GrossRcptFromProfession);
                }
            } else {
                // ITR4 / generic fallback
                const bp = latestItr.ITR4?.ScheduleBP || latestItr.iTR4?.ScheduleBP || latestItr.ITR?.ITR4?.ScheduleBP || latestItr.ITR?.iTR4?.ScheduleBP;
                if (bp) {
                    result.itr_pat = toNum(bp.NetProfit) ?? toNum(bp.NetProfitAfterTax);
                    result.itr_gross_receipts = toNum(bp.GrossReceipts) ?? toNum(bp.GrossTurnover);
                }
            }
        }

        // Global fallback if everything above fails
        if (result.itr_pat === null) {
            const generalInfo = latestItr?.ITR1 || latestItr?.ITR2 || latestItr;
            result.itr_pat = toNum(generalInfo?.profitAfterTax) ?? toNum(generalInfo?.PBT) ?? null;
        }
        if (result.itr_gross_receipts === null) {
            const generalInfo = latestItr?.ITR1 || latestItr?.ITR2 || latestItr;
            result.itr_gross_receipts = toNum(generalInfo?.receiptsFromProfession)
                                     ?? toNum(generalInfo?.revenueFromOperations)
                                     ?? toNum(generalInfo?.saleOfServices)
                                     ?? toNum(generalInfo?.saleOfGoods);
        }

    } catch (err) {
        console.error(`[ESR] Error parsing raw ITR:`, err.message);
    }
    return result;
}

// Handled by bankParser.service.js

function _parseBureauFromRaw(raw_response) {
    const result = { score: null, age: null };
    try {
        const rawBureau = typeof raw_response === 'string' ? JSON.parse(raw_response) : raw_response;
        const data = rawBureau?.verifiedData?.ResponseData?.data;
        result.score = toNum(data?.score) ?? toNum(data?.cibilScore) ?? toNum(data?.creditScore);
        result.age   = toNum(data?.age);
    } catch (e) {
        console.warn('[ESR Extraction] Bureau raw parse failed:', e.message);
    }
    return result;
}

module.exports = { extractEsrFinancials };