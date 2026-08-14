function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(String(value).toString().replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(num) ? num : null;
}

function normalizeSource(rawSource, summarySource) {
    return {
        raw: rawSource || null,
        summary: summarySource || null
    };
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

function normalizeManualMonthly(entry = {}) {
    const monthly = toNumber(entry.monthly_amount ?? entry.monthlyAmount ?? entry.monthlyIncome);
    if (monthly !== null && monthly > 0) return monthly;
    const annual = toNumber(entry.annual_amount ?? entry.annualAmount ?? entry.annualIncome);
    return annual !== null && annual > 0 ? annual / 12 : 0;
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

function buildManualIncomeImpactLog(esr) {
    const entries = Array.isArray(esr.manual_income_entries) ? esr.manual_income_entries : [];
    const selectedMethod = String(esr.selected_income_method || '').toUpperCase();
    const policyKey = String(esr.lender_policy_key || esr.policy_key || '').toUpperCase();
    const isHdfcPolicy = policyKey.includes('HDFC');
    const hasBaseSalary = (toNumber(esr.salaried_income) || 0) > 0;
    const hasItrRemuneration = (toNumber(esr.itr_remuneration) || 0) > 0;

    const rows = entries.map(entry => {
        const type = normalizeManualIncomeType(entry);
        const docText = normalizeManualIncomeDocText(entry);
        const annualAmount = toNumber(entry.annual_amount ?? entry.annualAmount ?? entry.annualIncome) || 0;
        const monthlyAmount = normalizeManualMonthly(entry);
        const isRent = type.includes('rent') || type.includes('rental');
        const isBankCredit = isRent && (type.includes('bank') || docText.includes('bank') || docText.includes('credit') || docText.includes('itr'));
        const isCashOrUnverifiedRent = isRent && !isBankCredit;
        const isAgri = type.includes('agri') || type.includes('agriculture');
        const ownershipProof = hasOwnershipProofText(`${type} ${docText}`);
        const isSalary = type === 'salary' || type.includes('director salary') || type.includes('partner salary') || type.includes("partner's salary") || type.includes('form 16') || type.includes('gross salary') || type.includes('net salary');
        const isRemuneration = type.includes('partner') || type.includes('director') || type.includes('remuneration');
        const isNpmOther = ['professional', 'interest', 'dividend', 'royalty', 'commission'].some(token => type.includes(token));

        let salariedEligible = 0;
        let npmEligible = 0;
        let bankingEligible = 0;
        let gstEligible = 0;
        let grpEligible = 0;
        let dscrEligible = 0;
        let nwmEligible = 0;
        let policyDecision = 'MANUAL_REVIEW_OR_NOT_WHITELISTED';
        let note = '';

        if (isHdfcPolicy) {
            if (isSalary) {
                if (!hasBaseSalary) {
                    const hdfcSalaryPct = monthlyAmount > 100000 ? 0.60 : 0.50;
                    salariedEligible = monthlyAmount * hdfcSalaryPct;
                    note = 'HDFC salaried fallback: 50% of gross salary up to ₹1 lakh/month and 60% above ₹1 lakh/month; final code also applies 70% of net salary cap when available.';
                } else {
                    note = 'Base salary already exists, so manual salary/remuneration is logged but not double-counted.';
                }
                if (isRemuneration && !hasItrRemuneration) {
                    npmEligible = monthlyAmount;
                    dscrEligible = monthlyAmount;
                    nwmEligible = monthlyAmount;
                    note = `${note} Director/partner remuneration can be used in NPM/DSCR/NWM only when it is not already included in ITR/company financials.`.trim();
                }
                policyDecision = 'HDFC_CONDITIONAL_SALARY_OR_REMUNERATION';
            } else if (isRent) {
                if (isBankCredit) {
                    npmEligible = monthlyAmount;
                    dscrEligible = monthlyAmount;
                    nwmEligible = monthlyAmount;
                    policyDecision = 'HDFC_RENTAL_BANK_OR_ITR_100_PERCENT_CAPPED';
                    note = 'HDFC considers ITR/bank-backed rental income for NPM/DSCR/NWM at 100%, capped to main business profit. It does not affect Banking, GST or GRP.';
                } else if (isCashOrUnverifiedRent) {
                    policyDecision = 'HDFC_RENTAL_CASH_EXCLUDED';
                    note = 'HDFC LAP policy does not consider rental income received in cash/unverified mode.';
                }
            } else if (isAgri) {
                policyDecision = 'HDFC_AGRICULTURE_EXCLUDED';
                note = 'HDFC LAP sheet marks agricultural income as not considered.';
            } else if (isNpmOther || type.includes('interest on capital')) {
                policyDecision = 'HDFC_OTHER_MANUAL_INCOME_NOT_AUTO_COUNTED';
                note = 'HDFC NPM/NWM/DSCR should use audited financial statement fields. Manual professional/interest/dividend/other income is logged for audit but not auto-counted unless mapped in financials.';
            }
        } else {
            if (isSalary) {
                if (!hasBaseSalary) {
                    salariedEligible = monthlyAmount * 0.70;
                    note = 'Manual salary can be used as salaried fallback only when OCR/API/bank salary is missing.';
                } else {
                    note = 'Base salary already exists, so manual salary is logged but not double-counted in salaried method.';
                }
                if (isRemuneration && !hasItrRemuneration) {
                    npmEligible = monthlyAmount;
                }
                policyDecision = 'CONDITIONAL_SALARY_OR_REMUNERATION';
            } else if (isRent) {
                if (isBankCredit) {
                    salariedEligible = monthlyAmount * 0.70;
                    npmEligible = monthlyAmount * 0.70;
                    policyDecision = 'RENTAL_BANK_ALLOWED_70_PERCENT';
                    note = 'ICICI allows bank-credit/ITR-backed rent at 70%.';
                } else if (isCashOrUnverifiedRent) {
                    policyDecision = 'RENTAL_CASH_EXCLUDED_MANUAL_REVIEW';
                    note = 'ICICI marks rental cash/unverified rent as No/manual review, so it is excluded from auto eligibility.';
                }
            } else if (isAgri) {
                const pct = ownershipProof ? 1.00 : 0.50;
                salariedEligible = monthlyAmount * pct;
                npmEligible = monthlyAmount * pct;
                policyDecision = ownershipProof ? 'AGRICULTURE_OWNERSHIP_PROOF_100_PERCENT' : 'AGRICULTURE_MANUAL_50_PERCENT';
                note = ownershipProof ? 'Ownership/land proof available.' : 'No ownership proof detected; 50% considered.';
            } else if (isNpmOther || type.includes('interest on capital')) {
                npmEligible = monthlyAmount;
                policyDecision = 'NPM_OTHER_INCOME_ALLOWED_100_PERCENT';
                note = 'Whitelisted other income affects NPM, not selected Banking/GST method.';
            }
        }

        const selectedMethodEligible = selectedMethod.includes('SALARIED')
            ? salariedEligible
            : selectedMethod.includes('NET') || selectedMethod.includes('NPM')
                ? npmEligible
                : selectedMethod.includes('DSCR')
                    ? dscrEligible
                    : selectedMethod.includes('WORTH') || selectedMethod.includes('NWM')
                        ? nwmEligible
                        : selectedMethod.includes('GRP')
                            ? grpEligible
                            : selectedMethod.includes('GST')
                                ? gstEligible
                                : selectedMethod.includes('BANK')
                                    ? bankingEligible
                                    : 0;

        return {
            incomeType: entry.income_type || entry.incomeType || entry.type || 'Other',
            annualAmount,
            monthlyAmount,
            supportingDocType: entry.supporting_doc_type || entry.supportingDocType || entry.proofDocument || null,
            remarks: entry.remarks || null,
            normalizedType: type,
            policyDecision,
            salariedImpactMonthly: salariedEligible,
            npmImpactMonthly: npmEligible,
            dscrImpactMonthly: dscrEligible,
            nwmImpactMonthly: nwmEligible,
            bankingImpactMonthly: bankingEligible,
            gstImpactMonthly: gstEligible,
            grpImpactMonthly: grpEligible,
            selectedMethodImpactMonthly: selectedMethodEligible,
            impactsSelectedMethod: selectedMethodEligible > 0,
            impactsAutoBestMethod: salariedEligible > 0 || npmEligible > 0 || dscrEligible > 0 || nwmEligible > 0 || bankingEligible > 0 || gstEligible > 0 || grpEligible > 0,
            note
        };
    });

    const totals = rows.reduce((acc, row) => {
        acc.annualAmount += row.annualAmount || 0;
        acc.monthlyAmount += row.monthlyAmount || 0;
        acc.salariedImpactMonthly += row.salariedImpactMonthly || 0;
        acc.npmImpactMonthly += row.npmImpactMonthly || 0;
        acc.dscrImpactMonthly += row.dscrImpactMonthly || 0;
        acc.nwmImpactMonthly += row.nwmImpactMonthly || 0;
        acc.bankingImpactMonthly += row.bankingImpactMonthly || 0;
        acc.gstImpactMonthly += row.gstImpactMonthly || 0;
        acc.grpImpactMonthly += row.grpImpactMonthly || 0;
        acc.selectedMethodImpactMonthly += row.selectedMethodImpactMonthly || 0;
        return acc;
    }, {
        annualAmount: 0,
        monthlyAmount: 0,
        salariedImpactMonthly: 0,
        npmImpactMonthly: 0,
        dscrImpactMonthly: 0,
        nwmImpactMonthly: 0,
        bankingImpactMonthly: 0,
        gstImpactMonthly: 0,
        grpImpactMonthly: 0,
        selectedMethodImpactMonthly: 0
    });

    return {
        methodName: 'Manual Income Addition Impact',
        lenderPolicyKey: isHdfcPolicy ? 'HDFC' : (policyKey || 'ICICI_OR_DEFAULT'),
        selectedMethod,
        sourcePath: 'CaseIncomeEntry / Manual Income Addition UI rows',
        formula: isHdfcPolicy
            ? 'HDFC: only allowed lender-policy buckets are included. Rental bank/ITR affects NPM/DSCR/NWM only and is capped to main business profit; Banking/GST/GRP stay unaffected.'
            : 'annualAmount / 12, then lender/scheme policy percentage is applied. Banking selected method remains unaffected by manual income.',
        entries: rows,
        totals,
        warnings: rows
            .filter(row => row.policyDecision.includes('EXCLUDED') || row.policyDecision.includes('MANUAL_REVIEW') || row.policyDecision.includes('NOT_AUTO'))
            .map(row => `${row.incomeType}: ${row.note || row.policyDecision}`)
    };
}

function buildPropertyCollateralLog(esr, lenderResults = []) {
    const propertyValue = toNumber(esr.property_value ?? esr.market_value) || 0;
    const ltvEvaluations = [];
    for (const lender of lenderResults || []) {
        for (const ev of lender.scheme_evaluations || []) {
            ltvEvaluations.push({
                lenderName: lender.lender_name || lender.lender_id || null,
                schemeName: ev.scheme_name || null,
                propertyType: esr.property_type || null,
                occupancyStatus: esr.occupancy_type || esr.occupancy_status || null,
                ownership: esr.ownership || esr.ownership_status || esr.property_ownership || null,
                applicableLtvKey: ev.applicable_ltv_key || null,
                applicableLtvPercent: ev.applicable_ltv_percent || null,
                ltvBasedEligibleLoanAmount: ev.ltv_based_eligible_loan_amount || ev.max_loan_by_ltv || null,
                finalEligibleLoanAmount: ev.final_eligible_loan_amount || null
            });
        }
    }

    return {
        methodName: 'Property & Collateral Details',
        sourcePath: 'Property & Collateral Details UI / case_esr_financials',
        inputValues: {
            productType: esr.product_type || null,
            propertyType: esr.property_type || null,
            occupancyStatus: esr.occupancy_type || esr.occupancy_status || null,
            ownership: esr.ownership || esr.ownership_status || esr.property_ownership || null,
            marketValue: toNumber(esr.market_value ?? esr.property_value),
            propertyValue,
            requestedLoanAmount: toNumber(esr.requested_loan_amount)
        },
        formula: 'LTV cap = market/property value × applicable lender LTV%; final eligibility is min(income eligibility, LTV cap, requested loan, product cap).',
        ltvEvaluations,
        warnings: [
            !esr.property_type ? 'Property Type is missing.' : null,
            !(esr.occupancy_type || esr.occupancy_status) ? 'Occupancy Status is missing.' : null,
            !(esr.ownership || esr.ownership_status || esr.property_ownership) ? 'Ownership is captured for audit. It changes eligibility only if lender/property policy has a configured ownership restriction.' : null,
            propertyValue <= 0 ? 'Property/market value is missing or zero.' : null
        ].filter(Boolean)
    };
}

function buildObligationAuditLog(esr) {
    const obligations = Array.isArray(esr.editable_obligations) ? esr.editable_obligations : [];
    const totalEditableEmi = obligations.reduce((sum, row) => sum + (toNumber(row.emi_per_month ?? row.emi ?? row.monthlyPayment) || 0), 0);
    return {
        methodName: 'Bureau & Credit Obligations Used',
        sourcePath: 'CaseCreditObligation editable EMI rows / Bureau & Credit Obligations UI',
        obligations,
        totalEditableEmi,
        persistedExistingObligations: toNumber(esr.existing_obligations) || 0,
        formula: 'net obligation used in eligibility = sum editable active EMI rows, with scheme-specific exclusions where policy allows.',
        warnings: totalEditableEmi !== (toNumber(esr.existing_obligations) || 0)
            ? ['Editable EMI total differs from case_esr_financials.existing_obligations. Review whether extraction summary was refreshed after EMI edit.']
            : []
    };
}

function buildMethodEligibilitySummary(lenderResults = []) {
    const rows = [];
    for (const lender of lenderResults || []) {
        for (const ev of lender.scheme_evaluations || []) {
            rows.push({
                lenderName: lender.lender_name || lender.lender_id || null,
                schemeName: ev.scheme_name || null,
                isEligible: !!ev.is_eligible,
                monthlyIncomeUsed: ev.monthly_income_used || null,
                primaryMonthlyIncomeUsed: ev.primary_monthly_income_used || null,
                eligibleIncomeBreakdown: ev.eligible_income_breakdown || [],
                weightedOtherIncome: ev.weighted_other_income || null,
                netObligations: ev.foir_breakdown?.net_obligations ?? null,
                maximumEligibleEmi: ev.maximum_eligible_emi || ev.foir_breakdown?.maximum_eligible_emi || null,
                foirBasedEligibleLoanAmount: ev.foir_based_eligible_loan_amount || null,
                ltvBasedEligibleLoanAmount: ev.ltv_based_eligible_loan_amount || ev.max_loan_by_ltv || null,
                finalEligibleLoanAmount: ev.final_eligible_loan_amount || null,
                failureReasons: ev.failure_reasons || [],
                policyWarnings: ev.policy_warnings || ev.warnings || []
            });
        }
    }
    return {
        methodName: 'Method-wise Eligibility Summary',
        rows,
        bestEligible: rows
            .filter(row => row.isEligible)
            .sort((a, b) => (b.finalEligibleLoanAmount || 0) - (a.finalEligibleLoanAmount || 0))[0] || null
    };
}

function buildLogEntry({
    methodName,
    sourcePath,
    source,
    inputValues,
    formula,
    intermediateCalculations,
    finalMonthlyIncome,
    warnings = [],
    manualReviewRequired = false,
    ignored = false,
    notes = null
}) {
    return {
        methodName,
        sourcePath,
        source,
        inputValues: inputValues || {},
        formula: formula || null,
        intermediateCalculations: intermediateCalculations || {},
        finalMonthlyIncome: finalMonthlyIncome !== undefined ? finalMonthlyIncome : null,
        warnings,
        manualReviewRequired,
        ignored,
        notes
    };
}

function buildSalariedLog(esr) {
    const baseSalary = toNumber(esr.salaried_income) || 0;
    const incentives = toNumber(esr.salaried_incentive_income) || 0;
    const otherIncome = toNumber(esr.salaried_other_income) || 0;
    const salarySource = normalizeSource(
        esr.salary_details || null,
        {
            salariedIncome: esr.salaried_income || null,
            salariedIncomeSource: esr.salaried_income_source || null,
            salariedSlipCount: esr.salaried_slip_count || null,
            salariedGrossMonthly: esr.salaried_gross_monthly || null,
            salariedNetMonthly: esr.salaried_net_monthly || null,
            salariedDeductionsMonthly: esr.salaried_deductions_monthly || null,
            salariedMonthsAvailable: esr.salaried_months_available || null,
            salariedMonthsRequired: esr.salaried_months_required || null,
            salariedPeriodFrom: esr.salaried_period_from || null,
            salariedPeriodTo: esr.salaried_period_to || null,
            salariedDataComplete: esr.salaried_data_complete ?? null,
            bankNetSalaryMonthly: esr.bank_net_salary_monthly || null,
            bankSalaryMonthsAvailable: esr.bank_salary_months_available || null
        }
    );
    const finalIncome = baseSalary + incentives + otherIncome;
    const warnings = [];
    let ignored = false;
    let manualReviewRequired = false;
    if (finalIncome <= 0) {
        ignored = true;
        warnings.push('No valid salaried income could be derived from summary or raw salary details.');
    }
    if (baseSalary === 0 && (incentives > 0 || otherIncome > 0)) {
        warnings.push('Base salaried income is missing; only incentives or other eligible income were found.');
        manualReviewRequired = true;
    }
    const monthsAvailable = toNumber(esr.salaried_months_available) || 0;
    const monthsRequired = toNumber(esr.salaried_months_required) || 0;
    if (monthsRequired > 0 && monthsAvailable > 0 && monthsAvailable < monthsRequired) {
        warnings.push(`Only ${monthsAvailable} unique salary month(s) available; ${monthsRequired} required for complete salaried assessment.`);
        manualReviewRequired = true;
    }

    return buildLogEntry({
        methodName: 'Salaried',
        sourcePath: 'case_esr_financials.salary_details / salary summary fields',
        source: salarySource,
        inputValues: {
            salariedIncome: esr.salaried_income || null,
            salariedIncomeSource: esr.salaried_income_source || null,
            salariedSlipCount: esr.salaried_slip_count || null,
            salariedGrossMonthly: esr.salaried_gross_monthly || null,
            salariedNetMonthly: esr.salaried_net_monthly || null,
            salariedDeductionsMonthly: esr.salaried_deductions_monthly || null,
            salariedMonthsAvailable: esr.salaried_months_available || null,
            salariedMonthsRequired: esr.salaried_months_required || null,
            salariedPeriodFrom: esr.salaried_period_from || null,
            salariedPeriodTo: esr.salaried_period_to || null,
            salariedDataComplete: esr.salaried_data_complete ?? null,
            salariedSource: esr.salaried_source || null,
            bankNetSalaryMonthly: esr.bank_net_salary_monthly || null,
            bankSalaryMonthsAvailable: esr.bank_salary_months_available || null,
            salariedIncentiveIncome: esr.salaried_incentive_income || null,
            salariedOtherIncome: esr.salaried_other_income || null
        },
        formula: 'salariedIncome + salariedIncentiveIncome + salariedOtherIncome',
        intermediateCalculations: {
            baseSalary,
            incentives,
            otherIncome
        },
        finalMonthlyIncome: finalIncome > 0 ? finalIncome : 0,
        warnings,
        manualReviewRequired,
        ignored
    });
}

function buildBankingAbbLog(esr) {
    const avgBalance = toNumber(esr.bank_avg_balance);
    const selectedIncome = toNumber(esr.bank_monthly_income);
    const source = normalizeSource(
        esr.bank_json || esr.raw_bank_json || null,
        {
            avgBalance: esr.bank_avg_balance || null,
            totalCredits: esr.bank_total_credits || null,
            avgMonthlyCredit: esr.bank_avg_monthly_credit || null
        }
    );
    const multiplier = 2;
    const calculatedIncome = avgBalance !== null ? avgBalance * multiplier : null;
    const warnings = [];
    if (avgBalance === null && selectedIncome === null) {
        warnings.push('No banking ABB source data available.');
    }
    if (avgBalance !== null && selectedIncome !== null && selectedIncome !== calculatedIncome) {
        warnings.push('Selected bank monthly income differs from default ABB multiplier calculation. Scheme-specific multiplier may be applied.');
    }
    if (avgBalance === null && selectedIncome !== null) {
        warnings.push('Bank average balance/strict ABB is missing; persisted bank_monthly_income should be reviewed before use.');
    }

    return buildLogEntry({
        methodName: 'Banking',
        sourcePath: 'case_esr_financials.bank_json / bank summary fields',
        source,
        inputValues: {
            bankAvgBalance: esr.bank_avg_balance || null,
            bankAvgMonthlyCredit: esr.bank_avg_monthly_credit || null,
            bankTotalCredits: esr.bank_total_credits || null,
            persistedBankMonthlyIncome: esr.bank_monthly_income || null,
            assumedAbbMultiplier: multiplier
        },
        formula: 'bankAvgBalance/ABB from 5th, 10th, 15th, 25th daily balance × ABB multiplier (no credit fallback)',
        intermediateCalculations: {
            bankAvgBalance: avgBalance,
            abbMultiplier: multiplier,
            calculatedBankIncome: calculatedIncome
        },
        finalMonthlyIncome: selectedIncome !== null ? selectedIncome : (calculatedIncome !== null ? calculatedIncome : 0),
        warnings,
        manualReviewRequired: false,
        ignored: avgBalance === null && selectedIncome === null
    });
}

function buildGstLog(esr) {
    const avgMonthlySales = toNumber(esr.gst_avg_monthly_sales);
    const margin = toNumber(esr.gst_industry_margin);
    const selection = toNumber(esr.gst_income);
    const source = normalizeSource(
        esr.gst_json || esr.raw_gst_json || null,
        {
            avgMonthlySales: esr.gst_avg_monthly_sales || null,
            industryType: esr.gst_industry_type || null,
            industryMargin: esr.gst_industry_margin || null
        }
    );
    const finalIncome = selection !== null ? selection : (avgMonthlySales !== null && margin !== null ? avgMonthlySales * margin : null);
    const warnings = [];
    if (avgMonthlySales === null) warnings.push('GST average monthly sales data unavailable.');
    if (margin === null) warnings.push('GST industry margin unavailable.');
    if (finalIncome === null) warnings.push('GST income could not be computed.');

    return buildLogEntry({
        methodName: 'GST',
        sourcePath: 'Monthly Sales&Purchase → Monthly Sale Summary → data → Taxable Value',
        source,
        inputValues: {
            gstAvgMonthlySales: esr.gst_avg_monthly_sales || null,
            gstIndustryType: esr.gst_industry_type || null,
            gstIndustryMargin: esr.gst_industry_margin || null
        },
        formula: 'Average Monthly Sales from Monthly Sales&Purchase × ICICI industry margin',
        intermediateCalculations: {
            avgMonthlySales: avgMonthlySales,
            industryMargin: margin,
            calculatedGstIncome: finalIncome
        },
        finalMonthlyIncome: finalIncome !== null ? finalIncome : 0,
        warnings,
        manualReviewRequired: finalIncome === null || margin === null,
        ignored: finalIncome === null
    });
}

function buildItrNpmLog(esr) {
    const pat = toNumber(esr.itr_pat) || 0;
    const depreciation = toNumber(esr.itr_depreciation) || 0;
    const financeCost = toNumber(esr.itr_finance_cost) || 0;
    const remuneration = toNumber(esr.itr_remuneration) || 0;
    const directorInterest = toNumber(esr.director_interest_on_loan) || 0;
    const selection = toNumber(esr.net_profit_income);
    const depreciationAddback = depreciation * (2 / 3);
    const calculatedIncome = (pat + depreciationAddback + financeCost + remuneration + directorInterest) / 12;
    const source = normalizeSource(
        esr.itr_analytics || null,
        {
            itrPat: esr.itr_pat || null,
            itrDepreciation: esr.itr_depreciation || null,
            itrFinanceCost: esr.itr_finance_cost || null,
            itrRemuneration: esr.itr_remuneration || null
        }
    );
    const warnings = [];
    if (pat === 0 && depreciation === 0 && financeCost === 0 && remuneration === 0) {
        warnings.push('ITR / Net Profit fields are missing or zero.');
    }

    return buildLogEntry({
        methodName: 'ITR / NPM',
        sourcePath: 'case_esr_financials.itr_analytics / summary ITR fields',
        source,
        inputValues: {
            itrPat: esr.itr_pat || null,
            itrDepreciation: esr.itr_depreciation || null,
            itrFinanceCost: esr.itr_finance_cost || null,
            itrRemuneration: esr.itr_remuneration || null,
            directorInterestOnLoan: esr.director_interest_on_loan || null
        },
        formula: '(PAT + Depreciation Addback + Finance Cost + Remuneration + Director Interest) / 12',
        intermediateCalculations: {
            pat,
            depreciation,
            depreciationFraction: 2 / 3,
            depreciationAddback,
            financeCost,
            remuneration,
            directorInterest,
            calculatedNpmIncome: calculatedIncome
        },
        finalMonthlyIncome: selection !== null ? selection : (Number.isFinite(calculatedIncome) ? Math.max(0, calculatedIncome) : 0),
        warnings,
        manualReviewRequired: false,
        ignored: selection === null && !Number.isFinite(calculatedIncome)
    });
}

function buildGrpLog(esr) {
    const grossReceipts = toNumber(esr.itr_gross_receipts);
    const source = normalizeSource(
        esr.itr_analytics || null,
        {
            itrGrossReceipts: esr.itr_gross_receipts || null
        }
    );
    const warnings = [];
    if (grossReceipts === null) {
        warnings.push('GRP source receipts unavailable.');
    } else {
        warnings.push('GRP multiplier was not available in the ESR snapshot; output is informational only.');
    }

    return buildLogEntry({
        methodName: 'GRP',
        sourcePath: 'case_esr_financials.itr_analytics or ITR source receipts field',
        source,
        inputValues: {
            itrGrossReceipts: esr.itr_gross_receipts || null
        },
        formula: 'grossReceipts × grpMultiplier',
        intermediateCalculations: {
            grossReceipts
        },
        finalMonthlyIncome: 0,
        warnings,
        manualReviewRequired: true,
        ignored: true,
        notes: 'GRP method is not directly computed from current ESR snapshot; multiplier and business margin logic are evaluated dynamically by lender scheme rules.'
    });
}


function buildDscrLog(esr, lenderResults = []) {
    const annualIncome =
        toNumber(esr.dscr_annual_income) ||
        toNumber(esr.annual_business_income) ||
        toNumber(esr.business_annual_income) ||
        toNumber(esr.annual_income) ||
        ((toNumber(esr.selected_monthly_income) || 0) * 12);

    const dscrEvaluations = [];
    if (Array.isArray(lenderResults)) {
        for (const lender of lenderResults) {
            for (const ev of lender.scheme_evaluations || []) {
                if (String(ev.scheme_name || '').toUpperCase().includes('DSCR')) {
                    dscrEvaluations.push({
                        lenderName: lender.lender_name,
                        schemeName: ev.scheme_name,
                        isEligible: ev.is_eligible,
                        finalEligibleLoanAmount: ev.final_eligible_loan_amount,
                        proposedEmi: ev.proposed_emi,
                        dscrBreakdown: ev.dscr_breakdown || ev.foir_breakdown?.dscr_breakdown || null,
                        failureReasons: ev.failure_reasons || [],
                        warnings: ev.warnings || []
                    });
                }
            }
        }
    }

    const firstBreakdown = dscrEvaluations.find(x => x.dscrBreakdown)?.dscrBreakdown || null;

    return buildLogEntry({
        methodName: 'DSCR',
        sourcePath: 'case_esr_financials annual income fields / lender scheme dscr_breakdown',
        source: normalizeSource(null, {
            dscrAnnualIncome: esr.dscr_annual_income || null,
            annualBusinessIncome: esr.annual_business_income || esr.business_annual_income || null,
            selectedMonthlyIncome: esr.selected_monthly_income || null
        }),
        inputValues: {
            annualIncome,
            monthlyEquivalentIncome: annualIncome > 0 ? annualIncome / 12 : 0,
            minRatio: firstBreakdown?.minRatio || null,
            obligationMultiplier: firstBreakdown?.obligationMultiplier || 12,
            lenderEvaluations: dscrEvaluations
        },
        formula: 'DSCR = Annual Income / (Existing Annual Obligations + Proposed Annual EMI); Eligible EMI = ((Annual Income / Min DSCR) - Existing Annual Obligations) / 12',
        intermediateCalculations: firstBreakdown || {},
        finalMonthlyIncome: annualIncome > 0 ? annualIncome / 12 : 0,
        warnings: dscrEvaluations.length === 0 ? ['No DSCR lender scheme evaluation found in lender results.'] : [],
        manualReviewRequired: dscrEvaluations.some(x => Array.isArray(x.failureReasons) && x.failureReasons.length > 0),
        ignored: annualIncome <= 0 || dscrEvaluations.length === 0,
        notes: 'DSCR method is ratio-based. Loan eligibility comes from DSCR-derived EMI capacity, ROI and lender max tenure.'
    });
}

function buildBusinessMarginLog(esr) {
    const margin = toNumber(esr.gst_industry_margin);
    const source = normalizeSource(
        esr.gst_json || esr.raw_gst_json || null,
        {
            gstIndustryType: esr.gst_industry_type || null,
            gstIndustryMargin: esr.gst_industry_margin || null
        }
    );
    const warnings = [];
    if (margin === null) {
        warnings.push('Business margin could not be resolved because GST industry margin is unavailable.');
    }
    return buildLogEntry({
        methodName: 'Business Margin',
        sourcePath: 'case_esr_financials.gst_industry_margin / gst_industry_type',
        source,
        inputValues: {
            gstIndustryType: esr.gst_industry_type || null,
            gstIndustryMargin: esr.gst_industry_margin || null
        },
        formula: 'gstIndustryMargin used for GST income derivation',
        intermediateCalculations: {
            gstIndustryType: esr.gst_industry_type || null,
            gstIndustryMargin: margin
        },
        finalMonthlyIncome: toNumber(esr.gst_income) || 0,
        warnings,
        manualReviewRequired: margin === null,
        ignored: margin === null
    });
}

function buildNetWorthLog(esr) {
    return buildLogEntry({
        methodName: 'Net Worth',
        sourcePath: 'Net worth method is not available in current ESR snapshot',
        source: normalizeSource(null, null),
        inputValues: {},
        formula: 'Net Worth method requires external net worth data not stored in ESR snapshot.',
        intermediateCalculations: {},
        finalMonthlyIncome: 0,
        warnings: ['Net Worth method is not available from the current ESR snapshot data.'],
        manualReviewRequired: true,
        ignored: true
    });
}

function collectWarnings(lenderResults) {
    if (!Array.isArray(lenderResults)) return [];
    return lenderResults.reduce((warnings, lender) => {
        if (Array.isArray(lender.policy_warnings)) {
            warnings.push(...lender.policy_warnings);
        }
        if (lender.manual_review_required) {
            warnings.push(`Lender ${lender.lender_name || lender.lender_id} requested manual review.`);
        }
        return warnings;
    }, []);
}

function buildIncomeCalculationLog(esr, lenderResults = []) {
    const selectedMethod = esr.selected_income_method || null;
    const selectedMonthlyIncome = toNumber(esr.selected_monthly_income) || 0;
    const manualIncomeImpact = buildManualIncomeImpactLog(esr);
    const propertyCollateral = buildPropertyCollateralLog(esr, lenderResults);
    const obligationAudit = buildObligationAuditLog(esr);
    const methodEligibilitySummary = buildMethodEligibilitySummary(lenderResults);
    const evaluatedMethodNames = new Set(
        (lenderResults || []).flatMap((lender) => (lender.scheme_evaluations || []))
            .map((evaluation) => String(evaluation.scheme_name || '').toUpperCase())
            .filter(Boolean)
    );
    const hasMethod = (matcher) => Array.from(evaluatedMethodNames).some((name) => matcher.test(name));
    const visibleMethods = {
        ...(hasMethod(/SALARIED/) ? { salaried: buildSalariedLog(esr) } : {}),
        ...(hasMethod(/BANKING|\bABB\b/) ? { bankingAbb: buildBankingAbbLog(esr) } : {}),
        ...(hasMethod(/\bGST\b|GROSS\s+MARGIN/) ? { gst: buildGstLog(esr) } : {}),
        ...(hasMethod(/ITR|NET\s+PROFIT|CASH\s+PROFIT|\bNPM\b/) ? { itrNpm: buildItrNpmLog(esr) } : {}),
        ...(hasMethod(/\bGRP\b|GROSS\s+RECEIPT/) ? { grp: buildGrpLog(esr) } : {}),
        ...(hasMethod(/\bDSCR\b|\bDCSR\b/) ? { dscr: buildDscrLog(esr, lenderResults) } : {}),
        ...(hasMethod(/BUSINESS\s+MARGIN/) ? { businessMargin: buildBusinessMarginLog(esr) } : {}),
        ...(hasMethod(/NET\s+WORTH|\bNWM\b/) ? { netWorth: buildNetWorthLog(esr) } : {})
    };

    return {
        selectedMethod,
        selectedMonthlyIncome,
        propertyCollateral,
        manualIncomeImpact,
        obligationAudit,
        methodEligibilitySummary,
        visibleEvaluatedMethods: Array.from(evaluatedMethodNames),
        methods: visibleMethods,
        aggregatedWarnings: [
            ...collectWarnings(lenderResults),
            ...manualIncomeImpact.warnings,
            ...propertyCollateral.warnings,
            ...obligationAudit.warnings
        ]
    };
}

module.exports = {
    buildIncomeCalculationLog
};
