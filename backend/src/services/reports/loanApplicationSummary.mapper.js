'use strict';

const {
  extractItrDetails,
  extractGstDetails,
  extractAllGstSummaries,
  extractBankDetails
} = require('../financial.extractor');
const { extractBankFySnapshot, extractBankSalary } = require('../bankParser.service');

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

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[₹,\s]/g, ''));
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
    (!record.tenant_id || Number(record.tenant_id) === tenantId)
    && (!record.case_id || Number(record.case_id) === caseId)
    && (!record.customer_id || Number(record.customer_id) === customerId)
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
  const raw = json(payload) || {};
  return Object.keys(raw)
    .filter(key => /^\d{4}[-/]\d{2,4}$/.test(key) || /^(AY|FY)\s*\d{4}/i.test(key))
    .sort((a, b) => b.localeCompare(a))
    .map(key => ({ key, payload: { [key]: raw[key] } }));
}

function buildItr(record, applicantId, sourceTrace, warnings) {
  if (!record) return { latest: {}, previous: {}, older: {}, sourceKind: 'NONE' };
  const selected = pickPayload(record, ['analytics_payload']);
  const years = selected.payload ? yearObjects(selected.payload) : [];
  const parsedYears = years.map(({ key, payload }) => ({ year: key, ...extractItrDetails(payload) }));
  const whole = selected.payload ? extractItrDetails(selected.payload) : {};
  const snapshots = [
    parsedYears[0] || {
      year: whole.financial_year_latest || record.financial_year_latest,
      net_profit_latest_year: whole.net_profit_latest_year ?? number(record.net_profit_latest_year),
      depreciation_latest_year: whole.depreciation_latest_year ?? number(record.depreciation_latest_year),
      finance_cost_latest_year: whole.finance_cost_latest_year ?? number(record.finance_cost_latest_year),
      itr_remuneration_latest_year: whole.itr_remuneration_latest_year ?? number(record.itr_remuneration_latest_year),
      gross_receipts_latest_year: whole.gross_receipts_latest_year ?? number(record.gross_receipts_latest_year)
    },
    parsedYears[1] || {
      year: whole.financial_year_previous || record.financial_year_previous,
      net_profit_latest_year: whole.net_profit_previous_year ?? number(record.net_profit_previous_year),
      gross_receipts_latest_year: whole.gross_receipts_previous_year ?? number(record.gross_receipts_previous_year)
    },
    parsedYears[2] || {}
  ];
  const normalizeYear = (row = {}, index) => ({
    year: row.year || (index === 0 ? record.financial_year_latest : index === 1 ? record.financial_year_previous : null),
    profitAfterTax: number(row.net_profit_latest_year ?? row.itr_pat),
    depreciation: number(row.depreciation_latest_year ?? row.itr_depreciation),
    financeCost: number(row.finance_cost_latest_year ?? row.itr_finance_cost),
    remuneration: number(row.itr_remuneration_latest_year ?? row.itr_remuneration),
    grossReceipts: number(row.gross_receipts_latest_year ?? row.itr_gross_receipts),
    agriculturalIncome: number(row.agricultural_income ?? row.itr_agricultural_income),
    salaryIncome: number(row.salary_income ?? row.itr_salary_income),
    filingDate: row.filing_date || null,
    assessmentYear: row.assessment_year || row.year || null,
    taxpayerName: row.taxpayer_name || row.name || null,
    pan: row.pan || record.pan || null
  });
  const result = {
    latest: normalizeYear(snapshots[0], 0),
    previous: normalizeYear(snapshots[1], 1),
    older: normalizeYear(snapshots[2], 2),
    sourceKind: selected.payload ? 'JSON' : 'STRUCTURED'
  };
  ['profitAfterTax', 'depreciation', 'financeCost', 'remuneration', 'grossReceipts', 'agriculturalIncome'].forEach(field => {
    const value = result.latest[field];
    if (value !== null) trace(sourceTrace, `financials.itr.latest.${field}`, {
      table: 'itr_analytics_requests', record, applicantId, path: selected.payload ? `${selected.field}.${field}` : field, value,
      fallbackReason: selected.payload ? null : 'Raw ITR JSON value unavailable; structured snapshot used.'
    });
  });
  if (!selected.payload) warnings.push('ITR: valid analytics_payload unavailable; structured snapshot fallback used.');
  return result;
}

function buildGst(record, applicantId, sourceTrace, warnings) {
  if (!record) return { latest: {}, previous: {}, older: {}, rolling12Months: {}, sourceKind: 'NONE' };
  const selected = pickPayload(record, ['raw_report_data', 'raw_fetch_data', 'raw_gst_data', 'provider_callback_payload', 'callback_payload']);
  const extracted = selected.payload ? extractGstDetails(selected.payload) : {};
  const extractedSummaries = extractAllGstSummaries(json(record.raw_fetch_data), json(record.raw_report_data));
  const persisted = record.gst_financial_year_summaries || [];
  const summaries = [...extractedSummaries, ...persisted]
    .filter(row => number(row.turnover) !== null)
    .sort((a, b) => String(b.financial_year || '').localeCompare(String(a.financial_year || '')));
  const uniqueYears = [];
  summaries.forEach(row => {
    if (!uniqueYears.some(existing => existing.financial_year === row.financial_year)) uniqueYears.push(row);
  });
  const turnover = index => number(uniqueYears[index]?.turnover);
  const rolling = number(extracted.turnover_latest_year ?? record.rolling_12_month_turnover);
  const average = number(extracted.avg_monthly_turnover ?? record.avg_monthly_turnover ?? (rolling !== null ? rolling / 12 : null));
  const result = {
    latest: { year: uniqueYears[0]?.financial_year || record.financial_year_latest, turnover: turnover(0) ?? number(record.turnover_latest_year) },
    previous: { year: uniqueYears[1]?.financial_year || record.financial_year_previous, turnover: turnover(1) ?? number(record.turnover_previous_year) },
    older: { year: uniqueYears[2]?.financial_year || null, turnover: turnover(2) },
    rolling12Months: { turnover: rolling, averageMonthlySales: average, endPeriod: record.rolling_12_month_end_period || null },
    gstin: record.gstin || null,
    legalName: selected.payload?.legalName || selected.payload?.legal_name || null,
    tradeName: selected.payload?.tradeName || selected.payload?.trade_name || null,
    registrationStatus: selected.payload?.status || selected.payload?.registrationStatus || null,
    filingPeriod: `${record.from_date || ''}${record.to_date ? ` to ${record.to_date}` : ''}`.trim(),
    businessAddress: selected.payload?.principalPlaceOfBusiness?.address || selected.payload?.businessAddress || null,
    sourceKind: selected.payload ? 'JSON' : 'STRUCTURED'
  };
  [['latest.turnover', result.latest.turnover], ['rolling12Months.turnover', rolling], ['rolling12Months.averageMonthlySales', average]].forEach(([field, value]) => {
    if (value !== null) trace(sourceTrace, `financials.gst.${field}`, {
      table: 'gstr_analytics_requests', record, applicantId, path: selected.payload ? selected.field : field, value,
      fallbackReason: selected.payload ? null : 'Raw GST JSON unavailable; structured snapshot used.'
    });
  });
  if (!selected.payload) warnings.push('GST: valid raw JSON unavailable; structured snapshot fallback used.');
  return result;
}

function buildBanking(record, applicantId, sourceTrace, warnings) {
  if (!record) return { latest: {}, previous: {}, older: {}, rolling12Months: {}, sourceKind: 'NONE' };
  // BankStatementAnalysisRequest.raw_analyze_response is the authoritative
  // Loan Application Summary source. Retrieve/download payloads are retained
  // only as compatibility fallbacks for older records.
  const selected = pickPayload(record, ['raw_analyze_response', 'raw_retrieve_response', 'raw_download_response', 'files_payload']);
  const details = selected.payload ? extractBankDetails(selected.payload) : {};
  const fy = selected.payload ? extractBankFySnapshot(selected.payload) : {};
  const salary = selected.payload ? extractBankSalary(selected.payload) : {};
  const latest = fy?.latest || {};
  const previous = fy?.previous || {};
  const totalCredits = number(fy?.total_credits ?? latest?.totalCredits ?? details.total_credits ?? details.avg_monthly_credit_total);
  const avgMonthlyCredits = number(fy?.avg_monthly_credit ?? details.avg_monthly_credit ?? latest?.avgMonthlyCredit);
  const result = {
    latest: {
      year: details.financial_year_latest || record.financial_year_latest,
      averageBalance: number((typeof latest === 'number' ? latest : latest?.averageBalance) ?? details.avg_bank_balance_latest_year ?? record.avg_bank_balance_latest_year),
      totalCredits,
      averageMonthlyCredits: avgMonthlyCredits
    },
    previous: {
      year: details.financial_year_previous || record.financial_year_previous,
      averageBalance: number((typeof previous === 'number' ? previous : previous?.averageBalance) ?? details.avg_bank_balance_previous_year ?? record.avg_bank_balance_previous_year),
      totalCredits: number(previous?.totalCredits)
    },
    older: {},
    rolling12Months: { totalCredits, averageMonthlyCredits: avgMonthlyCredits },
    accountHolderName: details.account_holder_name || latest.accountHolderName || null,
    bankName: details.bank_name || latest.bankName || null,
    accountNumber: details.account_number_masked || latest.accountNumber || null,
    statementPeriod: details.statement_period || latest.statementPeriod || null,
    salaryCredits: number(salary.avgMonthlySalary),
    chequeReturns: number(details.cheque_bounces_12m),
    emiObligations: number(latest.emiObligations),
    sourceKind: selected.payload ? 'JSON' : 'STRUCTURED'
  };
  [['latest.averageBalance', result.latest.averageBalance], ['rolling12Months.totalCredits', totalCredits], ['salaryCredits', result.salaryCredits]].forEach(([field, value]) => {
    if (value !== null) trace(sourceTrace, `financials.banking.${field}`, {
      table: 'bank_statement_analysis_requests', record, applicantId, path: selected.payload ? selected.field : field, value,
      fallbackReason: selected.payload ? null : 'Raw bank JSON unavailable; structured snapshot used.'
    });
  });
  if (!selected.payload) warnings.push('Banking: valid raw JSON unavailable; structured snapshot fallback used.');
  return result;
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
  const itr = buildItr(itrRecord, primaryApplicant.id, sourceTrace, warnings);
  const gst = buildGst(gstRecord, primaryApplicant.id, sourceTrace, warnings);
  const banking = buildBanking(bankRecord, primaryApplicant.id, sourceTrace, warnings);
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
  const requestedAmount = number(caseRecord.loan_amount ?? caseRecord.esr_financials?.requested_loan_amount);
  const requestedTenure = number(caseRecord.requested_tenure_months ?? caseRecord.esr_financials?.requested_tenure_months);
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
    sourceAvailability: { itrJson: itr.sourceKind === 'JSON', gstJson: gst.sourceKind === 'JSON', bankJson: banking.sourceKind === 'JSON' }
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
