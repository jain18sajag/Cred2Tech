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
        const gst_industry_margin = 0.10; // Intentional: bank-approved placeholder for all MSME GST income

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

        // Industry type (informational only — does not affect margin in current design)
        if (gstReq?.raw_gst_data) {
            gst_industry_type = _parseGstIndustryType(gstReq.raw_gst_data);
        }

        // ── 3. ITR EXTRACTION ───────────────────────────────────────────────────
        let itr_pat = null;
        let itr_depreciation = null;
        let itr_finance_cost = null;
        let itr_gross_receipts = null;

        const itrReq = pickBestRecord(caseRecord.itr_analytics);

        if (itrReq?.net_profit_latest_year != null) {
            // PRIMARY: structured snapshot column
            itr_pat           = toNum(itrReq.net_profit_latest_year);
            itr_gross_receipts = toNum(itrReq.gross_receipts_latest_year);
        } else if (itrReq?.analytics_payload) {
            // FALLBACK: parse raw analytics payload
            const parsed = _parseItrFromRaw(itrReq.analytics_payload);
            itr_pat            = parsed.itr_pat;
            itr_depreciation   = parsed.itr_depreciation;
            itr_finance_cost   = parsed.itr_finance_cost;
            itr_gross_receipts = parsed.itr_gross_receipts;
        }

        // ── 4. BANK EXTRACTION ──────────────────────────────────────────────────
        let bank_avg_balance = null;

        const bankReq = pickBestRecord(caseRecord.bank_statements);

        if (bankReq?.avg_bank_balance_latest_year != null) {
            // PRIMARY: structured snapshot column
            bank_avg_balance = toNum(bankReq.avg_bank_balance_latest_year);
        } else if (bankReq?.raw_retrieve_response) {
            // FALLBACK: parse raw vendor payload
            bank_avg_balance = _parseBankFromRaw(bankReq.raw_retrieve_response);
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

        if (hasSalariedData && totalSalariedMonthly > 0) {
            salaried_income = totalSalariedMonthly;
            if (hasOcrData && hasManualData) salaried_income_source = 'MIXED';
            else if (hasOcrData)             salaried_income_source = 'OCR';
            else                             salaried_income_source = 'MANUAL';
        }

        // ── 7. INCOME METHOD DERIVATION ─────────────────────────────────────────
        // All values represent monthly income for uniform FOIR calculation.
        // Formula logic is intentional (bank-approved; not to be changed arbitrarily).

        const net_profit_income = (itr_pat !== null)
            ? (itr_pat + (2 / 3 * (itr_depreciation || 0)) + (itr_finance_cost || 0)) / 12
            : null;

        const gst_income = (gst_avg_monthly_sales !== null && gst_avg_monthly_sales > 0)
            ? gst_avg_monthly_sales * gst_industry_margin
            : null;

        const banking_income = (bank_avg_balance !== null && bank_avg_balance > 0)
            ? bank_avg_balance / 2
            : null;

        // Eligible income methods and their derived values
        const incomeCandidates = {
            SALARIED:   salaried_income,
            GST:        gst_income,
            BANKING:    banking_income,
            NET_PROFIT: net_profit_income
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
        const bank_monthly_income = banking_income;

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
            bank_monthly_income,

            net_profit_income,
            gst_income,
            banking_income,

            salaried_income,
            salaried_income_source,
            salaried_slip_count,

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

function _parseGstIndustryType(raw_gst_data) {
    try {
        const rawGst = typeof raw_gst_data === 'string' ? JSON.parse(raw_gst_data) : raw_gst_data;
        const entityBlock = rawGst?.data?.find(x => x['Entity Details'])?.['Entity Details'];
        const firstEntity = entityBlock ? Object.values(entityBlock)[0] : null;
        const nature = firstEntity?.gstinDetails?.natureOfBusinessActivities;
        return Array.isArray(nature) ? nature.join(', ') : (nature || null);
    } catch {
        return null;
    }
}

function _parseItrFromRaw(analytics_payload) {
    const result = { itr_pat: null, itr_depreciation: null, itr_finance_cost: null, itr_gross_receipts: null };
    try {
        const rawItr = typeof analytics_payload === 'string' ? JSON.parse(analytics_payload) : analytics_payload;
        const actualItr = rawItr?.result || rawItr;
        const itrKey = actualItr?.iTR || actualItr?.ITR;
        const plArray = itrKey?.profitAndLossStatement?.profitAndLossStatement || [];
        const latestPL = latestByYear(plArray);
        if (latestPL) {
            result.itr_pat            = toNum(latestPL.profitAfterTax);
            result.itr_depreciation   = toNum(latestPL.depreciationAndAmortization) ?? toNum(latestPL.depreciationAndAmortisation);
            result.itr_finance_cost   = toNum(latestPL.financeCost);
            result.itr_gross_receipts = toNum(latestPL.receiptsFromProfession)
                ?? toNum(latestPL.revenueFromOperations)
                ?? toNum(latestPL.saleOfServices)
                ?? toNum(latestPL.saleOfGoods);
        }
    } catch (e) {
        console.warn('[ESR Extraction] ITR raw parse failed:', e.message);
    }
    return result;
}

function _parseBankFromRaw(raw_retrieve_response) {
    try {
        const rawBank = typeof raw_retrieve_response === 'string' ? JSON.parse(raw_retrieve_response) : raw_retrieve_response;
        const overview = rawBank?.overview ?? rawBank?.result?.[0]?.overview ?? rawBank?.[0]?.overview;
        const balances = overview?.monthlyAverageDailyBalance;
        if (Array.isArray(balances) && balances.length > 0) {
            const vals = balances.map(x => toNum(x.averageDailyBalance)).filter(v => v !== null && v > 0);
            if (vals.length > 0) return vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        return toNum(overview?.averageDailyBalance) ?? toNum(rawBank?.summary?.avgEodBalance) ?? null;
    } catch (e) {
        console.warn('[ESR Extraction] Bank raw parse failed:', e.message);
        return null;
    }
}

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