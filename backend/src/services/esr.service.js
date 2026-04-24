const prisma = require('../../config/db');
const { generateDynamicESR } = require('./esr/dynamicEligibility.service');

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

async function generateESR(case_id, user_id, tenant_id) {
  // Delegate entirely to the new Dynamic Engine
  return await generateDynamicESR(case_id, user_id, tenant_id);
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
