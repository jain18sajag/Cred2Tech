const prisma = require('../../config/db');

/**
 * getIncomeSummary — assembles API-pulled income + manual entries for a case.
 * Reads from persistent FY snapshot columns stored at callback ingestion time.
 * Falls back to legacy analytics_payload fields for existing records.
 */
async function getIncomeSummary(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: {
      gst_requests:    { orderBy: { created_at: 'desc' }, take: 1 },
      itr_analytics:   { orderBy: { created_at: 'desc' }, take: 1 },
      applicants: {
        where: { type: 'PRIMARY' },
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

  // ── GST: prefer persisted FY snapshot columns ─────────────────────────────
  const gstReq = caseRecord.gst_requests?.[0];
  const gstTurnoverLatest = gstReq?.turnover_latest_year   != null ? Number(gstReq.turnover_latest_year)   : null;
  const gstTurnoverPrev   = gstReq?.turnover_previous_year != null ? Number(gstReq.turnover_previous_year)  : null;
  const gstFyLatest       = gstReq?.financial_year_latest  || null;
  const gstFyPrev         = gstReq?.financial_year_previous || null;

  // ── ITR: prefer persisted FY snapshot columns ─────────────────────────────
  const itrReq = caseRecord.itr_analytics?.[0];
  let netProfitLatest     = itrReq?.net_profit_latest_year   != null ? Number(itrReq.net_profit_latest_year)   : null;
  let netProfitPrev       = itrReq?.net_profit_previous_year != null ? Number(itrReq.net_profit_previous_year)  : null;
  let grossReceiptsLatest = itrReq?.gross_receipts_latest_year != null ? Number(itrReq.gross_receipts_latest_year) : null;
  const itrFyLatest       = itrReq?.financial_year_latest  || null;
  const itrFyPrev         = itrReq?.financial_year_previous || null;

  // Fallback to analytics_payload for legacy records that predate the snapshot columns
  if (netProfitLatest === null && itrReq?.analytics_payload) {
    const payload = typeof itrReq.analytics_payload === 'string'
      ? JSON.parse(itrReq.analytics_payload) : itrReq.analytics_payload;
    netProfitLatest = payload?.net_profit || payload?.netProfit || null;
  }

  // ── Bank: prefer persisted FY snapshot columns ────────────────────────────
  const primaryApplicant = caseRecord.applicants?.[0];
  const bankReq = primaryApplicant?.bank_statements?.[0] || caseRecord.bank_statements?.[0];
  const avgBalanceLatest = bankReq?.avg_bank_balance_latest_year   != null ? Number(bankReq.avg_bank_balance_latest_year)   : null;
  const avgBalancePrev   = bankReq?.avg_bank_balance_previous_year != null ? Number(bankReq.avg_bank_balance_previous_year)  : null;
  const bankFyLatest     = bankReq?.financial_year_latest  || null;
  const bankFyPrev       = bankReq?.financial_year_previous || null;

  // ── Manual income entries ─────────────────────────────────────────────────
  const manualEntries = caseRecord.income_entries;
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
  if (!annual_amount || Number(annual_amount) < 0) throw new Error('annual_amount must be a positive number.');

  return prisma.caseIncomeEntry.create({
    data: {
      case_id,
      applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
      income_type,
      applicant_label,
      annual_amount:       Number(annual_amount),
      supporting_doc_type,
      remarks
    }
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

  await prisma.caseIncomeEntry.delete({ where: { id: entry_id } });
  return { success: true };
}

/**
 * confirmIncomeSummary — advances the case stage to INCOME_REVIEWED.
 */
async function confirmIncomeSummary(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  return prisma.case.update({
    where: { id: case_id },
    data: { stage: 'INCOME_REVIEWED' }
  });
}

module.exports = {
  getIncomeSummary,
  addIncomeEntry,
  deleteIncomeEntry,
  confirmIncomeSummary
};
