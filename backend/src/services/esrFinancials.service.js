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
 *   - BANKING  : ABB ÷ divisor (ICICI policy uses ABB/2 or ABB/3, not ABB×2)
 *   - NET_PROFIT: (PAT + 2/3*Depr + FinCost) / 12
 *   - SELECTED : highest non-zero monthly income among all derivations
 */

'use strict';

const prisma = require('../../config/db');
const { extractBankFySnapshot, extractBankSalary } = require('./bankParser.service');
const { extractGstDetails, extractItrDetails } = require('./financial.extractor');

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
 * @param {object} caseRecord
 * @param {boolean} preferRaw
 * @param {object|null} logger
 * @returns {Promise<void>}
 */
async function extractEsrFinancials(case_id, tenant_id, options = {}) {
    const { preferRaw = false, dryRun = false, logger: providedLogger } = options;

    // Ensure logger exists to avoid null checks everywhere
    const logger = providedLogger || {
        traceExtraction: () => { },
        traceVerbose: () => { },
        traceTable: () => { },
        traceStep: () => { }
    };
    const warnings = [];

    try {
        // ── 0. Fetch Case with all vendor data ──────────────────────────────────
        const caseWhere = (tenant_id !== null && tenant_id !== undefined)
            ? { id: case_id, tenant_id }
            : { id: case_id };

        const caseRecord = await prisma.case.findFirst({
            where: caseWhere,
            include: {
                property: true,
                customer: true,
                // All ACTIVE obligations — include_in_foir filtering done in code below
                obligations: { where: { status: 'ACTIVE' } },
                // Case-level manual income entries entered from Manual Income Addition UI.
                // Applicant-level entries are still loaded below for OCR/manual salary fallback.
                income_entries: true,
                // Vendor pull tables — ordered newest first
                gst_requests: { orderBy: { created_at: 'desc' }, take: 10 },
                itr_analytics: { orderBy: { created_at: 'desc' }, take: 10 },
                bank_statements: { orderBy: { created_at: 'desc' }, take: 10 },
                bureau_checks: { orderBy: { created_at: 'desc' }, take: 10 },
                // Applicants with their salary data
                applicants: {
                    include: {
                        // Completed OCR results — primary source for salaried income
                        salary_ocr_results: {
                            where: { ocr_status: 'COMPLETED' },
                            orderBy: { created_at: 'desc' }
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
        if (!dryRun) {
            await prisma.caseEsrFinancials.upsert({
                where: { case_id },
                update: { extraction_status: 'PENDING' },
                create: { case_id, extraction_status: 'PENDING' }
            });
        }

        // ── 1. OBLIGATIONS ──────────────────────────────────────────────────────
        // Only obligations with include_in_foir=true count toward FOIR burden.
        // Filtering is done here in code (not in the Prisma where clause) to keep
        // the query simple and avoid schema-level filtering bugs.
        let existing_obligations = 0;
        let icici_exposure = 0;
        let hdfc_exposure = 0;

        for (const obl of caseRecord.obligations) {
            const emi = toNum(obl.emi_per_month);
            // include_in_foir defaults to true; only sum it if the flag is not explicitly false
            if (emi !== null && emi > 0 && obl.include_in_foir !== false) {
                existing_obligations += emi;
            }
            if (obl.lender_name?.toUpperCase().includes('ICICI')) {
                icici_exposure += (toNum(obl.outstanding_amount) || 0);
            }
            if (obl.lender_name?.toUpperCase().includes('HDFC')) {
                hdfc_exposure += (toNum(obl.outstanding_amount) || 0);
            }
        }

        // ── 1.5 FETCH TENANT POLICY (Align with dynamicEligibility) ──────────────
        let banking_income_policy = null;
        let banking_abb_divisor = 3;
        let lender_gst_margin = null;
        let lender_policy_key = null;
        let hdfc_banking_threshold = 7500000;
        let hdfc_banking_divisor_upto = 3;
        let hdfc_banking_divisor_above = 4;
        let npm_depreciation_fraction = 2 / 3;

        if (tenant_id) {
            try {
                const firstScheme = await prisma.scheme.findFirst({
                    where: {
                        product: { product_type: caseRecord.product_type },
                        status: 'ACTIVE'
                    },
                    include: { parameter_values: { include: { parameter: true } } }
                });

                if (firstScheme && Array.isArray(firstScheme.parameter_values)) {
                    for (const pv of firstScheme.parameter_values) {
                        const key = pv.parameter?.parameter_key || pv.parameter_key;
                        const val = pv.value?.raw ?? pv.value?.normalized ?? pv.value;
                        if (key === 'lender_policy_key' && val) lender_policy_key = String(val).toUpperCase();
                        if (key === 'banking_income_policy' && val) banking_income_policy = String(val).toUpperCase();
                        if ((key === 'banking_abb_divisor' || key === 'banking_abb_multiplier') && !isNaN(Number(val))) {
                            // ICICI requirement labels this as multiplier in places, but the policy text says ABB is divided.
                            banking_abb_divisor = Number(val);
                        }
                        if (key === 'banking_loan_switch_threshold' && !isNaN(Number(val))) hdfc_banking_threshold = Number(val);
                        if (key === 'banking_abb_divisor_upto_75l' && !isNaN(Number(val))) hdfc_banking_divisor_upto = Number(val);
                        if (key === 'banking_abb_divisor_above_75l' && !isNaN(Number(val))) hdfc_banking_divisor_above = Number(val);
                        if (key === 'npm_depreciation_fraction') {
                            const parsedPct = parsePercentLike(val, npm_depreciation_fraction);
                            if (parsedPct !== null) npm_depreciation_fraction = parsedPct;
                        }
                        if (key === 'gst_industry_margin' && !isNaN(parseFloat(val))) {
                            let parsed = parseFloat(val);
                            if (String(val).includes('%') && parsed > 1) parsed = parsed / 100;
                            else if (parsed > 1) parsed = parsed / 100;
                            lender_gst_margin = parsed;
                        }
                    }
                }
            } catch (policyErr) {
                console.warn('[ESR Extraction] Warning: Could not fetch scheme policy:', policyErr.message);
            }
        }

        const isHdfcPolicy = String(lender_policy_key || '').includes('HDFC');
        // Expose policy info on caseRecord for dry-run logging later
        caseRecord.__policy = {
            lender_policy_key,
            banking_income_policy,
            banking_abb_divisor,
            hdfc_banking_threshold,
            hdfc_banking_divisor_upto,
            hdfc_banking_divisor_above,
            npm_depreciation_fraction,
            lender_gst_margin,
            hdfc_exposure
        };

        // ── 2. GST EXTRACTION ───────────────────────────────────────────────────
        // ICICI policy source:
        // GST Analysis → Monthly Sales&Purchase → Monthly Sale Summary → data → Taxable Value
        // Industry type: Entity Details → natureOfBusinessActivities, normalized to 4 policy buckets.
        let gst_avg_monthly_sales = null;
        let gst_industry_type = null;
        let gst_industry_margin = null;

        const { getBestUsableGstSnapshot } = require('./gstAnalyticsSnapshot.service');
        const gstSnapshot = await getBestUsableGstSnapshot({ tenantId: tenant_id, caseId: case_id });
        
        const gstReq = pickBestRecord(caseRecord.gst_requests); // Keep for industry parsing

        if (gstSnapshot) {
            gst_avg_monthly_sales = gstSnapshot.avg_monthly_turnover;
            logger.traceExtraction('GST', {
                'Source': 'getBestUsableGstSnapshot',
                'Avg Monthly Sales': `₹${(gst_avg_monthly_sales || 0).toLocaleString()}`,
                'Months Filed': gstSnapshot.months_filed_12m,
                'Source Latest': gstSnapshot.financial_year_latest
            });
        }

        // GST industry type / margin resolution.
        // Prefer GST Entity Details. If GST is unavailable, allow DSA/MSME manual customer.industry.
        let margin_source = 'missing';
        const industryPayload = gstReq?.raw_fetch_data || gstReq?.raw_gst_data;
        if (industryPayload) {
            gst_industry_type = _parseGstIndustryType(industryPayload);
            gst_industry_margin = resolveGstIndustryMargin(gst_industry_type, isHdfcPolicy ? 'HDFC' : 'ICICI');
            margin_source = gst_industry_margin !== null ? 'GST Entity Details industry mapping' : 'manual review required';
        }

        if (gst_industry_margin === null && caseRecord.customer?.industry) {
            gst_industry_type = caseRecord.customer.industry;
            gst_industry_margin = resolveGstIndustryMargin(gst_industry_type, isHdfcPolicy ? 'HDFC' : 'ICICI');
            margin_source = gst_industry_margin !== null ? 'Manual DSA/MSME customer industry' : 'manual review required';
        }

        caseRecord.__policy.gst_margin_source = margin_source;
        caseRecord.__policy.final_gst_margin = gst_industry_margin;

        if (gstReq || caseRecord.customer?.industry) {
            logger.traceExtraction('GST MARGIN', {
                'Industry Type': {
                    'Source Path Used': gstReq?.raw_gst_data
                        ? 'Entity Details.gstnDetailed.natureOfBusinessActivities / gstinDetails.natureOfBusinessActivities'
                        : 'customer.industry manual portal field',
                    'Raw Value': gst_industry_type || 'UNKNOWN',
                    'Allowed Policy Buckets': ['Factory/Manufacturer', 'Wholesale Business', 'Retail Business', 'Supplier of Service']
                },
                'GST Margin': {
                    'Source': margin_source,
                    'Final Margin': gst_industry_margin !== null ? `${(gst_industry_margin * 100).toFixed(2)}%` : 'N/A — manual review'
                },
                'GST Income Formula': {
                    'Avg Monthly Sales × GST Margin': gst_industry_margin !== null
                        ? `₹${(gst_avg_monthly_sales || 0).toLocaleString()} × ${(gst_industry_margin * 100).toFixed(2)}%`
                        : 'Not calculated — industry margin missing',
                    'Result': gst_industry_margin !== null
                        ? `₹${((gst_avg_monthly_sales || 0) * gst_industry_margin).toLocaleString()}/month`
                        : '₹0/month'
                }
            });
        }

        // ── 3. ITR EXTRACTION ───────────────────────────────────────────────────
        let itr_pat = null;
        let itr_depreciation = null;
        let itr_finance_cost = null;
        let itr_remuneration = null;
        let director_interest_on_loan = null;
        let itr_gross_receipts = null;

        const itrReq = pickBestRecord(caseRecord.itr_analytics);

        if (itrReq) {
            let parsedItr = null;
            if (itrReq.analytics_payload) {
                parsedItr = extractItrDetails(itrReq.analytics_payload);
                itr_pat = parsedItr.net_profit_latest_year;
                itr_depreciation = parsedItr.depreciation_latest_year;
                itr_finance_cost = parsedItr.finance_cost_latest_year;
                itr_gross_receipts = parsedItr.gross_receipts_latest_year;
                itr_remuneration = parsedItr.itr_remuneration_latest_year;
            }

            if (itr_pat === null && itrReq.net_profit_latest_year != null) {
                itr_pat = toNum(itrReq.net_profit_latest_year);
                itr_gross_receipts = toNum(itrReq.gross_receipts_latest_year);
            }

            if (parsedItr) {
                // Log ITR verbose details
                logger.traceExtraction('ITR', {
                    'PAT / Business Profit': {
                        'Source Path Used': parsedItr._trace.pat_path || 'Fallback DB or General Info',
                        'Raw Value': itr_pat,
                        'Normalized': `₹${(itr_pat || 0).toLocaleString()}`
                    },
                    'Depreciation': {
                        'Source Path Used': parsedItr._trace.dep_path || 'N/A',
                        'Raw Value': itr_depreciation,
                        'Normalized': `₹${(itr_depreciation || 0).toLocaleString()}`
                    },
                    'Finance Cost': {
                        'Source Path Used': parsedItr._trace.fin_path || 'N/A',
                        'Raw Value': itr_finance_cost,
                        'Normalized': `₹${(itr_finance_cost || 0).toLocaleString()}`
                    },
                    'Director Remuneration': {
                        'Source Path Used': parsedItr._trace.rem_path || 'N/A',
                        'Raw Value': itr_remuneration,
                        'Normalized': `₹${(itr_remuneration || 0).toLocaleString()}`
                    },
                    'Gross Receipts': {
                        'Source Path Used': parsedItr._trace.rec_path || 'Fallback DB or General Info',
                        'Raw Value': itr_gross_receipts,
                        'Normalized': `₹${(itr_gross_receipts || 0).toLocaleString()}`
                    }
                });

                if (parsedItr._ignored && parsedItr._ignored.length > 0) {
                    logger.traceVerbose('Ignored ITR Fields:\n- ' + parsedItr._ignored.join('\n- '));
                }
            }

            // Task 3: Handle missing NPM fields
            if (itr_pat !== null && director_interest_on_loan === null) {
                logger.traceVerbose(`[ESR Extraction] Warning`, `'director_interest_on_loan' field is unavailable in schema. Treating as 0 for NPM calculation.`);
            }
        }

        // ── 4. BANK EXTRACTION ──────────────────────────────────────────────────
        let bank_avg_balance = null;
        let bank_avg_monthly_credit = null;
        let bank_total_credits = null;
        let bank_salary_avg_monthly = null;
        let bank_salary_credit_count = 0;
        let bank_salary_source = null;

        const bankReq = pickBestRecord(caseRecord.bank_statements);

        if (bankReq) {
            const rawData = bankReq.raw_retrieve_response || bankReq.raw_download_response;
            let parsedBank = null;
            let fySnapshot = null;
            let salarySnapshot = null;

            if (rawData) {
                fySnapshot = extractBankFySnapshot(rawData);
                salarySnapshot = extractBankSalary(rawData);
                bank_avg_balance = fySnapshot.latest;
                bank_avg_monthly_credit = fySnapshot.avg_monthly_credit;
                bank_total_credits = fySnapshot.total_credits;
                if (salarySnapshot?.validCreditCount > 0) {
                    bank_salary_avg_monthly = salarySnapshot.avgMonthlySalary;
                    bank_salary_credit_count = salarySnapshot.validCreditCount;
                    bank_salary_source = salarySnapshot.source;
                }
            }

            if (bank_avg_balance === null && bankReq.avg_bank_balance_latest_year != null) {
                logger.traceVerbose('[ESR Extraction] Stored/vendor bank average balance exists but is ignored for ICICI Banking method unless daily 5/10/15/25 sampling is available.');
            }

            if (bank_avg_balance === null && rawData) {
                fySnapshot = fySnapshot || extractBankFySnapshot(rawData);
                bank_avg_monthly_credit = bank_avg_monthly_credit ?? fySnapshot.avg_monthly_credit;
                bank_total_credits = bank_total_credits ?? fySnapshot.total_credits;
            }

            if (fySnapshot && fySnapshot._trace) {
                logger.traceExtraction('BANKING ABB', {
                    'Policy Details': {
                        'Sample Days': fySnapshot._trace.sampling_days || '5, 10, 15, 25',
                        'Balance Rule': 'Latest closing balance on or before sample date'
                    },
                    'Monthly ABB Table': fySnapshot._trace.monthly_abb_table || {},
                    'Final ABB Formula': {
                        'Sum of Monthly ABB': `₹${(fySnapshot._trace.final_abb_sum || 0).toLocaleString()}`,
                        'Valid Months': fySnapshot._trace.final_abb_months || 0,
                        'Calculation': `₹${(fySnapshot._trace.final_abb_sum || 0).toLocaleString()} / ${(fySnapshot._trace.final_abb_months || 0)} = ₹${(bank_avg_balance || 0).toLocaleString()}`
                    },
                    'Vendor Provided ABB (Ignored/Debug)': `₹${(fySnapshot._trace.vendor_adb_latest || 0).toLocaleString()}`
                });
            }

            if (salarySnapshot && salarySnapshot.validCreditCount > 0) {
                logger.traceExtraction('BANK SALARY CREDITS', {
                    'Bank Salary Source': bank_salary_source,
                    'Avg Monthly Salary': `₹${(bank_salary_avg_monthly || 0).toLocaleString()}`,
                    'Valid Salary Credits': bank_salary_credit_count,
                    'Ignored Debit Count': salarySnapshot.ignoredDebitCount
                });
            }

            // Persist derived fields back to bankReq if they were missing and we are not in dryRun
            if (bank_avg_balance && fySnapshot?._trace?.strict_abb_available && bankReq.id && !dryRun) {
                const updateData = {
                    avg_bank_balance_latest_year: bank_avg_balance
                };
                if (fySnapshot) {
                    updateData.financial_year_latest = fySnapshot.fy_latest;
                    updateData.avg_bank_balance_previous_year = fySnapshot.previous;
                    updateData.financial_year_previous = fySnapshot.fy_previous;
                }

                prisma.bankStatementAnalysisRequest.update({
                    where: { id: bankReq.id },
                    data: updateData
                }).catch(e => console.error('[ESR Bank Update] Failed:', e.message));
            }
        }

        // ── 5. BUREAU (for bureau_score + applicant_age fallback) ───────────────
        let bureau_score = null;
        let applicant_age = null;

        const bureauReq = pickBestRecord(caseRecord.bureau_checks);

        if (bureauReq?.raw_response) {
            const parsed = _parseBureauFromRaw(bureauReq.raw_response);
            bureau_score = parsed.score;
            applicant_age = parsed.age;
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

        const allManualIncomeEntries = Array.from(new Map([
            ...(caseRecord.income_entries || []),
            ...caseRecord.applicants.flatMap(applicant => applicant.income_entries || [])
        ].filter(Boolean).map(entry => [entry.id || `${entry.case_id || 'case'}-${entry.applicant_id || 'entity'}-${entry.income_type}-${entry.annual_amount}`, entry])).values());

        const SALARY_INCOME_TYPES = new Set([
            'salary', 'director salary', "partner's salary", 'gross salary',
            'net salary', 'form 16', 'basic salary'
        ]);

        let salaried_income = null;
        let salaried_income_source = null;
        let salaried_slip_count = 0;

        let totalSalariedMonthly = 0;
        let hasSalariedData = false;
        const salaryFormulaLines = [];

        logger.traceVerbose('SALARIED_BONUS_2_YEAR_VETTING_NOT_IMPLEMENTED: Annual bonus vetting logic is intentionally deferred.');

        // --- SALARY INCOME (Bank statement + OCR + Manual) ---
        // Prefer OCR salary if available, else bank salary credits, else manual salary entries.
        let totalOcrSlipCount = 0;
        let hasOcrSalary = false;
        let hasManualSalary = false;
        let usedBankSalary = false;

        for (const applicant of caseRecord.applicants) {
            const completedSlips = applicant.salary_ocr_results || [];
            const slipNets = completedSlips
                .map(s => toNum(s.net_salary))
                .filter(v => v !== null && v > 0);

            if (slipNets.length > 0) {
                const avgNetForApplicant = slipNets.reduce((a, b) => a + b, 0) / slipNets.length;
                totalSalariedMonthly += avgNetForApplicant;
                totalOcrSlipCount += slipNets.length;
                hasOcrSalary = true;
                salaryFormulaLines.push(`Applicant ${applicant.id} OCR avg salary ₹${Math.round(avgNetForApplicant).toLocaleString('en-IN')}/mo from ${slipNets.length} slip(s)`);

                logger.traceExtraction('SALARIED INCOME', {
                    'Source': `OCR Payslips (Applicant ${applicant.id})`,
                    'Slips Used': slipNets.length,
                    'Avg Monthly Salary': `₹${Math.round(avgNetForApplicant).toLocaleString('en-IN')}/mo`
                });
                continue; // prioritize OCR over manual for this applicant
            }

            const salaryEntries = (applicant.income_entries || []).filter(e =>
                SALARY_INCOME_TYPES.has((e.income_type || '').toLowerCase())
            );

            if (salaryEntries.length > 0) {
                let applicantMonthly = 0;
                for (const entry of salaryEntries) {
                    const annual = toNum(entry.annual_amount);
                    if (annual !== null && annual > 0) {
                        applicantMonthly += annual / 12;
                    }
                }
                if (applicantMonthly > 0) {
                    totalSalariedMonthly += applicantMonthly;
                    hasManualSalary = true;
                    salaryFormulaLines.push(`Applicant ${applicant.id} manual salary entries average ₹${Math.round(applicantMonthly).toLocaleString('en-IN')}/mo from ${salaryEntries.length} entry(ies)`);

                    logger.traceExtraction('SALARIED INCOME', {
                        'Source': `Manual Salary Entries (Applicant ${applicant.id})`,
                        'Entries Used': salaryEntries.length,
                        'Avg Monthly Salary': `₹${Math.round(applicantMonthly).toLocaleString('en-IN')}/mo`
                    });
                }
            }
        }

        // Include case-level manual salary rows (Entity Level / applicant_id null) only when they are
        // not already attached to an applicant loop above. This keeps Manual Income Addition rows effective
        // without double-counting applicant salary entries.
        const caseLevelSalaryEntries = (caseRecord.income_entries || []).filter(e =>
            !e.applicant_id && SALARY_INCOME_TYPES.has((e.income_type || '').toLowerCase())
        );
        if (caseLevelSalaryEntries.length > 0) {
            let caseLevelMonthly = 0;
            for (const entry of caseLevelSalaryEntries) {
                const annual = toNum(entry.annual_amount);
                if (annual !== null && annual > 0) caseLevelMonthly += annual / 12;
            }
            if (caseLevelMonthly > 0) {
                totalSalariedMonthly += caseLevelMonthly;
                hasManualSalary = true;
                salaryFormulaLines.push(`Case-level manual salary entries ₹${Math.round(caseLevelMonthly).toLocaleString('en-IN')}/mo from ${caseLevelSalaryEntries.length} entry(ies)`);
                logger.traceExtraction('SALARIED INCOME', {
                    'Source': 'Case-Level Manual Salary Entries',
                    'Entries Used': caseLevelSalaryEntries.length,
                    'Avg Monthly Salary': `₹${Math.round(caseLevelMonthly).toLocaleString('en-IN')}/mo`
                });
            }
        }

        if (!hasOcrSalary && bank_salary_avg_monthly !== null && bank_salary_avg_monthly > 0) {
            totalSalariedMonthly += bank_salary_avg_monthly;
            hasSalariedData = true;
            usedBankSalary = true;
            salaryFormulaLines.push(`Bank salary credit average ₹${Math.round(bank_salary_avg_monthly).toLocaleString('en-IN')}/mo from bank statement`);
            logger.traceExtraction('SALARIED INCOME', {
                'Source': 'Bank Salary Credits',
                'Avg Monthly Salary': `₹${Math.round(bank_salary_avg_monthly).toLocaleString('en-IN')}/mo`,
                'Bank Salary Credit Count': bank_salary_credit_count,
                'Bank Salary Source': bank_salary_source
            });
        }

        if (hasOcrSalary && bank_salary_avg_monthly !== null && bank_salary_avg_monthly > 0) {
            const ocrMonthly = totalSalariedMonthly;
            const bankMonthly = bank_salary_avg_monthly;
            const diff = Math.abs(ocrMonthly - bankMonthly);
            const relativeDiff = bankMonthly > 0 ? diff / bankMonthly : 0;
            salaryFormulaLines.push(`OCR vs Bank salary comparison: OCR ₹${Math.round(ocrMonthly).toLocaleString('en-IN')} vs Bank ₹${Math.round(bankMonthly).toLocaleString('en-IN')}/mo`);
            if (relativeDiff >= 0.20) {
                logger.traceExtraction('SALARIED INCOME REVIEW', {
                    'OCR Avg Monthly Salary': `₹${Math.round(ocrMonthly).toLocaleString('en-IN')}`,
                    'Bank Salary Avg Monthly': `₹${Math.round(bankMonthly).toLocaleString('en-IN')}`,
                    'Relative Difference': `${(relativeDiff * 100).toFixed(1)}%`
                });
                salaryFormulaLines.push(`OCR and bank salary differ by ${(relativeDiff * 100).toFixed(1)}%. Manual review recommended.`);
                warnings.push(`[ESR INCOME] OCR salary and bank salary credit differ by ${(relativeDiff * 100).toFixed(1)}%. Manual review recommended.`);
            }
        }

        if (hasOcrSalary && hasManualSalary) {
            salaried_income_source = 'OCR_MANUAL';
        } else if (hasOcrSalary && bank_salary_avg_monthly !== null && bank_salary_avg_monthly > 0) {
            salaried_income_source = 'OCR_BANK';
        } else if (hasOcrSalary) {
            salaried_income_source = 'OCR';
        } else if (bank_salary_avg_monthly !== null && bank_salary_avg_monthly > 0) {
            salaried_income_source = 'BANK_STATEMENT';
        } else if (hasManualSalary) {
            salaried_income_source = 'MANUAL';
        }

        salaried_slip_count = totalOcrSlipCount;
        if (hasOcrSalary || hasManualSalary || usedBankSalary) {
            hasSalariedData = true;
            salaried_income = totalSalariedMonthly;
        }

        // --- Incentive income: 3-month average ---

        // --- Incentive income: 3-month average ---
        const INCENTIVE_TYPES = new Set(['incentive', 'bonus', 'variable pay', 'performance bonus']);
        const OTHER_ELIGIBLE_TYPES = new Set(['other eligible income', 'other income']);

        let totalIncentiveMonthly = 0;
        let totalOtherEligibleMonthly = 0;

        for (const applicant of caseRecord.applicants) {
            // Read incentive from OCR slip if available. 
            // Average strictly over the most recent 3 months of valid slips.
            const completedSlips = applicant.salary_ocr_results || [];
            if (completedSlips.length > 0) {
                // Sort descending by date (assume id or creation order, or explicit date if available)
                // We'll just take the top 3 slips since they are typically monthly.
                const recentSlips = completedSlips.slice(0, 3);
                let slipIncentiveSum = 0;
                let validIncentiveCount = 0;
                for (const slip of recentSlips) {
                    const incentiveVal = toNum(slip.incentive_amount) || toNum(slip.bonus_amount);
                    if (incentiveVal !== null && incentiveVal > 0) {
                        slipIncentiveSum += incentiveVal;
                        validIncentiveCount++;
                    }
                }
                if (validIncentiveCount > 0) {
                    totalIncentiveMonthly += slipIncentiveSum / 3; // Strict 3-month average per Excel
                }
            }

        }

        // Read incentive/other eligible income from all manual entries once at case level.
        // Do not scan per-applicant here, otherwise applicant-linked manual rows can be double-counted.
        for (const entry of allManualIncomeEntries) {
            const type = (entry.income_type || '').toLowerCase();
            const monthly = (toNum(entry.annual_amount) || 0) / 12;
            // If it's manual, annual/12 is used as average monthly value.
            if (INCENTIVE_TYPES.has(type)) totalIncentiveMonthly += monthly;
            if (OTHER_ELIGIBLE_TYPES.has(type)) totalOtherEligibleMonthly += monthly;
        }

        if (hasSalariedData && totalSalariedMonthly > 0) {
            salaried_income = totalSalariedMonthly;
        }

        // ── 7. INCOME METHOD DERIVATION ─────────────────────────────────────────
        // Calculate normalized monthly income for each valid method.
        // These normalized values are persisted so method-specific schemes don't have to guess.

        let normalized_salaried = salaried_income || 0;

        let normalized_gst = 0;
        let gst_formula_str = 'N/A';
        let gst_calculation_str = 'N/A';
        if (gst_avg_monthly_sales !== null && gst_industry_margin !== null) {
            const margin = gst_industry_margin;
            normalized_gst = gst_avg_monthly_sales * margin;
            gst_formula_str = `GST average monthly sales from Monthly Sales&Purchase × ${isHdfcPolicy ? 'HDFC' : 'ICICI'} industry margin`;
            gst_calculation_str = `₹${gst_avg_monthly_sales.toLocaleString('en-IN')} × ${(margin * 100).toFixed(2)}% = ₹${normalized_gst.toLocaleString('en-IN')}`;
            console.log(`[ESR Extraction] GST Income - Type: ${gst_industry_type || 'UNKNOWN'}, Margin: ${margin}, AvgSales: ${gst_avg_monthly_sales}, MonthlyIncome: ${normalized_gst}`);
        } else if (gst_avg_monthly_sales !== null && gst_industry_margin === null) {
            gst_formula_str = 'GST income not calculated — industry type/margin missing';
            gst_calculation_str = 'Manual review required: select one of Factory/Manufacturer, Wholesale Business, Retail Business, Supplier of Service';
        }

        let normalized_net_profit = 0;
        let netProfitFormulaStr = 'N/A';
        let netProfitCalculationStr = 'N/A';
        if (itr_pat !== null) {
            const deprFraction = isHdfcPolicy ? 1.00 : npm_depreciation_fraction;
            const deprAddback = (itr_depreciation || 0) * deprFraction;
            if (director_interest_on_loan === null || director_interest_on_loan === undefined) {
                console.log('[ESR Extraction] director_interest_on_loan is missing, defaulting to 0.');
            }
            const directorInterestComponent = isHdfcPolicy ? 0 : (director_interest_on_loan || 0);
            const npmAnnual = itr_pat + deprAddback + (itr_finance_cost || 0) + (itr_remuneration || 0) + directorInterestComponent;
            normalized_net_profit = Math.max(0, npmAnnual / 12);
            netProfitFormulaStr = isHdfcPolicy
                ? '(PAT + 100% Depreciation + Finance Cost/Interest on Loan + Director Remuneration) / 12'
                : '(PAT + Depreciation addback + Finance Cost + Remuneration + Director Interest) / 12';
            netProfitCalculationStr = `(${itr_pat.toLocaleString('en-IN')} + ${deprAddback.toLocaleString('en-IN')} + ${(itr_finance_cost || 0).toLocaleString('en-IN')} + ${(itr_remuneration || 0).toLocaleString('en-IN')} + ${directorInterestComponent.toLocaleString('en-IN')}) / 12 = ₹${normalized_net_profit.toLocaleString('en-IN')}`;
        }

        let normalized_banking = 0;
        let banking_formula_str = 'N/A';
        let banking_calculation_str = 'N/A';
        if (bank_avg_balance !== null) {
            const requestedLoanAmount = toNum(caseRecord.loan_amount) || 0;
            const effectiveBankingDivisor = isHdfcPolicy
                ? (requestedLoanAmount > hdfc_banking_threshold ? hdfc_banking_divisor_above : hdfc_banking_divisor_upto)
                : banking_abb_divisor;
            const abbIncome = effectiveBankingDivisor > 0 ? bank_avg_balance / effectiveBankingDivisor : 0;
            normalized_banking = abbIncome;
            banking_formula_str = isHdfcPolicy
                ? 'HDFC banking: ABB ÷ 3 up to ₹75L loan, ABB ÷ 4 above ₹75L loan'
                : 'bank average balance ÷ ABB divisor';
            banking_calculation_str = `₹${bank_avg_balance.toLocaleString('en-IN')} ÷ ${effectiveBankingDivisor} = ₹${abbIncome.toLocaleString('en-IN')}`;
        } else if (bank_avg_monthly_credit !== null) {
            logger.traceVerbose('[ESR Extraction] Bank average balance missing; bank income is derived from ABB only. Monthly credit is available but not used for ESR banking income.');
            banking_formula_str = 'No ABB available to derive bank income from balance.';
            banking_calculation_str = 'bank_avg_balance unavailable';
        }

        const incomeCandidates = {
            SALARIED: normalized_salaried,
            GST: normalized_gst,
            BANKING: normalized_banking,
            NET_PROFIT: normalized_net_profit
        };

        logger.traceExtraction('FINAL DERIVED INCOMES', {
            'SALARIED': {
                'Formula': 'Sum of applicant monthly salary values from OCR/manual sources',
                'Calculation': salaryFormulaLines.length > 0 ? salaryFormulaLines.join(' ; ') : 'No salary formula details available',
                'Income': `₹${(normalized_salaried || 0).toLocaleString()}/month`
            },
            'GST': {
                'Formula': gst_formula_str,
                'Calculation': gst_calculation_str,
                'Income': `₹${(normalized_gst || 0).toLocaleString()}/month`
            },
            'BANKING': {
                'Formula': banking_formula_str || 'N/A',
                'Calculation': banking_calculation_str || 'N/A',
                'Income': `₹${(normalized_banking || 0).toLocaleString()}/month`
            },
            'NET_PROFIT (ITR)': {
                'Formula': netProfitFormulaStr,
                'Calculation': netProfitCalculationStr,
                'Income': `₹${(normalized_net_profit || 0).toLocaleString()}/month`
            }
        });

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
            product_type: caseRecord.product_type,

            property_type: caseRecord.property?.property_type || null,
            occupancy_type: caseRecord.property?.occupancy_status || null,
            property_value: toNum(caseRecord.property?.market_value) || null,

            bureau_score,
            applicant_age,
            existing_obligations,
            icici_exposure,

            itr_pat,
            itr_depreciation,
            itr_finance_cost,
            itr_gross_receipts,
            itr_remuneration,

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
            extracted_at: now
        };

        if (!dryRun) {
            await prisma.caseEsrFinancials.upsert({
                where: { case_id },
                create: { ...payload, case_id },
                update: payload
            });
        }

        const returnPayload = { ...payload, __dryRun: dryRun, __policy: caseRecord.__policy };

        if (dryRun) {
            console.log(`[ESR Extraction] DRY RUN recomputed for Case ${case_id}, no DB update | Method: ${selected_income_method} | Monthly: ₹${Math.round(selected_monthly_income).toLocaleString('en-IN')}`);
        } else {
            console.log(`[ESR Extraction] ✅ Completed for Case ${case_id} | Method: ${selected_income_method} | Monthly: ₹${Math.round(selected_monthly_income).toLocaleString('en-IN')}`);
        }
        return returnPayload;

    } catch (err) {
        console.error(`[ESR Extraction] ❌ Failed for Case ${case_id}:`, err.message || err);
        // Mark snapshot as FAILED so the ESR engine's freshness guard blocks stale usage
        try {
            if (!dryRun) {
                await prisma.caseEsrFinancials.updateMany({
                    where: { case_id },
                    data: { extraction_status: 'FAILED' }
                });
            }
        } catch (markErr) {
            console.error(`[ESR Extraction] Could not mark FAILED for case ${case_id}:`, markErr.message);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW PAYLOAD PARSERS (only used as legacy fallback when structured columns are null)
// These are intentionally isolated to prevent raw parsing spreading across services.
// ─────────────────────────────────────────────────────────────────────────────

// _parseGstFromRaw was replaced by extractGstDetails from financial.extractor.js

function parsePercentLike(value, defaultValue = null) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const num = Number(String(value).replace(/[^0-9.\-]+/g, ''));
    if (!Number.isFinite(num)) return defaultValue;
    return num > 1 ? num / 100 : num;
}

function resolveGstIndustryMargin(industryType, lenderPolicyKey = 'ICICI') {
    const text = String(industryType || '').toLowerCase();
    const isHdfc = String(lenderPolicyKey || '').toUpperCase().includes('HDFC');

    if (isHdfc) {
        if (text.includes('manufactur') || text.includes('factory')) return 0.08;
        if (text.includes('retail')) return 0.09;
        if (text.includes('wholesale')) return 0.09;
        if (text.includes('service') || text.includes('supplier of service')) return 0.10;
        return null; // HDFC policy: no silent fallback margin.
    }

    if (text.includes('manufactur') || text.includes('factory')) return 0.07;
    if (text.includes('retail')) return 0.05;
    if (text.includes('wholesale')) return 0.04;
    if (text.includes('special')) return 0.03;

    return null; // ICICI policy: no silent fallback margin. Manual review/manual industry required.
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

            if (!nature && firstEntity?.gstnDetailed) {
                const det = Array.isArray(firstEntity.gstnDetailed) ? firstEntity.gstnDetailed[0] : firstEntity.gstnDetailed;
                if (det) {
                    nature = det.nba || det.natureOfBusinessActivities;
                    constitution = det.constitutionOfBusiness;
                }
            }
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

// Handled by bankParser.service.js

function _parseBureauFromRaw(raw_response) {
    const result = { score: null, age: null };
    try {
        const rawBureau = typeof raw_response === 'string' ? JSON.parse(raw_response) : raw_response;
        const data = rawBureau?.verifiedData?.ResponseData?.data;
        result.score = toNum(data?.score) ?? toNum(data?.cibilScore) ?? toNum(data?.creditScore);
        result.age = toNum(data?.age);
    } catch (e) {
        console.warn('[ESR Extraction] Bureau raw parse failed:', e.message);
    }
    return result;
}

module.exports = {
    extractEsrFinancials,
    __testables: {
        extractGstDetails,
        resolveGstIndustryMargin,
        _parseGstIndustryType
    }
};
