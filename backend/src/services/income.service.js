const prisma = require('../../config/db');
const { markEsrInputsChanged } = require('./esrSnapshotMutation.service');

function parseNumericInput(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be a valid number.`);
  return parsed;
}

const applicantDisplayName = (app) => {
  if (!app) return '';
  return app.name || (app.type === 'PRIMARY' ? 'Primary Applicant' : 'Co-Applicant');
};

/**
 * getIncomeSummary — assembles API-pulled income + manual entries for a case.
 * Reads from persistent FY snapshot columns stored at callback ingestion time.
 * Falls back to legacy analytics_payload fields for existing records.
 */
async function getIncomeSummary(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: {
      esr_financials:  true,
      gst_requests:    { orderBy: { created_at: 'desc' }, take: 1 },
      itr_analytics:   { orderBy: { created_at: 'desc' }, take: 1 },
      applicants: {
        include: {
          bank_statements: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      },
      bank_statements: { orderBy: { created_at: 'desc' }, take: 1 },
      income_entries:  { orderBy: { created_at: 'asc' } },
      obligations:     { where: { status: 'ACTIVE' } }
    }
  });

  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  const esr = caseRecord.esr_financials;

  // ── GST: use exact FY snapshot accessor ───────────────────────────────────
  const { getBestUsableGstSnapshot } = require('./gstAnalyticsSnapshot.service');
  const gstSnapshot = await getBestUsableGstSnapshot({ tenantId: tenant_id, caseId: case_id });
  let gstTurnoverLatest = gstSnapshot?.turnover_latest_year != null ? Number(gstSnapshot.turnover_latest_year) : (esr?.gst_avg_monthly_sales ? esr.gst_avg_monthly_sales * 12 : null);
  let gstTurnoverPrev   = gstSnapshot?.turnover_previous_year != null ? Number(gstSnapshot.turnover_previous_year) : null;
  const gstFyLatest     = gstSnapshot?.financial_year_latest || null;
  const gstFyPrev       = gstSnapshot?.financial_year_previous || null;

  // ── ITR: prefer persisted FY snapshot columns ─────────────────────────────
  const itrReq = caseRecord.itr_analytics?.[0];
  let netProfitLatest     = itrReq?.net_profit_latest_year   != null ? Number(itrReq.net_profit_latest_year)   : (esr?.itr_pat ?? null);
  let netProfitPrev       = itrReq?.net_profit_previous_year != null ? Number(itrReq.net_profit_previous_year)  : null;
  let grossReceiptsLatest = itrReq?.gross_receipts_latest_year != null ? Number(itrReq.gross_receipts_latest_year) : (esr?.itr_gross_receipts ?? null);
  const itrFyLatest       = itrReq?.financial_year_latest  || null;
  const itrFyPrev         = itrReq?.financial_year_previous || null;

  // Fallback to analytics_payload for legacy records that predate the snapshot columns
  if (netProfitLatest === null && itrReq?.analytics_payload) {
    const payload = typeof itrReq.analytics_payload === 'string'
      ? JSON.parse(itrReq.analytics_payload) : itrReq.analytics_payload;
    netProfitLatest = payload?.net_profit || payload?.netProfit || null;
  }

  // ── Bank: prefer persisted FY snapshot columns ────────────────────────────
  const primaryApplicant = caseRecord.applicants?.find(a => a.type === 'PRIMARY') || caseRecord.applicants?.[0];
  const bankReq = primaryApplicant?.bank_statements?.[0] || caseRecord.bank_statements?.[0];
  let avgBalanceLatest = bankReq?.avg_bank_balance_latest_year   != null ? Number(bankReq.avg_bank_balance_latest_year)   : (esr?.bank_avg_balance ?? null);
  let avgBalancePrev   = bankReq?.avg_bank_balance_previous_year != null ? Number(bankReq.avg_bank_balance_previous_year)  : null;
  const bankFyLatest     = bankReq?.financial_year_latest  || null;
  const bankFyPrev       = bankReq?.financial_year_previous || null;

  // ── Manual income entries ─────────────────────────────────────────────────
  const applicantById = new Map((caseRecord.applicants || []).map(app => [app.id, app]));
  const manualEntries = caseRecord.income_entries.map(entry => ({
    ...entry,
    applicant_label: entry.applicant_id
      ? (applicantDisplayName(applicantById.get(entry.applicant_id)) || entry.applicant_label || 'Applicant')
      : 'Entity'
  }));
  const manualTotal = manualEntries.reduce((sum, e) => sum + (Number(e.annual_amount) || 0), 0);

  // ── Obligations total ─────────────────────────────────────────────────────
  const totalEmiPerMonth = caseRecord.obligations.reduce((sum, o) => sum + (Number(o.emi_per_month) || 0), 0);

  // ── Combined income = ITR net profit + manual ─────────────────────────────
  const combinedAnnualIncome = (Number(netProfitLatest) || 0) + manualTotal;

  return {
    api_data: {
      gst_turnover: {
        latest: gstTurnoverLatest, prev: gstTurnoverPrev,
        fy_latest: gstFyLatest,    fy_prev: gstFyPrev
      },
      net_profit: {
        latest: netProfitLatest,   prev: netProfitPrev,
        gross_receipts_latest: grossReceiptsLatest,
        fy_latest: itrFyLatest,    fy_prev: itrFyPrev
      },
      avg_bank_balance: {
        latest: avgBalanceLatest,  prev: avgBalancePrev,
        fy_latest: bankFyLatest,   fy_prev: bankFyPrev
      }
    },
    manual_entries:         manualEntries,
    manual_total:           manualTotal,
    combined_annual_income: combinedAnnualIncome,
    total_emi_per_month:    totalEmiPerMonth
  };
}

/**
 * addIncomeEntry — saves a single manual income row for the given case.
 */
async function addIncomeEntry(case_id, payload, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  const { income_type, applicant_id, applicant_label, annual_amount, supporting_doc_type, remarks } = payload;
  if (!income_type)    throw new Error('income_type is required.');
  const annualAmount = parseNumericInput(annual_amount, 'annual_amount');
  if (!annualAmount || annualAmount < 0) throw new Error('annual_amount must be a positive number.');
  const applicantId = applicant_id ? parseInt(applicant_id, 10) : null;
  let resolvedApplicantLabel = applicant_label;

  if (applicantId) {
    const applicant = await prisma.applicant.findFirst({
      where: { id: applicantId, case_id },
      select: { id: true, name: true, type: true }
    });
    resolvedApplicantLabel = applicantDisplayName(applicant) || 'Applicant';
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.caseIncomeEntry.create({
      data: {
        case_id,
        applicant_id: applicantId,
        income_type,
        applicant_label: resolvedApplicantLabel,
        annual_amount:       annualAmount,
        supporting_doc_type,
        remarks
      }
    });

    await markEsrInputsChanged(tx, case_id);

    return entry;
  });
}

async function updateIncomeEntry(entry_id, case_id, payload, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');
  const existing = await prisma.caseIncomeEntry.findFirst({ where: { id: entry_id, case_id } });
  if (!existing) throw new Error('Income entry not found.');

  const data = {};
  if (payload.income_type !== undefined) {
    if (!payload.income_type) throw new Error('income_type is required.');
    data.income_type = payload.income_type;
  }
  if (payload.annual_amount !== undefined) {
    const amount = parseNumericInput(payload.annual_amount, 'annual_amount');
    if (!(amount > 0)) throw new Error('annual_amount must be a positive number.');
    data.annual_amount = amount;
  }
  if (payload.supporting_doc_type !== undefined) data.supporting_doc_type = payload.supporting_doc_type || null;
  if (payload.remarks !== undefined) data.remarks = payload.remarks || null;
  if (payload.applicant_id !== undefined) {
    const applicantId = payload.applicant_id ? parseInt(payload.applicant_id, 10) : null;
    if (applicantId) {
      const applicant = await prisma.applicant.findFirst({ where: { id: applicantId, case_id } });
      if (!applicant) throw new Error('Applicant not found for this case.');
      data.applicant_id = applicantId;
      data.applicant_label = applicantDisplayName(applicant);
    } else {
      data.applicant_id = null;
      data.applicant_label = null;
    }
  }

  return prisma.$transaction(async tx => {
    const updated = await tx.caseIncomeEntry.update({ where: { id: entry_id }, data });
    await markEsrInputsChanged(tx, case_id);
    return updated;
  });
}

/**
 * deleteIncomeEntry — removes a manual income row (ownership verified via case_id join).
 */
async function deleteIncomeEntry(entry_id, case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  const entry = await prisma.caseIncomeEntry.findFirst({ where: { id: entry_id, case_id } });
  if (!entry) throw new Error('Income entry not found.');

  await prisma.$transaction(async (tx) => {
    await tx.caseIncomeEntry.delete({ where: { id: entry_id } });
    await markEsrInputsChanged(tx, case_id);
  });
  return { success: true };
}

/**
 * confirmIncomeSummary — advances the case stage to INCOME_REVIEWED.
 */
async function confirmIncomeSummary(case_id, tenant_id, userId) {
  const { updateStage } = require('./case.service');
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    select: { stage: true }
  });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  if (caseRecord.stage === 'LEAD_CREATED') {
    await updateStage(case_id, tenant_id, 'DATA_COLLECTION', userId);
    return await updateStage(case_id, tenant_id, 'INCOME_REVIEWED', userId);
  }

  if (caseRecord.stage === 'DATA_COLLECTION') {
    return await updateStage(case_id, tenant_id, 'INCOME_REVIEWED', userId);
  }

  if (caseRecord.stage === 'INCOME_REVIEWED') {
    return caseRecord;
  }

  return await updateStage(case_id, tenant_id, 'INCOME_REVIEWED', userId);
}

module.exports = {
  getIncomeSummary,
  addIncomeEntry,
  updateIncomeEntry,
  deleteIncomeEntry,
  confirmIncomeSummary
};
