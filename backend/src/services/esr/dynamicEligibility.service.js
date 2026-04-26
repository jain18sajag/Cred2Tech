const prisma = require('../../../config/db');

// ---------- HELPER UTILITIES ----------

function toNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    let normalized = value;
    if (typeof value === 'object') {
        normalized = value.amount || value.value || value.percent || null;
    }
    if (typeof normalized === 'string') {
        normalized = normalized.replace(/,/g, '').replace(/₹/g, '').replace(/%/g, '').replace(/months/gi, '').trim();
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
}

function parsePercent(value) {
    if (value === undefined || value === null || value === '') return null;
    let normalized = typeof value === 'object' ? (value.percent !== undefined ? value.percent : value) : value;
    if (typeof normalized === 'string') {
        const strVal = normalized.toLowerCase();
        // E.g. "Max 100% ( Double wammy - 140%)" -> take raw percentage
        const match = strVal.match(/(\d+(\.\d+)?)%/);
        if (match) {
            return Number(match[1]) / 100;
        }
        normalized = normalized.replace(/,/g, '').replace(/%/g, '').trim();
    }
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? numeric / 100 : numeric;
}

function getParamMap(parameterValues) {
    const map = {};
    if (!Array.isArray(parameterValues)) return map;
    parameterValues.forEach(pv => {
        const key = pv.parameter?.parameter_key || pv.parameter_key;
        if (key) {
            map[key] = pv.value;
        }
    });
    return map;
}

function getParamNumber(paramMap, key) {
    return toNumber(paramMap[key]);
}

function getParamPercent(paramMap, key) {
    return parsePercent(paramMap[key]);
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
function resolveApplicableLtvKey(esr) {
    const pType = (esr.product_type || '').toLowerCase();

    if (pType === 'hl') {
        // HL Logic
        const loanAmt = Number(esr.requested_loan_amount) || 0;
        if (loanAmt > 0) {
            if (loanAmt <= 3000000) return 'hl_ltv_upto_30';
            if (loanAmt > 3000000 && loanAmt <= 7500000) return 'hl_ltv_30_75';
            if (loanAmt > 7500000) return 'hl_ltv_above_75';
        }
        const propLower = (esr.property_type || '').toLowerCase();
        if (propLower.includes('commercial')) return 'hl_ltv_commercial';
        if (propLower.includes('industrial')) return 'hl_ltv_industrial';
        if (propLower.includes('plot')) return 'hl_ltv_plot';
        if (propLower.includes('residential')) return 'hl_ltv_residential';
        return 'hl_ltv_other';
    }

    if (pType === 'lap') {
        // LAP Logic
        const propLower = (esr.property_type || '').toLowerCase();
        const occLower = (esr.occupancy_type || '').toLowerCase();

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
    if (!valString) return null;
    const str = typeof valString === 'object' ? (valString.percent || valString.value || JSON.stringify(valString)) : String(valString);
    const lowStr = str.toLowerCase();

    if (lowStr.includes('<75k') && lowStr.includes('>75k')) {
        return monthlyIncome >= 75000 ? 0.70 : 0.60;
    }
    if (lowStr.includes('max 100%')) {
        return 1.0;
    }

    return parsePercent(str);
}


// ------ EVALUATE SCHEME ------
function evaluateDynamicSchemeEligibility({ esr, scheme, product, lender }) {
    console.log(`\n[ESR ENGINE] Evaluating Scheme: ${scheme.scheme_name} | Lender: ${lender.name} | Product: ${product.product_type}`);
    const paramMap = getParamMap(scheme.parameter_values);
    console.log(`[ESR ENGINE] Parsed Parameter Map:`, JSON.stringify(paramMap, null, 2));

    const pType = (esr.product_type || '').toLowerCase();

    let isEligible = true;
    const failure_reasons = [];
    const warnings = [];

    // Scheme Matching Method
    const targetMethod = normalizeIncomeMethod(esr.selected_income_method);
    let income_method_matched = true;
    if (targetMethod && scheme.scheme_name !== targetMethod) {
        income_method_matched = false;
        // Do not force fail, let it process naturally, merely report flag.
    }

    const pref = pType === 'hl' ? 'hl' : 'lap';

    // A. Bureau Cutoff
    const rawBureau = paramMap['bureau_cutoff'];
    if (rawBureau !== undefined && rawBureau !== null && rawBureau !== '') {
        const bureauCutoff = toNumber(rawBureau);
        if (bureauCutoff && (!esr.bureau_score || esr.bureau_score < bureauCutoff)) {
            isEligible = false;
            failure_reasons.push(esr.bureau_score ? `CIBIL score ${esr.bureau_score} is below bureau cutoff ${bureauCutoff}` : "Bureau score missing.");
        }
    } else if (esr.bureau_score === null) {
        warnings.push("Bureau score missing, but no cutoff defined.");
    }

    // B & C. Min / Max Loan
    const minLoan = getParamNumber(paramMap, `${pref}_min_loan`);
    const maxLoanRaw = paramMap[`${pref}_max_loan`];
    const maxLoan = toNumber(maxLoanRaw);

    if (maxLoanRaw !== undefined && maxLoanRaw !== null && maxLoan === null) {
        warnings.push(`Max loan parameter is not numeric: ${typeof maxLoanRaw === 'object' ? JSON.stringify(maxLoanRaw) : maxLoanRaw}`);
    }

    const reqAmt = esr.requested_loan_amount ? Number(esr.requested_loan_amount) : null;
    if (reqAmt !== null) {
        if (minLoan !== null && reqAmt < minLoan) {
            isEligible = false;
            failure_reasons.push(`Requested loan amount ₹${reqAmt.toLocaleString()} is below minimum ₹${minLoan.toLocaleString()}`);
        }
        if (maxLoan !== null && reqAmt > maxLoan) {
            isEligible = false;
            failure_reasons.push(`Requested loan amount ₹${reqAmt.toLocaleString()} exceeds maximum ₹${maxLoan.toLocaleString()}`);
        }
    } else {
        warnings.push("Requested loan amount missing; max eligible loan calculated only.");
    }

    // D. FOIR
    const rawFoir = paramMap[`${pref}_dbr_foir`];
    let foir_allowed_percent = parseDynamicFoir(rawFoir, esr.selected_monthly_income);

    const monthlyIncome = esr.selected_monthly_income || 0;
    const existingObligations = esr.existing_obligations || 0;
    let foir_actual_percent = monthlyIncome > 0 ? (existingObligations / monthlyIncome) : 0;
    let max_eligible_emi = null;

    if (foir_allowed_percent !== null) {
        if (foir_actual_percent > foir_allowed_percent) {
            isEligible = false;
            failure_reasons.push(`FOIR ${(foir_actual_percent * 100).toFixed(1)}% exceeds allowed ${(foir_allowed_percent * 100).toFixed(1)}%`);
        }
        max_eligible_emi = monthlyIncome * foir_allowed_percent - existingObligations;
    } else if (rawFoir && rawFoir !== '---') {
        warnings.push(`FOIR parameter could not be parsed numerically: ${typeof rawFoir === 'object' ? JSON.stringify(rawFoir) : rawFoir}`);
    }

    // E. Max Age At Maturity
    const maxAge = getParamNumber(paramMap, 'age_maturity_income');
    const maxTenureMonths = getParamNumber(paramMap, `${pref}_max_tenure`);
    if (maxAge !== null && maxTenureMonths !== null && esr.applicant_age) {
        const ageAtMaturity = esr.applicant_age + (maxTenureMonths / 12);
        if (ageAtMaturity > maxAge) {
            isEligible = false;
            failure_reasons.push(`Age at maturity ${ageAtMaturity.toFixed(1)} exceeds allowed ${maxAge}`);
        }
    }

    // F. LTV
    const applicable_ltv_key = resolveApplicableLtvKey(esr);
    const applicable_ltv_percent = getParamPercent(paramMap, applicable_ltv_key);
    let max_loan_by_ltv = null;
    let final_eligible_loan_amount = null;

    if (applicable_ltv_percent !== null && esr.property_value) {
        max_loan_by_ltv = Math.round(esr.property_value * applicable_ltv_percent);
        if (reqAmt !== null) {
            if (reqAmt > max_loan_by_ltv) {
                isEligible = false;
                failure_reasons.push(`Requested loan ₹${reqAmt.toLocaleString()} exceeds allowed LTV calculation ₹${max_loan_by_ltv.toLocaleString()}.`);
            }
            final_eligible_loan_amount = Math.min(reqAmt, max_loan_by_ltv);
        } else {
            final_eligible_loan_amount = max_loan_by_ltv;
            if (maxLoan !== null && final_eligible_loan_amount > maxLoan) {
                final_eligible_loan_amount = maxLoan;
            }
        }
    }

    // G. ROI & PF
    const roi_min = getParamNumber(paramMap, `${pref}_roi_min`);
    const roi_max = getParamNumber(paramMap, `${pref}_roi_max`);
    const pf_min = getParamNumber(paramMap, `${pref}_pf_min`);
    const pf_max = getParamNumber(paramMap, `${pref}_pf_max`);

    // H. Warn on Invalid or Missing Configuration Matrix Points
    Object.keys(paramMap).forEach(k => {
        const v = paramMap[k];
        if (v === '---' || v === null || v === '') {
            warnings.push(`Invalid parameter value: ${k}`);
        }
    });

    const finalEvaluation = {
        scheme_id: scheme.id,
        scheme_name: scheme.scheme_name,
        income_method_matched,
        is_eligible: isEligible,
        failure_reasons,
        warnings,
        applicable_ltv_key,
        applicable_ltv_percent,
        max_loan_by_ltv,
        final_eligible_loan_amount,
        roi_min,
        roi_max,
        pf_min,
        pf_max,
        max_tenure_months: maxTenureMonths,
        foir_allowed_percent,
        foir_actual_percent,
        max_eligible_emi
    };

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

    console.log(`\n======================================================`);
    console.log(`[ESR ENGINE] Starting Dynamic ESR Calculation`);
    console.log(`[ESR ENGINE] Case ID: ${case_id} | Product Type: ${pType}`);
    console.log(`[ESR ENGINE] Input Payload:`, JSON.stringify(esr, null, 2));
    console.log(`======================================================\n`);

    // 2. Fetch Active Lenders
    const lenders = await prisma.lender.findMany({
        where: { status: 'ACTIVE' },
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

    // 3. Evaluate Config Matrix
    for (const lender of lenders) {
        if (lender.products.length === 0) {
            // Lender does not offer this product
            continue;
        }

        const product = lender.products[0]; // Assuming one product record perfectly matches (matched by product_type)
        const schemes = product.schemes || [];

        const scheme_evaluations = [];
        let isLenderEligible = false;
        let lenderIneligibilityReason = null;

        if (schemes.length === 0) {
            isLenderEligible = false;
            lenderIneligibilityReason = "No active scheme configured.";
        } else {
            // Pre-catch secured missing conditions natively before evaluation engines:
            if ((pType === 'LAP' || pType === 'HL') && (!esr.property_value || esr.property_value <= 0)) {
                isLenderEligible = false;
                lenderIneligibilityReason = "Property value missing for secured loan eligibility.";
            }

            for (const scheme of schemes) {
                const evalOutput = evaluateDynamicSchemeEligibility({ esr, scheme, product, lender });

                if (evalOutput.is_eligible && lenderIneligibilityReason === "Property value missing for secured loan eligibility.") {
                    evalOutput.is_eligible = false;
                    evalOutput.failure_reasons.push(lenderIneligibilityReason);
                }

                scheme_evaluations.push(evalOutput);
                if (evalOutput.is_eligible) isLenderEligible = true;
            }
        }

        // 4. Output Logic per Lender
        // Construct the output base
        const lenderRes = {
            lender_id: lender.id,
            lender_name: lender.name,
            lender_code: lender.code,
            product_type: pType,
            product_display_name: product.product_type === 'HL' ? 'Home Loan' : product.product_type === 'LAP' ? 'Loan Against Property' : product.product_type,
            is_eligible: isLenderEligible,
            ineligibility_reason: lenderIneligibilityReason,
            scheme_evaluations
        };

        if (isLenderEligible) {
            const eligibleSchemes = scheme_evaluations.filter(s => s.is_eligible);

            // Sort to find the best scheme
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
            lenderRes.best_scheme_name = best.scheme_name;
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
        } else if (!lenderIneligibilityReason) {
            // Aggregate all reasons
            lenderRes.ineligibility_reason = scheme_evaluations.filter(s => s.failure_reasons?.length).map(s => s.failure_reasons[0]).join(" | ") || "Failed evaluated scheme parameters.";
        }

        lenderResults.push(lenderRes);
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

    const combinedAnnualIncome = (esr.selected_monthly_income || 0) * 12;

    // 5. Transaction Persistence
    await prisma.$transaction(async (tx) => {
        await tx.eligibilityReport.upsert({
            where: { case_id },
            create: {
                case_id,
                generated_by_user_id: user_id,
                combined_income: combinedAnnualIncome,
                property_value: esr.property_value,
                primary_cibil_score: esr.bureau_score,
                lowest_cibil_score: esr.bureau_score,
                total_emi_per_month: esr.existing_obligations,
                status: 'GENERATED',
                raw_payload: {
                    source: "CASE_ESR_FINANCIALS",
                    case_esr_financial_id: esr.id,
                    product_type: esr.product_type,
                    selected_income_method: esr.selected_income_method,
                    selected_monthly_income: esr.selected_monthly_income,
                    lenders: lenderResults
                }
            },
            update: {
                generated_at: new Date(),
                generated_by_user_id: user_id,
                combined_income: combinedAnnualIncome,
                property_value: esr.property_value,
                primary_cibil_score: esr.bureau_score,
                lowest_cibil_score: esr.bureau_score,
                total_emi_per_month: esr.existing_obligations,
                status: 'GENERATED',
                updated_at: new Date(),
                raw_payload: {
                    source: "CASE_ESR_FINANCIALS",
                    case_esr_financial_id: esr.id,
                    product_type: esr.product_type,
                    selected_income_method: esr.selected_income_method,
                    selected_monthly_income: esr.selected_monthly_income,
                    lenders: lenderResults
                }
            }
        });

        await tx.case.update({
            where: { id: case_id },
            data: { stage: 'ESR_GENERATED', esr_generated: true }
        });
    });

    // Provide generic response back mirroring legacy system response wrapper
    return {
        lenders: lenderResults,
        eligible_count: lenderResults.filter(l => l.is_eligible).length,
        total_count: lenderResults.length,
        combined_income: combinedAnnualIncome,
        property_value: esr.property_value,
        primary_cibil_score: esr.bureau_score,
        lowest_cibil_score: esr.bureau_score,
        total_emi_per_month: esr.existing_obligations
    };
}

module.exports = {
    generateDynamicESR,
    evaluateDynamicSchemeEligibility
};
