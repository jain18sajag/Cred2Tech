const prisma = require('../../config/db');

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const parsePercentRatio = (value) => {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  return numeric > 1 ? numeric / 100 : numeric;
};

const latestByYear = (records = []) => {
  if (!Array.isArray(records) || records.length === 0) return null;
  return [...records]
    .filter((record) => record && record.year !== undefined && record.year !== null)
    .sort((a, b) => Number(b.year) - Number(a.year))[0] || null;
};

const getNetProfitFromItrPayload = (itrPayload) => {
  if (!itrPayload) return 0;

  const source = typeof itrPayload === 'string' ? JSON.parse(itrPayload) : itrPayload;
  const root = source?.result || source;

  const directNetProfit = toNumber(
    root?.net_profit
    ?? root?.netProfit
    ?? root?.annual_net_profit
    ?? root?.income_summary?.net_profit
  );
  if (directNetProfit !== null) return directNetProfit;

  const itrNode = root?.iTR || root?.ITR;
  const pnlCollection = itrNode?.profitAndLossStatement;
  const pnlRows = Array.isArray(pnlCollection)
    ? pnlCollection
    : Array.isArray(pnlCollection?.profitAndLossStatement)
      ? pnlCollection.profitAndLossStatement
      : [];
  const latestPnl = latestByYear(pnlRows);
  const pnlNetProfit = toNumber(
    latestPnl?.profitAfterTax
    ?? latestPnl?.netProfit
    ?? latestPnl?.profit_after_tax
  );
  if (pnlNetProfit !== null) return pnlNetProfit;

  const taxCollection = itrNode?.taxCalculation?.taxCalculation;
  const latestTaxCalc = latestByYear(Array.isArray(taxCollection) ? taxCollection : []);
  const taxCalcNetProfit = toNumber(
    latestTaxCalc?.profitsAndGainsFromBusinessAndProfession
    ?? latestTaxCalc?.netProfit
  );
  if (taxCalcNetProfit !== null) return taxCalcNetProfit;

  const legacyNetProfit = toNumber(itrNode?.ITR3?.PARTA_PL?.ProfitAfterTax);
  return legacyNetProfit || 0;
};

const getParameterNumeric = (parameterValue, type = 'amount') => {
  const rawValue = parameterValue?.value;
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'object' && rawValue !== null) {
    if (rawValue[type] !== undefined) return toNumber(rawValue[type]);
  }
  return toNumber(rawValue);
};

const evaluateSchemeEligibility = ({ scheme, caseRecord, lowestCibilScore, foir, combinedAnnualIncome, propertyValue }) => {
  let isEligible = true;
  let failReason = null;

  for (const parameterValue of scheme.parameter_values || []) {
    const key = parameterValue.parameter?.parameter_key;
    switch (key) {
      case 'MIN_CIBIL': {
        const minCibil = getParameterNumeric(parameterValue);
        if (minCibil !== null && lowestCibilScore !== null && lowestCibilScore < minCibil) {
          isEligible = false;
          failReason = `CIBIL score ${lowestCibilScore} is below minimum required ${minCibil}`;
        }
        break;
      }
      case 'MAX_FOIR': {
        const maxFoirRatio = parsePercentRatio(getParameterNumeric(parameterValue, 'percent'));
        if (maxFoirRatio !== null && foir > maxFoirRatio) {
          isEligible = false;
          failReason = `FOIR ${(foir * 100).toFixed(1)}% exceeds maximum allowed ${(maxFoirRatio * 100).toFixed(1)}%`;
        }
        break;
      }
      case 'MIN_BUSINESS_VINTAGE_YEARS': {
        const minVintage = getParameterNumeric(parameterValue, 'years');
        const vintage = Number(caseRecord.customer?.business_vintage) || 0;
        if (minVintage !== null && vintage < minVintage) {
          isEligible = false;
          failReason = `Business vintage ${vintage} years is below minimum ${minVintage} years`;
        }
        break;
      }
      case 'MIN_ANNUAL_INCOME': {
        const minIncome = getParameterNumeric(parameterValue);
        if (minIncome !== null && combinedAnnualIncome < minIncome) {
          isEligible = false;
          failReason = `Annual income ₹${combinedAnnualIncome.toLocaleString()} is below minimum ₹${minIncome.toLocaleString()}`;
        }
        break;
      }
      case 'MAX_LTV_PERCENT': {
        if (propertyValue > 0 && caseRecord.loan_amount) {
          const maxLtvRatio = parsePercentRatio(getParameterNumeric(parameterValue, 'percent'));
          const ltv = Number(caseRecord.loan_amount) / propertyValue;
          if (maxLtvRatio !== null && ltv > maxLtvRatio) {
            isEligible = false;
            failReason = `LTV ${(ltv * 100).toFixed(1)}% exceeds maximum ${(maxLtvRatio * 100).toFixed(1)}%`;
          }
        }
        break;
      }
      case 'MAX_LOAN_AMOUNT': {
        const maxLoan = getParameterNumeric(parameterValue);
        if (maxLoan !== null && caseRecord.loan_amount && Number(caseRecord.loan_amount) > maxLoan) {
          isEligible = false;
          failReason = `Requested loan amount ₹${Number(caseRecord.loan_amount).toLocaleString()} exceeds maximum ₹${maxLoan.toLocaleString()}`;
        }
        break;
      }
      case 'MIN_LOAN_AMOUNT': {
        const minLoan = getParameterNumeric(parameterValue);
        if (minLoan !== null && caseRecord.loan_amount && Number(caseRecord.loan_amount) < minLoan) {
          isEligible = false;
          failReason = `Requested loan amount ₹${Number(caseRecord.loan_amount).toLocaleString()} is below minimum ₹${minLoan.toLocaleString()}`;
        }
        break;
      }
      default:
        break;
    }

    if (!isEligible) break;
  }

  return {
    isEligible,
    failReason: failReason || 'Scheme parameters not satisfied'
  };
};

/**
 * generateESR — runs the eligibility engine for a case and persists the result.
 *
 * Algorithm:
 *  1. Assemble inputs (income, property, CIBIL, EMI obligations)
 *  2. Fetch all active lenders with products/schemes/parameters matching case.product_type
 *  3. Per lender/scheme, run each parameter check
 *  4. Build per-lender result object
 *  5. Upsert EligibilityReport (one per case)
 *  6. Advance Case.stage to ESR_GENERATED
 */
async function generateESR(case_id, user_id, tenant_id) {
  // ── 1. Load the case with all required data ─────────────────────────────
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: {
      customer: true,
      itr_analytics: {
        where: { status: 'COMPLETED' },
        orderBy: { created_at: 'desc' },
        take: 1
      },
      applicants: true,
      income_entries: true,
      obligations:    { where: { status: 'ACTIVE' } },
      property:       true
    }
  });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  // ── 2. Compute inputs ────────────────────────────────────────────────────
  const manualIncomeTotal = caseRecord.income_entries.reduce((s, e) => s + (Number(e.annual_amount) || 0), 0);
  const netProfit = getNetProfitFromItrPayload(caseRecord.itr_analytics?.[0]?.analytics_payload);
  const combinedAnnualIncome = Number(netProfit) + manualIncomeTotal;

  const propertyValue = caseRecord.property?.market_value || 0;

  const scores = caseRecord.applicants.map(a => a.cibil_score).filter(Boolean);
  const primaryApplicant = caseRecord.applicants.find(a => a.type === 'PRIMARY');
  const primaryCibilScore = primaryApplicant?.cibil_score || null;
  const lowestCibilScore  = scores.length ? Math.min(...scores) : null;

  const totalEmiPerMonth = caseRecord.obligations.reduce((s, o) => s + (Number(o.emi_per_month) || 0), 0);
  const monthlyIncome = combinedAnnualIncome / 12;
  const foir = monthlyIncome > 0 ? totalEmiPerMonth / monthlyIncome : 0;

  // ── 3. Fetch matching lender products ────────────────────────────────────
  const lenders = await prisma.lender.findMany({
    where: { status: 'ACTIVE' },
    include: {
      products: {
        where: { status: 'ACTIVE' },
        include: {
          schemes: {
            where: { status: 'ACTIVE' },
            include: {
              parameter_values: { include: { parameter: true } }
            }
          }
        }
      }
    }
  });

  // ── 4. Evaluate eligibility per lender ───────────────────────────────────
  const lenderResults = [];

  for (const lender of lenders) {
    // Match products by product_type OR use all if no filter (for lenders that accept any)
    const relevantProducts = lender.products.filter(p =>
      !caseRecord.product_type || p.product_type === caseRecord.product_type
    );

    if (relevantProducts.length === 0) {
      lenderResults.push({
        lender_id:            lender.id,
        lender_name:          lender.name,
        is_eligible:          false,
        ineligibility_reason: `No active scheme for product type: ${caseRecord.product_type || 'N/A'}`
      });
      continue;
    }

    const schemeCandidates = relevantProducts.flatMap((product) =>
      (product.schemes || []).map((scheme) => ({ product, scheme }))
    );

    if (schemeCandidates.length === 0) {
      lenderResults.push({
        lender_id:            lender.id,
        lender_name:          lender.name,
        is_eligible:          false,
        ineligibility_reason: 'No active scheme configured.'
      });
      continue;
    }

    const evaluatedSchemes = [];
    const eligibleSchemes = [];

    for (const candidate of schemeCandidates) {
      const { product, scheme } = candidate;
      const evaluation = evaluateSchemeEligibility({
        scheme,
        caseRecord,
        lowestCibilScore,
        foir,
        combinedAnnualIncome,
        propertyValue
      });

      evaluatedSchemes.push({
        product_name: product.product_name || product.product_type,
        scheme_name: scheme.scheme_name,
        is_eligible: evaluation.isEligible,
        ineligibility_reason: evaluation.isEligible ? null : evaluation.failReason
      });

      if (evaluation.isEligible) {
        const maxFoirPv = scheme.parameter_values.find((pv) => pv.parameter?.parameter_key === 'MAX_FOIR');
        const maxFoirRatio = parsePercentRatio(getParameterNumeric(maxFoirPv, 'percent')) ?? 0.5;
        const maxEligibleEmi = monthlyIncome * maxFoirRatio - totalEmiPerMonth;

        const roiPv = scheme.parameter_values.find((pv) => pv.parameter?.parameter_key === 'MIN_ROI');
        const maxLtvPv = scheme.parameter_values.find((pv) => pv.parameter?.parameter_key === 'MAX_LTV_PERCENT');
        const tenurePv = scheme.parameter_values.find((pv) => pv.parameter?.parameter_key === 'MAX_TENURE_MONTHS');
        const maxLtvRatio = parsePercentRatio(getParameterNumeric(maxLtvPv, 'percent'));

        const result = {
          lender_id: lender.id,
          lender_name: lender.name,
          product_name: product.product_name || product.product_type,
          scheme_name: scheme.scheme_name,
          is_eligible: true,
          roi_min: toNumber(roiPv?.value?.percent ?? roiPv?.value) ?? null,
          max_ltv_percent: toNumber(maxLtvPv?.value?.percent ?? maxLtvPv?.value) ?? null,
          max_tenure_months: toNumber(tenurePv?.value?.months ?? tenurePv?.value) ?? null,
          max_eligible_emi: maxEligibleEmi > 0 ? Math.round(maxEligibleEmi) : null
        };

        if (propertyValue && maxLtvRatio !== null) {
          result.max_loan_amount = Math.round(propertyValue * maxLtvRatio);
        }

        eligibleSchemes.push(result);
      }
    }

    if (eligibleSchemes.length > 0) {
      eligibleSchemes.sort((a, b) => {
        const loanDelta = (b.max_loan_amount || 0) - (a.max_loan_amount || 0);
        if (loanDelta !== 0) return loanDelta;
        return (b.max_eligible_emi || 0) - (a.max_eligible_emi || 0);
      });

      const bestEligible = eligibleSchemes[0];
      bestEligible.scheme_evaluations = evaluatedSchemes;
      lenderResults.push(bestEligible);
      continue;
    }

    lenderResults.push({
      lender_id: lender.id,
      lender_name: lender.name,
      is_eligible: false,
      ineligibility_reason: evaluatedSchemes[0]?.ineligibility_reason || 'No eligible scheme found',
      scheme_evaluations: evaluatedSchemes
    });
  }

  // Sort: eligible first
  lenderResults.sort((a, b) => (b.is_eligible ? 1 : 0) - (a.is_eligible ? 1 : 0));

  // ── 5. Persist ESR ───────────────────────────────────────────────────────
  await prisma.eligibilityReport.upsert({
    where:  { case_id },
    create: {
      case_id,
      generated_by_user_id: user_id,
      combined_income:      combinedAnnualIncome,
      property_value:       propertyValue,
      primary_cibil_score:  primaryCibilScore,
      lowest_cibil_score:   lowestCibilScore,
      total_emi_per_month:  totalEmiPerMonth,
      raw_payload:          { lenders: lenderResults },
      status:               'GENERATED'
    },
    update: {
      generated_at:         new Date(),
      generated_by_user_id: user_id,
      combined_income:      combinedAnnualIncome,
      property_value:       propertyValue,
      primary_cibil_score:  primaryCibilScore,
      lowest_cibil_score:   lowestCibilScore,
      total_emi_per_month:  totalEmiPerMonth,
      raw_payload:          { lenders: lenderResults },
      status:               'GENERATED',
      updated_at:           new Date()
    }
  });

  // ── 6. Advance stage ─────────────────────────────────────────────────────
  const caseUpdateResult = await prisma.case.updateMany({
    where: { id: case_id, tenant_id },
    data: { stage: 'ESR_GENERATED', esr_generated: true }
  });
  if (caseUpdateResult.count === 0) throw new Error('Case not found or unauthorized.');

  return {
    lenders:              lenderResults,
    eligible_count:       lenderResults.filter(l => l.is_eligible).length,
    total_count:          lenderResults.length,
    combined_income:      combinedAnnualIncome,
    property_value:       propertyValue,
    primary_cibil_score:  primaryCibilScore,
    lowest_cibil_score:   lowestCibilScore,
    total_emi_per_month:  totalEmiPerMonth
  };
}

/**
 * getESR — fetches the latest ESR for a case.
 */
async function getESR(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: { esr: true }
  });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');
  if (!caseRecord.esr) throw new Error('No ESR generated for this case yet.');
  return caseRecord.esr;
}

module.exports = { generateESR, getESR };
