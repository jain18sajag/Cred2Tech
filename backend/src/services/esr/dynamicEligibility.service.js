const prisma = require('../../../config/db');
const { updateStage } = require('../case.service');
const EsrTraceLogger = require('./esrTraceLogger');
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
    const m = method.toUpperCase();
    if (m === 'BANKING') return 'Banking';
    if (m === 'GST') return 'GST';
    if (m === 'NET_PROFIT') return 'Net Profit Method';
    if (m === 'SALARIED') return 'Salaried';
    return method;
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


function getSchemePrimaryIncome(schemeName, esr, paramMap, warnings = []) {
    const name = (schemeName || '').toUpperCase();
    
    const failMissing = (methodName, missingParam) => {
        warnings.push(`[ESR INCOME] ${methodName} calculation failed (Missing: ${missingParam}). Scheme requires method-specific data and will not fallback.`);
        return 0; // Return 0 so FOIR fails, marking it ineligible/manual review
    };

    if (name.includes('SALARIED')) {
        const baseSalary  = Number(esr.salaried_income) || Number(esr.selected_monthly_income) || 0;
        const incentives  = Number(esr.salaried_incentive_income) || 0;
        const otherIncome = Number(esr.salaried_other_income) || 0;
        return baseSalary + incentives + otherIncome;
    }
    if (name.includes('BANKING') || name.includes('ABB')) {
        const abb = Number(esr.bank_avg_balance) || 0;
        const rawMultiplier = paramMap['banking_abb_multiplier'];
        const multiplierRes = parseIntegerSafe(rawMultiplier);
        const abbMultiplier = (multiplierRes.ok && multiplierRes.value !== null) ? multiplierRes.value : 2;

        const creditIncome = Number(esr.bank_avg_monthly_credit) || Number(esr.bank_total_credits) / 12 || 0;
        const abbSurrogate  = abb * abbMultiplier;
        
        let calcVal = 0;
        const policy = (paramMap['banking_income_policy'] || 'MAX_OF_BOTH').toUpperCase();
        
        if (policy === 'ABB_MULTIPLIER') {
            calcVal = abbSurrogate;
        } else if (policy === 'AVG_MONTHLY_CREDIT') {
            calcVal = creditIncome;
        } else {
            // MAX_OF_BOTH default
            calcVal = Math.max(creditIncome, abbSurrogate);
        }

        if (calcVal > 0) return calcVal;
        return failMissing('Banking', 'bank_avg_balance/credits');
    }
    if (name.includes('GST')) {
        let turnover = Number(esr.gst_avg_monthly_sales) || 0;
        
        let marginRes = parsePercentSafe(paramMap['gst_industry_margin']);
        let margin = (marginRes.ok && marginRes.value !== null) ? marginRes.value : null;
        
        if (margin === null) {
            warnings.push(`[ESR INCOME] GST Industry Margin missing from config. Defaulting to 10%.`);
            margin = 0.10;
        }

        const calculatedGstIncome = turnover * margin;
        if (calculatedGstIncome > 0) return calculatedGstIncome;
        return failMissing('GST', 'gst_avg_monthly_sales');
    }
    if (name.includes('NET PROFIT') || name.includes('NPM')) {
        const pat          = Number(esr.itr_pat) || 0;
        const depr         = Number(esr.itr_depreciation) || 0;
        const financeCost  = Number(esr.itr_finance_cost) || 0;
        const remuneration = Number(esr.itr_remuneration) || 0;

        const rawDeprFraction = paramMap['npm_depreciation_fraction'];
        const deprFractionRes = parsePercentSafe(rawDeprFraction);
        const deprFraction = (deprFractionRes.ok && deprFractionRes.value !== null) ? deprFractionRes.value : (2 / 3);

        const depreciationAddback = depr * deprFraction;

        const calcVal = (pat + depreciationAddback + financeCost + remuneration) / 12;
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
function calculateComposedIncome({ schemeName, esr, incomeEntries, paramMap, warnings = [] }) {
    const primaryIncome = getSchemePrimaryIncome(schemeName, esr, paramMap, warnings);

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

    const eligRentalBank = getBoolParam('elig_rental_bank', true);
    const dbrRentalBank = getPercentParam('dbr_rental_bank', 0.70);
    const eligRentalCash = getBoolParam('elig_rental_cash', false);
    const dbrRentalCash = getPercentParam('dbr_rental_cash', 0.50);
    const eligAgriItr = getBoolParam('elig_agri_itr', true);
    const dbrAgriItr = getPercentParam('dbr_agri_itr', 1.00);

    let rentalIncomeBank = 0;
    let rentalIncomeCash = 0;
    let agriIncome = 0;
    let otherIncome = 0;

    const breakdownItems = [];

    if (Array.isArray(incomeEntries) && incomeEntries.length > 0) {
        for (const entry of incomeEntries) {
            const type = (entry.income_type || '').toLowerCase();
            const monthly = (Number(entry.annual_amount) || 0) / 12;
            if (monthly <= 0) continue;

            const docType = (entry.supporting_doc_type || '').toLowerCase();
            const isBankCredit = docType.includes('bank') || docType.includes('credit');

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
                    if (eligRentalCash) {
                        const amt = monthly * dbrRentalCash;
                        rentalIncomeCash += amt;
                        breakdownItems.push({
                            type: 'Rental Income (Cash)',
                            raw_monthly: monthly,
                            allowed_pct: dbrRentalCash * 100,
                            eligible_monthly: amt
                        });
                    }
                }
            } else if (type.includes('agri') || type.includes('agriculture')) {
                if (eligAgriItr) {
                    const amt = monthly * dbrAgriItr;
                    agriIncome += amt;
                    breakdownItems.push({
                        type: 'Agricultural Income',
                        raw_monthly: monthly,
                        allowed_pct: dbrAgriItr * 100,
                        eligible_monthly: amt
                    });
                }
            } else {
                // Strict whitelisting of approved other income types to prevent OCR/manual leakage
                const allowedOtherIncomeTypes = ['pension', 'professional', 'interest', 'dividend', 'royalty', 'commission'];
                const isWhitelisted = allowedOtherIncomeTypes.some(t => type.includes(t));
                if (isWhitelisted) {
                    otherIncome += monthly;
                    breakdownItems.push({
                        type: `Other Income (${entry.income_type})`,
                        raw_monthly: monthly,
                        allowed_pct: 100,
                        eligible_monthly: monthly
                    });
                } else {
                    console.log(`[ESR INCOME] Ignored non-whitelisted other income type: "${entry.income_type}"`);
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

function calculateNetObligations(obligationsList, exclusionMonths, warnings, policyWarnings, obligationExclusionNotes) {
    let netObligations = 0;
    const excludedObligations = [];
    const activeObligations = [];

    if (Array.isArray(obligationsList)) {
        for (const obl of obligationsList) {
            const emi = Number(obl.emi_per_month) || 0;
            if (emi <= 0) continue;

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
        active: activeObligations
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
                        } catch {}
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
    console.log(`[ESR ENGINE] Parsed Parameter Map:`, JSON.stringify(paramMap, null, 2));

    // Start scheme trace block
    logger?.startSchemeTrace(lender.name, scheme.scheme_name);
    logger?.traceStep('PARAMETER MAP', Object.keys(paramMap).map(k => `${k}: ${paramMap[k]}`).join('\n'));

    const pType = (esr.product_type || '').toLowerCase();

    let isEligible = true;
    const failure_reasons = [];
    const warnings = [];
    const policyWarnings = [];
    const obligationExclusionNotes = [];

    const schemeIncomeMethod = normalizeIncomeMethod(scheme.scheme_name);
    const caseIncomeMethod = normalizeIncomeMethod(esr.income_method);
    let income_method_matched = true;

    if (caseIncomeMethod && schemeIncomeMethod) {
        if (schemeIncomeMethod !== caseIncomeMethod) {
            income_method_matched = false;
            isEligible = false;
            failure_reasons.push(`Scheme income method (${schemeIncomeMethod}) does not match case (${caseIncomeMethod})`);
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

    let composedIncome = 0;
    let incomeComposition = { breakdown: [], primary_income: 0, total_eligible_income: 0 };
    
    if (isNwmMethod) {
        const npmMonthlyIncome = (
            (Number(esr.itr_pat) || 0)
            + ((Number(esr.itr_depreciation) || 0) * (2 / 3))
            + (Number(esr.itr_finance_cost) || 0)
            + (Number(esr.director_remuneration) || 0)
            + (Number(esr.director_interest_on_loan) || 0)
        ) / 12;

        const propertyValue = Number(esr.property_value) || 0;
        const propertyIncomeMonthly = (propertyValue * 0.03) / 12;

        const financialAssetsValue = Number(esr.shares_mf_fd_value) || Number(esr.financial_assets_value) || Number(esr.liquid_assets_value) || Number(esr.net_worth_liquid_assets) || 0;
        const financialAssetIncomeMonthly = (financialAssetsValue * 0.05) / 12;

        const rentalBankMonthly = Number(esr.rental_bank_income) || Number(esr.rental_income_bank) || 0;
        const eligibleRentalMonthly = rentalBankMonthly * 0.70;

        const agriMonthly = Number(esr.agricultural_income) || Number(esr.agri_income) || 0;
        const agriFactor = esr.agri_ownership_proof_available ? 1.00 : 0.50;
        const eligibleAgriMonthly = agriMonthly * agriFactor;

        composedIncome = npmMonthlyIncome + propertyIncomeMonthly + financialAssetIncomeMonthly + eligibleRentalMonthly + eligibleAgriMonthly;
        incomeComposition = {
            primary_income: npmMonthlyIncome,
            total_eligible_income: composedIncome,
            breakdown: [
                { source: 'NPM Component', amount: npmMonthlyIncome },
                { source: 'Property Add-on', amount: propertyIncomeMonthly },
                { source: 'Financial Asset Add-on', amount: financialAssetIncomeMonthly },
                { source: 'Eligible Rental Bank', amount: eligibleRentalMonthly },
                { source: 'Eligible Agri', amount: eligibleAgriMonthly }
            ]
        };
        
        logger?.traceStep('NWM INCOME BUILD-UP', [
            `NPM Monthly Income:           ₹${npmMonthlyIncome.toLocaleString()}`,
            `Property Value Add-on @3%/12: ₹${propertyIncomeMonthly.toLocaleString()}`,
            `Financial Asset Add-on @5%/12: ₹${financialAssetIncomeMonthly.toLocaleString()}`,
            `Eligible Rental Bank @70%:    ₹${eligibleRentalMonthly.toLocaleString()}`,
            `Eligible Agri @${agriFactor * 100}%:           ₹${eligibleAgriMonthly.toLocaleString()}`,
            `Total NWM Monthly Income:     ₹${composedIncome.toLocaleString()}`,
        ].join('\n'));

        // Customer Selection Gate
        const cibil = effectiveCibil || 0;
        let customerSelectionPass = false;
        let requiredIncome = 0;
        if (cibil >= 770 && composedIncome >= 150000) {
            customerSelectionPass = true;
            requiredIncome = 150000;
        } else if (cibil >= 750 && composedIncome >= 300000) {
            customerSelectionPass = true;
            requiredIncome = 300000;
        } else {
            requiredIncome = cibil >= 770 ? 150000 : 300000;
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
    } else {
        incomeComposition = calculateComposedIncome({ schemeName: scheme.scheme_name, esr, incomeEntries, paramMap, warnings });
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
    
    // GRP bypasses FOIR entirely
    if (isGrpMethod) {
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
    const exclusionMonths = parseObligationExclusionMonths(rawObligationRule);
    const netObligationsResult = calculateNetObligations(obligationsList, exclusionMonths, warnings, policyWarnings, obligationExclusionNotes);
    const netObligations = netObligationsResult.net_obligations;

    logger?.traceStep('STEP 4 — NET OBLIGATIONS', [
        `Obligation Rule:      "${rawObligationRule ?? 'N/A'}"`,
        `Exclusion Months:     ${exclusionMonths ?? 'None'}`,
        `Total Obligations:    ${obligationsList.length}`,
        `Excluded:             ${(netObligationsResult.excluded || []).map(o => `${o.lender_name || 'Unknown'} ${o.loan_type || ''} EMI:₹${(o.emi_per_month || 0).toLocaleString()}`).join('; ') || 'None'}`,
        `Net Obligations EMI:  ₹${netObligations.toLocaleString()}`,
    ].join('\n'));

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
    if (!skip_foir_check && foir_allowed_percent !== null && composedIncome > 0) {
        maximum_eligible_emi = Math.max(0, (composedIncome * foir_allowed_percent) - netObligations);
        logger?.traceFormula(
            'STEP 7 — ELIGIBLE EMI CAPACITY',
            '(FOIR% × Income) − Obligations',
            `(${(foir_allowed_percent * 100).toFixed(1)}% × ₹${composedIncome.toLocaleString()}) − ₹${netObligations.toLocaleString()}`,
            `₹${maximum_eligible_emi.toLocaleString()}`
        );
    } else if (skip_foir_check) {
        maximum_eligible_emi = Infinity;
        logger?.traceStep('STEP 7 — ELIGIBLE EMI CAPACITY', 'No DBR policy — EMI capacity is UNCAPPED');
    } else {
        logger?.traceWarning('STEP 7 — ELIGIBLE EMI CAPACITY: Could not calculate (missing FOIR% or income)');
    }

    // 7. Calculate FOIR-based Maximum Eligible Loan Amount (or Method-based direct loan amount)
    let foir_based_eligible_loan_amount = 0;

    if (isGrpMethod) {
        const grossReceipts = Number(esr.itr_gross_receipts) || 0;
        const rawGrpMult = paramMap['grp_annual_receipts_multiplier'] || paramMap['grp_industry_margin'];
        const parsedMult = parseFloat(rawGrpMult);
        const grpMultiplier = Number.isFinite(parsedMult) ? parsedMult : 4.0;
        
        const iciciExposure = Number(esr.icici_exposure) || 0;
        
        foir_based_eligible_loan_amount = Math.max(0, (grossReceipts * grpMultiplier) - iciciExposure);
        
        logger?.traceFormula(
            'STEP 8 — GRP DIRECT LOAN ELIGIBILITY',
            '(Gross Receipts × Multiplier) − ICICI Exposure',
            `(₹${grossReceipts.toLocaleString()} × ${grpMultiplier}) − ₹${iciciExposure.toLocaleString()}`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()}`
        );
        isEligible = foir_based_eligible_loan_amount > 0;
        if (!isEligible) {
             failure_reasons.push("GRP eligibility is 0 (Gross receipts * Multiplier <= Exposure).");
        }
    } else if (skip_foir_check) {
        const rawMonthsMult = paramMap['no_dbr_months_multiplier'];
        const monthsMultRes = parseIntegerSafe(rawMonthsMult);
        const monthsMultiplier = (monthsMultRes.ok && monthsMultRes.value !== null) ? monthsMultRes.value : 60;
        foir_based_eligible_loan_amount = composedIncome * monthsMultiplier;
        logger?.traceFormula(
            'STEP 8 — FOIR-BASED LOAN ELIGIBILITY (No DBR)',
            'Income × Months Multiplier (No DBR policy)',
            `₹${composedIncome.toLocaleString()} × ${monthsMultiplier} months`,
            `₹${foir_based_eligible_loan_amount.toLocaleString()}`
        );
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

    const eligibilityCandidates = [
        foir_based_eligible_loan_amount,
        ltv_based_eligible_loan_amount,
        maxLoan,
        nwm_cap,
        requested_loan
    ].filter(v => v !== null && v !== undefined && Number.isFinite(v) && v > 0);

    let final_eligible_loan_amount = eligibilityCandidates.length > 0
        ? Math.min(...eligibilityCandidates)
        : 0;

    // Strict constraint: if FOIR was required (not null for No DBR) but resulted in 0 (failed/missing data),
    // then final eligibility MUST be 0. It cannot borrow LTV or requested loan amounts.
    if (foir_based_eligible_loan_amount === 0) {
        final_eligible_loan_amount = 0;
    }

    logger?.traceFormula(
        'STEP 10 — FINAL ELIGIBILITY',
        'MIN of valid candidates: [FOIR Eligibility, LTV Eligibility, Product Max Loan, Requested Loan, NWM Cap]',
        `Candidates: [${[
            foir_based_eligible_loan_amount !== null ? '₹' + foir_based_eligible_loan_amount?.toLocaleString() : 'No Cap (No DBR)',
            ltv_based_eligible_loan_amount !== null ? '₹' + ltv_based_eligible_loan_amount?.toLocaleString() : 'N/A (no property/LTV)',
            maxLoan !== null ? '₹' + maxLoan?.toLocaleString() : 'No Product Cap',
            requested_loan !== null ? '₹' + requested_loan?.toLocaleString() : 'No Requested Cap'
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

    // Correct Underwriting FOIR Formula: FOIR = (Existing Obligations + Proposed EMI) / Eligible Monthly Income
    let foir_actual_percent = composedIncome > 0 ? ((netObligations + proposed_emi) / composedIncome) : 0;

    logger?.traceFormula(
        'FOIR ACTUAL',
        '(Existing Obligations + Proposed EMI) / Eligible Monthly Income',
        `(₹${netObligations.toLocaleString()} + ₹${proposed_emi.toLocaleString()}) / ₹${composedIncome.toLocaleString()}`,
        `${(foir_actual_percent * 100).toFixed(2)}%`
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
    }

    const finalEvaluation = {
        scheme_id: scheme.id,
        scheme_name: scheme.scheme_name,
        income_method_matched,
        is_eligible: isEligible,
        failure_reasons,
        warnings,
        policy_warnings: policyWarnings,
        applicable_ltv_key,
        applicable_ltv_percent,
        max_loan_by_ltv: ltv_based_eligible_loan_amount,
        foir_based_eligible_loan_amount,
        ltv_based_eligible_loan_amount,
        final_eligible_loan_amount,
        eligible_loan_amount: final_eligible_loan_amount, // for backwards compatibility
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
        eligible_income_breakdown: incomeComposition.breakdown,
        weighted_other_income: composedIncome - incomeComposition.primary_income,
        foir_breakdown: {
            skip_foir_check,
            composed_income: composedIncome,
            net_obligations: netObligations,
            proposed_emi: proposed_emi,
            foir_allowed_percent: foir_allowed_percent,
            foir_actual_percent: foir_actual_percent,
            maximum_eligible_emi: maximum_eligible_emi === Infinity ? null : maximum_eligible_emi
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
            include_in_foir: true,
            source: true
        }
    });

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
    console.log(`[ESR ENGINE] Input Payload:`, JSON.stringify(esr, null, 2));
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
    const logger = new EsrTraceLogger();
    logger.startTrace(case_id, esr.case_entity?.tenant_id, esr.product_type, {
        'Selected Monthly Income': `₹${(esr.selected_monthly_income || 0).toLocaleString()}`,
        'Property Value': esr.property_value ? `₹${esr.property_value.toLocaleString()}` : 'N/A',
        'Property Type': esr.property_type || 'N/A',
        'Occupancy': esr.occupancy_type || 'N/A',
        'Product Type': esr.product_type,
        'Income Method': esr.selected_income_method || 'N/A',
        'Primary CIBIL': primary_cibil ?? 'N/A',
        'Lowest CIBIL': lowest_cibil ?? 'N/A',
        'Total Obligations': obligationsList.length,
        'Total EMI': `₹${obligationsList.reduce((s, o) => s + (o.emi_per_month || 0), 0).toLocaleString()}`,
        'Lenders Evaluated': lenders.length,
    });

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
            const schemes = product.schemes || [];
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
                evalOutput.product_id   = product.id;
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
            lenderRes.best_scheme_name         = best.scheme_name;
            lenderRes.product_display_name     = best.product_display_name; // override with correct product
            lenderRes.product_type             = best.product_type;         // override with correct product
            lenderRes.final_eligible_loan_amount = best.final_eligible_loan_amount;
            lenderRes.max_loan_by_ltv          = best.max_loan_by_ltv;
            lenderRes.applicable_ltv_percent   = best.applicable_ltv_percent;
            lenderRes.roi_min                  = best.roi_min;
            lenderRes.roi_max                  = best.roi_max;
            lenderRes.pf_min                   = best.pf_min;
            lenderRes.pf_max                   = best.pf_max;
            lenderRes.max_tenure_months        = best.max_tenure_months;
            lenderRes.foir_allowed_percent     = best.foir_allowed_percent;
            lenderRes.foir_actual_percent      = best.foir_actual_percent;
            lenderRes.max_eligible_emi         = best.max_eligible_emi;

            // Enrich lender-wise ESR output enhancements
            lenderRes.eligible_income_breakdown = best.eligible_income_breakdown;
            lenderRes.weighted_other_income     = best.weighted_other_income;
            lenderRes.foir_breakdown           = best.foir_breakdown;
            lenderRes.proposed_emi             = best.proposed_emi;
            lenderRes.maximum_eligible_emi     = best.maximum_eligible_emi;
            lenderRes.eligible_loan_amount     = best.eligible_loan_amount;
            lenderRes.final_tenure_used        = best.final_tenure_used;
            lenderRes.underwriting_roi_used    = best.underwriting_roi_used;
            lenderRes.conditional_underwriting_flags = best.conditional_underwriting_flags;
            lenderRes.manual_review_required   = best.manual_review_required;
            lenderRes.policy_warnings          = best.policy_warnings;
            lenderRes.surrogate_program_notes  = best.surrogate_program_notes;
            lenderRes.obligation_exclusion_notes = best.obligation_exclusion_notes;
        } else if (!lenderIneligibilityReason) {
            // Aggregate all reasons
            lenderRes.ineligibility_reason = scheme_evaluations.filter(s => s.failure_reasons?.length).map(s => s.failure_reasons[0]).join(" | ") || "Failed evaluated scheme parameters.";
        }

        lenderResults.push(lenderRes);
    }

    // Flush trace log after all lender evaluations are complete
    logger.flushTrace();

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

        // Property
        property_value: esr.property_value,
        property_type: esr.property_type,
        occupancy_type: esr.occupancy_type,

        // Income summary
        selected_income_method: esr.selected_income_method,
        selected_monthly_income: esr.selected_monthly_income,
        combined_annual_income: combinedAnnualIncome,

        // Income methods (all four computed)
        net_profit_income:  esr.net_profit_income,
        gst_income:         esr.gst_income,
        banking_income:     esr.banking_income,
        salaried_income:    esr.salaried_income,
        salaried_income_source: esr.salaried_income_source,
        salaried_slip_count:    esr.salaried_slip_count,

        // ITR
        itr_pat:            esr.itr_pat,
        itr_depreciation:   esr.itr_depreciation,
        itr_finance_cost:   esr.itr_finance_cost,
        itr_gross_receipts: esr.itr_gross_receipts,

        // GST
        gst_avg_monthly_sales: esr.gst_avg_monthly_sales,
        gst_industry_type:     esr.gst_industry_type,
        gst_industry_margin:   esr.gst_industry_margin,

        // Bank
        bank_avg_balance:    esr.bank_avg_balance,
        bank_monthly_income: esr.bank_monthly_income,

        // Obligations
        existing_obligations: esr.existing_obligations,
        total_emi_per_month:  esr.existing_obligations,  // alias for downstream clarity
        icici_exposure:       esr.icici_exposure,

        // Bureau
        primary_cibil_score: primary_cibil,
        lowest_cibil_score: lowest_cibil,
        co_applicant_cibils: co_applicant_cibils,
        applicant_age: esr.applicant_age,

        // Full FOIR obligation detail
        obligations_detail: obligationsList
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
            data:  { is_latest: false }
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
                raw_payload: { lenders: lenderResults }, // Debugging only
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
