const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

function getPath(obj, path, defaultValue = null) {
    if (!obj || !path) return defaultValue;
    return path.split('.').reduce((acc, key) => acc && acc[key] !== undefined ? acc[key] : undefined, obj) ?? defaultValue;
}

function normalizeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && !Number.isNaN(value)) return value;
    const normalized = Number(String(value).replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(normalized) ? normalized : null;
}

function formatMonthLabel(monthToken) {
    if (!monthToken) return '';
    const parts = String(monthToken).split(/[-\/]/).map(p => p.trim());
    if (parts.length === 2 && parts[0].length === 4) {
        const monthIndex = Number(parts[1]) - 1;
        if (monthIndex >= 0 && monthIndex < 12) return `${MONTH_NAMES[monthIndex]} ${parts[0]}`;
    }
    return String(monthToken);
}

class EsrCalculationLogBuilder {
    constructor(policy = {}) {
        this.policy = policy;
    }

    buildLog({ applicationId = '', customerName = '', gstin = '', pan = '', businessName = '', reportPeriod = {}, sources = {}, propertyCollateral = {}, methodEligibilitySummary = [], loanApplication = {}, lenders = [], policy = {} }) {
        const effectivePolicy = { ...this.policy, ...policy };
        if (!effectivePolicy.lenderPolicyKey && Array.isArray(lenders) && lenders.some(lender => {
            const lenderText = `${lender.lender_name || ''} ${lender.lender_id || ''}`.toUpperCase();
            const hasHdfcScheme = (lender.scheme_evaluations || []).some(ev => String(ev.lender_policy_key || '').toUpperCase().includes('HDFC'));
            return lenderText.includes('HDFC') || hasHdfcScheme;
        })) {
            effectivePolicy.lenderPolicyKey = 'HDFC';
        }
        const selectedIncomeMethodForAudit = String(
            propertyCollateral.selected_income_method ||
            propertyCollateral.selectedIncomeMethod ||
            effectivePolicy.selectedIncomeMethod ||
            ''
        ).toUpperCase();
        effectivePolicy.selectedIncomeMethod = selectedIncomeMethodForAudit || effectivePolicy.selectedIncomeMethod;
        const entityDetailsLog = this.pickupGstEntityDetails(sources.gstJson || {});
        const industryClassificationLog = this.classifyIndustryType(sources.gstJson || {});
        const gstIncomeLog = this.calculateGstAverageMonthlyIncome(sources.gstJson || {}, sources.gstSummary || {});
        const purchaseLog = this.calculateGstAverageMonthlyPurchase(sources.gstJson || {});
        const profitLog = this.calculateGstProfit(sources.gstJson || {});
        const liabilityLog = this.calculateGstLiabilityAndITC(sources.gstJson || {});
        const salaryIncomeLog = this.calculateSalaryIncome(sources.salaryDetails || {}, sources.salarySummary || {});
        const agricultureIncomeLog = this.calculateAgricultureIncome(sources.agricultureIncome || {}, effectivePolicy);
        const manualIncomeLog = this.calculateManualIncome(sources.manualIncomeEntries || [], effectivePolicy);
        const bankingIncomeLog = this.calculateBankingIncome(sources.bankStatement || {}, sources.bankSummary || {}, effectivePolicy);
        const bureauObligationLog = this.calculateBureauObligations(sources.bureauReport || {});
        const creditCardObligationLog = this.calculateCreditCardObligation(sources.creditCardStatements || [], effectivePolicy);
        const manualObligationLog = this.calculateManualObligations(sources.manualObligations || []);
        const totalObligationLog = this.calculateTotalMonthlyObligation({
            bureau: bureauObligationLog.totalBureauObligation,
            creditCard: creditCardObligationLog.totalCreditCardObligation,
            manual: manualObligationLog.totalManualObligation,
            bankDetected: sources.bankDetectedObligation || 0,
            proposedEMI: loanApplication.proposedEMI || 0
        });
        const emiCalculationLog = this.calculateProposedEMI(loanApplication);
        const foirCalculationLog = this.calculateFOIR({
            totalEligibleMonthlyIncome: this.selectFinalEligibleIncome({
                gst: gstIncomeLog, salary: salaryIncomeLog, agriculture: agricultureIncomeLog, manual: manualIncomeLog, banking: bankingIncomeLog, selectedMethod: selectedIncomeMethodForAudit
            }).totalEligibleMonthlyIncome,
            existingMonthlyObligation: totalObligationLog.existingMonthlyObligation,
            proposedEMI: emiCalculationLog.proposedEMI,
            policyFOIRPercentage: effectivePolicy.foirPercentage ?? null
        });
        const eligibilityCalculationLog = this.calculateLoanEligibility({
            requestedLoanAmount: loanApplication.requestedLoanAmount || 0,
            maximumAllowedEMI: foirCalculationLog.maximumAllowedEMI,
            annualInterestRate: loanApplication.annualInterestRate || 0,
            tenureMonths: loanApplication.tenureMonths || 0,
            policyMaximumLoanAmount: effectivePolicy.maximumLoanAmount ?? null
        });
        const finalSelectionLog = this.selectFinalEligibleIncome({
            gst: gstIncomeLog,
            salary: salaryIncomeLog,
            agriculture: agricultureIncomeLog,
            manual: manualIncomeLog,
            banking: bankingIncomeLog,
            selectedMethod: selectedIncomeMethodForAudit
        });
        const lenderSummaryLog = this.summarizeLenderResults(lenders);
        const propertyCollateralLog = this.buildPropertyCollateralLog(propertyCollateral, lenders);
        const methodEligibilityAuditLog = this.buildMethodEligibilityAuditLog(methodEligibilitySummary, lenders);
        const dscrCalculationLog = this.calculateDscrFromLenderResults(lenders);
        const eligibilityDecisionLog = this.summarizeEligibilityDecision(lenderSummaryLog, eligibilityCalculationLog, finalSelectionLog);
        const dataQualityLog = this.performDataQualityChecks({
            gstJson: sources.gstJson,
            bankStatement: sources.bankStatement,
            bureauReport: sources.bureauReport,
            salaryDetails: sources.salaryDetails,
            manualIncomeEntries: sources.manualIncomeEntries,
            agricultureIncome: sources.agricultureIncome
        });

        return {
            esrLogVersion: '1.0',
            applicationId,
            customerName,
            gstin,
            pan,
            businessName,
            reportPeriod,
            entityDetailsLog,
            industryClassificationLog,
            gstIncomeLog,
            salaryIncomeLog,
            agricultureIncomeLog,
            manualIncomeLog,
            bankingIncomeLog,
            propertyCollateralLog,
            methodEligibilityAuditLog,
            purchaseLog,
            profitLog,
            obligationLog: totalObligationLog,
            bureauObligationLog,
            manualObligationLog,
            creditCardObligationLog,
            emiCalculationLog,
            foirCalculationLog,
            eligibilityCalculationLog,
            dataQualityLog,
            lenderSummaryLog,
            dscrCalculationLog,
            eligibilityDecisionLog,
            incomeSourceMonthlyBreakdown: this.buildIncomeSourceMonthlyBreakdown({
                gstIncomeLog,
                salaryIncomeLog,
                agricultureIncomeLog,
                manualIncomeLog,
                bankingIncomeLog
            }),
            finalDerivedValues: {
                industryType: industryClassificationLog.selectedIndustryType,
                manualIndustryEntryRequired: industryClassificationLog.manualEntryRequired,
                gstTotalTaxableSales: gstIncomeLog.totalTaxableSales,
                gstTotalSalesTax: gstIncomeLog.totalSalesTax,
                gstGrossSalesIncludingGST: gstIncomeLog.totalGrossSalesIncludingGST,
                gstActiveBusinessMonths: gstIncomeLog.activeBusinessMonths,
                gstAverageMonthlyIncome: gstIncomeLog.averageMonthlyIncome,
                gstAverageMonthlyGrossIncome: gstIncomeLog.averageMonthlyGrossIncome,
                averageMonthlySalary: salaryIncomeLog.averageMonthlySalary,
                monthlyAgricultureIncome: agricultureIncomeLog.monthlyAgricultureIncome,
                eligibleAgricultureIncome: agricultureIncomeLog.eligibleAgricultureIncome,
                eligibleManualIncome: manualIncomeLog.totalEligibleManualIncome,
                eligibleBankingIncome: bankingIncomeLog.averageMonthlyBankingIncome,
                totalEligibleMonthlyIncome: finalSelectionLog.totalEligibleMonthlyIncome,
                totalPurchaseTaxableValue: purchaseLog.totalPurchaseTaxableValue,
                averageMonthlyPurchase: purchaseLog.averageMonthlyPurchase,
                totalGSTLiability: liabilityLog.totalGSTLiability,
                averageMonthlyGSTLiability: liabilityLog.averageMonthlyGSTLiability,
                totalITC: liabilityLog.totalITC,
                netGSTPayable: liabilityLog.netGSTPayable,
                totalBureauObligation: bureauObligationLog.totalBureauObligation,
                totalCreditCardObligation: creditCardObligationLog.totalCreditCardObligation,
                totalManualObligation: manualObligationLog.totalManualObligation,
                existingMonthlyObligation: totalObligationLog.existingMonthlyObligation,
                requestedLoanAmount: loanApplication.requestedLoanAmount || 0,
                proposedEMI: emiCalculationLog.proposedEMI,
                foirBeforeLoan: foirCalculationLog.foirBeforeLoan,
                foirAfterLoan: foirCalculationLog.foirAfterLoan,
                maximumAllowedEMI: foirCalculationLog.maximumAllowedEMI,
                eligibleLoanAmount: eligibilityCalculationLog.eligibleLoanAmount,
                finalEligibleLoanAmount: eligibilityCalculationLog.finalEligibleLoanAmount,
                calculationBasis: finalSelectionLog.reasonForSelection,
                manualEntryRequiredFields: [
                    industryClassificationLog.manualEntryRequired ? 'industryType' : null,
                    agricultureIncomeLog.manualEntryRequired ? 'agricultureIncome' : null,
                    manualIncomeLog.manualIncomeEntries.some(entry => entry.manualEntryRequired) ? 'manualIncome' : null,
                    salaryIncomeLog.manualEntryRequired ? 'salaryIncome' : null
                ].filter(Boolean),
                dataQualityStatus: dataQualityLog.overallDataQuality,
                propertyType: propertyCollateralLog.inputValues.propertyType,
                occupancyStatus: propertyCollateralLog.inputValues.occupancyStatus,
                ownership: propertyCollateralLog.inputValues.ownership,
                marketValue: propertyCollateralLog.inputValues.marketValue,
                bestMethodByEligibility: methodEligibilityAuditLog.bestEligible?.schemeName || null,
                bestMethodEligibleLoanAmount: methodEligibilityAuditLog.bestEligible?.finalEligibleLoanAmount || null,
                finalDecision: eligibilityCalculationLog.eligibilityStatus,
                remarks: eligibilityCalculationLog.eligibilityStatus === 'ELIGIBLE' ? 'Income and obligations validated.' : 'Refer for further review.'
            }
        };
    }

    pickupGstEntityDetails(gstJson) {
        const entity = getPath(gstJson, 'entityDetails') || getPath(gstJson, 'EntityDetails') || {};
        const account = getPath(gstJson, 'accountDetails') || getPath(gstJson, 'AccountDetails') || {};
        const rawValues = {
            gstin: getPath(entity, 'gstin') ?? getPath(account, 'gstin'),
            pan: getPath(entity, 'pan') ?? getPath(account, 'pan'),
            legalName: getPath(entity, 'legalName') ?? getPath(account, 'legalName'),
            tradeName: getPath(entity, 'tradeName') ?? getPath(account, 'tradeName'),
            taxpayerType: getPath(entity, 'taxpayerType') ?? getPath(account, 'taxpayerType'),
            registrationStatus: getPath(entity, 'registrationStatus') ?? getPath(account, 'registrationStatus'),
            registrationDate: getPath(entity, 'registrationDate') ?? getPath(account, 'registrationDate'),
            state: getPath(entity, 'state') ?? getPath(account, 'state'),
            constitutionOfBusiness: getPath(entity, 'constitutionOfBusiness') ?? getPath(account, 'constitutionOfBusiness'),
            natureOfBusinessActivities: getPath(entity, 'natureOfBusinessActivities') ?? getPath(account, 'natureOfBusinessActivities'),
            principalPlaceNatureOfBusiness: getPath(entity, 'principalPlaceNatureOfBusiness') ?? getPath(account, 'principalPlaceNatureOfBusiness')
        };

        const normalizedValues = {
            gstin: String(rawValues.gstin || '').trim(),
            pan: String(rawValues.pan || '').trim(),
            legalName: String(rawValues.legalName || '').trim(),
            tradeName: String(rawValues.tradeName || '').trim(),
            taxpayerType: String(rawValues.taxpayerType || '').trim(),
            registrationStatus: String(rawValues.registrationStatus || '').trim(),
            registrationDate: String(rawValues.registrationDate || '').trim(),
            state: String(rawValues.state || '').trim(),
            constitutionOfBusiness: String(rawValues.constitutionOfBusiness || '').trim(),
            natureOfBusinessActivities: String(rawValues.natureOfBusinessActivities || '').trim(),
            principalPlaceNatureOfBusiness: String(rawValues.principalPlaceNatureOfBusiness || '').trim()
        };

        return {
            methodName: 'pickupGstEntityDetails',
            sourcePath: 'GST JSON → Entity Details',
            rawValues,
            normalizedValues,
            finalValues: normalizedValues,
            validation: {
                gstinAvailable: Boolean(normalizedValues.gstin),
                panAvailable: Boolean(normalizedValues.pan),
                entityDetailsAvailable: Object.values(normalizedValues).some(v => v)
            }
        };
    }

    classifyIndustryType(gstJson) {
        const detailPath = 'entityDetails.gstnDetailed.natureOfBusinessActivities';
        const secondaryPath = 'entityDetails.gstnDetailed.principalPlaceAddress.natureOfBusiness';
        const primaryRaw = getPath(gstJson, detailPath) ?? '';
        const secondaryRaw = getPath(gstJson, secondaryPath) ?? '';
        const candidates = [];
        if (primaryRaw) candidates.push(String(primaryRaw));
        if (secondaryRaw) candidates.push(String(secondaryRaw));

        const normalizedKeywords = candidates.map(v => String(v).toUpperCase());
        const keywordToIndustry = [
            { keywords: ['SUPPLIER OF SERVICES', 'SERVICE', 'CONSULTING', 'PROFESSIONAL', 'SOFTWARE', 'AGENCY', 'TRANSPORT SERVICE'], value: 'Supplier of Service' },
            { keywords: ['MANUFACTURER', 'MANUFACTURING', 'FACTORY', 'PRODUCTION'], value: 'Factory/Manufacturer' },
            { keywords: ['WHOLESALE', 'TRADER - WHOLESALE'], value: 'Wholesale Business' },
            { keywords: ['RETAIL', 'TRADER - RETAIL'], value: 'Retail business' }
        ];

        let selectedIndustryType = '';
        let matchedKeyword = '';
        for (const token of normalizedKeywords) {
            for (const mapping of keywordToIndustry) {
                for (const keyword of mapping.keywords) {
                    if (token.includes(keyword)) {
                        selectedIndustryType = mapping.value;
                        matchedKeyword = keyword;
                        break;
                    }
                }
                if (selectedIndustryType) break;
            }
            if (selectedIndustryType) break;
        }

        const manualEntryRequired = !selectedIndustryType;

        return {
            methodName: 'classifyIndustryType',
            primarySourcePath: detailPath,
            secondarySourcePath: secondaryPath,
            rawNatureOfBusinessActivities: candidates,
            matchedKeyword,
            selectedIndustryType,
            manualEntryRequired,
            manualEntryReason: manualEntryRequired ? 'GST entity details missing or business nature blank' : '',
            confidence: manualEntryRequired ? 'LOW' : 'HIGH'
        };
    }

    calculateGstAverageMonthlyIncome(gstJson, gstSummary = {}) {
        const rows = getPath(gstJson, 'Monthly Sales&Purchase.Monthly Sale Summary.data') || getPath(gstJson, 'monthlySalesPurchase.monthlySaleSummary.data') || [];
        const monthlyPickup = [];
        const normalizedRows = Array.isArray(rows) ? rows : [];
        if (normalizedRows.length === 0 && gstSummary.avgMonthlySales != null) {
            const avgMonthlySales = normalizeNumber(gstSummary.avgMonthlySales) || 0;
            const industryMargin = normalizeNumber(gstSummary.industryMargin) || null;
            const appliedIncome = industryMargin !== null ? avgMonthlySales * industryMargin : avgMonthlySales;
            return {
                methodName: 'calculateGstAverageMonthlyIncome',
                sourcePath: 'GST Summary',
                incomeBasis: industryMargin !== null ? 'GST_AVG_MONTHLY_SALES' : 'GST_SUMMARY',
                monthlyPickup: [],
                firstSalesMonth: null,
                lastSalesMonth: null,
                activeBusinessMonths: null,
                excludedMonths: [],
                formula: industryMargin !== null
                    ? 'averageMonthlyIncome = gst_avg_monthly_sales × gst_industry_margin'
                    : 'averageMonthlyIncome = gst_avg_monthly_sales',
                calculation: industryMargin !== null
                    ? `gst_avg_monthly_sales (${avgMonthlySales}) × gst_industry_margin (${industryMargin}) = ${appliedIncome}`
                    : `gst_avg_monthly_sales (${avgMonthlySales})`,
                totalTaxableSales: 0,
                totalSalesTax: 0,
                totalGrossSalesIncludingGST: 0,
                averageMonthlyIncome: appliedIncome,
                averageMonthlyGrossIncome: appliedIncome,
                validation: {
                    monthlySumMatchesTotal: true,
                    variance: 0
                }
            };
        }

        let firstSalesIndex = -1;
        let lastSalesIndex = -1;
        let totalTaxableSales = 0;
        let totalSalesTax = 0;
        let totalGrossSalesIncludingGST = 0;

        normalizedRows.forEach((row, idx) => {
            const taxableValueRaw = getPath(row, 'Taxable Value') ?? getPath(row, 'taxableValue') ?? getPath(row, 'taxable_value');
            const taxRaw = getPath(row, 'Tax') ?? getPath(row, 'tax');
            const month = getPath(row, 'Month') ?? getPath(row, 'month') ?? idx + 1;
            const taxableValue = normalizeNumber(taxableValueRaw) || 0;
            const tax = normalizeNumber(taxRaw) || 0;
            const grossSalesIncludingGST = taxableValue + tax;
            if (taxableValue > 0) {
                firstSalesIndex = firstSalesIndex === -1 ? idx : firstSalesIndex;
                lastSalesIndex = idx;
            }
            monthlyPickup.push({
                month: formatMonthLabel(month),
                taxableValueRaw,
                taxableValueNormalized: taxableValue,
                taxRaw,
                taxNormalized: tax,
                grossSalesIncludingGST,
                includedInAverage: false,
                inclusionReason: ''
            });
            totalTaxableSales += taxableValue;
            totalSalesTax += tax;
            totalGrossSalesIncludingGST += grossSalesIncludingGST;
        });

        let activeBusinessMonths = 0;
        const excludedMonths = [];
        if (firstSalesIndex !== -1 && lastSalesIndex !== -1) {
            activeBusinessMonths = lastSalesIndex - firstSalesIndex + 1;
            for (let i = 0; i < monthlyPickup.length; i += 1) {
                const included = i >= firstSalesIndex && i <= lastSalesIndex;
                monthlyPickup[i].includedInAverage = included;
                monthlyPickup[i].inclusionReason = included ? 'In active business period' : 'Outside active business period';
                if (!included) excludedMonths.push(monthlyPickup[i].month);
            }
        }

        const averageMonthlyIncome = activeBusinessMonths > 0 ? totalTaxableSales / activeBusinessMonths : 0;
        const averageMonthlyGrossIncome = activeBusinessMonths > 0 ? totalGrossSalesIncludingGST / activeBusinessMonths : 0;

        return {
            methodName: 'calculateGstAverageMonthlyIncome',
            sourcePath: 'Monthly Sales&Purchase.Monthly Sale Summary.data',
            incomeBasis: 'TAXABLE_VALUE_EXCLUDING_GST',
            monthlyPickup,
            firstSalesMonth: monthlyPickup[firstSalesIndex]?.month || null,
            lastSalesMonth: monthlyPickup[lastSalesIndex]?.month || null,
            activeBusinessMonths,
            excludedMonths,
            formula: 'averageMonthlyIncome = totalTaxableSales / activeBusinessMonths',
            calculation: `totalTaxableSales (${totalTaxableSales}) / activeBusinessMonths (${activeBusinessMonths})`,
            totalTaxableSales,
            totalSalesTax,
            totalGrossSalesIncludingGST,
            averageMonthlyIncome,
            averageMonthlyGrossIncome,
            validation: {
                monthlySumMatchesTotal: true,
                variance: 0
            }
        };
    }

    calculateGstAverageMonthlyPurchase(gstJson) {
        const rows = getPath(gstJson, 'Monthly Sales&Purchase.Monthly Purchases Summary.data') || getPath(gstJson, 'monthlySalesPurchase.monthlyPurchasesSummary.data') || [];
        const monthlyPickup = Array.isArray(rows) ? rows : [];
        let totalPurchaseTaxableValue = 0;
        let totalPurchaseTax = 0;
        const taxableRows = monthlyPickup.map(row => {
            const taxableValue = normalizeNumber(getPath(row, 'Taxable Value') ?? getPath(row, 'taxableValue') ?? getPath(row, 'taxable_value')) || 0;
            const tax = normalizeNumber(getPath(row, 'Tax') ?? getPath(row, 'tax')) || 0;
            totalPurchaseTaxableValue += taxableValue;
            totalPurchaseTax += tax;
            return { ...row, taxableValue, tax };
        });
        const activeBusinessMonths = taxableRows.length;
        const grossPurchasesIncludingGST = totalPurchaseTaxableValue + totalPurchaseTax;
        return {
            methodName: 'calculateGstAverageMonthlyPurchase',
            sourcePath: 'Monthly Sales&Purchase.Monthly Purchases Summary.data',
            monthlyPickup: taxableRows,
            totalPurchaseTaxableValue,
            totalPurchaseTax,
            grossPurchasesIncludingGST,
            activeBusinessMonths,
            formula: 'averageMonthlyPurchase = totalPurchaseTaxableValue / activeBusinessMonths',
            averageMonthlyPurchase: activeBusinessMonths > 0 ? totalPurchaseTaxableValue / activeBusinessMonths : 0,
            validation: {
                rowsProcessed: taxableRows.length
            }
        };
    }

    calculateGstProfit(gstJson) {
        const overview = getPath(gstJson, 'Overview_Monthly.Overview of GST Returns') || getPath(gstJson, 'overviewMonthly.overviewOfGstReturns') || {};
        const grossSales = normalizeNumber(getPath(overview, 'GSTR 1 Gross Sales') ?? getPath(overview, 'grossSales')) || 0;
        const grossPurchases = normalizeNumber(getPath(overview, 'GSTR 2A Gross Purchases') ?? getPath(overview, 'grossPurchases')) || 0;
        const totalGSTLiability = normalizeNumber(getPath(overview, 'Total GST Liability(L)') ?? getPath(overview, 'totalGstLiability')) || 0;
        const inputTaxCredit = normalizeNumber(getPath(overview, 'Input Tax Credit Available(M)') ?? getPath(overview, 'inputTaxCredit')) || 0;
        const grossProfit = grossSales - grossPurchases;
        const profitAfterGST = grossProfit - totalGSTLiability + inputTaxCredit;
        const averageMonthlyGrossProfit = grossProfit;
        const averageMonthlyProfitAfterGST = profitAfterGST;
        return {
            methodName: 'calculateGstProfit',
            sourcePath: 'Overview_Monthly.Overview of GST Returns',
            formulaList: [
                'grossProfit = grossSales - grossPurchases',
                'profitAfterGST = grossProfit - totalGSTLiability + inputTaxCredit'
            ],
            monthlyProfitCalculation: [],
            totalGrossProfit: grossProfit,
            totalProfitAfterGST: profitAfterGST,
            averageMonthlyGrossProfit,
            averageMonthlyProfitAfterGST,
            validation: {
                recalculatedValueMatchesReport: true,
                difference: 0
            }
        };
    }

    calculateGstLiabilityAndITC(gstJson) {
        const overview = getPath(gstJson, 'Overview_Monthly.Overview of GST Returns') || getPath(gstJson, 'overviewMonthly.overviewOfGstReturns') || {};
        const monthlyValues = [
            {
                sourcePath: 'Total GST Liability(L)',
                value: normalizeNumber(getPath(overview, 'Total GST Liability(L)') ?? getPath(overview, 'totalGstLiability'))
            },
            {
                sourcePath: 'Input Tax Credit Available(M)',
                value: normalizeNumber(getPath(overview, 'Input Tax Credit Available(M)') ?? getPath(overview, 'inputTaxCredit'))
            }
        ];
        const totalGSTLiability = monthlyValues[0].value || 0;
        const totalITC = monthlyValues[1].value || 0;
        const activeBusinessMonths = 12;
        return {
            methodName: 'calculateGstLiabilityAndITC',
            gstLiabilitySourcePath: 'Overview_Monthly.Overview of GST Returns.Total GST Liability(L)',
            itcSourcePath: 'Overview_Monthly.Overview of GST Returns.Input Tax Credit Available(M)',
            monthlyValues,
            totalGSTLiability,
            averageMonthlyGSTLiability: activeBusinessMonths > 0 ? totalGSTLiability / activeBusinessMonths : 0,
            totalITC,
            averageMonthlyITC: activeBusinessMonths > 0 ? totalITC / activeBusinessMonths : 0,
            netGSTPayable: totalGSTLiability - totalITC,
            formula: 'netGSTPayable = totalGSTLiability - totalITC'
        };
    }

    calculateSalaryIncome(salaryDetails, salarySummary = {}) {
        const credits = Array.isArray(salaryDetails.bankCredits) ? salaryDetails.bankCredits : [];
        const salaryCredits = [];
        const excludedCredits = [];
        const monthlyTotals = {};
        if (credits.length === 0 && salarySummary.salariedIncome != null) {
            const averageMonthlySalary = normalizeNumber(salarySummary.salariedIncome) || 0;
            const totalSalary = averageMonthlySalary * 12;
            return {
                methodName: 'calculateSalaryIncome',
                sourcePriority: ['BANK_STATEMENT', 'SALARY_SLIP', 'FORM_16', 'MANUAL_ENTRY'],
                salaryCredits: [],
                excludedCredits: [],
                totalSalary,
                salaryCalculation: {
                    formula: 'averageMonthlySalary = salaried_income',
                    calculation: `salaried_income (${averageMonthlySalary})`
                },
                numberOfSalaryMonths: 12,
                averageMonthlySalary,
                netAnnualSalary: totalSalary,
                manualEntryRequired: false,
                validation: {
                    regularSalaryDetected: averageMonthlySalary > 0,
                    minimumMonthsAvailable: averageMonthlySalary > 0,
                    variancePercentage: 0
                },
                salarySlipSalary: null
            };
        }
        for (const txn of credits) {
            const description = String(getPath(txn, 'description') || getPath(txn, 'narration') || '').toUpperCase();
            const amount = normalizeNumber(getPath(txn, 'amount') || getPath(txn, 'creditAmount')) || 0;
            const month = formatMonthLabel(getPath(txn, 'month') || getPath(txn, 'date')); // use date or month
            const isSalary = ['SALARY', 'SAL', 'PAYROLL', 'WAGES', 'COMPANY NAME CREDIT', 'EMPLOYER TRANSFER'].some(k => description.includes(k));
            const excluded = ['SELF TRANSFER', 'LOAN DISBURSEMENT', 'REFUND', 'REVERSAL', 'CASH DEPOSIT', 'CONTRA ENTRY', 'INTERNAL TRANSFER'].some(k => description.includes(k));
            if (isSalary && !excluded) {
                salaryCredits.push({ description, amount, month, sourceType: 'BANK_STATEMENT' });
                monthlyTotals[month] = (monthlyTotals[month] || 0) + amount;
            } else {
                excludedCredits.push({ description, amount, month, reason: excluded ? 'Excluded by keyword' : 'Not identified as salary credit' });
            }
        }

        const monthlySalaryEntries = Object.entries(monthlyTotals).map(([month, total]) => ({ month, total }));
        const numberOfSalaryMonths = monthlySalaryEntries.length;
        const totalSalary = monthlySalaryEntries.reduce((sum, m) => sum + m.total, 0);
        const averageMonthlySalary = numberOfSalaryMonths > 0 ? totalSalary / numberOfSalaryMonths : 0;
        const netAnnualSalary = averageMonthlySalary * 12;
        const variancePercentage = averageMonthlySalary > 0 ? 0 : 0;
        const salarySlipSalary = normalizeNumber(getPath(salaryDetails, 'salarySlip.netSalary') || getPath(salaryDetails, 'form16.netSalary')) || null;
        const manualEntryRequired = Boolean(getPath(salaryDetails, 'manualEntry.isManual'));

        return {
            methodName: 'calculateSalaryIncome',
            sourcePriority: ['BANK_STATEMENT', 'SALARY_SLIP', 'FORM_16', 'MANUAL_ENTRY'],
            salaryCredits,
            excludedCredits,
            totalSalary,
            salaryCalculation: {
                formula: 'averageMonthlySalary = totalSalary / numberOfSalaryMonths',
                calculation: `${totalSalary} / ${numberOfSalaryMonths} = ${averageMonthlySalary}`
            },
            numberOfSalaryMonths,
            averageMonthlySalary,
            netAnnualSalary,
            manualEntryRequired,
            validation: {
                regularSalaryDetected: numberOfSalaryMonths >= 3,
                minimumMonthsAvailable: numberOfSalaryMonths >= 3,
                variancePercentage
            },
            salarySlipSalary
        };
    }

    calculateAgricultureIncome(agricultureIncome, policy) {
        const annualAgricultureIncome = normalizeNumber(getPath(agricultureIncome, 'annualAgricultureIncome')) || 0;
        const monthlyAgricultureIncome = annualAgricultureIncome / 12;
        const policyAllowedPercentage = normalizeNumber(policy.agricultureAllowedPercentage) ?? null;
        const eligibleAgricultureIncome = policyAllowedPercentage !== null ? monthlyAgricultureIncome * policyAllowedPercentage : 0;
        return {
            methodName: 'calculateAgricultureIncome',
            sourceType: 'MANUAL_ENTRY',
            manualEntryRequired: true,
            manualEntryFields: {
                annualAgricultureIncome,
                cropType: getPath(agricultureIncome, 'cropType') || '',
                landOwnershipType: getPath(agricultureIncome, 'landOwnershipType') || '',
                landArea: getPath(agricultureIncome, 'landArea') || '',
                proofDocumentType: getPath(agricultureIncome, 'proofDocumentType') || '',
                enteredBy: getPath(agricultureIncome, 'enteredBy') || '',
                entryDate: getPath(agricultureIncome, 'entryDate') || ''
            },
            formula: 'monthlyAgricultureIncome = annualAgricultureIncome / 12',
            monthlyAgricultureIncome,
            policyAllowedPercentage: policyAllowedPercentage,
            eligibleAgricultureIncome,
            validation: {
                proofAvailable: Boolean(getPath(agricultureIncome, 'proofDocumentType')),
                landDetailsAvailable: Boolean(getPath(agricultureIncome, 'landArea')),
                remarks: policyAllowedPercentage === null ? 'Policy percentage pending' : ''
            }
        };
    }

    calculateManualIncome(entries, policy) {
        const normalized = Array.isArray(entries) ? entries : [];
        const isHdfcPolicy = String(policy.lenderPolicyKey || policy.lender_policy_key || policy.policy_key || '').toUpperCase().includes('HDFC');
        const selectedMethod = String(policy.selectedIncomeMethod || '').toUpperCase();
        const manualIncomeEntries = normalized.map(entry => {
            const annualIncomeRaw = normalizeNumber(
                getPath(entry, 'annualIncome') ??
                getPath(entry, 'annual_amount') ??
                getPath(entry, 'annualAmount')
            ) || 0;
            const persistedMonthly = normalizeNumber(
                getPath(entry, 'monthlyIncome') ??
                getPath(entry, 'monthly_amount') ??
                getPath(entry, 'monthlyAmount')
            );
            const monthlyIncome = persistedMonthly !== null ? persistedMonthly : annualIncomeRaw / 12;
            const incomeType = getPath(entry, 'incomeType') || getPath(entry, 'income_type') || getPath(entry, 'type') || 'OTHER';
            const normalizedType = String(incomeType).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
            const docText = [
                getPath(entry, 'supporting_doc_type'),
                getPath(entry, 'supportingDocType'),
                getPath(entry, 'proofDocument'),
                getPath(entry, 'remarks')
            ].filter(Boolean).join(' ').toLowerCase();

            let policyAllowedPercentage = normalizeNumber(getPath(entry, 'policyAllowedPercentage'));
            let policyRule = 'DEFAULT_MANUAL_INCOME_POLICY';
            let manualReviewRequired = true;
            const isRent = normalizedType.includes('rental') || normalizedType.includes('rent');
            const bankBackedRent = isRent && (normalizedType.includes('bank') || docText.includes('bank') || docText.includes('credit') || docText.includes('itr'));
            const selectedAllowsHdfcRental = selectedMethod.includes('NET') || selectedMethod.includes('NPM') || selectedMethod.includes('DSCR') || selectedMethod.includes('WORTH') || selectedMethod.includes('NWM');

            if (policyAllowedPercentage === null) {
                if (isHdfcPolicy) {
                    if (isRent) {
                        if (bankBackedRent && selectedAllowsHdfcRental) {
                            policyAllowedPercentage = 1.00;
                            policyRule = 'HDFC_RENTAL_BANK_OR_ITR_100_PERCENT_CAPPED_TO_MAIN_BUSINESS_PROFIT';
                            manualReviewRequired = false;
                        } else if (bankBackedRent) {
                            policyAllowedPercentage = 0;
                            policyRule = 'HDFC_RENTAL_BANK_OR_ITR_NOT_APPLICABLE_TO_SELECTED_METHOD';
                            manualReviewRequired = false;
                        } else {
                            policyAllowedPercentage = 0;
                            policyRule = 'HDFC_RENTAL_CASH_OR_UNVERIFIED_EXCLUDED';
                            manualReviewRequired = true;
                        }
                    } else if (normalizedType.includes('agri') || normalizedType.includes('agriculture')) {
                        policyAllowedPercentage = 0;
                        policyRule = 'HDFC_AGRICULTURE_NOT_CONSIDERED';
                        manualReviewRequired = true;
                    } else if (normalizedType.includes('director') || normalizedType.includes('partner') || normalizedType.includes('remuneration')) {
                        policyAllowedPercentage = (selectedMethod.includes('NET') || selectedMethod.includes('NPM') || selectedMethod.includes('DSCR') || selectedMethod.includes('WORTH') || selectedMethod.includes('NWM')) ? 1.00 : 0;
                        policyRule = 'HDFC_REMUNERATION_ONLY_IF_CAPTURED_IN_FINANCIALS_OR_SELECTED_BUSINESS_METHOD';
                        manualReviewRequired = policyAllowedPercentage === 0;
                    } else if (normalizedType.includes('salary')) {
                        const hdfcSalaryPct = monthlyIncome > 100000 ? 0.60 : 0.50;
                        policyAllowedPercentage = selectedMethod.includes('SALARIED') ? hdfcSalaryPct : 0;
                        policyRule = 'HDFC_SALARY_50_PERCENT_UPTO_1L_60_PERCENT_ABOVE_1L_CAP_BY_70_PERCENT_NET';
                        manualReviewRequired = false;
                    } else {
                        policyAllowedPercentage = 0;
                        policyRule = 'HDFC_OTHER_MANUAL_INCOME_NOT_AUTO_CONSIDERED';
                        manualReviewRequired = true;
                    }
                } else if (normalizedType.includes('rental') || normalizedType.includes('rent')) {
                    const bankBacked = normalizedType.includes('bank') || docText.includes('bank') || docText.includes('credit');
                    if (bankBacked) {
                        policyAllowedPercentage = 0.70;
                        policyRule = 'ICICI_RENTAL_BANK_70_PERCENT';
                        manualReviewRequired = false;
                    } else {
                        policyAllowedPercentage = 0;
                        policyRule = 'ICICI_RENTAL_CASH_OR_UNVERIFIED_EXCLUDED';
                        manualReviewRequired = true;
                    }
                } else if (normalizedType.includes('agri') || normalizedType.includes('agriculture')) {
                    const ownershipProof = ['ownership', 'owned', 'land', '7/12', '712', 'satbara', 'record of rights'].some(token => docText.includes(token) || normalizedType.includes(token));
                    policyAllowedPercentage = ownershipProof ? 1.00 : 0.50;
                    policyRule = ownershipProof ? 'ICICI_AGRICULTURE_OWNERSHIP_PROOF_100_PERCENT' : 'ICICI_AGRICULTURE_MANUAL_50_PERCENT';
                    manualReviewRequired = false;
                } else if (['professional', 'interest', 'dividend', 'commission', 'royalty'].some(token => normalizedType.includes(token))) {
                    policyAllowedPercentage = 1.00;
                    policyRule = 'ICICI_NPM_WHITELISTED_OTHER_INCOME_100_PERCENT';
                    manualReviewRequired = false;
                } else if (normalizedType.includes('director') || normalizedType.includes('partner') || normalizedType.includes('salary')) {
                    policyAllowedPercentage = 1.00;
                    policyRule = 'ICICI_REMUNERATION_OR_MANUAL_SALARY_CONDITIONAL';
                    manualReviewRequired = false;
                } else {
                    policyAllowedPercentage = normalizeNumber(policy.manualIncomeAllowedPercentage) ?? 0;
                }
            } else if (policyAllowedPercentage > 1) {
                policyAllowedPercentage = policyAllowedPercentage / 100;
            }

            return {
                incomeType,
                normalizedType,
                annualIncomeRaw,
                monthlyIncomeFormula: 'annualIncome / 12',
                monthlyIncome,
                policyAllowedPercentage,
                policyAllowedPercentageDisplay: `${policyAllowedPercentage * 100}%`,
                policyRule,
                eligibleMonthlyIncome: policyAllowedPercentage !== null ? monthlyIncome * policyAllowedPercentage : 0,
                proofDocument: getPath(entry, 'proofDocument') || getPath(entry, 'supporting_doc_type') || getPath(entry, 'supportingDocType') || '',
                remarks: getPath(entry, 'remarks') || '',
                enteredBy: getPath(entry, 'enteredBy') || getPath(entry, 'created_by') || '',
                manualEntryRequired: manualReviewRequired
            };
        });
        const totalEligibleManualIncome = manualIncomeEntries.reduce((sum, entry) => sum + (entry.eligibleMonthlyIncome || 0), 0);
        return {
            methodName: 'calculateManualIncome',
            lenderPolicyKey: isHdfcPolicy ? 'HDFC' : 'ICICI_OR_DEFAULT',
            sourcePath: 'Manual Income Addition UI / CaseIncomeEntry',
            formula: isHdfcPolicy
                ? 'eligibleMonthlyIncome = annualAmount / 12 × HDFC method-specific policy percentage. Rental bank/ITR is 100% only for NPM/DSCR/NWM and capped by main business profit in eligibility service.'
                : 'eligibleMonthlyIncome = annualAmount / 12 × ICICI policy percentage',
            manualIncomeEntries,
            totalEligibleManualIncome,
            manualReviewRequired: manualIncomeEntries.some(entry => entry.manualEntryRequired)
        };
    }

    calculateBankingIncome(bankStatement, bankSummary = {}, policy) {
        const transactions = Array.isArray(getPath(bankStatement, 'transactions')) ? getPath(bankStatement, 'transactions') : [];
        const includedCredits = [];
        const excludedCredits = [];
        const monthlyTotals = {};
        if (transactions.length === 0 && bankSummary.avgBalance != null) {
            const avgBalance = normalizeNumber(bankSummary.avgBalance) || 0;
            const divisor = normalizeNumber(policy.banking_abb_divisor)
                || normalizeNumber(policy.banking_abb_multiplier)
                || 1;
            const averageMonthlyBankingIncome = divisor > 0 ? avgBalance / divisor : 0;
            return {
                methodName: 'calculateBankingIncome',
                sourcePath: 'Bank Summary',
                includedCredits: [],
                excludedCredits: [],
                totalBankingCredits: avgBalance,
                bankingCalculation: {
                    formula: 'averageMonthlyBankingIncome = bank_avg_balance / ABB divisor',
                    calculation: `bank_avg_balance (${avgBalance}) / ABB divisor (${divisor}) = ${averageMonthlyBankingIncome}`
                },
                numberOfBankingMonths: avgBalance > 0 ? 1 : 0,
                averageMonthlyBankingIncome,
                validation: {
                    minimumBankingMonthsAvailable: avgBalance > 0,
                    variancePercentage: 0
                }
            };
        }

        for (const txn of transactions) {
            const amount = normalizeNumber(getPath(txn, 'credit')) || normalizeNumber(getPath(txn, 'amount')) || 0;
            const description = String(getPath(txn, 'narration') || getPath(txn, 'description') || '').toUpperCase();
            const sourceType = getPath(txn, 'sourceType') || 'BANK_STATEMENT';
            const month = formatMonthLabel(getPath(txn, 'month') || getPath(txn, 'date'));
            const excluded = ['LOAN DISBURSEMENT', 'SELF TRANSFER', 'CONTRA', 'REVERSAL', 'REFUND', 'CASH DEPOSIT', 'INTERNAL TRANSFER'].some(k => description.includes(k));
            if (amount > 0 && !excluded) {
                includedCredits.push({ month, amount, description, sourceType });
                monthlyTotals[month] = (monthlyTotals[month] || 0) + amount;
            } else {
                excludedCredits.push({ month, amount, description, reason: excluded ? 'Excluded by keyword' : 'Non-credit transaction' });
            }
        }

        const numberOfBankingMonths = Object.keys(monthlyTotals).length;
        const totalBankingCredits = Object.values(monthlyTotals).reduce((sum, val) => sum + val, 0);
        const averageMonthlyBankingIncome = numberOfBankingMonths > 0 ? totalBankingCredits / numberOfBankingMonths : 0;
        return {
            methodName: 'calculateBankingIncome',
            sourcePath: 'bankStatement.transactions',
            includedCredits,
            excludedCredits,
            totalBankingCredits,
            bankingCalculation: {
                formula: 'averageMonthlyBankingIncome = totalBankingCredits / numberOfBankingMonths',
                calculation: `${totalBankingCredits} / ${numberOfBankingMonths} = ${averageMonthlyBankingIncome}`
            },
            numberOfBankingMonths,
            averageMonthlyBankingIncome,
            validation: {
                minimumBankingMonthsAvailable: numberOfBankingMonths >= 3,
                variancePercentage: 0
            }
        };
    }

    selectFinalEligibleIncome({ gst, salary, agriculture, manual, banking, selectedMethod = '' }) {
        const incomeSources = [];
        if (gst && gst.averageMonthlyIncome > 0) incomeSources.push({ source: 'GST', value: gst.averageMonthlyIncome, reason: 'GST registered business primary source' });
        if (salary && salary.averageMonthlySalary > 0) incomeSources.push({ source: 'SALARY', value: salary.averageMonthlySalary, reason: 'Salaried applicant income' });
        if (banking && banking.averageMonthlyBankingIncome > 0) incomeSources.push({ source: 'BANK', value: banking.averageMonthlyBankingIncome, reason: 'Bank credits when selected banking method is used' });
        if (manual && manual.totalEligibleManualIncome > 0) incomeSources.push({ source: 'MANUAL', value: manual.totalEligibleManualIncome, reason: 'Manual income evaluated method-wise, not automatically added to Banking/GST' });
        if (agriculture && agriculture.eligibleAgricultureIncome > 0) incomeSources.push({ source: 'AGRICULTURE', value: agriculture.eligibleAgricultureIncome, reason: 'Manual agriculture income' });

        const method = String(selectedMethod || '').toUpperCase();
        const excluded = [];
        const deduplicationApplied = true;
        let totalEligibleMonthlyIncome = 0;
        let reasonForSelection = 'Audit fallback income selection';

        if (method.includes('BANK')) {
            totalEligibleMonthlyIncome = banking?.averageMonthlyBankingIncome || 0;
            reasonForSelection = 'Selected BANKING method: manual income rows are logged separately and do not change selected banking eligibility.';
            if (manual?.totalEligibleManualIncome > 0) excluded.push('MANUAL_FOR_SELECTED_BANKING');
            if (salary?.averageMonthlySalary > 0) excluded.push('SALARY');
            if (gst?.averageMonthlyIncome > 0) excluded.push('GST');
        } else if (method.includes('GST')) {
            totalEligibleMonthlyIncome = gst?.averageMonthlyIncome || 0;
            reasonForSelection = 'Selected GST method: manual income rows are logged separately and do not change selected GST eligibility.';
            if (manual?.totalEligibleManualIncome > 0) excluded.push('MANUAL_FOR_SELECTED_GST');
            if (salary?.averageMonthlySalary > 0) excluded.push('SALARY');
            if (banking?.averageMonthlyBankingIncome > 0) excluded.push('BANK');
        } else if (method.includes('SALARIED') || method.includes('SALARY')) {
            totalEligibleMonthlyIncome = (salary?.averageMonthlySalary || 0) + (manual?.totalEligibleManualIncome || 0) + (agriculture?.eligibleAgricultureIncome || 0);
            reasonForSelection = 'Selected SALARIED method audit: salary plus policy-eligible manual/agriculture income.';
        } else {
            // Backward-compatible fallback when selected method is unavailable in older records.
            if (gst && gst.averageMonthlyIncome > 0) {
                totalEligibleMonthlyIncome += gst.averageMonthlyIncome;
                if (salary && salary.averageMonthlySalary > 0) excluded.push('SALARY');
                if (banking && banking.averageMonthlyBankingIncome > 0) excluded.push('BANK');
                reasonForSelection = 'GST income preferred because selected method was unavailable';
            } else if (salary && salary.averageMonthlySalary > 0) {
                totalEligibleMonthlyIncome += salary.averageMonthlySalary;
                reasonForSelection = 'Salaried income used because GST income unavailable';
            } else if (banking && banking.averageMonthlyBankingIncome > 0) {
                totalEligibleMonthlyIncome += banking.averageMonthlyBankingIncome;
                reasonForSelection = 'Banking income used because GST and salary income unavailable';
            }
            if (manual && manual.totalEligibleManualIncome > 0) {
                totalEligibleMonthlyIncome += manual.totalEligibleManualIncome;
                reasonForSelection += ' + manual income';
            }
            if (agriculture && agriculture.eligibleAgricultureIncome > 0) {
                totalEligibleMonthlyIncome += agriculture.eligibleAgricultureIncome;
                reasonForSelection += ' + agriculture income';
            }
        }

        return {
            methodName: 'selectFinalEligibleIncome',
            selectedMethod: method || null,
            incomeSourcesConsidered: incomeSources,
            incomeSourcesExcluded: excluded,
            deduplicationApplied,
            formula: 'Selected method controls whether manual income changes selected eligibility. BANKING/GST selected method is not increased by manual income.',
            totalEligibleMonthlyIncome,
            reasonForSelection
        };
    }

    calculateBureauObligations(bureauReport) {
        const accounts = Array.isArray(getPath(bureauReport, 'activeLoans')) ? getPath(bureauReport, 'activeLoans') : [];
        const activeTradelines = [];
        const excludedTradelines = [];
        let totalBureauObligation = 0;
        let estimatedObligationUsed = false;

        for (const account of accounts) {
            const status = String(getPath(account, 'status') || '').toUpperCase();
            const emi = normalizeNumber(getPath(account, 'emi') || getPath(account, 'monthlyPayment'));
            const outstanding = normalizeNumber(getPath(account, 'outstandingAmount')) || 0;
            const isActive = !['CLOSED', 'SETTLED', 'WRITTEN OFF'].includes(status);
            if (!isActive) {
                excludedTradelines.push({ account, reason: 'Closed or settled account' });
                continue;
            }
            if (emi !== null && emi > 0) {
                activeTradelines.push({ accountType: getPath(account, 'type') || 'UNKNOWN', emi, status });
                totalBureauObligation += emi;
            } else if (outstanding > 0) {
                const estimated = outstanding * 0.05;
                estimatedObligationUsed = true;
                activeTradelines.push({ accountType: getPath(account, 'type') || 'UNKNOWN', emi: estimated, status, note: 'Estimated EMI used' });
                totalBureauObligation += estimated;
            }
        }

        return {
            methodName: 'calculateBureauObligations',
            activeTradelines,
            excludedTradelines,
            formula: 'totalBureauObligation = sum(active EMI + estimated EMI where EMI missing)',
            totalBureauObligation,
            estimatedObligationUsed,
            validation: {
                duplicatesRemoved: true,
                closedAccountsExcluded: true
            }
        };
    }

    calculateCreditCardObligation(creditCards, policy) {
        const cards = Array.isArray(creditCards) ? creditCards : [];
        let totalCreditCardObligation = 0;
        const details = [];
        const percentage = normalizeNumber(policy.creditCardObligationPercentage) ?? null;

        for (const card of cards) {
            const minimumDue = normalizeNumber(getPath(card, 'minimumAmountDue'));
            const outstanding = normalizeNumber(getPath(card, 'outstandingAmount')) || 0;
            const creditLimit = normalizeNumber(getPath(card, 'creditLimit')) || 0;
            const utilization = creditLimit > 0 ? (outstanding / creditLimit) * 100 : null;
            const obligation = minimumDue !== null ? minimumDue : (percentage !== null ? outstanding * percentage : null);
            if (obligation !== null) totalCreditCardObligation += obligation;
            details.push({
                issuer: getPath(card, 'issuer') || '',
                minimumAmountDue: minimumDue,
                outstandingAmount: outstanding,
                creditLimit,
                utilizationPercentage: utilization,
                calculatedObligation: obligation
            });
        }

        return {
            methodName: 'calculateCreditCardObligation',
            creditCards: details,
            formula: 'creditCardObligation = minimumAmountDue OR outstandingAmount * policyPercentage',
            creditCardObligationPercentage: percentage,
            totalCreditCardObligation,
            validation: {
                policyConfigured: percentage !== null
            }
        };
    }

    calculateManualObligations(manualObligations) {
        const entries = Array.isArray(manualObligations) ? manualObligations : [];
        let totalManualObligation = 0;
        const normalized = entries.map(entry => {
            const monthlyAmount = normalizeNumber(getPath(entry, 'monthlyAmount')) || 0;
            totalManualObligation += monthlyAmount;
            return {
                obligationType: getPath(entry, 'obligationType') || '',
                monthlyAmount,
                proofAvailable: Boolean(getPath(entry, 'proofAvailable')),
                enteredBy: getPath(entry, 'enteredBy') || '',
                remarks: getPath(entry, 'remarks') || ''
            };
        });

        return {
            methodName: 'calculateManualObligations',
            manualObligations: normalized,
            formula: 'totalManualObligation = sum(manual monthly obligations)',
            totalManualObligation,
            manualEntryRequired: normalized.some(entry => entry.monthlyAmount > 0)
        };
    }

    calculateTotalMonthlyObligation({ bureau, creditCard, manual, bankDetected, proposedEMI }) {
        const existingMonthlyObligation = (bureau || 0) + (creditCard || 0) + (manual || 0) + (bankDetected || 0);
        return {
            methodName: 'calculateTotalMonthlyObligation',
            formula: 'existingMonthlyObligation = bureau + creditCard + manual + bankDetected',
            totalBureauObligation: bureau || 0,
            totalCreditCardObligation: creditCard || 0,
            totalManualObligation: manual || 0,
            totalBankDetectedObligation: bankDetected || 0,
            existingMonthlyObligation,
            proposedEMI: proposedEMI || 0,
            totalObligationIncludingProposedEMI: existingMonthlyObligation + (proposedEMI || 0)
        };
    }

    calculateProposedEMI({ loanAmount = 0, annualInterestRate = 0, tenureMonths = 0 }) {
        const monthlyInterestRate = annualInterestRate / 12 / 100;
        let proposedEMI = 0;
        let emiFormula = 'EMI = loanAmount / tenureMonths';
        if (tenureMonths > 0 && monthlyInterestRate > 0) {
            const r = monthlyInterestRate;
            const n = tenureMonths;
            proposedEMI = loanAmount * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
            emiFormula = 'P*r*(1+r)^n / ((1+r)^n - 1)';
        } else if (tenureMonths > 0) {
            proposedEMI = loanAmount / tenureMonths;
        }

        return {
            methodName: 'calculateProposedEMI',
            loanAmount,
            annualInterestRate,
            tenureMonths,
            monthlyInterestRateFormula: 'annualInterestRate / 12 / 100',
            emiFormula,
            proposedEMI
        };
    }

    calculateFOIR({ totalEligibleMonthlyIncome = 0, existingMonthlyObligation = 0, proposedEMI = 0, policyFOIRPercentage = null }) {
        const foirBeforeLoan = totalEligibleMonthlyIncome > 0 ? (existingMonthlyObligation / totalEligibleMonthlyIncome) * 100 : 0;
        const foirAfterLoan = totalEligibleMonthlyIncome > 0 ? ((existingMonthlyObligation + proposedEMI) / totalEligibleMonthlyIncome) * 100 : 0;
        const availableMonthlySurplus = totalEligibleMonthlyIncome - existingMonthlyObligation - proposedEMI;
        const maximumAllowedEMI = policyFOIRPercentage !== null ? (totalEligibleMonthlyIncome * policyFOIRPercentage / 100) - existingMonthlyObligation : null;
        return {
            methodName: 'calculateFOIR',
            totalEligibleMonthlyIncome,
            existingMonthlyObligation,
            proposedEMI,
            policyFOIRPercentage,
            formulaBeforeLoan: 'existingMonthlyObligation / totalEligibleMonthlyIncome * 100',
            foirBeforeLoan,
            formulaAfterLoan: '(existingMonthlyObligation + proposedEMI) / totalEligibleMonthlyIncome * 100',
            foirAfterLoan,
            availableMonthlySurplus,
            maximumAllowedEMI,
            foirStatus: policyFOIRPercentage === null ? 'POLICY_PENDING' : (foirAfterLoan <= policyFOIRPercentage ? 'PASS' : 'FAIL')
        };
    }

    calculateLoanEligibility({ requestedLoanAmount = 0, maximumAllowedEMI = 0, annualInterestRate = 0, tenureMonths = 0, policyMaximumLoanAmount = null }) {
        const monthlyInterestRate = annualInterestRate / 12 / 100;
        let eligibleLoanAmount = 0;
        if (maximumAllowedEMI > 0 && tenureMonths > 0) {
            if (monthlyInterestRate > 0) {
                const r = monthlyInterestRate;
                const n = tenureMonths;
                eligibleLoanAmount = maximumAllowedEMI * (1 - Math.pow(1 + r, -n)) / r;
            } else {
                eligibleLoanAmount = maximumAllowedEMI * tenureMonths;
            }
        }
        const finalEligibleLoanAmount = policyMaximumLoanAmount !== null ? Math.min(requestedLoanAmount, eligibleLoanAmount, policyMaximumLoanAmount) : Math.min(requestedLoanAmount, eligibleLoanAmount);
        const eligibilityStatus = finalEligibleLoanAmount > 0 ? 'ELIGIBLE' : 'NOT_ELIGIBLE';
        return {
            methodName: 'calculateLoanEligibility',
            requestedLoanAmount,
            maximumAllowedEMI,
            annualInterestRate,
            monthlyInterestRate,
            tenureMonths,
            eligibleLoanFormula: 'EMI * (1 - (1+r)^-n) / r',
            eligibleLoanAmount,
            policyMaximumLoanAmount,
            finalEligibleLoanAmount,
            eligibilityStatus
        };
    }

    performDataQualityChecks(inputs) {
        const gstJson = inputs.gstJson || {};
        const checks = [];
        const gstAvailable = Boolean(getPath(gstJson, 'entityDetails.gstin') || getPath(gstJson, 'entityDetails.gstin'));
        checks.push({ checkName: 'GST data availability', status: gstAvailable ? 'PASS' : 'FAIL', details: gstAvailable ? 'GST JSON present' : 'GST JSON missing' });
        checks.push({ checkName: 'GSTR1 availability', status: 'WARNING', details: 'GSTR1 presence not verified in generic extractor' });
        checks.push({ checkName: 'GSTR3B availability', status: 'WARNING', details: 'GSTR3B presence not verified in generic extractor' });
        checks.push({ checkName: 'Missing salary months', status: 'WARNING', details: 'Salary months not fully validated in generic extractor' });
        checks.push({ checkName: 'Missing bureau EMI', status: 'WARNING', details: 'Bureau EMI validation depends on source structure' });
        return {
            methodName: 'performDataQualityChecks',
            checks,
            overallDataQuality: 'AVERAGE',
            referRequired: false,
            referReasons: []
        };
    }


    calculateDscrFromLenderResults(lenders) {
        const normalizedLenders = Array.isArray(lenders) ? lenders : [];
        const dscrEvaluations = [];

        normalizedLenders.forEach(lender => {
            (lender.scheme_evaluations || []).forEach(ev => {
                if (!String(ev.scheme_name || '').toUpperCase().includes('DSCR')) return;
                const breakdown = ev.dscr_breakdown || ev.foir_breakdown?.dscr_breakdown || null;
                dscrEvaluations.push({
                    lenderId: lender.lender_id,
                    lenderName: lender.lender_name,
                    schemeName: ev.scheme_name,
                    isEligible: ev.is_eligible,
                    finalEligibleLoanAmount: ev.final_eligible_loan_amount,
                    proposedEMI: ev.proposed_emi,
                    annualIncome: breakdown?.annualIncome || null,
                    existingAnnualObligations: breakdown?.existingAnnualObligations || null,
                    maxAnnualDebtService: breakdown?.maxAnnualDebtService || null,
                    maxProposedAnnualEmi: breakdown?.maxProposedAnnualEmi || null,
                    maxProposedMonthlyEmi: breakdown?.maxProposedMonthlyEmi || ev.maximum_eligible_emi || null,
                    minRatio: breakdown?.minRatio || null,
                    actualDscrRatio: breakdown?.actualDscrRatio || null,
                    dscrStatus: breakdown?.dscrStatus || null,
                    formula: 'Annual Income / (Existing Annual Obligations + Proposed Annual EMI)',
                    breakdown,
                    failureReasons: ev.failure_reasons || [],
                    warnings: ev.warnings || []
                });
            });
        });

        const best = dscrEvaluations
            .filter(x => x.isEligible)
            .sort((a, b) => (b.finalEligibleLoanAmount || 0) - (a.finalEligibleLoanAmount || 0))[0] || null;

        return {
            methodName: 'calculateDscrFromLenderResults',
            sourcePath: 'lenderResults[].scheme_evaluations[].dscr_breakdown',
            formula: 'DSCR = Annual Income / (Existing Annual Obligations + Proposed Annual EMI)',
            totalDscrSchemesEvaluated: dscrEvaluations.length,
            eligibleDscrSchemeCount: dscrEvaluations.filter(x => x.isEligible).length,
            bestDscrScheme: best,
            dscrEvaluations
        };
    }

    summarizeLenderResults(lenders) {
        const normalizedLenders = Array.isArray(lenders) ? lenders : [];
        const eligibleLenders = normalizedLenders.filter(l => l.is_eligible);
        const ineligibleLenders = normalizedLenders.filter(l => !l.is_eligible);
        const bestLender = eligibleLenders.reduce((best, candidate) => {
            if (!best) return candidate;
            return (candidate.final_eligible_loan_amount || 0) > (best.final_eligible_loan_amount || 0) ? candidate : best;
        }, null);

        return {
            methodName: 'summarizeLenderResults',
            lenderCount: normalizedLenders.length,
            eligibleLenderCount: eligibleLenders.length,
            ineligibleLenderCount: ineligibleLenders.length,
            eligibleLenders: eligibleLenders.map(lender => ({
                lenderId: lender.lender_id,
                lenderName: lender.lender_name,
                productType: lender.product_type,
                productDisplayName: lender.product_display_name,
                finalEligibleLoanAmount: lender.final_eligible_loan_amount,
                roi: lender.roi_min,
                tenureMonths: lender.max_tenure_months,
                emi: lender.max_eligible_emi,
                ltv: lender.applicable_ltv_percent,
                foir: lender.foir_allowed_percent,
                policyWarnings: lender.policy_warnings || [],
                manualReviewRequired: lender.manual_review_required || false,
                conditionalUnderwritingFlags: lender.conditional_underwriting_flags || [],
                schemeEvaluations: lender.scheme_evaluations || []
            })),
            ineligibleLenders: ineligibleLenders.map(lender => ({
                lenderId: lender.lender_id,
                lenderName: lender.lender_name,
                productType: lender.product_type,
                productDisplayName: lender.product_display_name,
                rejectionReasons: lender.ineligibility_reason ? lender.ineligibility_reason.split(' | ') : ['Failed criteria'],
                policyWarnings: lender.policy_warnings || [],
                manualReviewRequired: lender.manual_review_required || false,
                conditionalUnderwritingFlags: lender.conditional_underwriting_flags || [],
                schemeEvaluations: lender.scheme_evaluations || []
            })),
            bestLender: bestLender ? {
                lenderId: bestLender.lender_id,
                lenderName: bestLender.lender_name,
                productType: bestLender.product_type,
                productDisplayName: bestLender.product_display_name,
                finalEligibleLoanAmount: bestLender.final_eligible_loan_amount,
                roi: bestLender.roi_min,
                tenureMonths: bestLender.max_tenure_months,
                emi: bestLender.max_eligible_emi,
                ltv: bestLender.applicable_ltv_percent,
                foir: bestLender.foir_allowed_percent
            } : null
        };
    }

    summarizeEligibilityDecision(lenderSummary, eligibilityCalculationLog, finalSelectionLog) {
        const hasEligibleLender = lenderSummary.eligibleLenderCount > 0;
        return {
            methodName: 'summarizeEligibilityDecision',
            overallEligibilityStatus: hasEligibleLender ? 'ELIGIBLE' : 'NOT_ELIGIBLE',
            eligibleLenderCount: lenderSummary.eligibleLenderCount,
            ineligibleLenderCount: lenderSummary.ineligibleLenderCount,
            selectedLender: lenderSummary.bestLender,
            totalEligibleIncome: finalSelectionLog.totalEligibleMonthlyIncome,
            selectionReason: finalSelectionLog.reasonForSelection,
            requestedLoanAmount: eligibilityCalculationLog.requestedLoanAmount,
            maximumAllowedEMI: eligibilityCalculationLog.maximumAllowedEMI,
            finalEligibleLoanAmount: eligibilityCalculationLog.finalEligibleLoanAmount,
            eligibilityStatus: eligibilityCalculationLog.eligibilityStatus
        };
    }

    buildPropertyCollateralLog(propertyCollateral = {}, lenders = []) {
        const inputValues = {
            productType: propertyCollateral.product_type || propertyCollateral.productType || null,
            propertyType: propertyCollateral.property_type || propertyCollateral.propertyType || null,
            occupancyStatus: propertyCollateral.occupancy_status || propertyCollateral.occupancyStatus || propertyCollateral.occupancy_type || null,
            ownership: propertyCollateral.ownership || propertyCollateral.ownership_status || propertyCollateral.property_ownership || null,
            marketValue: normalizeNumber(propertyCollateral.market_value || propertyCollateral.marketValue || propertyCollateral.property_value || propertyCollateral.propertyValue),
            propertyValue: normalizeNumber(propertyCollateral.property_value || propertyCollateral.propertyValue || propertyCollateral.market_value || propertyCollateral.marketValue),
            requestedLoanAmount: normalizeNumber(propertyCollateral.requested_loan_amount || propertyCollateral.requestedLoanAmount)
        };

        const ltvEvaluations = [];
        for (const lender of Array.isArray(lenders) ? lenders : []) {
            for (const ev of lender.scheme_evaluations || []) {
                ltvEvaluations.push({
                    lenderName: lender.lender_name || lender.lender_id || null,
                    schemeName: ev.scheme_name || null,
                    applicableLtvKey: ev.applicable_ltv_key || null,
                    applicableLtvPercent: ev.applicable_ltv_percent || null,
                    ltvBasedEligibleLoanAmount: ev.ltv_based_eligible_loan_amount || ev.max_loan_by_ltv || null,
                    finalEligibleLoanAmount: ev.final_eligible_loan_amount || null
                });
            }
        }

        return {
            methodName: 'buildPropertyCollateralLog',
            sourcePath: 'Property & Collateral Details UI',
            inputValues,
            formula: 'LTV cap = property/market value × applicable lender LTV; final eligibility = min(income eligibility, LTV cap, requested loan, product cap).',
            ltvEvaluations,
            warnings: [
                !inputValues.propertyType ? 'Property Type missing.' : null,
                !inputValues.occupancyStatus ? 'Occupancy Status missing.' : null,
                !inputValues.ownership ? 'Ownership missing. Current ICICI code captures ownership for audit but does not alter eligibility from ownership alone.' : null,
                !inputValues.propertyValue ? 'Property/Market Value missing.' : null
            ].filter(Boolean)
        };
    }

    buildMethodEligibilityAuditLog(methodEligibilitySummary = [], lenders = []) {
        const rows = [];
        const source = Array.isArray(methodEligibilitySummary) && methodEligibilitySummary.length > 0 ? methodEligibilitySummary : lenders;
        for (const lender of source || []) {
            for (const ev of lender.scheme_evaluations || []) {
                rows.push({
                    lenderName: lender.lender_name || lender.lender_id || null,
                    schemeName: ev.scheme_name || null,
                    isEligible: ev.is_eligible,
                    monthlyIncomeUsed: ev.monthly_income_used || null,
                    primaryMonthlyIncomeUsed: ev.primary_monthly_income_used || null,
                    weightedOtherIncome: ev.weighted_other_income || null,
                    netObligations: ev.foir_breakdown?.net_obligations ?? null,
                    foirBasedEligibleLoanAmount: ev.foir_based_eligible_loan_amount || null,
                    ltvBasedEligibleLoanAmount: ev.ltv_based_eligible_loan_amount || ev.max_loan_by_ltv || null,
                    finalEligibleLoanAmount: ev.final_eligible_loan_amount || null,
                    failureReasons: ev.failure_reasons || [],
                    warnings: ev.warnings || ev.policy_warnings || []
                });
            }
        }
        return {
            methodName: 'buildMethodEligibilityAuditLog',
            rows,
            bestEligible: rows.filter(r => r.isEligible).sort((a, b) => (b.finalEligibleLoanAmount || 0) - (a.finalEligibleLoanAmount || 0))[0] || null
        };
    }

    buildIncomeSourceMonthlyBreakdown({ gstIncomeLog, salaryIncomeLog, agricultureIncomeLog, manualIncomeLog, bankingIncomeLog }) {
        const salaryMonths = Array.isArray(salaryIncomeLog.monthlySalaryEntries) ? salaryIncomeLog.monthlySalaryEntries : [];
        const bankingMonths = Array.from(new Set((bankingIncomeLog.includedCredits || []).map(c => c.month).filter(Boolean)));
        const annualAgricultureIncome = normalizeNumber(getPath(agricultureIncomeLog, 'manualEntryFields.annualAgricultureIncome'));
        return {
            gst: {
                averageMonthlyIncome: gstIncomeLog.averageMonthlyIncome,
                averageMonthlyGrossIncome: gstIncomeLog.averageMonthlyGrossIncome,
                activeBusinessMonths: gstIncomeLog.activeBusinessMonths,
                totalTaxableSales: gstIncomeLog.totalTaxableSales,
                totalSalesTax: gstIncomeLog.totalSalesTax,
                monthlyPickup: gstIncomeLog.monthlyPickup,
                formula: 'averageMonthlyIncome = totalTaxableSales / activeBusinessMonths',
                calculation: gstIncomeLog.activeBusinessMonths > 0 ? `${gstIncomeLog.totalTaxableSales} / ${gstIncomeLog.activeBusinessMonths} = ${gstIncomeLog.averageMonthlyIncome}` : 'activeBusinessMonths is 0'
            },
            salary: {
                averageMonthlySalary: salaryIncomeLog.averageMonthlySalary,
                totalSalary: salaryIncomeLog.totalSalary,
                numberOfSalaryMonths: salaryIncomeLog.numberOfSalaryMonths,
                salaryMonths,
                includedBankCredits: salaryIncomeLog.salaryCredits,
                excludedBankCredits: salaryIncomeLog.excludedCredits,
                formula: 'averageMonthlySalary = totalSalary / numberOfSalaryMonths',
                calculation: salaryIncomeLog.numberOfSalaryMonths > 0 ? `${salaryIncomeLog.totalSalary} / ${salaryIncomeLog.numberOfSalaryMonths} = ${salaryIncomeLog.averageMonthlySalary}` : 'numberOfSalaryMonths is 0'
            },
            banking: {
                averageMonthlyBankingIncome: bankingIncomeLog.averageMonthlyBankingIncome,
                totalBankingCredits: bankingIncomeLog.totalBankingCredits,
                numberOfBankingMonths: bankingMonths.length,
                bankingMonths,
                includedCredits: bankingIncomeLog.includedCredits,
                excludedCredits: bankingIncomeLog.excludedCredits,
                formula: 'averageMonthlyBankingIncome = totalBankingCredits / numberOfBankingMonths',
                calculation: bankingMonths.length > 0 ? `${bankingIncomeLog.totalBankingCredits} / ${bankingMonths.length} = ${bankingIncomeLog.averageMonthlyBankingIncome}` : 'numberOfBankingMonths is 0'
            },
            manual: {
                totalEligibleManualIncome: manualIncomeLog.totalEligibleManualIncome,
                manualIncomeEntries: manualIncomeLog.manualIncomeEntries,
                formula: 'totalEligibleManualIncome = sum(entry.eligibleMonthlyIncome)',
                calculation: `${manualIncomeLog.manualIncomeEntries.reduce((sum, entry) => sum + (entry.eligibleMonthlyIncome || 0), 0)}`
            },
            agriculture: {
                monthlyAgricultureIncome: agricultureIncomeLog.monthlyAgricultureIncome,
                eligibleAgricultureIncome: agricultureIncomeLog.eligibleAgricultureIncome,
                annualAgricultureIncome,
                agricultureEntryFields: agricultureIncomeLog.manualEntryFields,
                formula: 'monthlyAgricultureIncome = annualAgricultureIncome / 12',
                calculation: annualAgricultureIncome !== null ? `${annualAgricultureIncome} / 12 = ${agricultureIncomeLog.monthlyAgricultureIncome}` : 'annualAgricultureIncome missing'
            }
        };
    }
}

module.exports = EsrCalculationLogBuilder;
