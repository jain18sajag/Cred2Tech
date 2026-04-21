const prisma = require('../../config/db');

/**
 * getIncomeSummary — assembles API-pulled income + manual entries for a case.
 * Returns both the computed data from GST/ITR/Bank and the stored manual entries.
 */
async function getIncomeSummary(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: {
      customer: {
        include: {
          gst_profiles:  { orderBy: { created_at: 'desc' }, take: 1 },
          itr_analytics: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      },
      applicants: {
        include: {
          bank_statements: { orderBy: { created_at: 'desc' }, take: 1 }
        }
      },
      income_entries: {
        orderBy: { created_at: 'asc' }
      },
      obligations: {
        where: { status: 'ACTIVE' }
      }
    }
  });

  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  // ── GST data ─────────────────────────────────────────────────────────────
  const gstProfile = caseRecord.customer?.gst_profiles?.[0];
  const gstData = gstProfile?.raw_response || null;
  const gstTurnoverLatest  = gstData?.annual_turnover || gstData?.totalTaxableValue || null;
  const gstTurnoverPrev    = gstData?.prev_year_turnover || null;

  // ── ITR data ──────────────────────────────────────────────────────────────
  const itrRecord = caseRecord.customer?.itr_analytics?.[0];
  const itrPayload = itrRecord?.analytics_payload || null;
  const netProfitLatest = itrPayload?.net_profit || itrPayload?.netProfit || null;
  const netProfitPrev   = itrPayload?.prev_year_net_profit || null;

  // ── Bank statement — Primary applicant ────────────────────────────────────
  const primaryApplicant = caseRecord.applicants.find(a => a.type === 'PRIMARY');
  const bankRecord = primaryApplicant?.bank_statements?.[0];
  const bankPayload = bankRecord?.analysis_report || null;
  const avgBalanceLatest = bankPayload?.avg_monthly_balance || bankPayload?.averageMonthlyBalance || null;
  const avgBalancePrev   = bankPayload?.prev_avg_monthly_balance || null;

  // ── Manual income entries ─────────────────────────────────────────────────
  const manualEntries = caseRecord.income_entries;
  const manualTotal = manualEntries.reduce((sum, e) => sum + (Number(e.annual_amount) || 0), 0);

  // ── Obligations total ─────────────────────────────────────────────────────
  const totalEmiPerMonth = caseRecord.obligations.reduce((sum, o) => sum + (Number(o.emi_per_month) || 0), 0);

  // ── Combined income = ITR net profit + manual ─────────────────────────────
  const combinedAnnualIncome = (Number(netProfitLatest) || 0) + manualTotal;

  return {
    api_data: {
      gst_turnover:    { latest: gstTurnoverLatest,  prev: gstTurnoverPrev },
      net_profit:      { latest: netProfitLatest,    prev: netProfitPrev   },
      avg_bank_balance: { latest: avgBalanceLatest,  prev: avgBalancePrev  }
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
