const prisma = require('../../config/db');

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
      customer: {
        include: {
          itr_analytics: { orderBy: { created_at: 'desc' }, take: 1 },
          gst_profiles:  { orderBy: { created_at: 'desc' }, take: 1 }
        }
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
  const itrPayload = caseRecord.customer?.itr_analytics?.[0]?.analytics_payload;
  const netProfit  = itrPayload?.net_profit || itrPayload?.netProfit || 0;
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

    // Use first matching product + first matching scheme
    const product = relevantProducts[0];
    const scheme  = product.schemes?.[0];

    if (!scheme) {
      lenderResults.push({
        lender_id:            lender.id,
        lender_name:          lender.name,
        is_eligible:          false,
        ineligibility_reason: 'No active scheme configured.'
      });
      continue;
    }

    // Evaluate each parameter
    let isEligible = true;
    let failReason = null;

    for (const pv of scheme.parameter_values) {
      const key   = pv.parameter?.parameter_key;
      const value = pv.value;

      switch (key) {
        case 'MIN_CIBIL': {
          const minCibil = Number(value?.amount || value);
          if (lowestCibilScore !== null && lowestCibilScore < minCibil) {
            isEligible = false;
            failReason = `CIBIL score ${lowestCibilScore} is below minimum required ${minCibil}`;
          }
          break;
        }
        case 'MAX_FOIR': {
          const maxFoir = Number(value?.percent || value) / 100;
          if (foir > maxFoir) {
            isEligible = false;
            failReason = `FOIR ${(foir * 100).toFixed(1)}% exceeds maximum allowed ${(maxFoir * 100).toFixed(1)}%`;
          }
          break;
        }
        case 'MIN_BUSINESS_VINTAGE_YEARS': {
          const minVintage = Number(value?.years || value);
          const vintage = caseRecord.customer?.business_vintage || 0;
          if (vintage < minVintage) {
            isEligible = false;
            failReason = `Business vintage ${vintage} years is below minimum ${minVintage} years`;
          }
          break;
        }
        case 'MIN_ANNUAL_INCOME': {
          const minIncome = Number(value?.amount || value);
          if (combinedAnnualIncome < minIncome) {
            isEligible = false;
            failReason = `Annual income ₹${combinedAnnualIncome.toLocaleString()} is below minimum ₹${minIncome.toLocaleString()}`;
          }
          break;
        }
        case 'MAX_LTV_PERCENT': {
          if (propertyValue > 0 && caseRecord.loan_amount) {
            const maxLtv = Number(value?.percent || value) / 100;
            const ltv = Number(caseRecord.loan_amount) / propertyValue;
            if (ltv > maxLtv) {
              isEligible = false;
              failReason = `LTV ${(ltv * 100).toFixed(1)}% exceeds maximum ${(maxLtv * 100).toFixed(1)}%`;
            }
          }
          break;
        }
        case 'MAX_LOAN_AMOUNT': {
          const maxLoan = Number(value?.amount || value);
          if (caseRecord.loan_amount && Number(caseRecord.loan_amount) > maxLoan) {
            isEligible = false;
            failReason = `Requested loan amount ₹${Number(caseRecord.loan_amount).toLocaleString()} exceeds maximum ₹${maxLoan.toLocaleString()}`;
          }
          break;
        }
        default:
          break;
      }
      if (!isEligible) break;
    }

    // Compute eligible loan amount (simplified: income-based FOIR)
    const maxEligibleEmi = monthlyIncome * 0.5 - totalEmiPerMonth; // 50% FOIR threshold
    const eligibilityResult = {
      lender_id:    lender.id,
      lender_name:  lender.name,
      product_name: product.product_name || product.product_type,
      scheme_name:  scheme.scheme_name,
      is_eligible:  isEligible
    };

    if (isEligible) {
      // Pull ROI and tenure from parameter values if available
      const roiPv   = scheme.parameter_values.find(pv => pv.parameter?.parameter_key === 'MIN_ROI');
      const maxLtv  = scheme.parameter_values.find(pv => pv.parameter?.parameter_key === 'MAX_LTV_PERCENT');
      const tenure  = scheme.parameter_values.find(pv => pv.parameter?.parameter_key === 'MAX_TENURE_MONTHS');

      eligibilityResult.roi_min             = roiPv ? Number(roiPv.value?.percent || roiPv.value) : null;
      eligibilityResult.max_ltv_percent     = maxLtv ? Number(maxLtv.value?.percent || maxLtv.value) : null;
      eligibilityResult.max_tenure_months   = tenure ? Number(tenure.value?.months || tenure.value) : null;
      eligibilityResult.max_eligible_emi    = maxEligibleEmi > 0 ? Math.round(maxEligibleEmi) : null;

      // LTV-based loan amount
      if (propertyValue && maxLtv) {
        const ltvRatio = Number(maxLtv.value?.percent || maxLtv.value) / 100;
        eligibilityResult.max_loan_amount = Math.round(propertyValue * ltvRatio);
      }
    } else {
      eligibilityResult.ineligibility_reason = failReason;
    }

    lenderResults.push(eligibilityResult);
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
  await prisma.case.update({
    where: { id: case_id },
    data:  { stage: 'ESR_GENERATED', esr_generated: true }
  });

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
