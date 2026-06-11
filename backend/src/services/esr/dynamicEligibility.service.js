const prisma = require('../../../config/db');
const { updateStage } = require('../case.service');
const EsrTraceLogger = require('./esrTraceLogger');
const EsrCalculationLogBuilder = require('./esrCalculationLogBuilder');
const { buildIncomeCalculationLog } = require('./incomeCalculationLogBuilder');
const {
    parseMoneySafe,
    parsePercentSafe,
    parseTenureSafe,
    parseIntegerSafe,
    parseFoirRuleSafe,
    isCriticalParameter
} = require('../../utils/esrParsers');

// ---------- UNDERWRITING ROI NORMALIZATION HELPERS ----------
function normalizeRoi(value) {
    if (value === null || value === undefined) return 0;
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;

    // If value is whole number (e.g. 7.6) -> convert to fractional decimal (e.g. 0.076)
    if (num > 1) return num / 100;

    return num;
}

function toDisplayRoi(value) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;

    // Convert decimal fractional representation (e.g. 0.076) to whole percentage number (e.g. 7.6)
    if (num > 0 && num < 1) return Number((num * 100).toFixed(4));
    return num;
}

// ---------- HELPER UTILITIES ----------

// Legacy helpers removed, relying on esrParsers.js

// ------ SAFE PARAM VALUE RESOLVER ------
// Unwraps Prisma JSON-stored parameter objects so parsers always receive
// a plain string/number, never [object Object].
function resolveRawParamValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object') return value; // Already a primitive string/number

    // Unwrap Prisma normalizeParameter() output: { raw, normalized, type }
    if (value.raw !== undefined) return value.raw;

    // Fallback: prefer .normalized if .raw is absent
    if (value.normalized !== undefined && value.normalized !== null) return value.normalized;

    // Last resort: stringify to prevent [object Object] poisoning parsers
    try { return JSON.stringify(value); } catch { return null; }
}

function getParamMap(parameterValues) {
    const map = {};
    if (!Array.isArray(parameterValues)) return map;
    parameterValues.forEach(pv => {
        const key = pv.parameter?.parameter_key || pv.parameter_key;
        if (key) {
            // Always resolve to a raw scalar — parsers must never receive objects
            map[key] = resolveRawParamValue(pv.value);
        }
    });
    return map;
}

function getParamNumber(paramMap, key) {
    const rawValue = resolveRawParamValue(paramMap[key]);
    const res = parseMoneySafe(rawValue);
    res.key = key;
    res.raw = rawValue;
    return res;
}

function getParamPercent(paramMap, key) {
    const rawValue = resolveRawParamValue(paramMap[key]);
    const res = parsePercentSafe(rawValue);
    res.key = key;
    res.raw = rawValue;
    return res;
}

function getParamTenure(paramMap, key) {
    const rawValue = resolveRawParamValue(paramMap[key]);
    const res = parseTenureSafe(rawValue);
    res.key = key;
    res.raw = rawValue;
    return res;
}

function getParamInteger(paramMap, key) {
    const rawValue = resolveRawParamValue(paramMap[key]);
    const res = parseIntegerSafe(rawValue);
    res.key = key;
    res.raw = rawValue;
    return res;
}

function normalizeIncomeMethod(method) {
    if (!method) return null;
    const m = String(method).trim().toUpperCase();
    if (m === 'ANY' || m === 'ALL' || m === 'AUTO') return null;
    if (m === 'BANKING') return 'Banking';
    if (m === 'GST') return 'GST';
    if (m === 'NET_PROFIT') return 'Net Profit Method';
    if (m === 'SALARIED') return 'Salaried';
    return method;
}


// ------ LENDER POLICY REGISTRY ------
// Keep lender/bank/NBFC rules isolated here. Do NOT hardcode one bank's logic
// into generic calculation branches. Add new banks by creating a new entry below.
const LENDER_POLICY_REGISTRY = {
    DEFAULT: {
        key: 'DEFAULT',
        displayName: 'Default / Generic Policy',
        salariedCalculator: 'GENERIC',
        salariedEmiCapacityRule: 'FOIR',
        banking: {
            mode: 'ABB_DIVISOR',
            divisorParamKeys: ['banking_abb_divisor', 'banking_abb_multiplier'],
            defaultDivisor: 2
        },
        gstMargins: {},
        exposureFields: ['lender_exposure', 'existing_lender_exposure', 'icici_exposure'],
        dscr: {
            minRatioParamKey: 'dscr_min_ratio',
            defaultMinRatio: 1.25,
            obligationMultiplierParamKey: 'dscr_obligation_multiplier',
            defaultObligationMultiplier: 12
        }
    },
    ICICI: {
        key: 'ICICI',
        displayName: 'ICICI Bank Policy',
        aliases: ['ICICI', 'ICICI BANK'],
        salariedCalculator: 'ICICI',
        // ICICI salaried income is already policy weighted: Salary 70%, Agri 50/100%, Rent 70%.
        // So EMI capacity is considered income - obligations, not FOIR again.
        salariedEmiCapacityRule: 'INCOME_MINUS_OBLIGATIONS',
        banking: {
            mode: 'ABB_DIVISOR',
            divisorParamKeys: ['banking_abb_divisor', 'banking_abb_multiplier'],
            defaultDivisor: 2,
            sampleDays: [5, 10, 15, 25]
        },
        gstMargins: {
            factory: 0.07,
            manufacturing: 0.07,
            wholesale: 0.04,
            retail: 0.05,
            service: 0.15
        },
        exposureFields: ['icici_exposure', 'existing_icici_exposure', 'lender_exposure']
    },
    HDFC: {
        key: 'HDFC',
        displayName: 'HDFC Bank Policy',
        aliases: ['HDFC', 'HDFC BANK', 'HDFC BANK LTD'],
        salariedCalculator: 'HDFC',
        salariedEmiCapacityRule: 'INCOME_MINUS_OBLIGATIONS',
        salaried: {
            thresholdMonthly: 100000,
            pctUpToThreshold: 0.50,
            pctAboveThreshold: 0.60,
            netSalaryCapPct: 0.70
        },
        banking: {
            mode: 'ABB_DIVISOR_BY_LOAN_AMOUNT',
            thresholdParamKey: 'banking_loan_switch_threshold',
            defaultThreshold: 7500000,
            divisorUptoParamKey: 'banking_abb_divisor_upto_75l',
            divisorAboveParamKey: 'banking_abb_divisor_above_75l',
            defaultDivisorUpto: 3,
            defaultDivisorAbove: 4,
            sampleDays: [5, 15, 25]
        },
        gstMargins: {
            factory: 0.08,
            manufacturing: 0.08,
            wholesale: 0.09,
            retail: 0.09,
            service: 0.10
        },
        exposureFields: ['hdfc_exposure', 'existing_hdfc_exposure', 'lender_exposure'],
        npm: {
            depreciationFractionParamKey: 'npm_depreciation_fraction',
            defaultDepreciationFraction: 1.00,
            growthThresholdParamKey: 'npm_growth_threshold',
            defaultGrowthThreshold: 1.00,
            useAverageIfGrowthAboveThreshold: true
        },
        nwm: {
            depreciationFractionParamKey: 'nwm_depreciation_fraction',
            defaultDepreciationFraction: 2 / 3,
            propertyAddonAnnualPctParamKey: 'nwm_property_addon_annual_pct',
            defaultPropertyAddonAnnualPct: 0.03,
            financialAssetAnnualPctParamKey: 'nwm_financial_asset_annual_pct',
            defaultFinancialAssetAnnualPct: 0.05
        },
        manualIncome: {
            rentalBankAllowedMethods: ['NET PROFIT', 'NPM', 'DSCR'],
            rentalBankPct: 1.00,
            rentalBankCapToPrimaryIncome: true,
            rentalCashPct: 0,
            agriPct: 0,
            otherPct: 0
        },
        dscr: {
            minRatioParamKey: 'dscr_min_ratio',
            defaultMinRatio: 1.25,
            obligationMultiplierParamKey: 'dscr_obligation_multiplier',
            defaultObligationMultiplier: 12,
            calculationRuleParamKey: 'dscr_calculation_rule'
        }
    }
};



// ---------- HDFC DSCR FALLBACK SCHEME ----------
// Some UAT databases have HDFC LAP configured without DSCR or with legacy HDFC-only methods that are not present in policy.
// If DSCR is missing or was created without parameter values, the backend must still evaluate
// HDFC DSCR using policy defaults from the HDFC LAP requirement sheet instead of letting the
// frontend display an empty placeholder.
const HDFC_LAP_DSCR_PARAM_DEFAULTS = {
    lender_policy_key: 'HDFC_LAP',
    lap_min_loan: '50000000',
    lap_max_loan: 'No Capping',
    lap_roi_min: '8%',
    lap_roi_max: '10.25%',
    lap_pf_min: '0.35%',
    lap_pf_max: '1%',
    lap_max_tenure: '180 Months',
    age_maturity_income: '65',
    age_maturity_non_income: '75',
    bureau_cutoff: '740',
    bureau_name: 'CIBIL',
    lap_dbr_foir: 'No DBR',
    existing_obligation: 'All Obligation to be considered except getting closed in next 12 months. All obligation to be multiplied by 12 to get annual obligation',
    dscr_min_ratio: '1.25',
    dscr_obligation_multiplier: '12',
    dscr_calculation_rule: 'ANNUAL_INCOME_DIVIDED_BY_EXISTING_ANNUAL_OBLIGATION_PLUS_PROPOSED_ANNUAL_EMI',
    dscr_income_source_rule: 'Latest year PAT + 100% depreciation + interest on loan + director remuneration; rental bank/ITR allowed at 100% capped to main business profit',
    elig_rental_bank: 'Yes',
    elig_rental_cash: 'NO',
    elig_agri_itr: 'NO',
    dbr_rental_bank: '100%',
    dbr_rental_cash: 'No',
    dbr_agri_itr: 'No',
    lap_ltv_res_self: '65%',
    lap_ltv_res_rented: '65%',
    lap_ltv_res_vacant: '65%',
    lap_ltv_com_self: '65%',
    lap_ltv_com_rented: '65%',
    lap_ltv_com_vacant: '65%',
    lap_ltv_ind_self: '50%',
    lap_ltv_ind_rented: '50%',
    lap_ltv_ind_vacant: 'NOT_ALLOWED',
    lap_ltv_mix_self: '65%',
    lap_ltv_mix_rented: '65%',
    lap_ltv_mix_vacant: '65%',
    lap_ltv_plot_self: '30%',
    lap_ltv_plot_rented: '30%',
    lap_ltv_plot_vacant: '30%',
    lap_ltv_special: '50%'
};

function isHdfcLenderObject(lender = {}) {
    return resolveLenderPolicy(lender).key === 'HDFC';
}

function isLapProduct(product = {}) {
    return String(product.product_type || '').toUpperCase() === 'LAP';
}

function isDscrSchemeName(name) {
    return /\b(DSCR|DCSR)\b/i.test(String(name || ''));
}

function isUnsupportedHdfcLapSchemeName(name) {
    const text = String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    return text === 'LIP' || (text.includes('LOW') && text.includes('LTV')) || text.includes('NET WORTH') || text === 'NWM';
}

function buildVirtualParamValues(defaults = {}) {
    return Object.entries(defaults).map(([parameter_key, value]) => ({ parameter_key, value }));
}

function mergeMissingParamValues(existingValues = [], defaults = {}) {
    const existing = Array.isArray(existingValues) ? existingValues.filter(Boolean) : [];
    const existingKeys = new Set(existing.map(v => v.parameter?.parameter_key || v.parameter_key).filter(Boolean));
    const missing = Object.entries(defaults)
        .filter(([key]) => !existingKeys.has(key))
        .map(([parameter_key, value]) => ({ parameter_key, value }));
    return [...existing, ...missing];
}

function ensureHdfcDscrEvaluationSchemes({ schemes = [], product = {}, lender = {}, logger }) {
    const base = Array.isArray(schemes) ? schemes.filter(Boolean) : [];
    if (!isHdfcLenderObject(lender) || !isLapProduct(product)) return base;

    const supported = base.filter(scheme => {
        const unsupported = isUnsupportedHdfcLapSchemeName(scheme?.scheme_name);
        if (unsupported) {
            logger?.traceStep?.('HDFC UNSUPPORTED SCHEME SKIPPED', `${scheme.scheme_name} is not present in the HDFC LAP policy sheet. Skipped for HDFC only; ICICI and other lenders are unaffected.`);
        }
        return !unsupported;
    });

    let hasDscr = false;
    const patched = supported.map(scheme => {
        if (!isDscrSchemeName(scheme.scheme_name)) return scheme;
        hasDscr = true;
        return {
            ...scheme,
            scheme_name: scheme.scheme_name || 'DSCR',
            status: scheme.status || 'ACTIVE',
            parameter_values: mergeMissingParamValues(scheme.parameter_values, HDFC_LAP_DSCR_PARAM_DEFAULTS)
        };
    });

    if (!hasDscr) {
        logger?.traceStep?.('HDFC DSCR FALLBACK SCHEME', 'HDFC LAP DSCR scheme was not returned from DB. Added a virtual DSCR evaluation using HDFC LAP policy defaults so DSCR is generated in backend and frontend receives real data.');
        patched.push({
            id: `virtual-hdfc-lap-dscr-${product.id || 'product'}`,
            scheme_name: 'DSCR',
            status: 'ACTIVE',
            parameter_values: buildVirtualParamValues(HDFC_LAP_DSCR_PARAM_DEFAULTS)
        });
    }

    return patched;
}

function calculateDscrMonthlyObligations(obligationsList = []) {
    if (!Array.isArray(obligationsList)) return 0;
    return obligationsList.reduce((sum, obl) => {
        if (!obl || obl.include_in_foir === false) return sum;
        const emi = Number(obl.emi_per_month) || 0;
        return emi > 0 ? sum + emi : sum;
    }, 0);
}

function resolveLenderPolicy(lender = {}) {
    const raw = `${lender.code || ''} ${lender.name || ''}`.toUpperCase();
    for (const policy of Object.values(LENDER_POLICY_REGISTRY)) {
        if (!policy.aliases) continue;
        if (policy.aliases.some(alias => raw.includes(alias))) return policy;
    }
    return LENDER_POLICY_REGISTRY.DEFAULT;
}

function getNumericParam(paramMap, keys = [], defaultValue = 0) {
    for (const key of keys) {
        if (!key) continue;
        const raw = resolveRawParamValue(paramMap[key]);
        if (raw === undefined || raw === null || raw === '') continue;
        const num = toSafeNumber(raw);
        if (num > 0) return num;
    }
    return defaultValue;
}

function normalizeIndustryBucket(industryType) {
    const text = String(industryType || '').toLowerCase();
    if (text.includes('manufactur') || text.includes('factory')) return 'manufacturing';
    if (text.includes('wholesale')) return 'wholesale';
    if (text.includes('retail')) return 'retail';
    if (text.includes('service')) return 'service';
    return null;
}

function resolveGstIndustryMargin({ esr, paramMap, lenderPolicy }) {
    const bucket = normalizeIndustryBucket(esr.gst_industry_type || esr.industry_type);
    const policyMargin = bucket ? lenderPolicy.gstMargins?.[bucket] : null;

    const paramMargin = getNumericParam(paramMap, [
        bucket ? `gst_margin_${bucket}` : null,
        bucket ? `gst_${bucket}_margin` : null,
        'gst_industry_margin'
    ].filter(Boolean), 0);

    // Lender-specific margin wins for configured lenders like ICICI/HDFC.
    if (policyMargin && policyMargin > 0) return policyMargin;
    if (paramMargin && paramMargin > 0) return paramMargin > 1 ? paramMargin / 100 : paramMargin;

    const storedMargin = toSafeNumber(esr.gst_industry_margin);
    return storedMargin > 1 ? storedMargin / 100 : storedMargin;
}

function resolveExposureForLender(esr, lenderPolicy, obligationsList = []) {
    for (const key of lenderPolicy.exposureFields || []) {
        const val = toSafeNumber(esr[key]);
        if (val > 0) return { amount: val, sourceField: key };
    }

    // Some lender exposure fields (for example HDFC exposure) are not present as
    // columns in case_esr_financials. Derive lender exposure from the editable
    // credit-obligation rows so GRP/POS rules do not silently ignore exposure.
    const aliases = lenderPolicy.aliases || [lenderPolicy.key];
    const exposureFromObligations = Array.isArray(obligationsList)
        ? obligationsList.reduce((sum, obl) => {
            const lenderName = String(obl.lender_name || '').toUpperCase();
            const matched = aliases.some(alias => alias && lenderName.includes(String(alias).toUpperCase()));
            return matched ? sum + toSafeNumber(obl.outstanding_amount) : sum;
        }, 0)
        : 0;

    if (exposureFromObligations > 0) {
        return { amount: exposureFromObligations, sourceField: 'caseCreditObligation.outstanding_amount' };
    }

    return { amount: 0, sourceField: null };
}

function resolveBankingAbbIncome({ esr, paramMap, lenderPolicy }) {
    const abb = toSafeNumber(esr.bank_avg_balance);
    const bankingPolicy = lenderPolicy.banking || LENDER_POLICY_REGISTRY.DEFAULT.banking;
    if (abb <= 0) {
        return { abb, monthlyIncome: 0, divisor: null, basis: 'MISSING_ABB', threshold: null, loanReference: null };
    }

    if (bankingPolicy.mode === 'ABB_DIVISOR_BY_LOAN_AMOUNT') {
        const threshold = getNumericParam(paramMap, [bankingPolicy.thresholdParamKey], bankingPolicy.defaultThreshold || 7500000);
        const loanReference = toSafeNumber(esr.requested_loan_amount) || toSafeNumber(esr.sanction_amount) || toSafeNumber(esr.loan_amount);
        const divisorUpto = getNumericParam(paramMap, [bankingPolicy.divisorUptoParamKey], bankingPolicy.defaultDivisorUpto || 3);
        const divisorAbove = getNumericParam(paramMap, [bankingPolicy.divisorAboveParamKey], bankingPolicy.defaultDivisorAbove || 4);
        const divisor = loanReference > threshold ? divisorAbove : divisorUpto;
        return {
            abb,
            monthlyIncome: divisor > 0 ? abb / divisor : 0,
            divisor,
            basis: loanReference > threshold ? 'ABB_DIVISOR_ABOVE_THRESHOLD' : 'ABB_DIVISOR_UPTO_THRESHOLD',
            threshold,
            loanReference
        };
    }

    const divisor = getNumericParam(paramMap, bankingPolicy.divisorParamKeys || ['banking_abb_divisor', 'banking_abb_multiplier'], bankingPolicy.defaultDivisor || 2);
    return {
        abb,
        monthlyIncome: divisor > 0 ? abb / divisor : 0,
        divisor,
        basis: 'ABB_DIVISOR',
        threshold: null,
        loanReference: null
    };
}


function resolveDscrAnnualIncome({ esr, paramMap = {}, logger, lenderPolicy = LENDER_POLICY_REGISTRY.DEFAULT }) {
    const directAnnual = getNumericParam(paramMap, ['dscr_manual_annual_income'], 0)
        || toSafeNumber(esr.dscr_annual_income)
        || toSafeNumber(esr.annual_business_income)
        || toSafeNumber(esr.business_annual_income)
        || toSafeNumber(esr.annual_income)
        || toSafeNumber(esr.net_profit_annual_income);

    if (directAnnual > 0) {
        return {
            annualIncome: directAnnual,
            monthlyIncome: directAnnual / 12,
            source: 'DIRECT_ANNUAL_INCOME'
        };
    }

    if (lenderPolicy.key === 'HDFC') {
        const hdfcDscrIncome = resolveHdfcNpmAnnualIncome({ esr, paramMap, depreciationFraction: 1.00, includeDirectorInterest: false });
        if (hdfcDscrIncome.annualIncome > 0) {
            return {
                annualIncome: hdfcDscrIncome.annualIncome,
                monthlyIncome: hdfcDscrIncome.monthlyIncome,
                source: `HDFC_DSCR_${hdfcDscrIncome.source}`,
                components: hdfcDscrIncome.components,
                growthRate: hdfcDscrIncome.growthRate,
                useTwoYearAverage: hdfcDscrIncome.useTwoYearAverage
            };
        }
    }

    const pat = toSafeNumber(esr.itr_pat);
    const depreciation = toSafeNumber(esr.itr_depreciation);
    const financeCost = toSafeNumber(esr.itr_finance_cost);
    const remuneration = toSafeNumber(esr.itr_remuneration);
    const directorInterest = toSafeNumber(esr.director_interest_on_loan);
    const itrAnnualIncome = pat + depreciation + financeCost + remuneration + directorInterest;

    if (itrAnnualIncome > 0) {
        return {
            annualIncome: itrAnnualIncome,
            monthlyIncome: itrAnnualIncome / 12,
            source: 'ITR_NPM_ANNUAL_INCOME',
            components: { pat, depreciation, financeCost, remuneration, directorInterest }
        };
    }

    const monthlyCandidates = [
        { key: 'selected_monthly_income', value: toSafeNumber(esr.selected_monthly_income) },
        { key: 'net_profit_income', value: toSafeNumber(esr.net_profit_income) },
        { key: 'gst_income', value: toSafeNumber(esr.gst_income) },
        { key: 'banking_income', value: toSafeNumber(esr.banking_income) },
        { key: 'salaried_income', value: toSafeNumber(esr.salaried_income) }
    ];
    const selected = monthlyCandidates.find(x => x.value > 0);

    if (selected) {
        return {
            annualIncome: selected.value * 12,
            monthlyIncome: selected.value,
            source: `${selected.key.toUpperCase()}_X_12`
        };
    }

    logger?.traceWarning?.('DSCR annual income could not be resolved from ESR snapshot.');
    return {
        annualIncome: 0,
        monthlyIncome: 0,
        source: 'MISSING_DSCR_ANNUAL_INCOME'
    };
}

function calculateDscrCapacity({ annualIncome, netObligations, paramMap, lenderPolicy }) {
    const dscrPolicy = lenderPolicy.dscr || LENDER_POLICY_REGISTRY.DEFAULT.dscr;
    const minRatio = getNumericParam(paramMap, [dscrPolicy.minRatioParamKey || 'dscr_min_ratio'], dscrPolicy.defaultMinRatio || 1.25);
    const obligationMultiplier = getNumericParam(paramMap, [dscrPolicy.obligationMultiplierParamKey || 'dscr_obligation_multiplier'], dscrPolicy.defaultObligationMultiplier || 12);
    const existingAnnualObligations = Math.max(0, toSafeNumber(netObligations) * obligationMultiplier);
    const maxAnnualDebtService = minRatio > 0 ? (annualIncome / minRatio) : 0;
    const maxProposedAnnualEmi = Math.max(0, maxAnnualDebtService - existingAnnualObligations);
    const maxProposedMonthlyEmi = maxProposedAnnualEmi / 12;
    const ratioBeforeLoan = existingAnnualObligations > 0 ? annualIncome / existingAnnualObligations : null;

    return {
        minRatio,
        obligationMultiplier,
        annualIncome,
        existingAnnualObligations,
        maxAnnualDebtService,
        maxProposedAnnualEmi,
        maxProposedMonthlyEmi,
        ratioBeforeLoan,
        formula: 'DSCR = Annual Income / (Existing Annual Obligations + Proposed Annual EMI)'
    };
}



function getHdfcPreviousYearNumber(esr, keys = []) {
    return getFirstPositiveValue(esr, keys, 'annual') * 12;
}

function resolveHdfcNpmAnnualIncome({ esr, paramMap = {}, depreciationFraction = null, includeDirectorInterest = false }) {
    const hdfcNpmPolicy = LENDER_POLICY_REGISTRY.HDFC.npm || {};
    const rawDepFraction = depreciationFraction !== null && depreciationFraction !== undefined
        ? depreciationFraction
        : getNumericParam(paramMap, [hdfcNpmPolicy.depreciationFractionParamKey || 'npm_depreciation_fraction'], hdfcNpmPolicy.defaultDepreciationFraction || 1);
    const depFraction = rawDepFraction > 1 ? rawDepFraction / 100 : rawDepFraction;

    const latest = {
        pat: toSafeNumber(esr.itr_pat),
        depreciation: toSafeNumber(esr.itr_depreciation),
        financeCost: toSafeNumber(esr.itr_finance_cost),
        remuneration: toSafeNumber(esr.itr_remuneration),
        directorInterest: includeDirectorInterest ? toSafeNumber(esr.director_interest_on_loan) : 0
    };
    const latestAnnual = latest.pat + (latest.depreciation * depFraction) + latest.financeCost + latest.remuneration + latest.directorInterest;

    const previous = {
        pat: getHdfcPreviousYearNumber(esr, ['itr_pat_previous_year', 'itr_previous_year_pat', 'itr_prev_pat', 'previous_itr_pat']),
        depreciation: getHdfcPreviousYearNumber(esr, ['itr_depreciation_previous_year', 'itr_previous_year_depreciation', 'itr_prev_depreciation', 'previous_itr_depreciation']),
        financeCost: getHdfcPreviousYearNumber(esr, ['itr_finance_cost_previous_year', 'itr_previous_year_finance_cost', 'itr_prev_finance_cost', 'previous_itr_finance_cost']),
        remuneration: getHdfcPreviousYearNumber(esr, ['itr_remuneration_previous_year', 'itr_previous_year_remuneration', 'itr_prev_remuneration', 'previous_itr_remuneration']),
        directorInterest: includeDirectorInterest ? getHdfcPreviousYearNumber(esr, ['director_interest_on_loan_previous_year', 'previous_director_interest_on_loan']) : 0
    };
    const previousAnnual = previous.pat + (previous.depreciation * depFraction) + previous.financeCost + previous.remuneration + previous.directorInterest;

    const growthThresholdRaw = getNumericParam(paramMap, [hdfcNpmPolicy.growthThresholdParamKey || 'npm_growth_threshold'], hdfcNpmPolicy.defaultGrowthThreshold || 1);
    const growthThreshold = growthThresholdRaw > 1 ? growthThresholdRaw / 100 : growthThresholdRaw;
    const growthRate = previousAnnual > 0 ? ((latestAnnual - previousAnnual) / Math.abs(previousAnnual)) : null;
    const useTwoYearAverage = !!(previousAnnual > 0 && growthRate !== null && growthRate > growthThreshold);
    const annualIncome = useTwoYearAverage ? ((latestAnnual + previousAnnual) / 2) : latestAnnual;

    return {
        annualIncome: Math.max(0, annualIncome),
        monthlyIncome: Math.max(0, annualIncome / 12),
        latestAnnual,
        previousAnnual,
        growthRate,
        growthThreshold,
        useTwoYearAverage,
        depreciationFraction: depFraction,
        components: { latest, previous, includeDirectorInterest },
        source: useTwoYearAverage ? 'HDFC_NPM_TWO_YEAR_AVERAGE' : 'HDFC_NPM_LATEST_YEAR'
    };
}

function resolveGrpMultiplierForPolicy({ esr, paramMap = {}, lenderPolicy }) {
    if (lenderPolicy.key === 'HDFC') {
        const profileText = [
            esr.profession,
            esr.professional_type,
            esr.customer_profession,
            esr.industry_type,
            esr.gst_industry_type,
            esr.business_nature,
            esr.itr_profession,
            esr.constitution_type,
            esr.employment_type
        ].filter(Boolean).join(' ').toLowerCase();
        const isDoctor = profileText.includes('doctor') || profileText.includes('mbbs') || profileText.includes('md') || profileText.includes('medical practitioner');
        const doctorMultiplier = getNumericParam(paramMap, ['grp_doctor_multiplier'], 4);
        const otherProfessionalMultiplier = getNumericParam(paramMap, ['grp_other_professional_multiplier'], 3);
        return {
            multiplier: isDoctor ? doctorMultiplier : otherProfessionalMultiplier,
            source: isDoctor ? 'HDFC_DOCTOR_MBBS_MD_MULTIPLIER' : 'HDFC_OTHER_PROFESSIONAL_MULTIPLIER',
            profileText
        };
    }

    const rawGrpMult = paramMap['grp_annual_receipts_multiplier'] || paramMap['grp_industry_margin'];
    const parsedMult = parseFloat(rawGrpMult);
    return {
        multiplier: Number.isFinite(parsedMult) ? parsedMult : 4.0,
        source: rawGrpMult ? 'CONFIGURED_GRP_MULTIPLIER' : 'DEFAULT_GRP_MULTIPLIER',
        profileText: null
    };
}

function isHdfcRentalBankAllowedMethod(methodName = '') {
    const m = String(methodName || '').toUpperCase();
    return m.includes('NET PROFIT') || m.includes('NPM') || m.includes('DSCR');
}

function calculateHdfcManualIncomeAdditions({ incomeEntries = [], methodName = '', primaryIncome = 0 }) {
    const breakdown = [];
    let rentalBankRaw = 0;
    let rentalCashRaw = 0;
    let agriRaw = 0;
    let otherRaw = 0;

    for (const entry of incomeEntries || []) {
        const type = normalizeManualIncomeType(entry);
        const docText = normalizeManualIncomeDocText(entry);
        const monthly = normalizeManualEntryMonthlyAmount(entry);
        if (monthly <= 0) continue;

        const isRent = type.includes('rent') || type.includes('rental');
        const isBankOrItr = isRent && (type.includes('bank') || docText.includes('bank') || docText.includes('credit') || docText.includes('itr') || docText.includes('income tax'));
        const isCashRent = isRent && !isBankOrItr;
        const isAgri = type.includes('agri') || type.includes('agriculture');

        if (isBankOrItr) {
            rentalBankRaw += monthly;
        } else if (isCashRent) {
            rentalCashRaw += monthly;
        } else if (isAgri) {
            agriRaw += monthly;
        } else if (type) {
            otherRaw += monthly;
        }
    }

    const methodAllowsRental = isHdfcRentalBankAllowedMethod(methodName);
    const cap = Math.max(0, primaryIncome || 0);
    const rentalBankEligible = methodAllowsRental
        ? (cap > 0 ? Math.min(rentalBankRaw, cap) : 0)
        : 0;

    if (rentalBankRaw > 0) {
        breakdown.push({
            type: 'Rental Income — Bank/ITR',
            raw_monthly: rentalBankRaw,
            allowed_pct: methodAllowsRental ? 100 : 0,
            eligible_monthly: rentalBankEligible,
            cap_monthly: methodAllowsRental ? cap : 0,
            rule: methodAllowsRental
                ? 'HDFC LAP: rental bank/ITR income allowed at 100%, capped to 100% of main business profit considered.'
                : 'HDFC LAP: rental income is not considered for this method.'
        });
    }
    if (rentalCashRaw > 0) {
        breakdown.push({
            type: 'Rental Income — Cash / Unverified',
            raw_monthly: rentalCashRaw,
            allowed_pct: 0,
            eligible_monthly: 0,
            rule: 'HDFC LAP: rental cash is not considered.'
        });
    }
    if (agriRaw > 0) {
        breakdown.push({
            type: 'Agriculture Income',
            raw_monthly: agriRaw,
            allowed_pct: 0,
            eligible_monthly: 0,
            rule: 'HDFC LAP: agriculture income is not considered for auto eligibility.'
        });
    }
    if (otherRaw > 0) {
        breakdown.push({
            type: 'Other Manual Income',
            raw_monthly: otherRaw,
            allowed_pct: 0,
            eligible_monthly: 0,
            rule: 'HDFC LAP: other manual income is not auto-counted unless captured in the lender-specific ITR/GST/Banking source.'
        });
    }

    return {
        rental_bank: rentalBankEligible,
        rental_cash: 0,
        agri_income: 0,
        other_income: 0,
        total_eligible_manual_income: rentalBankEligible,
        breakdown,
        raw: { rentalBankRaw, rentalCashRaw, agriRaw, otherRaw }
    };
}

function calculateHdfcComposedIncome({ scheme, esr, incomeEntries, paramMap, warnings, logger, lenderPolicy }) {
    const methodName = String(scheme.scheme_name || '').toUpperCase();
    const primaryIncome = getSchemePrimaryIncome(esr, scheme, paramMap, warnings, logger, lenderPolicy);
    const manualAdditions = calculateHdfcManualIncomeAdditions({ incomeEntries, methodName, primaryIncome });
    const totalEligibleIncome = primaryIncome + manualAdditions.total_eligible_manual_income;

    logger?.traceExtraction?.('HDFC MANUAL INCOME POLICY', {
        'Method': scheme.scheme_name,
        'Primary Income': primaryIncome,
        'Rental Bank Eligible': manualAdditions.rental_bank,
        'Rental Cash Eligible': 0,
        'Agriculture Eligible': 0,
        'Other Manual Eligible': 0,
        'Rule': 'Only Rental Bank/ITR is allowed for NPM/DSCR and capped to 100% of main business profit; not counted for Salaried/Banking/GST/GRP.'
    });

    return {
        total_eligible_income: totalEligibleIncome,
        primary_income: primaryIncome,
        rental_bank: manualAdditions.rental_bank,
        rental_cash: 0,
        agri_income: 0,
        other_income: 0,
        breakdown: [
            { type: 'HDFC Primary Income', eligible_monthly: primaryIncome, rule: 'Method-specific HDFC primary income.' },
            ...manualAdditions.breakdown
        ]
    };
}

function isHdfcUnsecuredObligation(obl = {}) {
    const lenderName = String(obl.lender_name || '').toUpperCase();
    if (!lenderName.includes('HDFC')) return false;
    const type = String(obl.loan_type || '').toLowerCase();
    if (!type) return false;
    const securedMarkers = ['home', 'housing', 'lap', 'loan against property', 'property', 'mortgage', 'vehicle', 'auto', 'car', 'gold', 'equipment'];
    if (securedMarkers.some(x => type.includes(x))) return false;
    const unsecuredMarkers = ['unsecured', 'personal', 'business', 'consumer', 'credit card', 'card', 'professional'];
    return unsecuredMarkers.some(x => type.includes(x));
}

function getBankingBusinessCreditCap(esr, paramMap, lenderPolicy, isBankingMethod) {
    if (lenderPolicy.key !== 'HDFC' || !isBankingMethod) return null;
    const multiplier = getNumericParam(paramMap, ['banking_business_credit_cap_multiplier'], 1);
    const annualBusinessCredit = getFirstPositiveValue(esr, [
        'bank_total_business_credits',
        'bank_business_credit_12m',
        'banking_business_credit_12m',
        'bank_credits_last_12_months',
        'bank_total_credits'
    ], 'annual') * 12 || ((toSafeNumber(esr.bank_avg_monthly_credit) || 0) * 12);

    if (annualBusinessCredit <= 0 || multiplier <= 0) return null;
    return Math.round(annualBusinessCredit * multiplier);
}

function toSafeNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(String(value).replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(num) ? num : 0;
}

function normalizeIncomeFrequency(value, frequency = 'monthly') {
    const amount = toSafeNumber(value);
    if (amount <= 0) return 0;
    const freq = String(frequency || '').toLowerCase();
    if (freq.includes('annual') || freq.includes('year') || freq === 'pa') return amount / 12;
    return amount;
}

function getFirstPositiveValue(source, keys, frequency = 'monthly') {
    if (!source) return 0;
    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
            const value = normalizeIncomeFrequency(source[key], frequency);
            if (value > 0) return value;
        }
    }
    return 0;
}

function normalizeManualIncomeType(entry = {}) {
    return String(entry.income_type || entry.incomeType || entry.type || '')
        .toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeManualIncomeDocText(entry = {}) {
    return [
        entry.supporting_doc_type,
        entry.supportingDocType,
        entry.proofDocument,
        entry.source,
        entry.remarks
    ].filter(Boolean).join(' ')
        .toLowerCase()
        .replace(/[–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeManualEntryMonthlyAmount(entry = {}) {
    const monthlyAmount = toSafeNumber(entry.monthly_amount ?? entry.monthlyAmount ?? entry.monthlyIncome);
    if (monthlyAmount > 0) return monthlyAmount;

    const annualAmount = toSafeNumber(entry.annual_amount ?? entry.annualAmount ?? entry.annualIncome);
    return annualAmount > 0 ? annualAmount / 12 : 0;
}

function hasOwnershipProofText(text = '') {
    const normalized = String(text || '').toLowerCase();
    return normalized.includes('ownership')
        || normalized.includes('owned')
        || normalized.includes('land')
        || normalized.includes('7/12')
        || normalized.includes('712')
        || normalized.includes('satbara')
        || normalized.includes('record of rights');
}

function isManualSalaryIncomeType(type = '') {
    return type === 'salary'
        || type.includes('director salary')
        || type.includes("partner's salary")
        || type.includes('partner salary')
        || type.includes('gross salary')
        || type.includes('net salary')
        || type.includes('form 16')
        || type.includes('basic salary');
}


function getRawManualEntryAnnualAmount(entry = {}) {
    return toSafeNumber(entry.annual_amount ?? entry.annualAmount ?? entry.annualIncome);
}

function getManualEntryDisplayType(entry = {}) {
    return entry.income_type || entry.incomeType || entry.type || 'Other';
}

function maskAuditIdentifier(value) {
    if (value === null || value === undefined || value === '') return null;
    const str = String(value);
    if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(str)) {
        return `${str[0]}XXXX${str.slice(-3)}`;
    }
    if (/^\d{10}$/.test(str)) {
        return `XXXXXX${str.slice(-4)}`;
    }
    return str;
}

function normalizeAuditManualIncomeEntry(entry = {}) {
    const annualAmount = getRawManualEntryAnnualAmount(entry) || 0;
    const monthlyAmount = normalizeManualEntryMonthlyAmount(entry);
    const type = normalizeManualIncomeType(entry);
    const docText = normalizeManualIncomeDocText(entry);
    const isRent = type.includes('rent') || type.includes('rental');
    const isBankCredit = docText.includes('bank') || docText.includes('credit') || type.includes('bank');
    const isCashOrUnverifiedRent = isRent && !isBankCredit;
    const ownershipProof = hasOwnershipProofText(`${type} ${docText}`);

    return {
        id: entry.id || null,
        applicant_id: entry.applicant_id || entry.applicantId || null,
        applicant_pan_masked: maskAuditIdentifier(entry.applicant_pan || entry.pan || entry.applicantPan),
        applicant_name: entry.applicant_name || entry.applicantName || entry.applicant || null,
        income_type: getManualEntryDisplayType(entry),
        normalized_income_type: type,
        annual_amount: annualAmount,
        monthly_amount: monthlyAmount,
        supporting_doc_type: entry.supporting_doc_type || entry.supportingDocType || entry.proofDocument || null,
        remarks: entry.remarks || null,
        rent_classification: isRent ? (isBankCredit ? 'BANK_CREDIT' : 'CASH_OR_UNVERIFIED') : null,
        ownership_proof_available: ownershipProof,
        included_in_icici_auto_calculation: !(isCashOrUnverifiedRent),
        policy_note: isCashOrUnverifiedRent
            ? 'ICICI: rental cash/unverified rent is No/manual review; excluded from auto eligibility.'
            : 'Will be evaluated by lender/scheme-specific manual income policy.'
    };
}

function normalizeAuditObligationEntry(obligation = {}) {
    const emi = toSafeNumber(obligation.emi_per_month ?? obligation.emi ?? obligation.monthlyPayment ?? obligation.monthly_amount);
    const outstanding = toSafeNumber(obligation.outstanding_amount ?? obligation.outstandingAmount);
    return {
        id: obligation.id || null,
        lender_name: obligation.lender_name || obligation.lenderName || null,
        loan_type: obligation.loan_type || obligation.type || obligation.obligation_type || null,
        emi_per_month: emi,
        outstanding_amount: outstanding,
        loan_start_date: obligation.loan_start_date || obligation.startDate || null,
        include_in_foir: obligation.include_in_foir !== false,
        status: obligation.status || 'ACTIVE',
        source: obligation.source || null
    };
}

function buildAuditPropertySnapshot(esr = {}) {
    return {
        product_type: esr.product_type || null,
        property_type: esr.property_type || null,
        occupancy_status: esr.occupancy_type || esr.occupancy_status || null,
        ownership: esr.ownership || esr.ownership_status || esr.property_ownership || null,
        market_value: toSafeNumber(esr.market_value ?? esr.property_value),
        property_value: toSafeNumber(esr.property_value ?? esr.market_value),
        requested_loan_amount: toSafeNumber(esr.requested_loan_amount),
        requested_tenure_months: toSafeNumber(esr.requested_tenure_months),
        selected_income_method: esr.selected_income_method || null,
        selected_monthly_income: toSafeNumber(esr.selected_monthly_income),
        existing_obligations: toSafeNumber(esr.existing_obligations)
    };
}

function buildAuditBureauReport(rawBureauReport, obligationsList = []) {
    const activeLoans = (Array.isArray(obligationsList) ? obligationsList : [])
        .map(normalizeAuditObligationEntry)
        .filter(o => (o.emi_per_month || 0) > 0 || (o.outstanding_amount || 0) > 0)
        .map(o => ({
            lender: o.lender_name,
            type: o.loan_type,
            emi: o.emi_per_month,
            monthlyPayment: o.emi_per_month,
            outstandingAmount: o.outstanding_amount,
            status: o.status,
            includeInFoir: o.include_in_foir,
            source: o.source
        }));

    return {
        raw: rawBureauReport || null,
        activeLoans,
        note: 'activeLoans are normalized from editable CaseCreditObligation rows so printed ESR audit uses the EMI values reviewed/edited in the UI.'
    };
}

function getIncomeEntryMonthlySums(incomeEntries = []) {
    const result = {
        manualSalaryMonthly: 0,
        manualAgriMonthly: 0,
        manualAgriWithOwnershipMonthly: 0,
        itrAgriMonthly: 0,
        manualRentMonthly: 0,
        manualRentBankMonthly: 0,
        manualRentCashMonthly: 0,
        itrRentMonthly: 0,
        excludedRentCashMonthly: 0,
        rows: []
    };

    if (!Array.isArray(incomeEntries)) return result;

    for (const entry of incomeEntries) {
        const type = normalizeManualIncomeType(entry);
        const docText = normalizeManualIncomeDocText(entry);
        const annualAmount = toSafeNumber(entry.annual_amount ?? entry.annualAmount ?? entry.annualIncome);
        const normalizedMonthly = normalizeManualEntryMonthlyAmount(entry);

        if (normalizedMonthly <= 0) continue;

        const isItr = docText.includes('itr') || docText.includes('income tax');
        const isAgri = type.includes('agri') || type.includes('agriculture');
        const isRent = type.includes('rent') || type.includes('rental');
        const isRentBank = isRent && (type.includes('bank') || docText.includes('bank') || docText.includes('credit'));
        const isRentCash = isRent && type.includes('cash');
        const ownershipProof = hasOwnershipProofText(`${type} ${docText}`);

        if (isManualSalaryIncomeType(type)) {
            result.manualSalaryMonthly += normalizedMonthly;
        }

        if (isAgri) {
            if (isItr) result.itrAgriMonthly += normalizedMonthly;
            else if (ownershipProof) result.manualAgriWithOwnershipMonthly += normalizedMonthly;
            else result.manualAgriMonthly += normalizedMonthly;
        }

        if (isRent) {
            if (isItr) {
                result.itrRentMonthly += normalizedMonthly;
            } else if (isRentBank) {
                result.manualRentBankMonthly += normalizedMonthly;
                result.manualRentMonthly += normalizedMonthly;
            } else if (isRentCash) {
                result.manualRentCashMonthly += normalizedMonthly;
                result.excludedRentCashMonthly += normalizedMonthly;
            } else {
                // Conservative ICICI default: unclassified manual rent is treated as cash/unverified
                // and is not auto-counted unless the user/doc clearly identifies Bank Credit.
                result.manualRentCashMonthly += normalizedMonthly;
                result.excludedRentCashMonthly += normalizedMonthly;
            }
        }

        if (isManualSalaryIncomeType(type) || isAgri || isRent) {
            result.rows.push({
                income_type: entry.income_type || entry.incomeType,
                source: isItr ? 'ITR' : 'MANUAL',
                annual_amount: annualAmount || null,
                monthly_amount: normalizedMonthly,
                rent_classification: isRent ? (isRentBank ? 'BANK' : 'CASH_OR_UNVERIFIED') : null,
                ownership_proof: ownershipProof
            });
        }
    }

    return result;
}

function calculateIciciSalariedConsideredIncome({ esr, incomeEntries = [] }) {
    const entrySums = getIncomeEntryMonthlySums(incomeEntries);

    // Salary is stored/entered as monthly in ESR summary. Apply ICICI salaried-method 70% weight once.
    // Manual salary rows are used only as a fallback when OCR/API/bank salary is not available.
    const grossSalaryFromSnapshot =
        getFirstPositiveValue(esr, [
            'salaried_income',
            'salary_income',
            'monthly_salary_income',
            'net_monthly_salary',
            'applicant_salary_income'
        ], 'monthly');
    const grossSalaryMonthly = grossSalaryFromSnapshot > 0 ? grossSalaryFromSnapshot : entrySums.manualSalaryMonthly;
    const consideredSalary = grossSalaryMonthly * 0.70;

    // Agriculture priority:
    // 1. ITR agriculture at 100%.
    // 2. Manual agriculture with ownership/land/7/12 proof at 100%.
    // 3. Other manual agriculture at 50%.
    const itrAgriMonthly = entrySums.itrAgriMonthly || getFirstPositiveValue(esr, [
        'itr_agriculture_income',
        'itr_agri_income',
        'agriculture_income_itr',
        'agri_income_itr',
        'annual_itr_agriculture_income',
        'itr_annual_agriculture_income'
    ], 'annual');

    const manualAgriMonthly = entrySums.manualAgriMonthly || getFirstPositiveValue(esr, [
        'manual_agriculture_income',
        'manual_agri_income',
        'annual_agriculture_income',
        'agriculture_income',
        'agri_income'
    ], 'annual');

    let consideredAgriculture = 0;
    let agricultureSource = 'NONE';
    let agricultureRawMonthly = 0;
    let agricultureAllowedPct = 0;

    if (itrAgriMonthly > 0) {
        agricultureRawMonthly = itrAgriMonthly;
        consideredAgriculture = itrAgriMonthly;
        agricultureAllowedPct = 100;
        agricultureSource = 'ITR_AGRICULTURE_100_PERCENT';
    } else if (entrySums.manualAgriWithOwnershipMonthly > 0) {
        agricultureRawMonthly = entrySums.manualAgriWithOwnershipMonthly;
        consideredAgriculture = entrySums.manualAgriWithOwnershipMonthly;
        agricultureAllowedPct = 100;
        agricultureSource = 'MANUAL_AGRICULTURE_OWNERSHIP_PROOF_100_PERCENT';
    } else if (manualAgriMonthly > 0) {
        agricultureRawMonthly = manualAgriMonthly;
        consideredAgriculture = manualAgriMonthly * 0.50;
        agricultureAllowedPct = 50;
        agricultureSource = 'MANUAL_AGRICULTURE_50_PERCENT';
    }

    // ICICI policy: Rental income is auto-counted only if it is Bank Credit / ITR-backed.
    // Rental cash or unclassified manual rent is not auto-counted.
    const manualRentBankMonthly = entrySums.manualRentBankMonthly || getFirstPositiveValue(esr, [
        'manual_rent_bank_income',
        'manual_rental_bank_income',
        'annual_manual_rent_bank_income',
        'annual_manual_rental_bank_income'
    ], 'annual');

    const itrRentMonthly = entrySums.itrRentMonthly || getFirstPositiveValue(esr, [
        'itr_rent_income',
        'itr_rental_income',
        'annual_itr_rent_income',
        'annual_itr_rental_income'
    ], 'annual');

    let consideredRent = 0;
    let rentSource = 'NONE';
    let rentRawMonthly = 0;

    if (manualRentBankMonthly > 0) {
        rentRawMonthly = manualRentBankMonthly;
        consideredRent = manualRentBankMonthly * 0.70;
        rentSource = 'MANUAL_RENT_BANK_70_PERCENT';
    } else if (itrRentMonthly > 0) {
        rentRawMonthly = itrRentMonthly;
        consideredRent = itrRentMonthly * 0.70;
        rentSource = 'ITR_RENT_70_PERCENT';
    }

    const totalConsideredIncome = consideredSalary + consideredAgriculture + consideredRent;

    return {
        total_eligible_income: totalConsideredIncome,
        primary_income: consideredSalary,
        rental_bank: consideredRent,
        rental_cash: 0,
        agri_income: consideredAgriculture,
        other_income: 0,
        salary_gross_monthly: grossSalaryMonthly,
        salary_allowed_pct: 70,
        salary_source: grossSalaryFromSnapshot > 0 ? 'ESR_SALARY_SNAPSHOT' : (entrySums.manualSalaryMonthly > 0 ? 'MANUAL_SALARY_FALLBACK' : 'NONE'),
        agriculture_raw_monthly: agricultureRawMonthly,
        agriculture_source: agricultureSource,
        agriculture_allowed_pct: agricultureAllowedPct,
        rent_raw_monthly: rentRawMonthly,
        rent_source: rentSource,
        rent_cash_excluded_monthly: entrySums.excludedRentCashMonthly || 0,
        breakdown: [
            ...(grossSalaryMonthly > 0 ? [{
                type: 'Salary Income',
                raw_monthly: grossSalaryMonthly,
                allowed_pct: 70,
                eligible_monthly: consideredSalary,
                source: grossSalaryFromSnapshot > 0 ? 'ESR salary snapshot' : 'Manual salary fallback',
                rule: 'ICICI Salaried method: salary income considered at 70%; manual salary used only if OCR/API/bank salary is missing'
            }] : []),
            ...(consideredAgriculture > 0 ? [{
                type: 'Agriculture Income',
                raw_monthly: agricultureRawMonthly,
                allowed_pct: agricultureAllowedPct,
                eligible_monthly: consideredAgriculture,
                source: agricultureSource,
                rule: agricultureAllowedPct === 100
                    ? 'Agriculture income considered at 100% because ITR/ownership proof is available'
                    : 'Manual agriculture income considered at 50%'
            }] : []),
            ...(consideredRent > 0 ? [{
                type: 'Rental Income — Bank/ITR',
                raw_monthly: rentRawMonthly,
                allowed_pct: 70,
                eligible_monthly: consideredRent,
                source: rentSource,
                rule: 'Only bank-credit/ITR rent is auto-counted at 70%; cash/unverified rent is excluded'
            }] : []),
            ...((entrySums.excludedRentCashMonthly || 0) > 0 ? [{
                type: 'Rental Income — Cash / Unverified',
                raw_monthly: entrySums.excludedRentCashMonthly,
                allowed_pct: 0,
                eligible_monthly: 0,
                source: 'MANUAL_REVIEW',
                rule: 'ICICI policy marks rental cash as No/manual review; excluded from auto eligibility'
            }] : [])
        ]
    };
}


function calculateHdfcSalariedConsideredIncome({ esr, paramMap = {} }) {
    const grossSalaryMonthly = getFirstPositiveValue(esr, [
        'salaried_income',
        'salary_income',
        'monthly_salary_income',
        'net_monthly_salary',
        'applicant_salary_income'
    ], 'monthly');

    const bankNetSalaryMonthly = getFirstPositiveValue(esr, [
        'bank_net_salary',
        'bank_salary_income',
        'net_salary_as_per_bank',
        'salaried_bank_income'
    ], 'monthly');

    const hdfcPolicy = LENDER_POLICY_REGISTRY.HDFC.salaried;
    const thresholdMonthly = getNumericParam(paramMap, ['hdfc_salaried_salary_threshold'], hdfcPolicy.thresholdMonthly);
    const pctUpToThresholdRaw = getNumericParam(paramMap, ['hdfc_salaried_salary_pct_upto_1lakh'], hdfcPolicy.pctUpToThreshold);
    const pctAboveThresholdRaw = getNumericParam(paramMap, ['hdfc_salaried_salary_pct_above_1lakh'], hdfcPolicy.pctAboveThreshold);
    const netSalaryCapPctRaw = getNumericParam(paramMap, ['hdfc_salaried_bank_salary_cap_pct'], hdfcPolicy.netSalaryCapPct);

    const pctUpToThreshold = pctUpToThresholdRaw > 1 ? pctUpToThresholdRaw / 100 : pctUpToThresholdRaw;
    const pctAboveThreshold = pctAboveThresholdRaw > 1 ? pctAboveThresholdRaw / 100 : pctAboveThresholdRaw;
    const netSalaryCapPct = netSalaryCapPctRaw > 1 ? netSalaryCapPctRaw / 100 : netSalaryCapPctRaw;

    const allowedPct = grossSalaryMonthly > thresholdMonthly ? pctAboveThreshold : pctUpToThreshold;

    const policyWeightedSalary = grossSalaryMonthly * allowedPct;
    const bankSalaryCap = bankNetSalaryMonthly > 0 ? bankNetSalaryMonthly * netSalaryCapPct : null;

    const consideredSalary = bankSalaryCap !== null ? Math.min(policyWeightedSalary, bankSalaryCap) : policyWeightedSalary;

    const incentiveMonthly = getFirstPositiveValue(esr, [
        'salaried_incentive_income',
        'average_monthly_incentive',
        'incentive_3m_average',
        'salary_incentive_income'
    ], 'monthly');

    const annualBonusMonthly = getFirstPositiveValue(esr, [
        'salaried_annual_bonus',
        'annual_bonus',
        'latest_year_bonus',
        'bonus_income_annual'
    ], 'annual');

    const totalConsideredSalaryIncome = consideredSalary + incentiveMonthly + annualBonusMonthly;

    return {
        total_eligible_income: totalConsideredSalaryIncome,
        primary_income: totalConsideredSalaryIncome,
        rental_bank: 0,
        rental_cash: 0,
        agri_income: 0,
        other_income: 0,
        salary_gross_monthly: grossSalaryMonthly,
        salary_allowed_pct: allowedPct * 100,
        bank_net_salary_monthly: bankNetSalaryMonthly,
        bank_salary_cap: bankSalaryCap,
        incentive_monthly: incentiveMonthly,
        annual_bonus_monthly: annualBonusMonthly,
        breakdown: [
            {
                type: 'Salary Income',
                raw_monthly: grossSalaryMonthly,
                allowed_pct: allowedPct * 100,
                eligible_monthly_before_cap: policyWeightedSalary,
                bank_net_salary_monthly: bankNetSalaryMonthly,
                bank_salary_cap: bankSalaryCap,
                eligible_monthly: consideredSalary,
                rule: 'HDFC Salaried: 50% up to ₹1L, 60% above ₹1L, capped by 70% of bank net salary when available. This is treated as EMI capacity basis and FOIR is not applied again.'
            },
            ...(incentiveMonthly > 0 ? [{
                type: 'Incentive Income',
                raw_monthly: incentiveMonthly,
                allowed_pct: 100,
                eligible_monthly: incentiveMonthly,
                rule: 'HDFC Salaried: 3-month average incentive can be considered.'
            }] : []),
            ...(annualBonusMonthly > 0 ? [{
                type: 'Annual Bonus',
                raw_monthly: annualBonusMonthly,
                allowed_pct: 100,
                eligible_monthly: annualBonusMonthly,
                rule: 'HDFC Salaried: latest-year annual bonus considered as monthly equivalent when reported/vetted.'
            }] : [])
        ]
    };
}

// ------ LTV RESOLVER ------
// ------ LTV RESOLVER ------
function resolveApplicableLtvKey(productType, propertyType, occupancyType, candidateLoanAmount) {
    const pType = (productType || '').toLowerCase();

    if (pType === 'hl') {
        // HL Logic
        const loanAmt = Number(candidateLoanAmount) || 0;
        if (loanAmt > 0) {
            if (loanAmt <= 3000000) return 'hl_ltv_upto_30';
            if (loanAmt > 3000000 && loanAmt <= 7500000) return 'hl_ltv_30_75';
            if (loanAmt > 7500000) return 'hl_ltv_above_75';
        }
        const propLower = (propertyType || '').toLowerCase();
        if (propLower.includes('commercial')) return 'hl_ltv_commercial';
        if (propLower.includes('industrial')) return 'hl_ltv_industrial';
        if (propLower.includes('plot')) return 'hl_ltv_plot';
        if (propLower.includes('residential')) return 'hl_ltv_residential';
        return 'hl_ltv_other';
    }

    if (pType === 'lap') {
        // LAP Logic
        const propLower = (propertyType || '').toLowerCase();
        const occLower = (occupancyType || '').toLowerCase();

        let prop = 'special';
        if (propLower.includes('commercial')) prop = 'com';
        else if (propLower.includes('residential')) prop = 'res';
        else if (propLower.includes('industrial')) prop = 'ind';
        else if (propLower.includes('plot')) prop = 'plot';
        else if (propLower.includes('mixed')) prop = 'mix';

        if (prop === 'special') return 'lap_ltv_special';

        let occ = 'vacant';
        if (occLower.includes('rented')) occ = 'rented';
        else if (occLower.includes('self') || occLower.includes('owner')) occ = 'self';

        return `lap_ltv_${prop}_${occ}`;
    }

    return null;
}

// ------ FOIR PARSER ------
function parseDynamicFoir(valString, monthlyIncome) {
    const res = parseFoirRuleSafe(valString);
    if (!res.ok || res.value === null) return res;

    // Handle structured slab arrays
    if (Array.isArray(res.value)) {
        for (const slab of res.value) {
            if (slab.income_min !== undefined && monthlyIncome < slab.income_min) continue;
            if (slab.income_max !== undefined && monthlyIncome > slab.income_max) continue;
            return { ok: true, value: slab.value, warning: res.warning, error: null };
        }
        // Fallback if slab doesn't match
        return { ok: false, value: null, warning: null, error: "Income does not match FOIR slabs." };
    }

    return res;
}


// ------ INCOME SOURCING (STRICT ISOLATION BY SCHEME NAME) ------
function getSchemePrimaryIncome(esr, scheme, paramMap, warnings, logger, lenderPolicy = LENDER_POLICY_REGISTRY.DEFAULT) {
    const name = String(scheme.scheme_name || '').toUpperCase();

    const failMissing = (methodName, missingParam) => {
        warnings.push(`[ESR INCOME] ${methodName} calculation failed (Missing: ${missingParam}). Scheme requires method-specific data and will not fallback.`);
        return 0; // Return 0 so FOIR fails, marking it ineligible/manual review
    };

    if (name.includes('SALARIED')) {
        const baseSalary = Number(esr.salaried_income) || 0;
        if (baseSalary === 0) {
            return failMissing('Salaried', 'NO_VALID_SALARIED_INCOME_SOURCE');
        }
        if (lenderPolicy.key === 'HDFC') {
            return calculateHdfcSalariedConsideredIncome({ esr, paramMap }).total_eligible_income;
        }
        if (lenderPolicy.key === 'ICICI') {
            return calculateIciciSalariedConsideredIncome({ esr, incomeEntries: [] }).total_eligible_income;
        }
        return baseSalary;
    }
    if (name.includes('BANKING') || name.includes('ABB')) {
        const banking = resolveBankingAbbIncome({ esr, paramMap, lenderPolicy });

        logger?.traceExtraction?.('BANKING POLICY', {
            'Lender Policy': lenderPolicy.displayName,
            'Selected Policy': banking.basis,
            'Bank Avg Balance / ABB': banking.abb,
            'ABB Divisor': banking.divisor,
            'Loan Reference': banking.loanReference,
            'Threshold': banking.threshold,
            'Formula': 'Monthly Income Used = ABB / divisor',
            'Calculated Banking Income': banking.monthlyIncome
        });

        if (banking.monthlyIncome > 0) return banking.monthlyIncome;
        return failMissing('Banking', 'STRICT_ABB_DAILY_BALANCE');
    }
    if (name.includes('GST')) {
        // ICICI policy: GST income = Average Monthly Sales from Monthly Sales&Purchase
        // × mapped industry margin. No default 10% fallback.
        const turnover = Number(esr.gst_avg_monthly_sales) || 0;
        const margin = resolveGstIndustryMargin({ esr, paramMap, lenderPolicy });

        logger?.traceExtraction?.('GST SCHEME MARGIN RESOLUTION', {
            'Lender Policy': lenderPolicy.displayName,
            'Resolved Category': esr.gst_industry_type || 'Unknown/DB',
            'Final Margin Used': margin > 0 ? `${(margin * 100).toFixed(2)}%` : 'N/A',
            'Margin Source': margin > 0 ? 'lender-specific GST/manual industry mapping' : 'MISSING — manual review',
            'Formula': 'Monthly Income Used = GST Avg Monthly Sales × Industry Margin',
            'GST Avg Monthly Sales': turnover
        });

        if (turnover <= 0) return failMissing('GST', 'gst_avg_monthly_sales_from_Monthly_Sales_Purchase');
        if (margin <= 0) return failMissing('GST', 'valid GST industry margin / manual industry type');
        return turnover * margin;
    }
    if (name.includes('NET PROFIT') || name.includes('NPM')) {
        if (lenderPolicy.key === 'HDFC') {
            const hdfcNpm = resolveHdfcNpmAnnualIncome({ esr, paramMap, depreciationFraction: null, includeDirectorInterest: false });
            logger?.traceExtraction?.('HDFC NET PROFIT METHOD (NPM) CALCULATION', {
                'Latest Annual Income': `₹${hdfcNpm.latestAnnual.toLocaleString()}`,
                'Previous Annual Income': hdfcNpm.previousAnnual > 0 ? `₹${hdfcNpm.previousAnnual.toLocaleString()}` : 'N/A',
                'Growth Rate': hdfcNpm.growthRate !== null ? `${(hdfcNpm.growthRate * 100).toFixed(2)}%` : 'N/A',
                'Growth Threshold': `${(hdfcNpm.growthThreshold * 100).toFixed(2)}%`,
                'Use 2Y Average': hdfcNpm.useTwoYearAverage,
                'Depreciation Fraction': `${(hdfcNpm.depreciationFraction * 100).toFixed(2)}%`,
                'Monthly NPM Income': `₹${hdfcNpm.monthlyIncome.toLocaleString()}`,
                'Rule': 'HDFC LAP NPM: PAT + 100% depreciation + interest on loan + director remuneration; if growth > 100%, use 2-year average else latest year.'
            });
            if (hdfcNpm.monthlyIncome > 0) return hdfcNpm.monthlyIncome;
            return failMissing('Net Profit', 'HDFC ITR Data');
        }

        const pat = Number(esr.itr_pat) || 0;
        const depr = Number(esr.itr_depreciation) || 0;
        const financeCost = Number(esr.itr_finance_cost) || 0;
        const remuneration = Number(esr.itr_remuneration) || 0;
        const dirInterest = Number(esr.director_interest_on_loan) || 0;

        const rawDeprFraction = paramMap['npm_depreciation_fraction'];
        const deprFractionRes = parsePercentSafe(rawDeprFraction);
        const deprFraction = (deprFractionRes.ok && deprFractionRes.value !== null) ? deprFractionRes.value : (2 / 3);

        const depreciationAddback = depr * deprFraction;

        const calcVal = (pat + depreciationAddback + financeCost + remuneration + dirInterest) / 12;

        logger?.traceExtraction?.('NET PROFIT METHOD (NPM) CALCULATION', {
            'PAT': `₹${pat.toLocaleString()}`,
            'Depreciation': `₹${depr.toLocaleString()}`,
            'Depreciation Fraction': `${(deprFraction * 100).toFixed(2)}%`,
            'Depreciation Addback': `₹${depreciationAddback.toLocaleString()}`,
            'Finance Cost': `₹${financeCost.toLocaleString()}`,
            'Remuneration': `₹${remuneration.toLocaleString()}`,
            'Director Interest': `₹${dirInterest.toLocaleString()}`,
            'Monthly NPM Income': `₹${calcVal.toLocaleString()}`
        });

        // Even if PAT is negative, if the total is positive, it can be valid. 
        if (calcVal > 0 || pat !== 0 || depr !== 0) {
            return Math.max(0, calcVal);
        }
        return failMissing('Net Profit', 'ITR Data');
    }
    if (name.includes('GRP') || name.includes('GROSS RECEIPT')) {
        const grossReceipts = Number(esr.itr_gross_receipts) || 0;

        // Add ambiguity warning for GRP
        warnings.push(`[ESR INCOME] GRP Method multiplier ambiguity: Ensure 'grp_annual_receipts_multiplier' is properly configured.`);

        const rawGrpMult = paramMap['grp_annual_receipts_multiplier'] || paramMap['grp_industry_margin'];

        // User requested: Do not parse as percent. Parse it as a numeric multiplier: 4 means 4x.
        const parsedMult = parseFloat(rawGrpMult);
        let grpMultiplier = Number.isFinite(parsedMult) ? parsedMult : 4.0; // fallback to 4x if missing/invalid

        // Return 0 for primary income to bypass FOIR, we will calculate loan eligibility directly later
        return 0;
    }
    if (name.includes('NET WORTH') || name.includes('NWM')) {
        // NWM logic is handled directly inside evaluateDynamicSchemeEligibility
        return 0;
    }
    return Number(esr.selected_monthly_income) || 0;
}

// ------ OPTIONAL INCOME COMPOSITION ENGINE ------
function calculateComposedIncome({ scheme, esr, incomeEntries, paramMap, warnings = [], logger, lenderPolicy = LENDER_POLICY_REGISTRY.DEFAULT }) {
    const methodNameForComposition = String(scheme.scheme_name || '').toUpperCase();

    if (methodNameForComposition.includes('SALARIED')) {
        const salariedComposition = lenderPolicy.key === 'HDFC'
            ? calculateHdfcSalariedConsideredIncome({ esr, paramMap })
            : lenderPolicy.key === 'ICICI'
                ? calculateIciciSalariedConsideredIncome({ esr, incomeEntries })
                : {
                    total_eligible_income: Number(esr.salaried_income) || 0,
                    primary_income: Number(esr.salaried_income) || 0,
                    rental_bank: 0,
                    rental_cash: 0,
                    agri_income: 0,
                    other_income: 0,
                    breakdown: [{
                        type: 'Salary Income',
                        raw_monthly: Number(esr.salaried_income) || 0,
                        allowed_pct: 100,
                        eligible_monthly: Number(esr.salaried_income) || 0,
                        rule: 'Generic salaried income rule'
                    }]
                };

        logger?.traceExtraction?.(`${lenderPolicy.key} SALARIED POLICY-WEIGHTED INCOME`, {
            'Lender Policy': lenderPolicy.displayName,
            'Gross Salary Monthly': salariedComposition.salary_gross_monthly,
            'Salary Allowed %': salariedComposition.salary_allowed_pct ? `${salariedComposition.salary_allowed_pct}%` : 'N/A',
            'Considered Salary': salariedComposition.primary_income,
            'Agriculture Source': salariedComposition.agriculture_source || 'N/A',
            'Considered Agriculture': salariedComposition.agri_income || 0,
            'Rent Source': salariedComposition.rent_source || 'N/A',
            'Considered Rent': salariedComposition.rental_bank || 0,
            'Total Considered Income': salariedComposition.total_eligible_income
        });

        return salariedComposition;
    }

    if (lenderPolicy.key === 'HDFC') {
        return calculateHdfcComposedIncome({ scheme, esr, incomeEntries, paramMap, warnings, logger, lenderPolicy });
    }

    const primaryIncome = getSchemePrimaryIncome(esr, scheme, paramMap, warnings, logger, lenderPolicy);

    const getBoolParam = (key, defaultVal = false) => {
        const raw = paramMap[key];
        if (raw === undefined || raw === null) return defaultVal;
        const str = String(raw).toLowerCase().trim();
        return str.includes('yes') || str === 'true' || raw === true;
    };

    const getPercentParam = (key, defaultVal = 0) => {
        const raw = paramMap[key];
        if (raw === undefined || raw === null) return defaultVal;
        const str = String(raw).trim();
        const match = str.match(/(\d+(\.\d+)?)%/);
        if (match) return parseFloat(match[1]) / 100;
        const num = Number(raw);
        return Number.isFinite(num) ? (num > 1 ? num / 100 : num) : defaultVal;
    };

    const methodName = String(scheme.scheme_name || '').toUpperCase();
    const otherIncomeAllowedByPolicy = methodName.includes('SALARIED') || methodName.includes('NET PROFIT') || methodName.includes('NPM');

    const eligRentalBank = otherIncomeAllowedByPolicy && getBoolParam('elig_rental_bank', true);
    const dbrRentalBank = getPercentParam('dbr_rental_bank', 0.70);
    const eligRentalCash = otherIncomeAllowedByPolicy && lenderPolicy.key !== 'ICICI' && getBoolParam('elig_rental_cash', false);
    const dbrRentalCash = getPercentParam('dbr_rental_cash', 0.50);
    const eligAgriItr = otherIncomeAllowedByPolicy && getBoolParam('elig_agri_itr', true);
    const dbrAgriItr = getPercentParam('dbr_agri_itr', 0.50);

    let rentalIncomeBank = 0;
    let rentalIncomeCash = 0;
    let agriIncome = 0;
    let otherIncome = 0;

    const breakdownItems = [];

    if (Array.isArray(incomeEntries) && incomeEntries.length > 0) {
        for (const entry of incomeEntries) {
            const type = normalizeManualIncomeType(entry);
            const monthly = normalizeManualEntryMonthlyAmount(entry);
            if (monthly <= 0) continue;

            const docType = normalizeManualIncomeDocText(entry);
            const isIcici = lenderPolicy.key === 'ICICI';
            const isBankCredit = docType.includes('bank') || docType.includes('credit') || type.includes('bank');
            const isCashOrUnverifiedRent = type.includes('cash') || (!isBankCredit && isIcici);

            if (type.includes('rent') || type.includes('rental')) {
                if (isBankCredit) {
                    if (eligRentalBank) {
                        const amt = monthly * dbrRentalBank;
                        rentalIncomeBank += amt;
                        breakdownItems.push({
                            type: 'Rental Income (Bank Credit)',
                            raw_monthly: monthly,
                            allowed_pct: dbrRentalBank * 100,
                            eligible_monthly: amt
                        });
                    }
                } else {
                    if (eligRentalCash && !isCashOrUnverifiedRent) {
                        const amt = monthly * dbrRentalCash;
                        rentalIncomeCash += amt;
                        breakdownItems.push({
                            type: 'Rental Income (Cash)',
                            raw_monthly: monthly,
                            allowed_pct: dbrRentalCash * 100,
                            eligible_monthly: amt
                        });
                    } else {
                        breakdownItems.push({
                            type: 'Rental Income (Cash / Unverified)',
                            raw_monthly: monthly,
                            allowed_pct: 0,
                            eligible_monthly: 0,
                            rule: isIcici
                                ? 'ICICI policy: rental cash/unverified rent is No/manual review and excluded from auto eligibility'
                                : 'Rental cash not enabled in lender policy'
                        });
                    }
                }
            } else if (type.includes('agri') || type.includes('agriculture')) {
                if (eligAgriItr) {
                    const proofText = `${type} ${docType}`;
                    const ownershipProof = hasOwnershipProofText(proofText);
                    const allowedPct = ownershipProof ? 1.00 : dbrAgriItr;
                    const amt = monthly * allowedPct;
                    agriIncome += amt;
                    breakdownItems.push({
                        type: 'Agricultural Income',
                        raw_monthly: monthly,
                        allowed_pct: allowedPct * 100,
                        eligible_monthly: amt,
                        rule: ownershipProof ? '100% because ownership/land proof is available' : '50% as per ICICI policy'
                    });
                }
            } else {
                // Strict whitelisting of approved other income types to prevent OCR/manual leakage.
                // Partner/director remuneration can be used as an NPM addback only if ITR remuneration was not captured.
                const isNpm = methodName.includes('NET PROFIT') || methodName.includes('NPM');
                const isManualRemuneration = type.includes('partner') || type.includes('director') || type.includes('remuneration');
                const itrRemunerationAlreadyCaptured = Number(esr.itr_remuneration) > 0;

                if (isNpm && isManualRemuneration && !itrRemunerationAlreadyCaptured) {
                    otherIncome += monthly;
                    breakdownItems.push({
                        type: `Manual Remuneration Addback (${entry.income_type})`,
                        raw_monthly: monthly,
                        allowed_pct: 100,
                        eligible_monthly: monthly,
                        rule: 'Used only because ITR remuneration field is missing/zero'
                    });
                    continue;
                }

                const allowedOtherIncomeTypes = ['pension', 'professional', 'interest', 'dividend', 'royalty', 'commission'];
                const isWhitelisted = otherIncomeAllowedByPolicy && allowedOtherIncomeTypes.some(t => type.includes(t));
                if (isWhitelisted) {
                    otherIncome += monthly;
                    breakdownItems.push({
                        type: `Other Income (${entry.income_type})`,
                        raw_monthly: monthly,
                        allowed_pct: 100,
                        eligible_monthly: monthly
                    });
                } else {
                    console.log(`[ESR INCOME] Ignored non-whitelisted or policy-disallowed other income type: "${entry.income_type}" for ${scheme.scheme_name}`);
                }
            }
        }
    }

    const totalEligibleIncome = primaryIncome + rentalIncomeBank + rentalIncomeCash + agriIncome + otherIncome;

    return {
        total_eligible_income: totalEligibleIncome,
        primary_income: primaryIncome,
        rental_bank: rentalIncomeBank,
        rental_cash: rentalIncomeCash,
        agri_income: agriIncome,
        other_income: otherIncome,
        breakdown: breakdownItems
    };
}

// ------ OBLIGATION EXCLUSIONS PARSER & CALCULATOR ------
function parseObligationExclusionMonths(ruleString) {
    if (!ruleString) return 0;
    const str = String(ruleString).toLowerCase();
    const match = str.match(/closed in next (\d+) months/);
    return match ? parseInt(match[1], 10) : 0;
}

function calculateNetObligations(obligationsList, rawObligationRule, warnings, policyWarnings, obligationExclusionNotes, lenderPolicy = LENDER_POLICY_REGISTRY.DEFAULT) {
    let netObligations = 0;
    const excludedObligations = [];
    const activeObligations = [];
    let hdfcUnsecuredPosDeduction = 0;
    const hdfcPosDeductionEntries = [];

    const ruleStr = String(rawObligationRule || '').toLowerCase();
    const noObligation = ruleStr.includes('no need to obligate');
    const availedInLastMatch = ruleStr.match(/availed in last (\d+)/);
    const availedInLastMonths = availedInLastMatch ? parseInt(availedInLastMatch[1], 10) : 0;

    const exclusionMonths = parseObligationExclusionMonths(rawObligationRule);

    if (noObligation) {
        obligationExclusionNotes.push(`All obligations excluded per rule: "${rawObligationRule}"`);
        return { net_obligations: 0, excluded: obligationsList || [], active: [] };
    }

    if (Array.isArray(obligationsList)) {
        for (const obl of obligationsList) {
            const emi = Number(obl.emi_per_month) || 0;
            if (emi <= 0) continue;

            if (obl.include_in_foir === false) {
                excludedObligations.push(obl);
                obligationExclusionNotes.push(`Excluded EMI ₹${emi.toLocaleString()} (${obl.lender_name || 'Lender'} - ${obl.loan_type || 'Loan'}) because include_in_foir=false.`);
                continue;
            }

            if (lenderPolicy.key === 'HDFC' && isHdfcUnsecuredObligation(obl)) {
                const outstanding = toSafeNumber(obl.outstanding_amount);
                hdfcUnsecuredPosDeduction += outstanding;
                hdfcPosDeductionEntries.push({ ...obl, pos_deduction: outstanding });
                excludedObligations.push(obl);
                const note = `HDFC unsecured obligation treatment: EMI ₹${emi.toLocaleString()} excluded from FOIR and POS/outstanding ₹${outstanding.toLocaleString()} will be deducted from final eligible loan amount.`;
                obligationExclusionNotes.push(note);
                warnings.push(note);
                continue;
            }

            if (availedInLastMonths > 0) {
                const dateStr = obl.disbursement_date || obl.opened_date || obl.loan_start_date || obl.created_at;
                if (!dateStr) {
                    warnings.push(`BANKING_OBLIGATION_DATE_MISSING: Missing date for loan ${obl.loan_type}. Safely counting obligation.`);
                    netObligations += emi;
                    activeObligations.push(obl);
                    continue;
                }

                const loanDate = new Date(dateStr);
                const monthsSince = (new Date().getTime() - loanDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

                if (monthsSince > availedInLastMonths) {
                    excludedObligations.push(obl);
                    const note = `Excluded EMI ₹${emi.toLocaleString()} (${obl.lender_name || 'Lender'} - ${obl.loan_type || 'Loan'}) because it was availed > ${availedInLastMonths} months ago.`;
                    obligationExclusionNotes.push(note);
                    continue;
                }
            }

            const typeLower = (obl.loan_type || '').toLowerCase();
            const isOdCc = typeLower.includes('od') || typeLower.includes('cc') || typeLower.includes('overdraft') || typeLower.includes('cash credit') || typeLower.includes('working capital');

            // Explicit remaining tenure takes priority if available, otherwise check OD/CC, else fallback to derived
            let remainingMonths = Number(obl.remaining_tenure_months);
            if (isNaN(remainingMonths) || remainingMonths === null) {
                if (isOdCc) {
                    remainingMonths = 999; // Never exclude OD/CC/Working Capital lines
                } else {
                    const outstanding = Number(obl.outstanding_amount) || 0;
                    remainingMonths = emi > 0 ? (outstanding / emi) : 999;
                }
            }

            if (exclusionMonths > 0 && remainingMonths > 0 && remainingMonths < exclusionMonths) {
                excludedObligations.push(obl);
                const note = `Excluded EMI ₹${emi.toLocaleString()} (${obl.lender_name || 'Lender'} - ${obl.loan_type || 'Loan'}) because it closes in ${remainingMonths.toFixed(1)} months (< ${exclusionMonths} months threshold).`;
                obligationExclusionNotes.push(note);
                warnings.push(note);
                policyWarnings.push(note);
            } else {
                netObligations += emi;
                activeObligations.push(obl);
            }
        }
    }

    return {
        net_obligations: netObligations,
        excluded: excludedObligations,
        active: activeObligations,
        hdfc_unsecured_pos_deduction: hdfcUnsecuredPosDeduction,
        hdfc_pos_deduction_entries: hdfcPosDeductionEntries
    };
}

// ------ AGE-BASED TENURE RESTRICTION ------
function calculateAgeBasedTenureLimit(applicants, paramMap, warnings, policyWarnings) {
    const getIntParam = (key, defaultVal = null) => {
        const raw = paramMap[key];
        if (raw === undefined || raw === null) return defaultVal;
        const num = Number(raw);
        return Number.isFinite(num) ? num : defaultVal;
    };

    const ageMaturityIncome = getIntParam('age_maturity_income', 60);
    const ageMaturityNonIncome = getIntParam('age_maturity_non_income', 75);

    let lowestLimitMonths = Infinity;

    if (Array.isArray(applicants)) {
        for (const app of applicants) {
            let appAge = Number(app.age);
            if (isNaN(appAge) || appAge <= 0) {
                if (app.bureau_checks && app.bureau_checks.length > 0) {
                    const check = app.bureau_checks[0];
                    if (check.raw_response) {
                        try {
                            const rawBureau = typeof check.raw_response === 'string' ? JSON.parse(check.raw_response) : check.raw_response;
                            const ageVal = rawBureau?.verifiedData?.ResponseData?.data?.age;
                            if (ageVal) appAge = Number(ageVal);
                        } catch { }
                    }
                }
            }
            if (isNaN(appAge) || appAge <= 0) continue;

            // Primary applicants and employed applicants with standard employment types are income considered.
            // Non-working co-applicants / guarantors (NA employment type) are non-income considered.
            const isIncomeConsidered = app.is_primary || (app.employment_type && app.employment_type !== 'NA');
            const limitAge = isIncomeConsidered ? ageMaturityIncome : ageMaturityNonIncome;

            if (limitAge) {
                const allowedMonths = Math.max(0, (limitAge - appAge) * 12);
                if (allowedMonths < lowestLimitMonths) {
                    lowestLimitMonths = allowedMonths;
                }
                if (allowedMonths <= 0) {
                    const warn = `Applicant age ${appAge} exceeds maturity age limit of ${limitAge} for ${app.is_primary ? 'Primary' : 'Co-applicant'}.`;
                    warnings.push(warn);
                    policyWarnings.push(warn);
                }
            }
        }
    }

    return lowestLimitMonths === Infinity ? null : lowestLimitMonths;
}

// ------ FINANCIAL MATH HELPERS ------
function calculateEMI(principal, annualRoi, tenureMonths) {
    const normRoi = normalizeRoi(annualRoi);
    if (!principal || !normRoi || tenureMonths <= 0) return 0;
    const R = normRoi / 12;
    const N = tenureMonths;
    const emi = (principal * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
    return Number.isFinite(emi) ? Math.round(emi) : 0;
}

function calculateMaxLoanAmount(eligibleEmi, annualRoi, tenureMonths) {
    const normRoi = normalizeRoi(annualRoi);
    if (eligibleEmi <= 0 || !normRoi || tenureMonths <= 0) return 0;
    const R = normRoi / 12;
    const N = tenureMonths;
    if (R === 0) return eligibleEmi * N;
    const P = (eligibleEmi * (Math.pow(1 + R, N) - 1)) / (R * Math.pow(1 + R, N));
    return Number.isFinite(P) ? Math.round(P) : 0;
}


// ------ CONDITIONAL UNDERWRITING RELAXATIONS ------
function applyConditionalUnderwritingRelaxations(evaluation, conditionalFlags, paramMap) {
    if (!conditionalFlags) return;

    // Extensible program branching (e.g. Double Wammy special program handling)
    if (conditionalFlags.special_program === 'double_wammy') {
        evaluation.surrogate_program_notes += " [Conditional Program: Double Wammy Policy Relaxations Enabled]";
        // Future extensions can relax LTV caps, ROI rates, or minimum loan rules here dynamically.
    }
}


// ------ EVALUATE SCHEME ------
function evaluateDynamicSchemeEligibility({ esr, scheme, product, lender, lowest_cibil_score, incomeEntries, applicants, obligationsList, logger }) {
    console.log(`\n[ESR ENGINE] Evaluating Scheme: ${scheme.scheme_name} | Lender: ${lender.name} | Product: ${product.product_type}`);
    const paramMap = getParamMap(scheme.parameter_values);
    const lenderPolicy = resolveLenderPolicy(lender);
    console.log(`[ESR ENGINE] Parsed Parameter Map:`, JSON.stringify(paramMap, null, 2));
    console.log(`[ESR ENGINE] Lender Policy: ${lenderPolicy.displayName}`);

    // Start scheme trace block
    logger?.startSchemeTrace(lender.name, scheme.scheme_name);
    logger?.traceStep('PARAMETER MAP', Object.keys(paramMap).map(k => `${k}: ${paramMap[k]}`).join('\n'));
    logger?.traceStep('LENDER POLICY', `${lenderPolicy.key} — ${lenderPolicy.displayName}`);

    const pType = (esr.product_type || '').toLowerCase();

    let isEligible = true;
    const failure_reasons = [];
    const warnings = [];
    const policyWarnings = [];
    const obligationExclusionNotes = [];

    const schemeIncomeMethod = normalizeIncomeMethod(scheme.scheme_name);
    const caseIncomeMethod = normalizeIncomeMethod(esr.selected_income_method);
    const isSalariedMethod =
        String(schemeIncomeMethod || '').toUpperCase() === 'SALARIED';
    const isNoDoubleFoirSalariedMethod =
        isSalariedMethod && lenderPolicy.salariedEmiCapacityRule === 'INCOME_MINUS_OBLIGATIONS';
    let income_method_matched = true;

    if (caseIncomeMethod && schemeIncomeMethod) {
        if (schemeIncomeMethod !== caseIncomeMethod) {
            income_method_matched = false;
            logger?.traceStep('INFO', `Scheme method ${schemeIncomeMethod} differs from selected case method ${caseIncomeMethod}; evaluated for comparison.`);
        }
    }

    const pref = pType === 'hl' ? 'hl' : 'lap';

    // Generic parsing evaluator helper
    const handleParseResult = (res, paramKey) => {
        if (!res.ok) {
            if (isCriticalParameter(paramKey)) {
                isEligible = false;
                failure_reasons.push(`Invalid lender configuration for ${paramKey}: ${res.error}`);
            } else {
                warnings.push(`Invalid configuration ignored for ${paramKey}: ${res.error}`);
            }
        } else if (res.warning) {
            warnings.push(`Parser warning for ${paramKey}: ${res.warning}`);
        }

        if (res.ok && res.value === null && isCriticalParameter(paramKey)) {
            if (!(paramKey.includes('_max_loan'))) {
                isEligible = false;
                failure_reasons.push(`Missing required lender configuration for ${paramKey}`);
            }
        }

        return res.value === 'NO_CAP' ? null : res.value;
    };

    // A. Bureau Cutoff
    const bureauRes = getParamInteger(paramMap, 'bureau_cutoff');
    const bureauCutoff = handleParseResult(bureauRes, 'bureau_cutoff');
    logger?.traceParser('parseIntegerSafe', 'bureau_cutoff', bureauRes.raw, bureauRes);

    const effectiveCibil = (lowest_cibil_score !== undefined && lowest_cibil_score !== null)
        ? lowest_cibil_score
        : esr.bureau_score;

    if (bureauCutoff !== null) {
        if (!effectiveCibil || effectiveCibil < bureauCutoff) {
            isEligible = false;
            failure_reasons.push(effectiveCibil
                ? `Lowest CIBIL score ${effectiveCibil} is below bureau cutoff ${bureauCutoff}`
                : "Bureau score missing.");
            logger?.traceFailure('CIBIL_REJECT', effectiveCibil
                ? `Lowest CIBIL ${effectiveCibil} < Bureau Cutoff ${bureauCutoff}`
                : 'Bureau score missing');
        } else {
            logger?.traceStep('BUREAU CHECK', `PASS — Effective CIBIL ${effectiveCibil} >= Cutoff ${bureauCutoff}`);
        }
    } else if (effectiveCibil === null && isEligible) {
        warnings.push("Bureau score missing, but no cutoff defined.");
        logger?.traceWarning('Bureau score missing but no cutoff configured');
    } else {
        logger?.traceStep('BUREAU CHECK', `No bureau cutoff configured — Effective CIBIL: ${effectiveCibil ?? 'N/A'}`);
    }

    // B & C. Min / Max Loan Limits
    const minLoanRes = getParamNumber(paramMap, `${pref}_min_loan`);
    const minLoan = handleParseResult(minLoanRes, `${pref}_min_loan`);

    const maxLoanRes = getParamNumber(paramMap, `${pref}_max_loan`);
    const maxLoan = handleParseResult(maxLoanRes, `${pref}_max_loan`);

    // 1. Compose eligible income (Rental, agricultural, and other incomes are strictly optional)
    const isNwmMethod = (scheme.scheme_name || '').toUpperCase().includes('NET WORTH') || (scheme.scheme_name || '').toUpperCase().includes('NWM');
    const isGrpMethod = (scheme.scheme_name || '').toUpperCase().includes('GRP') || (scheme.scheme_name || '').toUpperCase().includes('GROSS RECEIPT');
    const isDscrMethod = (scheme.scheme_name || '').toUpperCase().includes('DSCR');
    const isManualOnlyMethod = /\b(LIP|LOW\s+LTV|MANUAL)\b/i.test(scheme.scheme_name || '');

    if (isManualOnlyMethod && !(Number(esr.manual_eligible_loan_amount) > 0)) {
        logger?.traceStep('MANUAL / POLICY METHOD', `${scheme.scheme_name} requires manual/deviation underwriting. Auto FOIR/DSCR calculation skipped; common policy/LTV parameters remain seeded for UI/audit.`);
        return {
            lender_id: lender?.id || scheme.lender_id,
            lender_name: lender?.name || esr.lender_name,
            lender_policy_key: lenderPolicy.key,
            lender_policy_name: lenderPolicy.displayName,
            scheme_id: scheme.id,
            scheme_name: scheme.scheme_name,
            income_method_matched,
            status: 'MANUAL_REVIEW',
            is_eligible: false,
            final_eligible_loan_amount: 0,
            eligible_loan_amount: 0,
            monthly_income_used: 0,
            failure_reasons: [`${scheme.scheme_name} is a manual/deviation method. Enter manual eligible loan amount to evaluate/send.`],
            warnings: ['Manual method skipped from auto eligibility.'],
            manual_review_required: true,
            ineligibility_reason: `${scheme.scheme_name} requires manual override.`
        };
    }

    let dscrBreakdown = null;
    let composedIncome = 0;
    let incomeComposition = { breakdown: [], primary_income: 0, total_eligible_income: 0 };

    if (isNwmMethod) {
        // NWM Config Gate
        const nwmActive = paramMap['nwm_active'] === true || String(paramMap['nwm_active']).toLowerCase() === 'true' || String(paramMap['nwm_active']).toLowerCase() === 'yes';
        if (!nwmActive) {
            return {
                lender_id: scheme.lender_id,
                lender_name: esr.lender_name,
                scheme_id: scheme.id,
                scheme_name: scheme.scheme_name,
                income_method_matched,
                status: 'NOT_APPLICABLE',
                is_eligible: false,
                monthly_income_used: 0,
                failure_reasons: ["NWM inactive per ICICI policy / ignored for current phase"],
                ineligibility_reason: "NWM inactive per ICICI policy / ignored for current phase"
            };
        }

        const nwmDepFractionRaw = lenderPolicy.key === 'HDFC'
            ? getNumericParam(paramMap, ['nwm_depreciation_fraction'], LENDER_POLICY_REGISTRY.HDFC.nwm.defaultDepreciationFraction)
            : 2 / 3;
        const nwmDepFraction = nwmDepFractionRaw > 1 ? nwmDepFractionRaw / 100 : nwmDepFractionRaw;
        const hdfcNwmIncome = resolveHdfcNpmAnnualIncome({
            esr,
            paramMap,
            depreciationFraction: nwmDepFraction,
            includeDirectorInterest: lenderPolicy.key === 'HDFC'
        });
        const npmMonthlyIncome = hdfcNwmIncome.monthlyIncome;

        const propertyValue = Number(esr.property_value) || 0;
        const propertyAddonPctRaw = lenderPolicy.key === 'HDFC'
            ? getNumericParam(paramMap, ['nwm_property_addon_annual_pct'], LENDER_POLICY_REGISTRY.HDFC.nwm.defaultPropertyAddonAnnualPct)
            : 0.03;
        const propertyAddonPct = propertyAddonPctRaw > 1 ? propertyAddonPctRaw / 100 : propertyAddonPctRaw;
        const propertyIncomeMonthly = (propertyValue * propertyAddonPct) / 12;

        const financialAssetsValue = Number(esr.shares_mf_fd_value) || Number(esr.financial_assets_value) || Number(esr.liquid_assets_value) || Number(esr.net_worth_liquid_assets) || 0;
        const financialAssetPctRaw = lenderPolicy.key === 'HDFC'
            ? getNumericParam(paramMap, ['nwm_financial_asset_annual_pct'], LENDER_POLICY_REGISTRY.HDFC.nwm.defaultFinancialAssetAnnualPct)
            : 0.05;
        const financialAssetPct = financialAssetPctRaw > 1 ? financialAssetPctRaw / 100 : financialAssetPctRaw;
        const financialAssetIncomeMonthly = (financialAssetsValue * financialAssetPct) / 12;

        const nwmManualAdditions = lenderPolicy.key === 'HDFC'
            ? calculateHdfcManualIncomeAdditions({ incomeEntries, methodName: scheme.scheme_name, primaryIncome: npmMonthlyIncome })
            : { rental_bank: 0, agri_income: 0, breakdown: [] };
        const eligibleRentalMonthly = nwmManualAdditions.rental_bank || 0;
        const eligibleAgriMonthly = 0;

        composedIncome = npmMonthlyIncome + propertyIncomeMonthly + financialAssetIncomeMonthly + eligibleRentalMonthly + eligibleAgriMonthly;
        incomeComposition = {
            primary_income: npmMonthlyIncome,
            total_eligible_income: composedIncome,
            breakdown: [
                { source: 'NPM Component', amount: npmMonthlyIncome, rule: lenderPolicy.key === 'HDFC' ? 'HDFC NWM: PAT + 2/3 Dep + interest + remuneration + director interest' : 'NPM component' },
                { source: 'Property Add-on', amount: propertyIncomeMonthly, rule: `${(propertyAddonPct * 100).toFixed(2)}% of property value / 12` },
                { source: 'Financial Asset Add-on', amount: financialAssetIncomeMonthly, rule: `${(financialAssetPct * 100).toFixed(2)}% of Shares/MF/FD / 12` },
                { source: 'Eligible Rental Bank/ITR', amount: eligibleRentalMonthly, rule: 'HDFC NWM: 100% rental bank/ITR capped to 100% of main business profit' },
                ...nwmManualAdditions.breakdown
            ]
        };

        logger?.traceStep('NWM INCOME BUILD-UP', [
            `NPM Monthly Income:           ₹${npmMonthlyIncome.toLocaleString()}`,
            `Property Value Add-on @${(propertyAddonPct * 100).toFixed(2)}%/12: ₹${propertyIncomeMonthly.toLocaleString()}`,
            `Financial Asset Add-on @${(financialAssetPct * 100).toFixed(2)}%/12: ₹${financialAssetIncomeMonthly.toLocaleString()}`,
            `Eligible Rental Bank/ITR @100% capped: ₹${eligibleRentalMonthly.toLocaleString()}`,
            `Total NWM Monthly Income:     ₹${composedIncome.toLocaleString()}`,
        ].join('\n'));

        // Customer Selection Gate
        const cibil = effectiveCibil || 0;
        let customerSelectionPass = false;
        let requiredIncome = 0;
        const nwmCibilHigh = getNumericParam(paramMap, ['nwm_cibil_high'], 770);
        const nwmIncomeHighCibil = getNumericParam(paramMap, ['nwm_income_high_cibil'], 150000);
        const nwmCibilStandard = getNumericParam(paramMap, ['nwm_cibil_standard'], 750);
        const nwmIncomeStandardCibil = getNumericParam(paramMap, ['nwm_income_standard_cibil'], 300000);
        if (cibil >= nwmCibilHigh && composedIncome >= nwmIncomeHighCibil) {
            customerSelectionPass = true;
            requiredIncome = nwmIncomeHighCibil;
        } else if (cibil >= nwmCibilStandard && composedIncome >= nwmIncomeStandardCibil) {
            customerSelectionPass = true;
            requiredIncome = nwmIncomeStandardCibil;
        } else {
            requiredIncome = cibil >= nwmCibilHigh ? nwmIncomeHighCibil : nwmIncomeStandardCibil;
        }

        logger?.traceStep('NWM CUSTOMER SELECTION', [
            `CIBIL:              ${cibil}`,
            `Required threshold: ₹${requiredIncome.toLocaleString()}`,
            `Actual NWM income:  ₹${composedIncome.toLocaleString()}`,
            `Result:             ${customerSelectionPass ? 'PASS' : 'FAIL'}`,
            ...(customerSelectionPass ? [] : ['Reason:             NWM_CUSTOMER_SELECTION_FAILED'])
        ].join('\n'));

        if (!customerSelectionPass) {
            isEligible = false;
            failure_reasons.push("NWM_CUSTOMER_SELECTION_FAILED");
            logger?.traceFailure('INCOME_REJECT', `NWM Customer Selection failed (CIBIL ${cibil}, Income ₹${composedIncome.toLocaleString()})`);
        }
    } else if (isDscrMethod) {
        const dscrIncome = resolveDscrAnnualIncome({ esr, paramMap, logger, lenderPolicy });
        composedIncome = dscrIncome.monthlyIncome;
        incomeComposition = {
            primary_income: composedIncome,
            total_eligible_income: composedIncome,
            breakdown: [{
                type: 'DSCR Annual Income',
                source: dscrIncome.source,
                annual_income: dscrIncome.annualIncome,
                monthly_equivalent: composedIncome,
                components: dscrIncome.components || null,
                rule: 'DSCR uses annual income against annual obligations and proposed annual EMI.'
            }]
        };
        if (lenderPolicy.key === 'HDFC') {
            const hdfcManualAdditions = calculateHdfcManualIncomeAdditions({ incomeEntries, methodName: scheme.scheme_name, primaryIncome: composedIncome });
            if (hdfcManualAdditions.total_eligible_manual_income > 0 || hdfcManualAdditions.breakdown.length > 0) {
                composedIncome += hdfcManualAdditions.total_eligible_manual_income;
                incomeComposition.total_eligible_income = composedIncome;
                incomeComposition.breakdown.push(...hdfcManualAdditions.breakdown);
                dscrIncome.annualIncome += (hdfcManualAdditions.total_eligible_manual_income * 12);
            }
        }
        dscrBreakdown = {
            ...(dscrBreakdown || {}),
            incomeSource: dscrIncome.source,
            annualIncome: dscrIncome.annualIncome,
            monthlyEquivalentIncome: composedIncome,
            components: dscrIncome.components || null
        };
        logger?.traceStep('DSCR INCOME BUILD-UP', [
            `Income Source:       ${dscrIncome.source}`,
            `Annual Income:       ₹${dscrIncome.annualIncome.toLocaleString()}`,
            `Monthly Equivalent:  ₹${composedIncome.toLocaleString()}`,
            lenderPolicy.key === 'HDFC' ? 'HDFC rental bank/ITR add-on, if any, is included at 100% and capped to main business profit.' : ''
        ].filter(Boolean).join('\n'));
    } else {
        incomeComposition = calculateComposedIncome({ scheme, esr, incomeEntries, paramMap, warnings, logger, lenderPolicy });
        composedIncome = incomeComposition.total_eligible_income;

        logger?.traceStep('STEP 1-2 — INCOME COMPOSITION', [
            `Primary Income:       ₹${(incomeComposition.primary_income || 0).toLocaleString()}`,
            `Rental (Bank):        ₹${(incomeComposition.rental_bank || 0).toLocaleString()}`,
            `Agri Income:          ₹${(incomeComposition.agri_income || 0).toLocaleString()}`,
            `Other Income:         ₹${(incomeComposition.other_income || 0).toLocaleString()}`,
            `Total Eligible:       ₹${composedIncome.toLocaleString()}`,
            `Breakdown:            ${JSON.stringify(incomeComposition.breakdown || {})}`,
        ].join('\n'));
    }

    if (composedIncome <= 0 && !isGrpMethod && !isNwmMethod) {
        isEligible = false;
        failure_reasons.push("Composed eligible income is 0 or missing.");
        logger?.traceFailure('INCOME_REJECT', 'Composed eligible income is zero or missing');
    }

    // 2. Resolve Allowed FOIR limit
    const rawFoir = paramMap[`${pref}_dbr_foir`];
    const foirRes = parseDynamicFoir(rawFoir, composedIncome);
    const foir_allowed_percent_value = handleParseResult(foirRes, `${pref}_dbr_foir`);
    logger?.traceParser('parseDynamicFoir', `${pref}_dbr_foir`, rawFoir, foirRes);

    let foir_allowed_percent = null;
    let conditionalFlags = null;
    let skip_foir_check = false;

    // GRP and DSCR bypass FOIR percentage checks.
    // DSCR has its own ratio formula: Annual Income / Annual Debt Service.
    if (isGrpMethod || isDscrMethod) {
        skip_foir_check = true;
    }

    if (foir_allowed_percent_value !== null) {
        if (typeof foir_allowed_percent_value === 'object' && foir_allowed_percent_value.type === 'conditional_foir') {
            const isDoubleWhammy = esr.double_whammy_flag === true;
            if (isDoubleWhammy) {
                foir_allowed_percent = foir_allowed_percent_value.special_limit / 100;
                warnings.push(`Double Whammy activated — FOIR limit set to ${foir_allowed_percent_value.special_limit}%.`);
            } else {
                foir_allowed_percent = foir_allowed_percent_value.base_limit / 100;
            }
            conditionalFlags = foir_allowed_percent_value;
        } else if (typeof foir_allowed_percent_value === 'object' && foir_allowed_percent_value.type === 'no_dbr') {
            skip_foir_check = true;
            warnings.push("No DBR policy configured. FOIR validation skipped.");
        } else {
            foir_allowed_percent = foir_allowed_percent_value;
        }
    }

    logger?.traceStep('STEP 3 — FOIR RESOLUTION', [
        `Raw FOIR Param:       "${rawFoir ?? 'N/A'}"`,
        `FOIR Allowed %:       ${foir_allowed_percent !== null ? (foir_allowed_percent * 100).toFixed(2) + '%' : 'N/A'}`,
        `Skip FOIR Check:      ${skip_foir_check}`,
        `Conditional Flags:    ${conditionalFlags ? JSON.stringify(conditionalFlags) : 'None'}`,
    ].join('\n'));

    // GUARD: FOIR must be resolvable (unless No DBR)
    if (!skip_foir_check && foir_allowed_percent === null) {
        isEligible = false;
        failure_reasons.push(`FOIR/DBR not configured or could not be resolved for this scheme.`);
        logger?.traceFailure('CONFIG_MISSING', `FOIR = null and skip_foir_check = false — cannot underwrite`);
    }

    // 3. Resolve Net Obligations with dynamic exclusions
    const rawObligationRule = paramMap['existing_obligation'];
    const netObligationsResult = calculateNetObligations(obligationsList, rawObligationRule, warnings, policyWarnings, obligationExclusionNotes, lenderPolicy);
    let netObligations = netObligationsResult.net_obligations;
    const dscrObligationsForCapacity = isDscrMethod
        ? calculateDscrMonthlyObligations(obligationsList)
        : netObligations;

    logger?.traceStep('STEP 4 — NET OBLIGATIONS', [
        `Obligation Rule:      "${rawObligationRule ?? 'N/A'}"`,
        `Total Obligations:    ${obligationsList.length}`,
        `Excluded:             ${(netObligationsResult.excluded || []).map(o => `${o.lender_name || 'Unknown'} ${o.loan_type || ''} EMI:₹${(o.emi_per_month || 0).toLocaleString()}`).join('; ') || 'None'}`,
        `Net Obligations EMI:  ₹${netObligations.toLocaleString()}`,
    ].join('\n'));


    // HDFC Banking policy: "EMI of such loan can be added to ABB".
    // When configured, add active obligation EMI to ABB, recompute ABB/divisor income,
    // and do not deduct the same EMI again in EMI capacity.
    const isBankingMethod = String(scheme.scheme_name || '').toUpperCase().includes('BANKING')
        || String(scheme.scheme_name || '').toUpperCase().includes('ABB');
    const addEmiToAbb = lenderPolicy.key === 'HDFC'
        && isBankingMethod
        && `${rawObligationRule || ''} ${paramMap['banking_obligation_treatment'] || ''}`.toUpperCase().includes('ADD_EMI_TO_ABB');

    if (addEmiToAbb) {
        const addToAbbAmount = (netObligationsResult.active || []).reduce((sum, obl) => sum + (Number(obl.emi_per_month) || 0), 0);
        const originalAbb = toSafeNumber(esr.bank_avg_balance);
        const adjustedEsr = { ...esr, bank_avg_balance: originalAbb + addToAbbAmount };
        const adjustedBanking = resolveBankingAbbIncome({ esr: adjustedEsr, paramMap, lenderPolicy });

        composedIncome = adjustedBanking.monthlyIncome;
        incomeComposition = {
            primary_income: composedIncome,
            total_eligible_income: composedIncome,
            banking_original_abb: originalAbb,
            banking_obligation_added_to_abb: addToAbbAmount,
            banking_adjusted_abb: adjustedBanking.abb,
            banking_divisor: adjustedBanking.divisor,
            breakdown: [{
                type: 'HDFC Banking Obligation Add-back',
                raw_abb: originalAbb,
                obligation_added_to_abb: addToAbbAmount,
                adjusted_abb: adjustedBanking.abb,
                divisor: adjustedBanking.divisor,
                eligible_monthly: adjustedBanking.monthlyIncome,
                rule: 'HDFC Banking: add eligible EMI to ABB, divide by 3/4, and do not deduct the same EMI again.'
            }]
        };
        netObligations = 0;
        obligationExclusionNotes.push(`HDFC Banking ADD_EMI_TO_ABB applied: added EMI ₹${addToAbbAmount.toLocaleString()} to ABB and set net obligations to ₹0 for this method.`);
        logger?.traceFormula(
            'STEP 4B — HDFC BANKING OBLIGATION ADD-BACK',
            '(ABB + eligible EMI obligations) / divisor; obligations not deducted again',
            `(₹${originalAbb.toLocaleString()} + ₹${addToAbbAmount.toLocaleString()}) / ${adjustedBanking.divisor}`,
            `₹${composedIncome.toLocaleString()}`
        );
    }

    // 4. Resolve final tenure used (Lender max tenure vs age-based restrictions)
    const maxTenureRes = getParamTenure(paramMap, `${pref}_max_tenure`);
    const maxTenureMonths = handleParseResult(maxTenureRes, `${pref}_max_tenure`);
    logger?.traceParser('parseTenureSafe', `${pref}_max_tenure`, maxTenureRes.raw, maxTenureRes);
    const ageBasedLimit = calculateAgeBasedTenureLimit(applicants, paramMap, warnings, policyWarnings);

    let final_tenure_used = maxTenureMonths || 0;
    if (ageBasedLimit !== null && ageBasedLimit !== Infinity) {
        final_tenure_used = Math.min(final_tenure_used, ageBasedLimit);
    }

    logger?.traceStep('STEP 5 — TENURE RESOLUTION', [
        `Lender Max Tenure:    ${maxTenureMonths ?? 'N/A'} months`,
        `Age-Based Limit:      ${ageBasedLimit !== null && ageBasedLimit !== Infinity ? ageBasedLimit + ' months' : 'No restriction'}`,
        `Final Tenure Used:    ${final_tenure_used} months`,
    ].join('\n'));

    // 5. Resolve underwriting ROI (roi_max preferred, fallback to roi_min)
    const roiMinRes = getParamPercent(paramMap, `${pref}_roi_min`);
    const roi_min = handleParseResult(roiMinRes, `${pref}_roi_min`);
    logger?.traceParser('parsePercentSafe', `${pref}_roi_min`, roiMinRes.raw, roiMinRes);

    const roiMaxRes = getParamPercent(paramMap, `${pref}_roi_max`);
    const roi_max = handleParseResult(roiMaxRes, `${pref}_roi_max`);
    logger?.traceParser('parsePercentSafe', `${pref}_roi_max`, roiMaxRes.raw, roiMaxRes);

    const underwriting_roi_used = roi_max || roi_min || 0;

    logger?.traceStep('STEP 6 — ROI RESOLUTION', [
        `ROI Min:              ${toDisplayRoi(roi_min) ?? 'N/A'}%`,
        `ROI Max:              ${toDisplayRoi(roi_max) ?? 'N/A'}%`,
        `Underwriting ROI:     ${toDisplayRoi(underwriting_roi_used)}% (roi_max preferred)`,
    ].join('\n'));

    // GUARD: ROI must be > 0 for any meaningful loan calculation
    if (underwriting_roi_used <= 0) {
        isEligible = false;
        failure_reasons.push(`No valid ROI configured for this scheme. Cannot calculate loan eligibility.`);
        logger?.traceFailure('CONFIG_MISSING', `ROI = 0 — scheme cannot be underwritten`);
    }

    // GUARD: Tenure must be > 0
    if (final_tenure_used <= 0) {
        isEligible = false;
        failure_reasons.push(`No valid tenure configured for this scheme. Cannot calculate loan eligibility.`);
        logger?.traceFailure('CONFIG_MISSING', `Tenure = 0 months — scheme cannot be underwritten`);
    }

    const pfMinRes = getParamPercent(paramMap, `${pref}_pf_min`);
    const pf_min = handleParseResult(pfMinRes, `${pref}_pf_min`);

    const pfMaxRes = getParamPercent(paramMap, `${pref}_pf_max`);
    const pf_max = handleParseResult(pfMaxRes, `${pref}_pf_max`);

    // 6. Calculate Maximum Eligible EMI
    let maximum_eligible_emi = 0;
    if (isNoDoubleFoirSalariedMethod && composedIncome > 0) {
        // Lender-specific salaried method where income has already been policy-weighted
        // Salary 70%, Agri 50%/100%, Rent 70%. Do NOT apply FOIR again.
        maximum_eligible_emi = Math.max(0, composedIncome - netObligations);
        logger?.traceFormula(
            'STEP 7 — ELIGIBLE EMI CAPACITY',
            'Considered Income − Obligations',
            `₹${composedIncome.toLocaleString()} − ₹${netObligations.toLocaleString()}`,
            `₹${maximum_eligible_emi.toLocaleString()}`
        );
    } else if (!skip_foir_check && foir_allowed_percent !== null && composedIncome > 0) {
        maximum_eligible_emi = Math.max(0, (composedIncome * foir_allowed_percent) - netObligations);
        logger?.traceFormula(
            'STEP 7 — ELIGIBLE EMI CAPACITY',
            '(FOIR% × Income) − Obligations',
            `(${(foir_allowed_percent * 100).toFixed(1)}% × ₹${composedIncome.toLocaleString()}) − ₹${netObligations.toLocaleString()}`,
            `₹${maximum_eligible_emi.toLocaleString()}`
        );
    } else if (isDscrMethod && composedIncome > 0) {
        const annualIncome = dscrBreakdown?.annualIncome || (composedIncome * 12);
        const dscrCapacity = calculateDscrCapacity({ annualIncome, netObligations: dscrObligationsForCapacity, paramMap, lenderPolicy });
        dscrBreakdown = { ...(dscrBreakdown || {}), ...dscrCapacity, dscrMonthlyObligationsUsed: dscrObligationsForCapacity };
        if (dscrObligationsForCapacity !== netObligations) {
            logger?.traceStep('DSCR OBLIGATION OVERRIDE', `HDFC DSCR uses all included obligations for annual debt service: ₹${dscrObligationsForCapacity.toLocaleString()}/month × ${dscrCapacity.obligationMultiplier || 12}, instead of FOIR net obligations ₹${netObligations.toLocaleString()}.`);
        }
        maximum_eligible_emi = Math.max(0, dscrCapacity.maxProposedMonthlyEmi);
        logger?.traceFormula(
            'STEP 7 — DSCR EMI CAPACITY',
            'Max Proposed Annual EMI = (Annual Income / DSCR Min Ratio) − Existing Annual Obligations',
            `(₹${annualIncome.toLocaleString()} / ${dscrCapacity.minRatio}) − ₹${dscrCapacity.existingAnnualObligations.toLocaleString()}`,
            `Annual EMI ₹${dscrCapacity.maxProposedAnnualEmi.toLocaleString()} | Monthly EMI ₹${maximum_eligible_emi.toLocaleString()}`
        );
    } else if (skip_foir_check && composedIncome > 0) {
        // No DBR means do not apply FOIR %, but still calculate EMI capacity.
        // EMI capacity = method monthly income - net obligations.
        // Loan amount will be reverse-calculated using ROI and lender max tenure.
        maximum_eligible_emi = Math.max(0, composedIncome - netObligations);
        logger?.traceFormula(
            'STEP 7 — ELIGIBLE EMI CAPACITY (No DBR)',
            'Income − Obligations',
            `₹${composedIncome.toLocaleString()} − ₹${netObligations.toLocaleString()}`,
            `₹${maximum_eligible_emi.toLocaleString()}`
        );
    } else if (skip_foir_check) {
        maximum_eligible_emi = 0;
        logger?.traceWarning('STEP 7 — NO DBR EMI CAPACITY: Could not calculate because income is missing/zero');
    } else {
        logger?.traceWarning('STEP 7 — ELIGIBLE EMI CAPACITY: Could not calculate (missing FOIR% or income)');
    }

    // 7. Calculate FOIR-based Maximum Eligible Loan Amount (or Method-based direct loan amount)
    let foir_based_eligible_loan_amount = 0;

    if (isGrpMethod) {
        const grossReceipts = Number(esr.itr_gross_receipts) || 0;
        const grpResolution = resolveGrpMultiplierForPolicy({ esr, paramMap, lenderPolicy });
        const grpMultiplier = grpResolution.multiplier;

        const exposure = resolveExposureForLender(esr, lenderPolicy, obligationsList);

        foir_based_eligible_loan_amount = Math.max(0, (grossReceipts * grpMultiplier) - exposure.amount);

        logger?.traceFormula(
            'STEP 8 — GRP DIRECT LOAN ELIGIBILITY',
            `(Gross Receipts × Multiplier) − ${lenderPolicy.key} Exposure`,
            `(₹${grossReceipts.toLocaleString()} × ${grpMultiplier}) − ₹${exposure.amount.toLocaleString()}${exposure.sourceField ? ' [' + exposure.sourceField + ']' : ''}`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()} | Multiplier Source: ${grpResolution.source}`
        );
        isEligible = foir_based_eligible_loan_amount > 0;
        if (!isEligible) {
            failure_reasons.push("GRP eligibility is 0 (Gross receipts * Multiplier <= Exposure).");
        }
    } else if (isDscrMethod && maximum_eligible_emi > 0 && underwriting_roi_used > 0 && final_tenure_used > 0) {
        foir_based_eligible_loan_amount = calculateMaxLoanAmount(maximum_eligible_emi, underwriting_roi_used, final_tenure_used);
        logger?.traceFormula(
            'STEP 8 — DSCR LOAN ELIGIBILITY',
            'Reverse EMI using DSCR-derived EMI capacity, ROI and Max Tenure',
            `DSCR EMI=₹${maximum_eligible_emi.toLocaleString()} | ROI=${toDisplayRoi(underwriting_roi_used)}% | Max Tenure=${final_tenure_used}m`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()}`
        );
    } else if (skip_foir_check && maximum_eligible_emi > 0 && underwriting_roi_used > 0 && final_tenure_used > 0) {
        // No DBR must use reverse EMI with lender max tenure.
        // Do NOT use fixed 60-month multiplier.
        foir_based_eligible_loan_amount = calculateMaxLoanAmount(maximum_eligible_emi, underwriting_roi_used, final_tenure_used);
        logger?.traceFormula(
            'STEP 8 — FOIR-BASED LOAN ELIGIBILITY (No DBR)',
            'Reverse EMI: EMI, ROI, Max Tenure → Loan Amount',
            `EMI=₹${maximum_eligible_emi.toLocaleString()} | ROI=${toDisplayRoi(underwriting_roi_used)}% | Max Tenure=${final_tenure_used}m`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()}`
        );
    } else if (skip_foir_check) {
        logger?.traceWarning('STEP 8 — NO DBR LOAN: Could not calculate (zero EMI capacity, ROI or tenure)');
    } else if (maximum_eligible_emi > 0 && underwriting_roi_used > 0 && final_tenure_used > 0) {
        foir_based_eligible_loan_amount = calculateMaxLoanAmount(maximum_eligible_emi, underwriting_roi_used, final_tenure_used);
        logger?.traceFormula(
            'STEP 8 — FOIR-BASED LOAN ELIGIBILITY',
            'Reverse EMI: EMI, ROI, Tenure → Loan Amount',
            `EMI=₹${maximum_eligible_emi.toLocaleString()} | ROI=${toDisplayRoi(underwriting_roi_used)}% | Tenure=${final_tenure_used}m`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()}`
        );
    } else {
        logger?.traceWarning('STEP 8 — FOIR-BASED LOAN: Could not calculate (zero EMI capacity, ROI or tenure)');
    }

    // 8. Resolve LTV and Max Loan by LTV based on estimated capacity before LTV cap
    const temp_loan_amt = foir_based_eligible_loan_amount || 0;
    const applicable_ltv_key = resolveApplicableLtvKey(esr.product_type, esr.property_type, esr.occupancy_type, temp_loan_amt);

    let applicable_ltv_percent = null;
    if (applicable_ltv_key) {
        const ltvRes = getParamPercent(paramMap, applicable_ltv_key);
        applicable_ltv_percent = handleParseResult(ltvRes, applicable_ltv_key);
        logger?.traceParser('parsePercentSafe', applicable_ltv_key, ltvRes.raw, ltvRes);
    }

    let ltv_based_eligible_loan_amount = null;
    if (applicable_ltv_percent !== null && esr.property_value) {
        ltv_based_eligible_loan_amount = Math.round(esr.property_value * applicable_ltv_percent);
    } else if (esr.product_type === 'HL' && esr.property_value) {
        // Task 4: HL Slab LTV if no explicit key override
        const propLower = (esr.property_type || '').toLowerCase();
        let hl_ltv = 0.75; // default fallback for HL

        if (propLower.includes('residential')) {
            if (temp_loan_amt <= 3000000) hl_ltv = 0.90;
            else if (temp_loan_amt <= 7500000) hl_ltv = 0.80;
            else hl_ltv = 0.75;
        } else if (propLower.includes('commercial')) {
            hl_ltv = lenderPolicy.key === 'HDFC' ? 0.70 : 0.75;
        } else if (propLower.includes('industrial')) {
            hl_ltv = lenderPolicy.key === 'HDFC' ? 0.60 : 0.40;
        } else if (propLower.includes('plot')) {
            hl_ltv = 0.75;
        }

        applicable_ltv_percent = hl_ltv;
        ltv_based_eligible_loan_amount = Math.round(esr.property_value * applicable_ltv_percent);
        logger?.traceStep('STEP 8B — HL SLAB LTV', `Applied dynamic HL LTV ${applicable_ltv_percent * 100}% for property type '${esr.property_type}' based on estimated loan capacity ₹${temp_loan_amt.toLocaleString()}`);
    }

    logger?.traceStep('STEP 9 — LTV EVALUATION', [
        `Property Value:       ${esr.property_value ? '₹' + esr.property_value.toLocaleString() : 'N/A'}`,
        `Property Type:        ${esr.property_type || 'N/A'}`,
        `Occupancy:            ${esr.occupancy_type || 'N/A'}`,
        `LTV Param Key:        ${applicable_ltv_key || 'N/A'}`,
        `LTV %:                ${applicable_ltv_percent !== null ? (applicable_ltv_percent * 100).toFixed(0) + '%' : 'N/A'}`,
        `LTV Eligible Loan:    ${ltv_based_eligible_loan_amount !== null ? '₹' + ltv_based_eligible_loan_amount.toLocaleString() : 'N/A'}`,
    ].join('\n'));

    // --- NWM Cap: NET WORTH × LOAN% ---
    let nwm_cap = null;
    if ((scheme.scheme_name || '').toUpperCase().includes('NET WORTH') ||
        (scheme.scheme_name || '').toUpperCase().includes('NWM')) {
        const netWorth = Number(esr.net_worth) || 0;
        const rawNwmPct = paramMap['nwm_loan_percent'];
        const nwmPctRes = parsePercentSafe(rawNwmPct);
        const nwmPct = (nwmPctRes.ok && nwmPctRes.value !== null) ? nwmPctRes.value : 0.15;

        if (netWorth > 0) {
            nwm_cap = Math.round(netWorth * nwmPct);
            logger?.traceFormula(
                'STEP 9B — NWM CAP',
                'Net Worth × Loan%',
                `₹${netWorth.toLocaleString()} × ${(nwmPct * 100).toFixed(0)}%`,
                `₹${nwm_cap.toLocaleString()}`
            );
        } else {
            warnings.push('Net Worth not provided — NWM cap cannot be applied. Eligibility is FOIR/LTV-limited only.');
        }
    }

    // 9. Calculate final eligibility — safe candidate-based MIN (avoids 0/null collapsing the result)
    // FOIR-based: null means No DBR (uncapped), 0 means calculation failed
    // LTV-based: null means no property or no LTV configured
    // maxLoan: null means no lender cap
    const requested_loan = Number(esr.requested_loan_amount) || null;

    const bankingBusinessCreditCap = getBankingBusinessCreditCap(esr, paramMap, lenderPolicy, isBankingMethod);
    if (bankingBusinessCreditCap !== null) {
        logger?.traceFormula(
            'STEP 9C — HDFC BANKING BUSINESS CREDIT CAP',
            'Final banking eligibility cannot exceed 1× business credit of last 12 months',
            `Business Credit Cap = ₹${bankingBusinessCreditCap.toLocaleString()}`,
            `₹${bankingBusinessCreditCap.toLocaleString()}`
        );
    }

    const eligibilityCandidates = [
        foir_based_eligible_loan_amount,
        ltv_based_eligible_loan_amount,
        maxLoan,
        nwm_cap,
        requested_loan,
        bankingBusinessCreditCap
    ].filter(v => v !== null && v !== undefined && Number.isFinite(v) && v > 0);

    let final_eligible_loan_amount = eligibilityCandidates.length > 0
        ? Math.min(...eligibilityCandidates)
        : 0;

    // Strict constraint: if FOIR was required (not null for No DBR) but resulted in 0 (failed/missing data),
    // then final eligibility MUST be 0. It cannot borrow LTV or requested loan amounts.
    if (foir_based_eligible_loan_amount === 0) {
        final_eligible_loan_amount = 0;
    }

    const hdfcUnsecuredPosDeduction = lenderPolicy.key === 'HDFC'
        ? Math.round(netObligationsResult.hdfc_unsecured_pos_deduction || 0)
        : 0;
    if (hdfcUnsecuredPosDeduction > 0 && final_eligible_loan_amount > 0) {
        const beforePosDeduction = final_eligible_loan_amount;
        final_eligible_loan_amount = Math.max(0, final_eligible_loan_amount - hdfcUnsecuredPosDeduction);
        logger?.traceFormula(
            'STEP 10B — HDFC UNSECURED POS DEDUCTION',
            'Final Eligible Loan − HDFC unsecured POS/outstanding',
            `₹${beforePosDeduction.toLocaleString()} − ₹${hdfcUnsecuredPosDeduction.toLocaleString()}`,
            `₹${final_eligible_loan_amount.toLocaleString()}`
        );
    }

    logger?.traceFormula(
        'STEP 10 — FINAL ELIGIBILITY',
        'MIN of valid candidates: [FOIR Eligibility, LTV Eligibility, Product Max Loan, Requested Loan, NWM Cap]',
        `Candidates: [${[
            foir_based_eligible_loan_amount !== null ? '₹' + foir_based_eligible_loan_amount?.toLocaleString() : 'No Cap (No DBR)',
            ltv_based_eligible_loan_amount !== null ? '₹' + ltv_based_eligible_loan_amount?.toLocaleString() : 'N/A (no property/LTV)',
            maxLoan !== null ? '₹' + maxLoan?.toLocaleString() : 'No Product Cap',
            requested_loan !== null ? '₹' + requested_loan?.toLocaleString() : 'No Requested Cap',
            bankingBusinessCreditCap !== null ? '₹' + bankingBusinessCreditCap?.toLocaleString() + ' HDFC Banking Credit Cap' : 'N/A Banking Credit Cap',
            hdfcUnsecuredPosDeduction > 0 ? 'Less HDFC POS ₹' + hdfcUnsecuredPosDeduction.toLocaleString() : 'No HDFC POS Deduction'
        ].join(', ')}]`,
        `₹${final_eligible_loan_amount.toLocaleString()}`
    );

    // Scheme eligibility checks
    if (minLoan !== null && final_eligible_loan_amount < minLoan) {
        isEligible = false;
        failure_reasons.push(`Maximum eligible loan ₹${final_eligible_loan_amount.toLocaleString()} is below lender minimum ₹${minLoan.toLocaleString()}`);
        logger?.traceFailure('MIN_LOAN_REJECT', `Eligible ₹${final_eligible_loan_amount.toLocaleString()} < Lender Min ₹${minLoan.toLocaleString()}`);
    }

    // Proposed EMI for final eligible amount
    let proposed_emi = 0;
    if (final_eligible_loan_amount > 0 && underwriting_roi_used > 0 && final_tenure_used > 0) {
        proposed_emi = calculateEMI(final_eligible_loan_amount, underwriting_roi_used, final_tenure_used);
    }

    if (isDscrMethod && dscrBreakdown) {
        const finalAnnualDebtService = (dscrObligationsForCapacity + proposed_emi) * (dscrBreakdown.obligationMultiplier || 12);
        const actualDscrRatio = finalAnnualDebtService > 0 ? (dscrBreakdown.annualIncome / finalAnnualDebtService) : null;
        dscrBreakdown = {
            ...dscrBreakdown,
            finalLoanAmountUsed: final_eligible_loan_amount,
            proposedMonthlyEmi: proposed_emi,
            finalAnnualDebtService,
            actualDscrRatio,
            dscrStatus: actualDscrRatio === null ? 'NO_DEBT_SERVICE' : (actualDscrRatio >= dscrBreakdown.minRatio ? 'PASS' : 'FAIL')
        };
        logger?.traceFormula(
            'DSCR ACTUAL',
            'Annual Income / ((Existing Obligations + Proposed EMI) × 12)',
            `₹${dscrBreakdown.annualIncome.toLocaleString()} / ((₹${dscrObligationsForCapacity.toLocaleString()} + ₹${proposed_emi.toLocaleString()}) × ${dscrBreakdown.obligationMultiplier || 12})`,
            actualDscrRatio !== null ? actualDscrRatio.toFixed(2) : 'N/A'
        );
    }

    // Correct Underwriting FOIR Formula: FOIR = (Existing Obligations + Proposed EMI) / Eligible Monthly Income
    let foir_actual_percent = composedIncome > 0 ? ((netObligations + proposed_emi) / composedIncome) : 0;

    let foir_display_string = `${(foir_actual_percent * 100).toFixed(2)}%`;
    if (isDscrMethod) {
        foir_display_string = 'N/A — DSCR method uses DSCR ratio';
    } else if ((scheme.scheme_name || '').toUpperCase().includes('GRP') || (scheme.scheme_name || '').toUpperCase().includes('GROSS RECEIPT')) {
        foir_display_string = 'N/A — GRP direct method / No DBR';
    }

    logger?.traceFormula(
        'FOIR ACTUAL',
        '(Existing Obligations + Proposed EMI) / Eligible Monthly Income',
        `(₹${netObligations.toLocaleString()} + ₹${proposed_emi.toLocaleString()}) / ₹${composedIncome.toLocaleString()}`,
        foir_display_string
    );

    // --- MANUAL OVERRIDE (LIP / LOW LTV / MANUAL SCHEMES) ---
    const manual_eligible_loan_amount = Number(esr.manual_eligible_loan_amount) || null;
    const manual_proposed_emi = Number(esr.manual_proposed_emi) || null;

    if (manual_eligible_loan_amount !== null && manual_eligible_loan_amount > 0) {
        isEligible = true;
        failure_reasons.length = 0; // Clear failures
        warnings.push(`Manual Eligibility Override applied: System calculation bypassed.`);
        final_eligible_loan_amount = manual_eligible_loan_amount;
        if (manual_proposed_emi !== null) proposed_emi = manual_proposed_emi;
        logger?.traceStep('MANUAL OVERRIDE', `Override applied. Loan: ₹${final_eligible_loan_amount}, EMI: ₹${proposed_emi}`);
    } else if (scheme.scheme_name?.toUpperCase().includes('LIP') || scheme.scheme_name?.toUpperCase().includes('LOW LTV') || scheme.scheme_name?.toUpperCase().includes('MANUAL')) {
        // Task 6: Skip LIP/Low LTV if not configured manually
        return {
            lender_id: scheme.lender_id,
            lender_name: esr.lender_name,
            scheme_id: scheme.id,
            scheme_name: scheme.scheme_name,
            income_method_matched,
            status: 'MANUAL_REVIEW',
            ineligibility_reason: "Manual / Low LTV / LIP method requires explicit manual override config. Standard underwriting skipped."
        };
    }

    const finalEvaluation = {
        scheme_id: scheme.id,
        scheme_name: scheme.scheme_name,
        lender_policy_key: lenderPolicy.key,
        lender_policy_name: lenderPolicy.displayName,
        income_method_matched,
        is_eligible: isEligible,
        failure_reasons,
        warnings,
        policy_warnings: policyWarnings,
        applicable_ltv_key,
        applicable_ltv_percent,
        banking_business_credit_cap: bankingBusinessCreditCap,
        hdfc_unsecured_pos_deduction: hdfcUnsecuredPosDeduction,
        hdfc_pos_deduction_entries: netObligationsResult.hdfc_pos_deduction_entries || [],
        max_loan_by_ltv: ltv_based_eligible_loan_amount,
        foir_based_eligible_loan_amount,
        ltv_based_eligible_loan_amount,
        final_eligible_loan_amount,
        eligible_loan_amount: final_eligible_loan_amount, // for backwards compatibility
        dscr_eligible_loan_amount: isDscrMethod ? foir_based_eligible_loan_amount : null,
        dscr_actual_ratio: isDscrMethod && dscrBreakdown ? dscrBreakdown.actualDscrRatio : null,
        dscr_min_ratio: isDscrMethod && dscrBreakdown ? dscrBreakdown.minRatio : null,
        dscr_status: isDscrMethod && dscrBreakdown ? dscrBreakdown.dscrStatus : null,
        proposed_emi,
        maximum_eligible_emi: maximum_eligible_emi === Infinity ? null : maximum_eligible_emi,
        final_tenure_used,
        underwriting_roi_used: toDisplayRoi(underwriting_roi_used),
        roi_min: toDisplayRoi(roi_min),
        roi_max: toDisplayRoi(roi_max),
        pf_min,
        pf_max,
        max_tenure_months: final_tenure_used,
        foir_allowed_percent,
        foir_actual_percent,
        max_eligible_emi: maximum_eligible_emi,
        monthly_income_used: composedIncome,
        primary_monthly_income_used: incomeComposition.primary_income,
        monthly_income_note: isDscrMethod
            ? `${lenderPolicy.key} DSCR: annual income tested against annual obligations and proposed annual EMI.`
            : isGrpMethod
                ? 'GRP is direct eligibility method; FOIR monthly income is not used.'
                : isNoDoubleFoirSalariedMethod
                    ? `${lenderPolicy.key} Salaried: income already policy-weighted; EMI capacity = considered income - obligations.`
                    : `${lenderPolicy.key} scheme-specific composed monthly income used for FOIR/eligibility.`,
        dscr_breakdown: isDscrMethod ? dscrBreakdown : null,
        eligible_income_breakdown: incomeComposition.breakdown,
        weighted_other_income: composedIncome - incomeComposition.primary_income,
        foir_breakdown: {
            skip_foir_check,
            composed_income: composedIncome,
            net_obligations: netObligations,
            proposed_emi: proposed_emi,
            foir_allowed_percent: foir_allowed_percent,
            foir_actual_percent: foir_actual_percent,
            maximum_eligible_emi: maximum_eligible_emi === Infinity ? null : maximum_eligible_emi,
            dscr_breakdown: isDscrMethod ? dscrBreakdown : null
        },
        conditional_underwriting_flags: conditionalFlags,
        manual_review_required: !!conditionalFlags || policyWarnings.length > 0,
        surrogate_program_notes: `Underwriting via surrogate method: ${schemeIncomeMethod || 'Selected Candidate'}`,
        obligation_exclusion_notes: obligationExclusionNotes
    };

    // Apply conditional policy relaxations extensible plug-in
    applyConditionalUnderwritingRelaxations(finalEvaluation, conditionalFlags, paramMap);

    // Final trace — pass/fail decision
    if (isEligible) {
        logger?.traceSuccess(`ELIGIBLE — ₹${final_eligible_loan_amount.toLocaleString()} @ ${toDisplayRoi(underwriting_roi_used)}% ROI for ${final_tenure_used}m`);
    } else {
        failure_reasons.forEach(r => logger?.traceFailure('INELIGIBLE', r));
    }

    console.log(`[ESR ENGINE] Final Evaluation for ${scheme.scheme_name}:`, JSON.stringify(finalEvaluation, null, 2));
    return finalEvaluation;
}


// ------ PRIMARY GENERATOR ROUTINE ------
async function generateDynamicESR(case_id, user_id, tenant_id) {
    // 1. Fetch case_esr_financials natively
    const esr = await prisma.caseEsrFinancials.findFirst({
        where: { case_entity: { id: case_id, tenant_id } },
        include: { case_entity: true }
    });

    if (!esr) {
        throw new Error("ESR financial extraction not found. Run ESR extraction first.");
    }
    if (!esr.product_type) {
        throw new Error("Product type missing in ESR financials.");
    }
    if (!esr.selected_monthly_income || esr.selected_monthly_income <= 0) {
        throw new Error("Selected monthly income missing or invalid.");
    }

    const pType = esr.product_type.toUpperCase();

    // Fetch CaseIncomeEntry and CaseCreditObligation upfront for dynamic composed income and exclusion logic
    const incomeEntries = await prisma.caseIncomeEntry.findMany({
        where: {
            case_id,
            case_entity: { tenant_id }
        }
    });

    const obligationsList = await prisma.caseCreditObligation.findMany({
        where: {
            case_id,
            status: 'ACTIVE',
            case_entity: { tenant_id }
        },
        select: {
            id: true,
            lender_name: true,
            loan_type: true,
            emi_per_month: true,
            outstanding_amount: true,
            loan_start_date: true,
            include_in_foir: true,
            source: true
        }
    });

    // Build normalized audit/print snapshots from the same editable UI rows used for calculation.
    // Earlier logs printed only case_esr_financials, so Manual Income Addition and edited EMIs
    // were missing from the text/JSON audit output.
    const auditManualIncomeEntries = (incomeEntries || []).map(normalizeAuditManualIncomeEntry);
    const auditObligations = (obligationsList || []).map(normalizeAuditObligationEntry);
    const auditPropertySnapshot = buildAuditPropertySnapshot(esr);
    const auditBureauReport = buildAuditBureauReport(esr.bureau_json || esr.raw_bureau_json || null, obligationsList);
    const esrAuditSource = {
        ...esr,
        manual_income_entries: auditManualIncomeEntries,
        manual_obligations: auditObligations.filter(o => String(o.source || '').toUpperCase().includes('MANUAL')),
        editable_obligations: auditObligations,
        property_collateral_snapshot: auditPropertySnapshot,
        bureau_json: auditBureauReport
    };

    // 2. Resolve CIBIL scores (Corrected: moved before lender evaluation)
    // Fetch all applicants with their latest successful bureau checks
    const applicants = await prisma.applicant.findMany({
        where: { case_id },
        include: {
            bureau_checks: {
                where: { status: 'SUCCESS' },
                orderBy: { created_at: 'desc' },
                take: 1
            }
        }
    });

    let primary_cibil = null;
    let scores = [];
    const co_applicant_cibils = [];

    applicants.forEach(app => {
        let appScore = null;
        if (app.bureau_checks.length > 0) {
            appScore = parseInt(app.bureau_checks[0].score);
        }
        if (appScore === null || isNaN(appScore)) {
            appScore = app.cibil_score; // Fallback to applicant field
        }

        if (appScore !== null && !isNaN(appScore)) {
            scores.push(appScore);
            if (app.is_primary) {
                primary_cibil = appScore;
            } else {
                co_applicant_cibils.push({ applicant_id: app.id, score: appScore });
            }
        }
    });

    // Final fallback to case snapshot for primary
    if (primary_cibil === null) {
        primary_cibil = esr.case_entity.cibil_score;
        if (primary_cibil !== null) scores.push(primary_cibil);
    }

    const lowest_cibil = scores.length > 0 ? Math.min(...scores) : primary_cibil;

    console.log(`\n======================================================`);
    console.log(`[ESR ENGINE] Starting Dynamic ESR Calculation`);
    console.log(`[ESR ENGINE] Case ID: ${case_id} | Product Type: ${pType}`);
    console.log(`[ESR ENGINE] CIBIL — Primary: ${primary_cibil}, Lowest: ${lowest_cibil}`);
    console.log(`[ESR ENGINE] Property & Collateral Snapshot:`, JSON.stringify(auditPropertySnapshot, null, 2));
    console.log(`[ESR ENGINE] Manual Income Entries Used:`, JSON.stringify(auditManualIncomeEntries, null, 2));
    console.log(`[ESR ENGINE] Editable Obligations Used:`, JSON.stringify(auditObligations, null, 2));
    console.log(`[ESR ENGINE] Input Payload:`, JSON.stringify(esrAuditSource, null, 2));
    console.log(`======================================================\n`);

    // 3. Fetch Active Lenders (Two-Layer Architecture)
    // Step 3a: Fetch all active platform lenders
    const platformLenders = await prisma.lender.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
    });

    if (platformLenders.length === 0) {
        throw new Error('No platform lenders are active.');
    }

    // Step 3b: Fetch tenant overrides
    const tenantLenders = await prisma.tenantLender.findMany({
        where: { tenant_id, is_active: true }
    });

    const activePlatformLenderIds = [];
    const tenantLenderIdMap = {};

    for (const pl of platformLenders) {
        const override = tenantLenders.find(t => t.platform_lender_id === pl.id);
        if (override) {
            if (override.is_esr_enabled) {
                activePlatformLenderIds.push(pl.id);
                tenantLenderIdMap[pl.id] = override.id;
            }
        } else {
            activePlatformLenderIds.push(pl.id);
        }
    }

    if (activePlatformLenderIds.length === 0) {
        throw new Error('All platform lenders have been disabled for ESR in your configuration.');
    }

    // Step 3c: Fetch platform lender matrix for included IDs
    const lenders = await prisma.lender.findMany({
        where: {
            id: { in: activePlatformLenderIds },
            status: 'ACTIVE'
        },
        include: {
            products: {
                where: { status: 'ACTIVE', product_type: pType },
                include: {
                    schemes: {
                        where: { status: 'ACTIVE' },
                        include: {
                            parameter_values: {
                                include: { parameter: true }
                            }
                        }
                    }
                }
            }
        }
    });

    const lenderResults = [];

    // Initialize ESR Trace Logger
    const logger = new EsrTraceLogger({ enabled: true });
    logger.startTrace(case_id, esr.case_entity?.tenant_id, esr.product_type, {
        'Selected Monthly Income': `₹${(esr.selected_monthly_income || 0).toLocaleString()}`,
        'Property Value': esr.property_value ? `₹${esr.property_value.toLocaleString()}` : 'N/A',
        'Market Value': auditPropertySnapshot.market_value ? `₹${auditPropertySnapshot.market_value.toLocaleString()}` : 'N/A',
        'Property Type': esr.property_type || 'N/A',
        'Occupancy': esr.occupancy_type || 'N/A',
        'Ownership': auditPropertySnapshot.ownership || 'N/A',
        'Product Type': esr.product_type,
        'Income Method': esr.selected_income_method || 'N/A',
        'Primary CIBIL': primary_cibil ?? 'N/A',
        'Lowest CIBIL': lowest_cibil ?? 'N/A',
        'Manual Income Rows': auditManualIncomeEntries.length,
        'Manual Income Annual Total': `₹${auditManualIncomeEntries.reduce((s, o) => s + (o.annual_amount || 0), 0).toLocaleString()}`,
        'Manual Income Monthly Total': `₹${auditManualIncomeEntries.reduce((s, o) => s + (o.monthly_amount || 0), 0).toLocaleString()}`,
        'Total Obligations': auditObligations.length,
        'Total EMI': `₹${auditObligations.reduce((s, o) => s + (o.emi_per_month || 0), 0).toLocaleString()}`,
        'Lenders Evaluated': lenders.length,
    });

    logger.traceStep('PROPERTY & COLLATERAL SNAPSHOT', auditPropertySnapshot);
    logger.traceTable(
        'MANUAL INCOME ADDITION ROWS USED',
        ['Type', 'Annual', 'Monthly', 'Doc', 'Rent Class', 'Auto Included', 'Remarks'],
        auditManualIncomeEntries.map(row => [
            row.income_type,
            row.annual_amount,
            row.monthly_amount,
            row.supporting_doc_type || '',
            row.rent_classification || '',
            row.included_in_icici_auto_calculation ? 'Yes' : 'No',
            row.remarks || row.policy_note || ''
        ])
    );
    logger.traceTable(
        'EDITABLE BUREAU / CREDIT OBLIGATIONS USED',
        ['Lender', 'Type', 'Outstanding', 'EMI/mo', 'Include FOIR', 'Source'],
        auditObligations.map(row => [
            row.lender_name || '',
            row.loan_type || '',
            row.outstanding_amount || 0,
            row.emi_per_month || 0,
            row.include_in_foir ? 'Yes' : 'No',
            row.source || ''
        ])
    );

    // 3. Evaluate Config Matrix — iterate ALL products per lender, not just [0]
    for (const lender of lenders) {
        if (lender.products.length === 0) {
            // Lender does not offer this product type at all
            continue;
        }

        // FIXED: Evaluate EVERY active product the lender has for this product type.
        // A lender may have multiple products for the same type (e.g. LAP-Salaried, LAP-MSME).
        // We collect all scheme evaluations across all products and pick the best result.
        let allSchemeEvaluations = [];
        let isLenderEligible = false;
        let lenderIneligibilityReason = null;

        // Pre-check: secured loan property requirement applies regardless of product
        const propertyMissing = (pType === 'LAP' || pType === 'HL') && (!esr.property_value || esr.property_value <= 0);
        if (propertyMissing) {
            lenderIneligibilityReason = "Property value missing for secured loan eligibility.";
        }

        for (const product of lender.products) {
            const schemes = ensureHdfcDscrEvaluationSchemes({ schemes: product.schemes || [], product, lender, logger });
            if (schemes.length === 0) continue;

            for (const scheme of schemes) {
                const evalOutput = evaluateDynamicSchemeEligibility({
                    esr,
                    scheme,
                    product,
                    lender,
                    lowest_cibil_score: lowest_cibil,
                    incomeEntries,
                    applicants,
                    obligationsList,
                    logger
                });

                if (propertyMissing && evalOutput.is_eligible) {
                    evalOutput.is_eligible = false;
                    evalOutput.failure_reasons.push(lenderIneligibilityReason);
                }

                // Tag product metadata onto each evaluation result.
                // This is the authoritative source for product info on the winning scheme.
                // Do NOT rely on the outer `bestProduct` variable for display purposes.
                evalOutput.product_type = product.product_type;
                evalOutput.product_id = product.id;
                evalOutput.product_display_name = product.product_type === 'HL'
                    ? 'Home Loan'
                    : product.product_type === 'LAP'
                        ? 'Loan Against Property'
                        : product.product_type;

                allSchemeEvaluations.push(evalOutput);

                if (evalOutput.is_eligible) {
                    isLenderEligible = true;
                }
            }
        }

        if (allSchemeEvaluations.length === 0) {
            lenderIneligibilityReason = lenderIneligibilityReason || "No active scheme configured.";
        }

        // 4. Build lender result — display name is set tentatively here,
        // then overridden after scheme sort to match the winning scheme's product.
        const lenderRes = {
            lender_id: lender.id,
            lender_name: lender.name,
            lender_code: lender.code,
            product_type: pType,
            product_display_name: lender.products[0].product_type === 'HL' ? 'Home Loan' : lender.products[0].product_type === 'LAP' ? 'Loan Against Property' : lender.products[0].product_type,
            is_eligible: isLenderEligible,
            ineligibility_reason: lenderIneligibilityReason,
            scheme_evaluations: allSchemeEvaluations
        };

        const scheme_evaluations = allSchemeEvaluations; // alias for the block below

        if (isLenderEligible) {
            const eligibleSchemes = scheme_evaluations.filter(s => s.is_eligible);

            // Sort all eligible schemes (across all products) by: loan amount ↓, roi ↑, tenure ↑
            eligibleSchemes.sort((a, b) => {
                const loanA = a.final_eligible_loan_amount || 0;
                const loanB = b.final_eligible_loan_amount || 0;
                if (loanB !== loanA) return loanB - loanA;

                const roiA = a.roi_min || Infinity;
                const roiB = b.roi_min || Infinity;
                if (roiB !== roiA) return roiA - roiB;

                const tA = a.max_tenure_months || 0;
                const tB = b.max_tenure_months || 0;
                return tB - tA;
            });

            const best = eligibleSchemes[0];

            // FIX: Use the winning scheme's OWN product metadata.
            // Do NOT use bestProduct — it may point to the last eligible product
            // rather than the product that owns the winning scheme after sort.
            lenderRes.best_scheme_name = best.scheme_name;
            lenderRes.product_display_name = best.product_display_name; // override with correct product
            lenderRes.product_type = best.product_type;         // override with correct product
            lenderRes.final_eligible_loan_amount = best.final_eligible_loan_amount;
            lenderRes.max_loan_by_ltv = best.max_loan_by_ltv;
            lenderRes.applicable_ltv_percent = best.applicable_ltv_percent;
            lenderRes.roi_min = best.roi_min;
            lenderRes.roi_max = best.roi_max;
            lenderRes.pf_min = best.pf_min;
            lenderRes.pf_max = best.pf_max;
            lenderRes.max_tenure_months = best.max_tenure_months;
            lenderRes.foir_allowed_percent = best.foir_allowed_percent;
            lenderRes.foir_actual_percent = best.foir_actual_percent;
            lenderRes.max_eligible_emi = best.max_eligible_emi;

            // Enrich lender-wise ESR output enhancements
            lenderRes.monthly_income_used = best.monthly_income_used;
            lenderRes.monthly_income_note = best.monthly_income_note;
            lenderRes.eligible_income_breakdown = best.eligible_income_breakdown;
            lenderRes.weighted_other_income = best.weighted_other_income;
            lenderRes.foir_breakdown = best.foir_breakdown;
            lenderRes.proposed_emi = best.proposed_emi;
            lenderRes.maximum_eligible_emi = best.maximum_eligible_emi;
            lenderRes.eligible_loan_amount = best.eligible_loan_amount;
            lenderRes.final_tenure_used = best.final_tenure_used;
            lenderRes.underwriting_roi_used = best.underwriting_roi_used;
            lenderRes.conditional_underwriting_flags = best.conditional_underwriting_flags;
            lenderRes.manual_review_required = best.manual_review_required;
            lenderRes.policy_warnings = best.policy_warnings;
            lenderRes.surrogate_program_notes = best.surrogate_program_notes;
            lenderRes.obligation_exclusion_notes = best.obligation_exclusion_notes;
        } else if (!lenderIneligibilityReason) {
            // Aggregate all reasons
            lenderRes.ineligibility_reason = scheme_evaluations.filter(s => s.failure_reasons?.length).map(s => s.failure_reasons[0]).join(" | ") || "Failed evaluated scheme parameters.";
        }

        lenderResults.push(lenderRes);
    }

    // Build and flush structured ESR JSON audit log in addition to the text trace
    const auditLenderPolicyKey = (lenderResults || []).some(lender => {
        const lenderText = `${lender.lender_name || ''} ${lender.lender_id || ''}`.toUpperCase();
        const hasHdfcScheme = (lender.scheme_evaluations || []).some(ev => String(ev.lender_policy_key || '').toUpperCase().includes('HDFC'));
        return lenderText.includes('HDFC') || hasHdfcScheme;
    }) ? 'HDFC' : ((lenderResults || []).some(lender => {
        const lenderText = `${lender.lender_name || ''} ${lender.lender_id || ''}`.toUpperCase();
        const hasIciciScheme = (lender.scheme_evaluations || []).some(ev => String(ev.lender_policy_key || '').toUpperCase().includes('ICICI'));
        return lenderText.includes('ICICI') || hasIciciScheme;
    }) ? 'ICICI' : null);
    if (auditLenderPolicyKey) {
        esrAuditSource.lender_policy_key = auditLenderPolicyKey;
        auditPropertySnapshot.lender_policy_key = auditLenderPolicyKey;
    }
    let incomeCalculationLog = buildIncomeCalculationLog(esrAuditSource, lenderResults);
    try {
        const calculationLogBuilder = new EsrCalculationLogBuilder();
        const esrAuditJson = calculationLogBuilder.buildLog({
            applicationId: case_id,
            customerName: esr.applicant_name || esr.customer_name || '',
            gstin: esr.gstin || '',
            pan: esr.pan || '',
            businessName: esr.business_name || '',
            reportPeriod: {
                extractedAt: esr.extracted_at ? new Date(esr.extracted_at).toISOString() : null,
                generatedAt: new Date().toISOString()
            },
            sources: {
                gstJson: esr.gst_json || esr.raw_gst_json || null,
                gstSummary: {
                    avgMonthlySales: esr.gst_avg_monthly_sales || null,
                    industryMargin: esr.gst_industry_margin || null,
                    industryType: esr.gst_industry_type || null
                },
                bankStatement: esr.bank_json || esr.raw_bank_json || null,
                bankSummary: {
                    avgBalance: esr.bank_avg_balance || null,
                    totalCredits: esr.bank_total_credits || null,
                    avgMonthlyCredit: esr.bank_avg_monthly_credit || null
                },
                bureauReport: auditBureauReport,
                salaryDetails: esr.salary_details || null,
                salarySummary: {
                    salariedIncome: esr.salaried_income || null,
                    salariedIncomeSource: esr.salaried_income_source || null,
                    salariedSlipCount: esr.salaried_slip_count || null
                },
                manualIncomeEntries: auditManualIncomeEntries,
                agricultureIncome: esr.agriculture_income || {},
                manualObligations: esrAuditSource.manual_obligations || [],
                creditCardStatements: esr.credit_card_statements || [],
                editableObligations: auditObligations
            },
            propertyCollateral: auditPropertySnapshot,
            methodEligibilitySummary: lenderResults,
            loanApplication: {
                requestedLoanAmount: esr.requested_loan_amount || null,
                annualInterestRate: esr.annual_interest_rate || null,
                tenureMonths: esr.requested_tenure_months || null,
                proposedEMI: esr.proposed_emi || null
            },
            lenders: lenderResults,
            policy: {
                lenderPolicyKey: auditLenderPolicyKey,
                selectedIncomeMethod: esr.selected_income_method || esr.income_method || null
            }
        });
        esrAuditJson.incomeCalculationLog = incomeCalculationLog;
        logger.flushTrace({ jsonData: esrAuditJson });
    } catch (err) {
        console.warn('[ESR TRACE WARNING] Failed to generate structured JSON audit log:', err.message);
        logger.flushTrace();
    }

    // Sort Lenders
    lenderResults.sort((a, b) => {
        if (a.is_eligible && !b.is_eligible) return -1;
        if (!a.is_eligible && b.is_eligible) return 1;

        if (a.is_eligible && b.is_eligible) {
            const fA = a.final_eligible_loan_amount || 0;
            const fB = b.final_eligible_loan_amount || 0;
            if (fB !== fA) return fB - fA;

            const rA = a.roi_min || Infinity;
            const rB = b.roi_min || Infinity;
            if (rA !== rB) return rA - rB;

            const tA = a.max_tenure_months || 0;
            const tB = b.max_tenure_months || 0;
            return tB - tA;
        }
        return 0;
    });

    // 5. Fetch Full Obligations List for Snapshot — already fetched upfront
    const combinedAnnualIncome = (esr.selected_monthly_income || 0) * 12;

    // 6. Versioning — resolved inside the transaction for concurrency safety.
    // nextVersion is computed here as a baseline, but the authoritative version
    // is derived inside the transaction after acquiring the row-level lock.

    // 7. Build Comprehensive Input Snapshot for full audit traceability
    const inputSnapshot = {
        source: "CASE_ESR_FINANCIALS",
        case_esr_financial_id: esr.id,
        generated_at: new Date().toISOString(),
        lender_count_evaluated: lenders.length,

        // Case identifiers
        case_id,
        tenant_id,

        // Product
        product_type: esr.product_type,
        requested_loan_amount: esr.requested_loan_amount,
        requested_tenure_months: esr.requested_tenure_months,

        // Property & Collateral Details from UI
        property_value: esr.property_value,
        market_value: auditPropertySnapshot.market_value,
        property_type: esr.property_type,
        occupancy_type: esr.occupancy_type,
        ownership: auditPropertySnapshot.ownership,
        property_collateral_snapshot: auditPropertySnapshot,

        // Manual Income Addition rows from UI
        manual_income_entries: auditManualIncomeEntries,

        // Editable obligations reviewed before ESR
        editable_obligations: auditObligations,

        // Income summary
        selected_income_method: esr.selected_income_method,
        selected_monthly_income: esr.selected_monthly_income,
        combined_annual_income: combinedAnnualIncome,

        // Income methods (all four computed)
        net_profit_income: esr.net_profit_income,
        gst_income: esr.gst_income,
        banking_income: esr.banking_income,
        salaried_income: esr.salaried_income,
        salaried_income_source: esr.salaried_income_source,
        salaried_slip_count: esr.salaried_slip_count,

        // ITR
        itr_pat: esr.itr_pat,
        itr_depreciation: esr.itr_depreciation,
        itr_finance_cost: esr.itr_finance_cost,
        itr_gross_receipts: esr.itr_gross_receipts,

        // GST
        gst_avg_monthly_sales: esr.gst_avg_monthly_sales,
        gst_industry_type: esr.gst_industry_type,
        gst_industry_margin: esr.gst_industry_margin,

        // Bank
        bank_avg_balance: esr.bank_avg_balance,
        bank_monthly_income: esr.bank_monthly_income,

        // Obligations
        existing_obligations: esr.existing_obligations,
        total_emi_per_month: esr.existing_obligations,  // alias for downstream clarity
        icici_exposure: esr.icici_exposure,

        // Bureau
        primary_cibil_score: primary_cibil,
        lowest_cibil_score: lowest_cibil,
        co_applicant_cibils: co_applicant_cibils,
        applicant_age: esr.applicant_age,

        // Full FOIR obligation detail
        obligations_detail: auditObligations
    };

    // 8. Resolve tenant_lender_id mapping for each lender result
    // Already resolved in Step 3d using exact FK matching.

    // 9. Transaction Persistence
    //
    // CONCURRENCY DESIGN:
    //   We use a case-row level lock (SELECT ... FOR UPDATE on the `cases` table)
    //   as the serialization mechanism. This is safe with Prisma connection pooling
    //   because the lock is TRANSACTION-level — it is held for the duration of
    //   the $transaction and released automatically when the transaction commits
    //   or rolls back, on the SAME connection Prisma assigns to the transaction.
    //
    //   Session-level advisory locks (pg_advisory_lock) are NOT safe with pooling
    //   because lock + unlock may execute on different connections.
    //
    //   Two concurrent requests for the same case_id will serialize here:
    //   the second request blocks on the FOR UPDATE until the first commits.
    //
    await prisma.$transaction(async (tx) => {
        // LAYER 1: Acquire case-row lock for this transaction.
        // All subsequent reads/writes in this transaction are safe on this connection.
        await tx.$queryRawUnsafe(
            `SELECT id FROM cases WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
            case_id, tenant_id
        );

        // LAYER 2: Resolve version number atomically while holding the case lock.
        // The case lock serializes concurrent requests, so we read MAX(version_number)
        // safely with no risk of two requests seeing the same value.
        const rows = await tx.$queryRawUnsafe(
            `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM eligibility_reports WHERE case_id = $1 AND tenant_id = $2`,
            case_id, tenant_id
        );
        const nextVersion = Number(rows[0].max_version) + 1;

        // Mark all previous reports for this case as not-latest
        await tx.eligibilityReport.updateMany({
            where: { case_id, tenant_id, is_latest: true },
            data: { is_latest: false }
        });

        // Create new EligibilityReport
        // The DB-level constraints protect us as a last line of defence:
        //   @@unique([case_id, tenant_id, version_number])   — no duplicate versions
        //   PARTIAL UNIQUE INDEX on is_latest=true           — at most one latest per case
        const newESR = await tx.eligibilityReport.create({
            data: {
                case_id,
                tenant_id,
                version_number: nextVersion,
                is_latest: true,
                generated_by_user_id: user_id,
                combined_income: combinedAnnualIncome,
                property_value: esr.property_value,
                primary_cibil_score: primary_cibil,
                lowest_cibil_score: lowest_cibil,
                total_emi_per_month: esr.existing_obligations,
                status: 'GENERATED',
                input_snapshot: inputSnapshot,
                raw_payload: { lenders: lenderResults, income_calculation_log: incomeCalculationLog, manual_income_entries: auditManualIncomeEntries, property_collateral: auditPropertySnapshot, editable_obligations: auditObligations }, // Debugging only
                lenders: {
                    create: lenderResults.map(l => {
                        // FIX 7: Resolve tenant_lender_id by exact FK link
                        const resolvedTenantLenderId = tenantLenderIdMap[l.lender_id] || null;

                        if (!resolvedTenantLenderId) {
                            console.warn(`[ESR PERSIST] Failed to resolve tenant_lender_id for platform lender_id: "${l.lender_id}".`);
                        }

                        return {
                            tenant_lender_id: resolvedTenantLenderId,
                            lender_id: l.lender_id || null,
                            lender_name: l.lender_name,
                            product_type: l.product_type,
                            product_display_name: l.product_display_name || null,
                            best_scheme_name: l.best_scheme_name || null,
                            is_eligible: l.is_eligible,
                            eligible_amount: l.final_eligible_loan_amount || null,
                            roi: l.roi_min || null,
                            tenure_months: l.max_tenure_months || null,
                            emi: l.max_eligible_emi || null,
                            ltv: l.applicable_ltv_percent || null,
                            foir: l.foir_allowed_percent || null,
                            remarks: l.ineligibility_reason || null,
                            rejection_reasons: l.is_eligible ? null : {
                                reasons: l.ineligibility_reason ? l.ineligibility_reason.split(" | ") : ["Failed criteria"]
                            },
                            scheme_evaluations: l.scheme_evaluations || null
                        };
                    })
                }
            }
        });

        return newESR;
    });

    // ISSUE 3 FIX: Call updateStage OUTSIDE the transaction.
    // updateStage uses the global prisma client internally (not a tx-client).
    // Calling it inside $transaction would deadlock the connection pool.
    // It handles: tenant validation + CaseStageHistory + ActivityLog + stage lock rules.
    await updateStage(case_id, tenant_id, 'ESR_GENERATED', user_id);

    // Set esr_generated flag tenant-safely (ISSUE 5: WHERE includes tenant_id)
    await prisma.case.updateMany({
        where: { id: case_id, tenant_id },
        data: { esr_generated: true }
    });

    // Provide generic response back mirroring legacy system response wrapper
    return {
        lenders: lenderResults,
        eligible_count: lenderResults.filter(l => l.is_eligible).length,
        total_count: lenderResults.length,
        combined_income: combinedAnnualIncome,
        property_value: esr.property_value,
        primary_cibil_score: primary_cibil,
        lowest_cibil_score: lowest_cibil,
        total_emi_per_month: esr.existing_obligations
    };
}

module.exports = {
    generateDynamicESR,
    evaluateDynamicSchemeEligibility
};
