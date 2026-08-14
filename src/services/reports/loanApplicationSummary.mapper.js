'use strict';

const {
  extractItrDetails,
  extractGstDetails,
  extractAllGstSummaries,
  extractBankDetails
} = require('../financial.extractor');
const { extractBankFySnapshot, extractBankSalary } = require('../bankParser.service');
const { decryptJson } = require('../../utils/fieldEncryption');

const SUCCESS = new Set(['COMPLETED', 'COMPLETE', 'SUCCESS', 'SUCCEEDED', 'PROCESSED']);

function json(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function authoritativeJson(value) {
  const parsed = json(value);
  if (!parsed) return null;
  const decrypted = json(decryptJson(parsed));
  if (parsed.__enc === 'v1' && decrypted?.__enc === 'v1') return null;
  return decrypted;
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const converted = value.toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  const cleaned = String(value)
    .trim()
    .replace(/[₹,\s%]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  if (value === null || value === undefined) return '';
  const result = String(value).trim();
  return /^[=+\-@]/.test(result) ? `'${result}` : result;
}

function time(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function recordTime(record) {
  return time(record?.metrics_extracted_at || record?.completed_at || record?.provider_completed_at || record?.updated_at || record?.created_at);
}


function normalizeLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function deepFindValues(root, wantedKeys, { arraysOnly = false, limit = 100 } = {}) {
  const wanted = new Set((wantedKeys || []).map(normalizeLookupKey));
  const found = [];
  const seen = new Set();

  function visit(value, depth = 0) {
    if (found.length >= limit || depth > 18 || value === null || value === undefined) return;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        const parsed = json(trimmed);
        if (parsed) visit(parsed, depth + 1);
      }
      return;
    }

    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      const normalized = normalizeLookupKey(key);
      if (wanted.has(normalized) && (!arraysOnly || Array.isArray(child))) found.push(child);
      visit(child, depth + 1);
    });
  }

  visit(root);
  return found;
}

function deepFirst(root, wantedKeys, fallback = null) {
  const direct = deepFindValues(root, wantedKeys, { limit: 20 });
  for (const value of direct) {
    if (value !== null && value !== undefined && value !== '' && !Array.isArray(value) && typeof value !== 'object') {
      return value;
    }
  }
  return fallback;
}

function deepArray(root, wantedKeys) {
  const arrays = deepFindValues(root, wantedKeys, { arraysOnly: true, limit: 20 });
  return arrays.find(value => Array.isArray(value) && value.length) || [];
}

function firstObjectFromArray(root, wantedKeys) {
  const items = deepArray(root, wantedKeys);
  return items.find(item => item && typeof item === 'object' && !Array.isArray(item)) || null;
}

function normalizeMonthLabel(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return raw;
}

function sortMonthlyRows(rows = []) {
  return [...rows].sort((a, b) => {
    const left = Date.parse(`1 ${a.month || ''}`);
    const right = Date.parse(`1 ${b.month || ''}`);
    if (!Number.isNaN(left) && !Number.isNaN(right)) return left - right;
    return String(a.month || '').localeCompare(String(b.month || ''));
  });
}

function normalizeMonthlyRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => {
      if (!row || typeof row !== 'object') return null;
      const month = row.Month ?? row.month ?? row.period ?? row.monthYear ?? row.month_year ?? row.date;
      const taxableValue = number(
        row['Taxable Value']
        ?? row.taxableValue
        ?? row.taxable_value
        ?? row.sales
        ?? row.purchase
        ?? row.amount
        ?? row.total
      );
      const tax = number(
        row.Tax
        ?? row.tax
        ?? row.taxAmount
        ?? row.tax_amount
        ?? row.gst
      );
      if (!month && taxableValue === null && tax === null) return null;
      return {
        month: normalizeMonthLabel(month),
        taxableValue,
        tax
      };
    })
    .filter(Boolean);
}

function extractGstMonthlyRows(payload, type) {
  if (!payload) return [];
  const keyCandidates = type === 'purchase'
    ? ['monthlyPurchaseSummary', 'purchaseSummary', 'monthlyPurchases', 'purchases']
    : ['monthlySaleSummary', 'monthlySalesSummary', 'salesSummary', 'monthlySales', 'sales'];

  const direct = deepArray(payload, keyCandidates);
  if (direct.length) {
    const nestedData = direct.flatMap(item => Array.isArray(item?.data) ? item.data : []);
    const normalized = normalizeMonthlyRows(nestedData.length ? nestedData : direct);
    if (normalized.length) return normalized;
  }

  const containers = deepFindValues(payload, keyCandidates, { limit: 20 });
  for (const container of containers) {
    if (container?.data && Array.isArray(container.data)) {
      const normalized = normalizeMonthlyRows(container.data);
      if (normalized.length) return normalized;
    }
  }
  return [];
}

function extractGstFinancialYears(payload) {
  const candidates = deepFindValues(payload, ['OverviewOfGSTReturns'], { arraysOnly: true, limit: 20 });
  const rows = candidates.flatMap(value => Array.isArray(value) ? value : [])
    .filter(row => row && typeof row === 'object' && !Array.isArray(row))
    .map(row => ({
      financial_year: row['Month Year'] ?? row.financial_year ?? row.financialYear,
      turnover: firstNumber(
        row['GSTR 1 Gross Sales (E=A+B-C+D)'],
        row.gstr1GrossSales,
        row.turnover
      )
    }))
    .filter(row => /^FY\s*\d{4}[-/]\d{2,4}$/i.test(String(row.financial_year || '')) && row.turnover !== null);

  return rows.sort((a, b) => String(b.financial_year).localeCompare(String(a.financial_year)));
}

function deterministicSort(records = []) {
  return [...records].sort((a, b) => {
    const successDelta = Number(SUCCESS.has(String(b?.status || b?.report_status || '').toUpperCase()))
      - Number(SUCCESS.has(String(a?.status || a?.report_status || '').toUpperCase()));
    if (successDelta) return successDelta;
    return recordTime(b) - recordTime(a)
      || time(b?.updated_at) - time(a?.updated_at)
      || time(b?.created_at) - time(a?.created_at)
      || Number(b?.id || 0) - Number(a?.id || 0);
  });
}

function isPrimary(applicant, index = 0) {
  const type = String(applicant?.type || applicant?.applicant_type || '').toUpperCase();
  return applicant?.is_primary === true || type.includes('PRIMARY') || (!type.includes('CO') && index === 0);
}

function scopedRecords(records, caseRecord, primaryApplicant, warnings, sourceName) {
  const tenantId = Number(caseRecord.tenant_id);
  const caseId = Number(caseRecord.id);
  const customerId = Number(caseRecord.customer_id || caseRecord.customer?.id);
  const primaryId = Number(primaryApplicant?.id);
  const inCase = (records || []).filter(record =>
    Number(record.tenant_id) === tenantId
    && Number(record.case_id) === caseId
    && Number(record.customer_id) === customerId
    && SUCCESS.has(String(record.status || record.report_status || '').toUpperCase())
  );
  const exactApplicant = inCase.filter(record => record.applicant_id && Number(record.applicant_id) === primaryId);
  if (exactApplicant.length) return deterministicSort(exactApplicant);
  const legacyUnscoped = inCase.filter(record => !record.applicant_id);
  if (legacyUnscoped.length) warnings.push(`${sourceName}: using legacy case/customer-scoped record because applicant_id is missing.`);
  return deterministicSort(legacyUnscoped);
}

function pickPayload(record, fields) {
  for (const field of fields) {
    const payload = json(record?.[field]);
    if (payload) return { payload, field };
  }
  return { payload: null, field: null };
}

function collectPayloads(record, fields) {
  const entries = [];
  for (const field of fields) {
    const payload = json(record?.[field]);
    if (hasPayloadContent(payload)) entries.push({ field, payload });
  }
  return entries;
}

function firstNonEmptyObject(objects = []) {
  return (objects || []).find(value => value && typeof value === 'object' && Object.keys(value).length) || {};
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function collectBankTransactionRows(root) {
  const candidates = deepFindValues(root, [
    'transactions', 'transactionList', 'bankTransactions', 'txnList',
    'statementTransactions', 'transactionDetails', 'entries'
  ], { arraysOnly: true, limit: 60 });

  let best = [];
  let bestScore = -1;
  for (const rows of candidates) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const objects = rows.filter(row => row && typeof row === 'object' && !Array.isArray(row));
    const score = objects.reduce((sum, row) => {
      const keys = Object.keys(row).map(normalizeLookupKey);
      const hasAmount = keys.some(key => ['amount', 'credit', 'creditamount', 'debit', 'debitamount', 'transactionamount'].includes(key));
      const hasDate = keys.some(key => ['date', 'transactiondate', 'txndate', 'valuedate', 'postingdate'].includes(key));
      return sum + Number(hasAmount) + Number(hasDate);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = objects;
    }
  }
  return best;
}

function summarizeBankTransactions(root) {
  const rows = collectBankTransactionRows(root);
  const monthlyCreditMap = new Map();
  let totalCredits = 0;
  let creditCount = 0;

  rows.forEach(row => {
    const direction = String(
      row.type ?? row.transactionType ?? row.txnType ?? row.creditDebitIndicator
      ?? row.drCr ?? row.direction ?? ''
    ).toUpperCase();
    let credit = firstNumber(
      row.creditAmount, row.credit_amount, row.credit, row.depositAmount,
      row.deposit, row.crAmount, row.cr_amount
    );
    const amount = firstNumber(row.amount, row.transactionAmount, row.txnAmount, row.value);
    if (credit === null && amount !== null && /(^|\b)(CR|CREDIT|DEPOSIT)(\b|$)/.test(direction)) credit = Math.abs(amount);
    if (credit === null || credit <= 0) return;

    totalCredits += credit;
    creditCount += 1;
    const dateValue = row.date ?? row.transactionDate ?? row.txnDate ?? row.valueDate ?? row.postingDate;
    const month = normalizeMonthLabel(dateValue);
    if (month) monthlyCreditMap.set(month, (monthlyCreditMap.get(month) || 0) + credit);
  });

  return {
    totalCredits: creditCount ? totalCredits : null,
    monthlyCredits: [...monthlyCreditMap.entries()].map(([month, value]) => ({ month, value }))
  };
}


function hasPayloadContent(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return Array.isArray(payload) ? payload.length > 0 : Object.keys(payload).length > 0;
}

function trace(traceMap, field, { table, record, applicantId, path, value, fallbackReason = null }) {
  traceMap[field] = {
    reportField: field,
    selectedSourceTable: table,
    sourceRecordId: record?.id ?? null,
    applicantId: applicantId || null,
    jsonPath: path || null,
    sourceTimestamp: record?.metrics_extracted_at || record?.completed_at || record?.updated_at || record?.created_at || null,
    selectedValue: value ?? null,
    fallbackReason
  };
  return value;
}

function yearObjects(payload) {
  const roots = Array.isArray(payload) ? payload : [payload];
  const years = [];
  const seen = new Set();

  function visit(value, depth = 0) {
    if (depth > 14 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const parsed = json(value);
      if (parsed) visit(parsed, depth + 1);
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      if (/^\d{4}[-/]\d{2,4}$/.test(key) || /^(AY|FY)\s*\d{4}/i.test(key)) {
        years.push({ key, payload: { [key]: child } });
      }
      visit(child, depth + 1);
    });
  }

  roots.forEach(root => visit(json(root) || root));
  const deduped = new Map();
  years.forEach(item => {
    if (!deduped.has(item.key)) deduped.set(item.key, item);
  });
  return [...deduped.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function buildItr(record, applicantId, sourceTrace, warnings, caseId) {
  if (!record) {
    return {
      latest: {}, previous: {}, older: {},
      email: null, mobile: null, dob: null, registeredAddress: null,
      sourceKind: 'NONE'
    };
  }

  const encryptedItrPayload = json(record.analytics_payload)?.__enc === 'v1';
  const itrPayload = authoritativeJson(record.analytics_payload);
  console.info('[LoanApplicationSummary][ITR]', {
    caseId, requestId: record.id, source: 'itr_analytics_requests.analytics_payload',
    hasPayload: hasPayloadContent(itrPayload), payloadType: Array.isArray(itrPayload) ? 'array' : typeof itrPayload
  });
  if (!hasPayloadContent(itrPayload)) {
    warnings.push(encryptedItrPayload
      ? 'ITR: itr_analytics_requests.analytics_payload is encrypted but could not be decrypted.'
      : 'ITR: itr_analytics_requests.analytics_payload is empty.');
    return { latest: {}, previous: {}, older: {}, email: null, mobile: null, dob: null, registeredAddress: null, sourceKind: 'NONE' };
  }
  const payloadRoots = [itrPayload];
  const years = yearObjects(payloadRoots);
  const parsedYears = years.map(({ key, payload }) => ({
    year: key,
    ...extractItrDetails(payload),
    rawPayload: payload
  }));
  const extractedCandidates = payloadRoots.map(payload => extractItrDetails(payload));
  const whole = firstNonEmptyObject(extractedCandidates);

  const snapshots = [
    parsedYears[0] || {
      year: whole.financial_year_latest,
      net_profit_latest_year: whole.net_profit_latest_year,
      depreciation_latest_year: whole.depreciation_latest_year,
      finance_cost_latest_year: whole.finance_cost_latest_year,
      itr_remuneration_latest_year: whole.itr_remuneration_latest_year,
      gross_receipts_latest_year: whole.gross_receipts_latest_year,
      rawPayload: payloadRoots
    },
    parsedYears[1] || {
      year: whole.financial_year_previous,
      net_profit_latest_year: whole.net_profit_previous_year,
      gross_receipts_latest_year: whole.gross_receipts_previous_year,
      rawPayload: payloadRoots
    },
    parsedYears[2] || { rawPayload: payloadRoots }
  ];

  const normalizeYear = (row = {}, index) => {
    const raw = row.rawPayload || payloadRoots;
    return {
      year: row.year || null,
      profitAfterTax: firstNumber(row.net_profit_latest_year, row.itr_pat, deepFirst(raw, ['ProfitAfterTax', 'NetProfitAfterTax', 'NetProfit'])),
      depreciation: firstNumber(row.depreciation_latest_year, row.itr_depreciation, deepFirst(raw, ['DepreciationAmort', 'DepreciationAndAmortization', 'Depreciation'])),
      financeCost: firstNumber(row.finance_cost_latest_year, row.itr_finance_cost, deepFirst(raw, ['InterestExpdr', 'FinanceCost', 'InterestOnLoan', 'InterestExpense'])),
      remuneration: firstNumber(row.itr_remuneration_latest_year, row.itr_remuneration, deepFirst(raw, ['RemunerationToPartners', 'DirectorRemuneration', 'Remuneration'])),
      grossReceipts: firstNumber(row.gross_receipts_latest_year, row.itr_gross_receipts, deepFirst(raw, ['TotRevenueFrmOperations', 'RevenueFromOperations', 'GrossReceipts', 'GrossTurnover', 'SalesGrossReceiptsTotal'])),
      agriculturalIncome: firstNumber(row.agricultural_income, row.itr_agricultural_income, deepFirst(raw, ['AgriculturalIncome', 'NetAgriculturalIncome', 'AgricultureIncome'])),
      salaryIncome: firstNumber(row.salary_income, row.itr_salary_income, deepFirst(raw, ['SalaryIncome', 'IncomeFromSalary'])),
      grossTotalIncome: firstNumber(row.gross_total_income, deepFirst(raw, ['GrossTotalIncome'])),
      totalTaxableIncome: firstNumber(row.total_taxable_income, deepFirst(raw, ['TotalTaxableIncome', 'TotalIncome'])),
      filingDate: row.filing_date || deepFirst(raw, ['FilingDate', 'DateOfFiling']) || null,
      assessmentYear: row.assessment_year || deepFirst(raw, ['AssessmentYear']) || row.year || null,
      taxpayerName: row.taxpayer_name || row.name || deepFirst(raw, ['AssesseeName', 'TaxpayerName', 'NameOfAssessee', 'Name']) || null,
      pan: row.pan || deepFirst(raw, ['PAN', 'PanNumber']) || null
    };
  };

  const latest = normalizeYear(snapshots[0], 0);
  const previous = normalizeYear(snapshots[1], 1);
  const older = normalizeYear(snapshots[2], 2);
  const hasJsonData = payloadRoots.length > 0 && [
    latest.profitAfterTax, latest.depreciation, latest.financeCost,
    latest.grossReceipts, latest.taxpayerName, latest.pan,
    latest.grossTotalIncome, latest.totalTaxableIncome
  ].some(value => value !== null && value !== undefined && value !== '');

  const result = {
    latest,
    previous,
    older,
    email: deepFirst(payloadRoots, ['EmailId', 'Email', 'EmailAddress']),
    mobile: deepFirst(payloadRoots, ['ContactNumber', 'MobileNumber', 'Mobile', 'Phone']),
    dob: deepFirst(payloadRoots, ['DateOfBirth', 'DOB']),
    registeredAddress: deepFirst(payloadRoots, ['RegisteredAddress', 'AddressOfAssessee', 'Address']),
    sourceKind: hasJsonData ? 'JSON' : 'STRUCTURED'
  };

  ['profitAfterTax', 'depreciation', 'financeCost', 'remuneration', 'grossReceipts', 'agriculturalIncome', 'grossTotalIncome', 'totalTaxableIncome'].forEach(field => {
    const value = result.latest[field];
    if (value !== null) trace(sourceTrace, `financials.itr.latest.${field}`, {
      table: 'itr_analytics_requests', record, applicantId,
      path: `analytics_payload.${field}`,
      value,
      fallbackReason: null
    });
  });

  if (!hasJsonData) warnings.push('ITR: itr_analytics_requests.analytics_payload contains no usable ITR metrics.');
  return result;
}

function buildGst(record, applicantId, sourceTrace, warnings, caseId) {
  if (!record) {
    return {
      latest: {}, previous: {}, older: {}, rolling12Months: {},
      monthlySales: [], monthlyPurchases: [], sourceKind: 'NONE'
    };
  }

  const gstPayload = authoritativeJson(record.raw_report_data);
  console.info('[LoanApplicationSummary][GST]', {
    caseId, requestId: record.id, source: 'gstr_analytics_requests.raw_report_data',
    hasPayload: hasPayloadContent(gstPayload), payloadType: Array.isArray(gstPayload) ? 'array' : typeof gstPayload
  });
  if (!hasPayloadContent(gstPayload)) {
    warnings.push('GST: gstr_analytics_requests.raw_report_data is empty.');
    return { latest: {}, previous: {}, older: {}, rolling12Months: {}, monthlySales: [], monthlyPurchases: [], sourceKind: 'NONE' };
  }
  const payloadRoots = [gstPayload];
  const extracted = extractGstDetails(gstPayload) || {};
  const extractedSummaries = [
    ...extractGstFinancialYears(gstPayload),
    ...(extractAllGstSummaries(gstPayload, null) || [])
  ];
  const summaries = [...extractedSummaries]
    .filter(row => number(row?.turnover) !== null)
    .sort((a, b) => String(b.financial_year || '').localeCompare(String(a.financial_year || '')));
  const uniqueYears = [];
  summaries.forEach(row => {
    if (!uniqueYears.some(existing => existing.financial_year === row.financial_year)) uniqueYears.push(row);
  });

  const turnover = index => number(uniqueYears[index]?.turnover);
  const monthlySales = extractGstMonthlyRows(payloadRoots, 'sales');
  const monthlyPurchases = extractGstMonthlyRows(payloadRoots, 'purchase');
  const monthlySalesTotal = monthlySales.length
    ? monthlySales.reduce((sum, row) => sum + (number(row.taxableValue) || 0), 0)
    : null;
  const rolling = firstNumber(
    extracted.turnover_latest_year,
    deepFirst(payloadRoots, ['Rolling12MonthTurnover', 'Last12MonthSales', 'TotalSales']),
    monthlySalesTotal
  );
  const average = firstNumber(
    extracted.avg_monthly_turnover,
    rolling !== null ? rolling / 12 : null
  );

  const legalName = deepFirst(payloadRoots, ['LegalName', 'LegalNameOfBusiness', 'Lgnm']);
  const tradeName = deepFirst(payloadRoots, ['TradeName', 'TradeNameOfBusiness', 'TradeNam']);
  const gstin = deepFirst(payloadRoots, ['GSTIN', 'Gstin', 'GstinUin']) || null;
  const registrationStatus = deepFirst(payloadRoots, ['GSTINStatus', 'RegistrationStatus', 'Status']);
  const registrationDate = deepFirst(payloadRoots, ['DateOfRegistration', 'RegistrationDate']);
  const taxpayerType = deepFirst(payloadRoots, ['TaxpayerType', 'Dty']);
  const natureOfBusiness = deepFirst(payloadRoots, ['NatureOfBusinessActivity', 'NatureOfBusiness', 'Nba']);
  const businessAddress = deepFirst(payloadRoots, ['PrincipalPlaceOfBusiness', 'PrincipalAddress', 'BusinessAddress', 'Address']);
  const hasJsonData = payloadRoots.length > 0 && (
    extractedSummaries.length || rolling !== null || average !== null || gstin
    || legalName || monthlySales.length || monthlyPurchases.length
  );

  const result = {
    latest: {
      year: uniqueYears[0]?.financial_year || null,
      turnover: turnover(0) ?? rolling
    },
    previous: {
      year: uniqueYears[1]?.financial_year || null,
      turnover: turnover(1)
    },
    older: { year: uniqueYears[2]?.financial_year || null, turnover: turnover(2) },
    rolling12Months: {
      turnover: rolling,
      averageMonthlySales: average,
      endPeriod: deepFirst(payloadRoots, ['Rolling12MonthEndPeriod', 'ReportPeriod', 'Period']) || null
    },
    monthlySales,
    monthlyPurchases,
    gstin,
    legalName,
    tradeName,
    registrationStatus,
    registrationDate,
    taxpayerType,
    natureOfBusiness,
    filingPeriod: `${record.from_date || ''}${record.to_date ? ` to ${record.to_date}` : ''}`.trim(),
    businessAddress,
    email: deepFirst(payloadRoots, ['Email', 'EmailId', 'EmailAddress']),
    mobile: deepFirst(payloadRoots, ['MobileNumber', 'Mobile', 'PhoneNumber']),
    constitution: deepFirst(payloadRoots, ['ConstitutionOfBusiness', 'Constitution']),
    stateJurisdiction: deepFirst(payloadRoots, ['StateJurisdiction']),
    centreJurisdiction: deepFirst(payloadRoots, ['CentreJurisdiction', 'CenterJurisdiction']),
    stateOfOperations: deepFirst(payloadRoots, ['StateOfOperations', 'State']),
    sourceKind: hasJsonData ? 'JSON' : 'STRUCTURED'
  };

  [['latest.turnover', result.latest.turnover], ['rolling12Months.turnover', rolling], ['rolling12Months.averageMonthlySales', average]].forEach(([field, value]) => {
    if (value !== null) trace(sourceTrace, `financials.gst.${field}`, {
      table: 'gstr_analytics_requests', record, applicantId,
      path: `raw_report_data.${field}`,
      value,
      fallbackReason: null
    });
  });

  if (!hasJsonData) warnings.push('GST: gstr_analytics_requests.raw_report_data contains no usable GST metrics.');
  return result;
}

function buildBanking(record, applicantId, sourceTrace, warnings, caseId) {
  if (!record) {
    return {
      latest: {}, previous: {}, older: {}, rolling12Months: {},
      monthly: {}, sourceKind: 'NONE'
    };
  }

  const bankPayload = authoritativeJson(record.files_payload) || record.files_payload;
  const topLevelKeys = bankPayload && typeof bankPayload === 'object' && !Array.isArray(bankPayload)
    ? Object.keys(bankPayload).slice(0, 25) : [];
  console.info('[LoanApplicationSummary][BANK]', {
    caseId, requestId: record.id, source: 'bank_statement_analysis_requests.files_payload',
    hasPayload: hasPayloadContent(bankPayload), payloadType: Array.isArray(bankPayload) ? 'array' : typeof bankPayload,
    filesPayloadIsArray: Array.isArray(bankPayload), filesPayloadLength: Array.isArray(bankPayload) ? bankPayload.length : null,
    topLevelKeys
  });
  if (!hasPayloadContent(bankPayload)) {
    warnings.push('Banking: bank_statement_analysis_requests.files_payload is empty.');
    return { latest: {}, previous: {}, older: {}, rolling12Months: {}, monthly: {}, sourceKind: 'NONE' };
  }
  const payloadRoots = [bankPayload];

  const detailCandidates = payloadRoots.map(payload => extractBankDetails(payload));
  const details = detailCandidates.reduce((result, current) => {
    Object.entries(current || {}).forEach(([key, value]) => {
      if ((result[key] === null || result[key] === undefined || result[key] === '')
        && value !== null && value !== undefined && value !== '') result[key] = value;
    });
    return result;
  }, {});
  const fyCandidates = payloadRoots.map(payload => extractBankFySnapshot(payload));
  const fy = fyCandidates.find(item => item && (
    number(item.total_credits) !== null || number(item.avg_monthly_credit) !== null
    || item.latest || item.previous
  )) || {};
  const salaryCandidates = payloadRoots.map(payload => extractBankSalary(payload));
  const salary = salaryCandidates.find(item => number(item?.avgMonthlySalary) !== null) || {};
  const latest = fy?.latest || {};
  const previous = fy?.previous || {};
  const account = firstObjectFromArray(payloadRoots, ['accountLevelAnalysis', 'accounts', 'accountDetails', 'bankAccounts']) || {};
  const overview = deepFindValues(payloadRoots, ['overview'], { limit: 20 })
    .find(value => value && typeof value === 'object' && !Array.isArray(value)) || {};

  const monthlyBalanceRows = deepArray(payloadRoots, ['monthlyAverageDailyBalance', 'monthlyAverageBalance', 'averageDailyBalance']);
  const monthlyCreditsRows = deepArray(payloadRoots, ['monthlyCreditTransactions', 'monthwiseCredits', 'monthlyCredits', 'creditTransactions']);
  const normalizeMetricRows = (rows, valueKeys) => (Array.isArray(rows) ? rows : []).map(item => ({
    month: normalizeMonthLabel(item?.month ?? item?.date ?? item?.period ?? item?.monthYear),
    value: firstNumber(...valueKeys.map(key => item?.[key]))
  })).filter(item => item.month && item.value !== null);

  const transactionSummary = summarizeBankTransactions(payloadRoots);
  const monthlyAverageBalance = sortMonthlyRows(normalizeMetricRows(monthlyBalanceRows, ['averageDailyBalance', 'averageBalance', 'amount', 'value']));
  const monthlyCredits = sortMonthlyRows(normalizeMetricRows(monthlyCreditsRows, ['totalCreditAmount', 'creditAmount', 'amount', 'value']));
  const finalMonthlyCredits = monthlyCredits.length ? monthlyCredits : transactionSummary.monthlyCredits;
  const monthlyCreditTotal = finalMonthlyCredits.length
    ? finalMonthlyCredits.reduce((sum, row) => sum + (number(row.value) || 0), 0)
    : null;

  const totalCredits = firstNumber(
    fy?.total_credits, latest?.totalCredits, details.total_credits,
    details.avg_monthly_credit_total, account.totalCreditAmount, account.totalCredits,
    overview.totalCreditAmount, overview.totalCredits,
    deepFirst(payloadRoots, ['TotalCreditAmount', 'TotalCredits', 'CreditTxnTotal']),
    transactionSummary.totalCredits, monthlyCreditTotal,
  );
  const avgMonthlyCredits = firstNumber(
    fy?.avg_monthly_credit, details.avg_monthly_credit, latest?.avgMonthlyCredit,
    account.avgMonthlyCredit, account.averageMonthlyCredit,
    overview.avgMonthlyCredit, overview.averageMonthlyCredit,
    totalCredits !== null ? totalCredits / 12 : null
  );
  const averageBalanceLatest = firstNumber(
    typeof latest === 'number' ? latest : latest?.averageBalance,
    details.avg_bank_balance_latest_year,
    account.avgClosingBalance, overview.averageClosingBalance,
    deepFirst(payloadRoots, ['AverageBalance', 'AvgBalance', 'AverageDailyBalance', 'AverageEodBalance'])
  );

  const accountHolderName = account.accountHolderName || account.accountHolder
    || deepFirst(payloadRoots, ['AccountHolderName', 'AccountHolders', 'AccountHolder']) || null;
  const rawAccountNumber = account.accountNumber || account.accNo
    || deepFirst(payloadRoots, ['AccountNumber', 'AccountNo', 'AccNo']) || null;
  const bankName = details.bank_name || account.bankName || account.bank
    || deepFirst(payloadRoots, ['BankName', 'InstitutionName']) || null;
  const accountType = account.accountType || account.type
    || deepFirst(payloadRoots, ['AccountType', 'TypeOfAccount']) || null;
  const statementFrom = account.fromDate || account.startDate
    || deepFirst(payloadRoots, ['StatementFrom', 'FromDate', 'TxnStartDate', 'TransactionStartDate']) || null;
  const statementTo = account.toDate || account.endDate
    || deepFirst(payloadRoots, ['StatementTo', 'ToDate', 'TxnEndDate', 'TransactionEndDate']) || null;
  const inwardBounces = firstNumber(deepFirst(payloadRoots, ['InwardChequeBounces', 'InwardChequeBouncedCount', 'IWCHEQUEBOUNCECOUNT']));
  const outwardBounces = firstNumber(deepFirst(payloadRoots, ['OutwardChequeBounces', 'OutwardChequeBouncedCount', 'OWCHEQUEBOUNCECOUNT']));
  const genericBounces = firstNumber(details.cheque_bounces_12m);

  const hasJsonData = payloadRoots.length > 0 && (
    totalCredits !== null || avgMonthlyCredits !== null || averageBalanceLatest !== null
    || bankName || rawAccountNumber || accountHolderName
    || monthlyAverageBalance.length || finalMonthlyCredits.length
  );

  const result = {
    latest: {
      year: details.financial_year_latest || record.financial_year_latest,
      averageBalance: averageBalanceLatest,
      totalCredits,
      averageMonthlyCredits: avgMonthlyCredits
    },
    previous: {
      year: details.financial_year_previous || record.financial_year_previous,
      averageBalance: firstNumber(typeof previous === 'number' ? previous : previous?.averageBalance, details.avg_bank_balance_previous_year),
      totalCredits: firstNumber(previous?.totalCredits)
    },
    older: {},
    rolling12Months: { totalCredits, averageMonthlyCredits: avgMonthlyCredits },
    monthly: {
      averageBalance: monthlyAverageBalance,
      credits: finalMonthlyCredits,
      creditTransactions: finalMonthlyCredits
    },
    accountHolderName,
    bankName,
    accountNumber: details.account_number_masked || rawAccountNumber,
    accountType,
    email: deepFirst(payloadRoots, ['Email', 'EmailId', 'EmailAddress']),
    phone: deepFirst(payloadRoots, ['PhoneNumber', 'MobileNumber', 'Mobile', 'Phone']),
    statementFrom,
    statementTo,
    transactionStartDate: deepFirst(payloadRoots, ['TxnStartDate', 'TransactionStartDate']) || statementFrom,
    transactionEndDate: deepFirst(payloadRoots, ['TxnEndDate', 'TransactionEndDate']) || statementTo,
    statementPeriod: details.statement_period || (statementFrom && statementTo ? `${statementFrom} to ${statementTo}` : null),
    salaryCredits: firstNumber(salary.avgMonthlySalary),
    chequeReturns: genericBounces,
    inwardChequeBounces: inwardBounces ?? genericBounces,
    outwardChequeBounces: outwardBounces,
    bankCharges: firstNumber(deepFirst(payloadRoots, ['BankCharges', 'MinimumBalanceCharges', 'TotalBankCharges'])),
    cashDeposit: firstNumber(deepFirst(payloadRoots, ['CashDeposit', 'CashDeposits', 'TotalCashDeposit'])),
    cashWithdrawal: firstNumber(deepFirst(payloadRoots, ['CashWithdrawal', 'CashWithdrawals', 'TotalCashWithdrawal'])),
    emiLoanPayments: firstNumber(deepFirst(payloadRoots, ['EmiLoanPayments', 'EmiPayments', 'LoanPayments', 'TotalEmiAmount'])),
    emiObligations: firstNumber(latest.emiObligations),
    sourceKind: hasJsonData ? 'JSON' : 'NONE'
  };

  [['latest.averageBalance', result.latest.averageBalance], ['rolling12Months.totalCredits', totalCredits], ['salaryCredits', result.salaryCredits]].forEach(([field, value]) => {
    if (value !== null) trace(sourceTrace, `financials.banking.${field}`, {
      table: 'bank_statement_analysis_requests', record, applicantId,
      path: `files_payload.${field}`,
      value,
      fallbackReason: null
    });
  });

  if (!hasJsonData) warnings.push('Banking: bank_statement_analysis_requests.files_payload contains file metadata only and no bank analysis metrics.');
  return result;
}

function applyEsrFinancialFallbacks({ itr, gst, banking }, esr, sourceTrace, applicantId) {
  if (!esr) return;
  const apply = (target, key, rawValue, traceField) => {
    if (!target || (target[key] !== null && target[key] !== undefined && target[key] !== '')) return;
    const value = number(rawValue);
    if (value === null) return;
    target[key] = value;
    trace(sourceTrace, traceField, {
      table: 'case_data_pull_statuses', record: esr, applicantId, path: key, value,
      fallbackReason: 'Provider JSON/Excel value unavailable; ESR structured snapshot used.'
    });
  };

  itr.latest ||= {};
  gst.latest ||= {};
  gst.rolling12Months ||= {};
  banking.latest ||= {};
  banking.rolling12Months ||= {};

  apply(itr.latest, 'profitAfterTax', esr.itr_pat, 'financials.itr.latest.profitAfterTax');
  apply(itr.latest, 'depreciation', esr.itr_depreciation, 'financials.itr.latest.depreciation');
  apply(itr.latest, 'financeCost', esr.itr_finance_cost, 'financials.itr.latest.financeCost');
  apply(itr.latest, 'grossReceipts', esr.itr_gross_receipts, 'financials.itr.latest.grossReceipts');

  apply(gst.rolling12Months, 'averageMonthlySales', esr.gst_avg_monthly_sales, 'financials.gst.rolling12Months.averageMonthlySales');
  if ((gst.rolling12Months.turnover === null || gst.rolling12Months.turnover === undefined || gst.rolling12Months.turnover === '')
    && number(esr.gst_avg_monthly_sales) !== null) gst.rolling12Months.turnover = number(esr.gst_avg_monthly_sales) * 12;
  if ((gst.latest.turnover === null || gst.latest.turnover === undefined || gst.latest.turnover === '')
    && gst.rolling12Months.turnover !== null && gst.rolling12Months.turnover !== undefined) gst.latest.turnover = gst.rolling12Months.turnover;

  apply(banking.latest, 'averageBalance', esr.bank_avg_balance, 'financials.banking.latest.averageBalance');
  apply(banking.rolling12Months, 'totalCredits', esr.bank_total_credits, 'financials.banking.rolling12Months.totalCredits');
  if ((banking.rolling12Months.totalCredits === null || banking.rolling12Months.totalCredits === undefined || banking.rolling12Months.totalCredits === '')
    && number(esr.bank_avg_monthly_credit) !== null) banking.rolling12Months.totalCredits = number(esr.bank_avg_monthly_credit) * 12;
  if ((banking.latest.totalCredits === null || banking.latest.totalCredits === undefined || banking.latest.totalCredits === '')
    && banking.rolling12Months.totalCredits !== null && banking.rolling12Months.totalCredits !== undefined) banking.latest.totalCredits = banking.rolling12Months.totalCredits;
  if ((banking.rolling12Months.averageMonthlyCredits === null || banking.rolling12Months.averageMonthlyCredits === undefined || banking.rolling12Months.averageMonthlyCredits === '')
    && number(esr.bank_avg_monthly_credit) !== null) banking.rolling12Months.averageMonthlyCredits = number(esr.bank_avg_monthly_credit);

  if (itr.sourceKind === 'NONE' && Object.values(itr.latest).some(value => value !== null && value !== undefined && value !== '')) itr.sourceKind = 'STRUCTURED';
  if (gst.sourceKind === 'NONE' && (gst.latest.turnover !== null || gst.rolling12Months.turnover !== null)) gst.sourceKind = 'STRUCTURED';
  if (banking.sourceKind === 'NONE' && (banking.latest.averageBalance !== null || banking.rolling12Months.totalCredits !== null)) banking.sourceKind = 'STRUCTURED';
}

function monthlyIncome(entries, matcher, applicantId) {
  return (entries || []).filter(entry => (!entry.applicant_id || Number(entry.applicant_id) === Number(applicantId)) && matcher(String(entry.income_type || '').toLowerCase(), entry))
    .reduce((sum, entry) => sum + (number(entry.monthly_amount) ?? ((number(entry.annual_amount) || 0) / 12)), 0);
}

function buildCanonicalLoanApplicationSummaryData(caseRecord) {
  if (!caseRecord || !caseRecord.id) throw new Error('A current case record is required for Loan Application Summary mapping.');
  const warnings = [];
  const sourceTrace = {};
  const applicants = caseRecord.applicants || [];
  const primaryApplicant = applicants.find(isPrimary) || applicants[0] || {};
  const coApplicants = applicants.filter(app => Number(app.id) !== Number(primaryApplicant.id));
  const itrRecord = scopedRecords(caseRecord.itr_analytics, caseRecord, primaryApplicant, warnings, 'ITR')[0] || null;
  const gstRecord = scopedRecords(caseRecord.gst_requests, caseRecord, primaryApplicant, warnings, 'GST')[0] || null;
  const bankRecord = scopedRecords(caseRecord.bank_statements, caseRecord, primaryApplicant, warnings, 'Banking')[0] || null;
  const itr = buildItr(itrRecord, primaryApplicant.id, sourceTrace, warnings, caseRecord.id);
  const gst = buildGst(gstRecord, primaryApplicant.id, sourceTrace, warnings, caseRecord.id);
  const banking = buildBanking(bankRecord, primaryApplicant.id, sourceTrace, warnings, caseRecord.id);
  applyEsrFinancialFallbacks({ itr, gst, banking }, caseRecord.esr_financials, sourceTrace, primaryApplicant.id);
  const property = caseRecord.property || {};
  const propertyValue = number(property.market_value ?? caseRecord.property_value ?? caseRecord.esr_financials?.property_value);
  if (propertyValue !== null) trace(sourceTrace, 'property.marketValue', {
    table: property.id ? 'case_property_details' : 'cases', record: property.id ? property : caseRecord,
    applicantId: primaryApplicant.id, path: property.id ? 'market_value' : 'property_value', value: propertyValue
  });
  // The template has one salary row, so aggregate the latest completed salary
  // slip per applicant. This preserves applicant isolation while still showing
  // a verified co-applicant salary (case 578) instead of an unrelated ITR value.
  const salaryOcrRows = applicants.map(applicant => ({
    applicant,
    row: deterministicSort(applicant.salary_ocr_results || []).find(row =>
      SUCCESS.has(String(row.ocr_status || row.status || '').toUpperCase()) && number(row.net_salary) !== null
    )
  })).filter(item => item.row);
  const salaryOcrMonthly = salaryOcrRows.length
    ? salaryOcrRows.reduce((sum, item) => sum + number(item.row.net_salary), 0)
    : null;
  const manualSalaryMonthly = monthlyIncome(caseRecord.income_entries, type => type === 'salary' || type.includes('salary'));
  const salaryMonthly = salaryOcrMonthly ?? (manualSalaryMonthly || banking.salaryCredits || null);
  if (salaryMonthly !== null) trace(sourceTrace, 'financials.salary.monthlyNet', {
    table: salaryOcrRows.length ? 'salary_slip_ocr_results' : 'case_income_entries', record: salaryOcrRows[0]?.row || {},
    applicantId: salaryOcrRows.length === 1 ? salaryOcrRows[0].applicant.id : null,
    path: salaryOcrRows.length ? 'latest completed net_salary per applicant (sum)' : 'annual_amount/12', value: salaryMonthly,
    fallbackReason: salaryOcrRows.length ? null : 'Completed salary-slip OCR unavailable; verified manual/bank salary fallback used.'
  });
  const latestEsr = deterministicSort(caseRecord.esrs || [])[0] || null;
  const lenders = latestEsr?.lenders || [];
  const best = [...lenders].filter(row => row.is_eligible).sort((a, b) => number(b.eligible_amount) - number(a.eligible_amount))[0] || null;
  const requestedAmountValue = number(
    caseRecord.loan_amount ?? caseRecord.requested_loan_amount ?? caseRecord.requested_amount
    ?? caseRecord.esr_financials?.requested_loan_amount
  );
  const requestedTenureValue = number(
    caseRecord.requested_tenure_months ?? caseRecord.tenure_months ?? caseRecord.tenure
    ?? caseRecord.esr_financials?.requested_tenure_months
  );
  const requestedAmount = requestedAmountValue !== null && requestedAmountValue > 0 ? requestedAmountValue : null;
  const requestedTenure = requestedTenureValue !== null && requestedTenureValue > 0 ? requestedTenureValue : null;
  if (requestedAmount === null) warnings.push('Requested loan amount is missing; report cell left blank.');
  if (requestedTenure === null) warnings.push('Requested tenure is missing; report cell left blank.');

  return {
    case: {
      id: caseRecord.id, tenantId: caseRecord.tenant_id, customerId: caseRecord.customer_id || caseRecord.customer?.id,
      reference: `CASE-${caseRecord.id}`, requestedAmount, requestedTenureMonths: requestedTenure,
      productType: caseRecord.product_type || caseRecord.esr_financials?.product_type || null,
      customerName: caseRecord.customer_name || caseRecord.customer?.business_name || primaryApplicant.name || null,
      dsaName: caseRecord.created_by?.name || null, dsaCode: caseRecord.dsa_code || null
    },
    primaryApplicant: { ...primaryApplicant },
    coApplicants: coApplicants.map(app => ({ ...app })),
    business: {
      name: gst.legalName || gst.tradeName || caseRecord.customer?.business_name || null,
      pan: itr.latest.pan || primaryApplicant.pan_number || caseRecord.customer?.business_pan || null,
      gstin: gst.gstin || null,
      address: gst.businessAddress || caseRecord.customer?.address || null,
      mobile: primaryApplicant.mobile || caseRecord.customer?.business_mobile || null,
      email: primaryApplicant.email || caseRecord.customer?.business_email || null
    },
    property: {
      id: property.id || null, type: property.property_type || caseRecord.esr_financials?.property_type || null,
      occupancy: property.occupancy_status || caseRecord.esr_financials?.occupancy_type || null,
      ownership: property.ownership_type || null, marketValue: propertyValue,
      address: property.property_address || property.address || property.location || caseRecord.property_address || caseRecord.location || null
    },
    bureau: {
      primary: deterministicSort(primaryApplicant.bureau_checks || []).find(row => SUCCESS.has(String(row.status || '').toUpperCase())) || deterministicSort(primaryApplicant.bureau_checks || [])[0] || null,
      coApplicants: coApplicants.map(app => ({ applicantId: app.id, record: deterministicSort(app.bureau_checks || [])[0] || null }))
    },
    financials: {
      itr, gst, banking,
      salary: { monthlyNet: salaryMonthly, source: salaryOcrRows.length ? 'SALARY_SLIP_OCR' : salaryMonthly ? 'MANUAL_OR_BANK_FALLBACK' : 'NONE' },
      rentalIncome: {
        bankMonthly: monthlyIncome(caseRecord.income_entries, type => type.includes('rent') && type.includes('bank'), primaryApplicant.id),
        cashMonthly: monthlyIncome(caseRecord.income_entries, type => type.includes('rent') && type.includes('cash'), primaryApplicant.id)
      },
      agriculturalIncome: {
        itrAnnual: itr.latest.agriculturalIncome,
        manualMonthly: monthlyIncome(caseRecord.income_entries, type => type.includes('agri'), primaryApplicant.id)
      },
      otherIncome: { monthly: monthlyIncome(caseRecord.income_entries, type => !type.includes('salary') && !type.includes('rent') && !type.includes('agri'), primaryApplicant.id) }
    },
    documents: { records: caseRecord.documents || [], byApplicant: applicants.map(app => ({ applicantId: app.id, records: app.documents || [] })) },
    eligibility: { latestReport: latestEsr, lenders, best },
    warnings,
    sourceTrace,
    sourceAvailability: {
      itrJson: hasPayloadContent(authoritativeJson(itrRecord?.analytics_payload)),
      gstJson: hasPayloadContent(authoritativeJson(gstRecord?.raw_report_data)),
      bankJson: hasPayloadContent(authoritativeJson(bankRecord?.files_payload) || bankRecord?.files_payload)
    }
  };
}

module.exports = {
  buildCanonicalLoanApplicationSummaryData,
  deterministicSort,
  scopedRecords,
  json,
  number,
  text
};
