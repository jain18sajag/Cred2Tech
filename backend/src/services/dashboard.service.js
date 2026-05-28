const prisma = require('../../config/db');

// ─── IST Date Utilities ────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30

function toIST(date) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function startOfDayIST(date) {
  const ist = toIST(date);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}

function getDateRange(period, customStart, customEnd) {
  const now = new Date();
  const todayStart = startOfDayIST(now);
  const istNow = toIST(now);

  switch (period) {
    case 'today':
      return { gte: todayStart, lte: now };
    case 'mtd': {
      const m = startOfDayIST(new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - IST_OFFSET_MS));
      return { gte: m, lte: now };
    }
    case 'ytd': {
      const y = startOfDayIST(new Date(Date.UTC(istNow.getUTCFullYear(), 0, 1) - IST_OFFSET_MS));
      return { gte: y, lte: now };
    }
    case 'fy': {
      // Indian FY: April 1
      let fyYear = istNow.getUTCFullYear();
      if (istNow.getUTCMonth() < 3) fyYear -= 1; // Jan-Mar belongs to previous FY
      const fy = startOfDayIST(new Date(Date.UTC(fyYear, 3, 1) - IST_OFFSET_MS));
      return { gte: fy, lte: now };
    }
    case 'week': {
      const day = istNow.getUTCDay(); // 0 = Sunday
      const weekStart = startOfDayIST(new Date(now.getTime() - day * 86400000));
      return { gte: weekStart, lte: now };
    }
    case 'life_to_date':
      return { lte: now };
    case 'custom':
      return {
        gte: customStart ? new Date(customStart) : undefined,
        lte: customEnd ? new Date(customEnd) : now,
      };
    default: // default to MTD
      return getDateRange('mtd');
  }
}

function getPrevRange(period) {
  const now = new Date();
  const istNow = toIST(now);
  switch (period) {
    case 'today': {
      const yesterday = startOfDayIST(new Date(now.getTime() - 86400000));
      const todayStart = startOfDayIST(now);
      return { gte: yesterday, lte: new Date(todayStart.getTime() - 1) };
    }
    case 'mtd': {
      const prevMonthEnd = startOfDayIST(new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - IST_OFFSET_MS));
      const prevMonthStart = startOfDayIST(new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - 1, 1) - IST_OFFSET_MS));
      return { gte: prevMonthStart, lte: new Date(prevMonthEnd.getTime() - 1) };
    }
    default:
      return null;
  }
}

function calcTrend(current, previous) {
  if (previous === 0 || previous === null) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ─── DSA Case Scope Helper ────────────────────────────────────────────────────

async function buildCaseWhereForUser(user, dateField, dateRange) {
  const base = { tenant_id: user.tenant_id };
  if (dateRange) base[dateField] = dateRange;

  if (user.role === 'DSA_ADMIN') {
    return base;
  }

  if (user.role === 'SUB_DSA') {
    return { ...base, created_by_user_id: user.id };
  }

  // DSA_MEMBER: self + subordinates via hierarchy_path
  if (user.hierarchy_path) {
    const subordinates = await prisma.user.findMany({
      where: { hierarchy_path: { startsWith: user.hierarchy_path }, tenant_id: user.tenant_id },
      select: { id: true },
    });
    const ids = subordinates.map((u) => u.id);
    return { ...base, created_by_user_id: { in: ids } };
  }

  return { ...base, created_by_user_id: user.id };
}

// ─── DSA Dashboard Services ───────────────────────────────────────────────────

async function getDsaWalletBalance(tenantId) {
  const wallet = await prisma.tenantWallet.findUnique({ where: { tenant_id: tenantId } });
  return wallet?.balance ?? 0;
}

async function getDsaSummary(user, period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);
  const prevRange = getPrevRange(period);

  // Lead Created — cases created in period (not DRAFT)
  const caseWhere = await buildCaseWhereForUser(user, 'lead_date', range);
  const prevCaseWhere = prevRange ? await buildCaseWhereForUser(user, 'lead_date', prevRange) : null;
  const caseWhereNonDraft = { ...caseWhere, stage: { not: 'DRAFT' } };
  const prevCaseWhereNonDraft = prevCaseWhere ? { ...prevCaseWhere, stage: { not: 'DRAFT' } } : null;

  // Eligibility Checked — ESR_GENERATED stage entered in period (via stage_history)
  const esrHistoryWhere = {
    tenant_id: user.role === 'DSA_ADMIN' ? user.tenant_id : undefined,
    new_stage: 'ESR_GENERATED',
    changed_at: range,
  };
  const prevEsrHistoryWhere = prevRange ? { ...esrHistoryWhere, changed_at: prevRange } : null;

  if (user.role === 'SUB_DSA') {
    esrHistoryWhere.case = { created_by_user_id: user.id };
    if (prevEsrHistoryWhere) prevEsrHistoryWhere.case = { created_by_user_id: user.id };
  } else if (user.role === 'DSA_MEMBER' && user.hierarchy_path) {
    const subs = await prisma.user.findMany({
      where: { hierarchy_path: { startsWith: user.hierarchy_path }, tenant_id: user.tenant_id },
      select: { id: true },
    });
    const ids = subs.map((u) => u.id);
    esrHistoryWhere.case = { created_by_user_id: { in: ids } };
    if (prevEsrHistoryWhere) prevEsrHistoryWhere.case = { created_by_user_id: { in: ids } };
  }

  // Sanctions — by sanction_date
  const sanctionBaseWhere = user.role === 'SUB_DSA'
    ? { tenant_id: user.tenant_id, case_entity: { created_by_user_id: user.id } }
    : { tenant_id: user.tenant_id };

  const sanctionWhere = { ...sanctionBaseWhere, sanction_date: range };
  const prevSanctionWhere = prevRange ? { ...sanctionBaseWhere, sanction_date: prevRange } : null;

  // Disbursements — by disbursement_date
  const disbWhere = { ...sanctionBaseWhere, disbursement_date: range };
  const prevDisbWhere = prevRange ? { ...sanctionBaseWhere, disbursement_date: prevRange } : null;

  const [
    leadsCount, prevLeadsCount, leadsAmt,
    esrRecords, prevEsrRecords,
    sanctionCount, prevSanctionCount, sanctionAmt,
    disbCount, prevDisbCount, disbAmt,
  ] = await Promise.all([
    prisma.case.count({ where: caseWhereNonDraft }),
    prevCaseWhereNonDraft ? prisma.case.count({ where: prevCaseWhereNonDraft }) : Promise.resolve(0),
    prisma.case.aggregate({ where: caseWhereNonDraft, _sum: { loan_amount: true } }),

    prisma.caseStageHistory.findMany({ where: esrHistoryWhere, select: { case_id: true }, distinct: ['case_id'] }),
    prevEsrHistoryWhere ? prisma.caseStageHistory.findMany({ where: prevEsrHistoryWhere, select: { case_id: true }, distinct: ['case_id'] }) : Promise.resolve([]),

    prisma.caseSanction.count({ where: sanctionWhere }),
    prevSanctionWhere ? prisma.caseSanction.count({ where: prevSanctionWhere }) : Promise.resolve(0),
    prisma.caseSanction.aggregate({ where: sanctionWhere, _sum: { sanctioned_amount: true } }),

    prisma.disbursement.count({ where: disbWhere }),
    prevDisbWhere ? prisma.disbursement.count({ where: prevDisbWhere }) : Promise.resolve(0),
    prisma.disbursement.aggregate({ where: disbWhere, _sum: { amount: true } }),
  ]);

  const esrCount = esrRecords.length;
  const prevEsrCount = prevEsrRecords.length;

  return {
    leads: {
      count: leadsCount,
      amount: leadsAmt._sum.loan_amount || 0,
      trend_count: leadsCount - (prevLeadsCount || 0),
      trend_pct: calcTrend(leadsCount, prevLeadsCount),
    },
    eligibility: {
      count: esrCount,
      trend_count: esrCount - (prevEsrCount || 0),
      trend_pct: calcTrend(esrCount, prevEsrCount),
    },
    sanctions: {
      count: sanctionCount,
      amount: Number(sanctionAmt._sum.sanctioned_amount || 0),
      trend_count: sanctionCount - (prevSanctionCount || 0),
      trend_pct: calcTrend(sanctionCount, prevSanctionCount),
    },
    disbursements: {
      count: disbCount,
      amount: Number(disbAmt._sum.amount || 0),
      trend_count: disbCount - (prevDisbCount || 0),
      trend_pct: calcTrend(disbCount, prevDisbCount),
    },
  };
}

async function getDsaRecentCases(user, period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);
  const where = await buildCaseWhereForUser(user, 'lead_date', range);
  where.stage = { not: 'DRAFT' };

  const cases = await prisma.case.findMany({
    where,
    orderBy: { lead_date: 'desc' },
    take: 10,
    select: {
      id: true,
      customer_name: true,
      lender_name: true,
      loan_amount: true,
      stage: true,
      lead_date: true,
      esr_generated: true,
    },
  });

  return cases.map((c) => ({
    case_id: c.id,
    case_ref: `CASE-${String(c.id).padStart(4, '0')}`,
    customer_name: c.customer_name || '—',
    lender: c.lender_name || '—',
    applied_amount: c.loan_amount,
    stage: c.stage,
    lead_date: c.lead_date,
    next_action: deriveNextAction(c.stage),
  }));
}

function deriveNextAction(stage) {
  const map = {
    LEAD_CREATED: 'Pull Data',
    DATA_COLLECTION: 'Gen. Elig. Report',
    INCOME_REVIEWED: 'Gen. Elig. Report',
    ESR_GENERATED: 'Send to Lender',
    LEAD_SENT_TO_LENDER: 'Update Stage',
    IN_REVIEW: 'Update Stage',
    APPROVED: 'Record Sanction',
    PARTLY_DISBURSED: 'Tranches',
    DISBURSED: '—',
    CLOSED: '—',
    REJECTED: '—',
  };
  return map[stage] || 'Update Stage';
}

async function getDsaStageSummary(user, period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);

  // Use stage_history to count entries per stage in the period
  const historyWhere = {
    tenant_id: user.tenant_id,
    changed_at: range,
  };
  if (user.role === 'SUB_DSA') {
    historyWhere.case = { created_by_user_id: user.id };
  } else if (user.role === 'DSA_MEMBER' && user.hierarchy_path) {
    const subs = await prisma.user.findMany({
      where: { hierarchy_path: { startsWith: user.hierarchy_path }, tenant_id: user.tenant_id },
      select: { id: true },
    });
    historyWhere.case = { created_by_user_id: { in: subs.map((u) => u.id) } };
  }

  const history = await prisma.caseStageHistory.findMany({
    where: historyWhere,
    select: { new_stage: true, case_id: true },
    distinct: ['new_stage', 'case_id'],
  });

  const stageLabels = {
    LEAD_CREATED: 'Lead Created',
    DATA_COLLECTION: 'Data Pulled',
    ESR_GENERATED: 'Eligibility Report Generated',
    LEAD_SENT_TO_LENDER: 'Lead Sent to Lender',
    IN_REVIEW: 'Under Process',
    APPROVED: 'Sanctioned Undisbursed',
    PARTLY_DISBURSED: 'Partly Disbursed',
    CLOSED: 'Closed',
    REJECTED: 'Closed Leads',
  };

  const result = {};
  for (const [key, label] of Object.entries(stageLabels)) result[label] = 0;
  for (const row of history) {
    const label = stageLabels[row.new_stage];
    if (label) result[label] = (result[label] || 0) + 1;
  }
  return result;
}

// ─── Platform Dashboard Services (SUPER_ADMIN only, no PII) ─────────────────

async function getPlatformSummary(period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);
  const prevRange = getPrevRange(period);

  const [
    activeDsas, prevActiveDsas,
    activeClients, prevActiveClients,
    apiCalls, prevApiCalls,
    disbursed, prevDisbursed,
  ] = await Promise.all([
    prisma.tenant.count({ where: { type: 'DSA', status: 'ACTIVE', created_at: range } }),
    prevRange ? prisma.tenant.count({ where: { type: 'DSA', status: 'ACTIVE', created_at: prevRange } }) : Promise.resolve(0),

    prisma.customer.count({ where: { created_at: range } }),
    prevRange ? prisma.customer.count({ where: { created_at: prevRange } }) : Promise.resolve(0),

    prisma.apiUsageLog.count({ where: { created_at: range } }),
    prevRange ? prisma.apiUsageLog.count({ where: { created_at: prevRange } }) : Promise.resolve(0),

    prisma.disbursement.aggregate({ where: { disbursement_date: range }, _sum: { amount: true } }),
    prevRange ? prisma.disbursement.aggregate({ where: { disbursement_date: prevRange }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: 0 } }),
  ]);

  // Total active DSAs (not just this period)
  const totalActiveDsas = await prisma.tenant.count({ where: { type: 'DSA', status: 'ACTIVE' } });

  return {
    active_dsas: totalActiveDsas,
    active_dsas_new_period: activeDsas,
    active_dsas_trend_count: activeDsas - prevActiveDsas,
    active_dsas_trend_pct: calcTrend(activeDsas, prevActiveDsas),

    active_clients: activeClients,
    active_clients_trend_pct: calcTrend(activeClients, prevActiveClients),

    total_api_calls: apiCalls,
    total_api_calls_trend_pct: calcTrend(apiCalls, prevApiCalls),

    amount_disbursed: Number(disbursed._sum.amount || 0),
    amount_disbursed_trend_pct: calcTrend(
      Number(disbursed._sum.amount || 0),
      Number(prevDisbursed._sum?.amount || 0)
    ),
  };
}

async function getPlatformApiUsage(period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);

  const grouped = await prisma.apiUsageLog.groupBy({
    by: ['api_code', 'status'],
    where: { created_at: range },
    _count: { id: true },
  });

  // Aggregate into api_code → { total, success, failed, refunded }
  const map = {};
  for (const row of grouped) {
    if (!map[row.api_code]) map[row.api_code] = { api_code: row.api_code, total: 0, success: 0, failed: 0, refunded: 0 };
    map[row.api_code].total += row._count.id;
    if (row.status === 'SUCCESS') map[row.api_code].success += row._count.id;
    else if (row.status === 'FAILED') map[row.api_code].failed += row._count.id;
    else if (row.status === 'REFUNDED') map[row.api_code].refunded += row._count.id;
  }

  const rows = Object.values(map).map((r) => ({
    ...r,
    success_rate: r.total > 0 ? ((r.success / r.total) * 100).toFixed(1) : '0.0',
    display_name: apiCodeToDisplayName(r.api_code),
  }));

  const totals = rows.reduce((a, r) => ({
    total: a.total + r.total,
    success: a.success + r.success,
    failed: a.failed + r.failed,
    refunded: a.refunded + r.refunded,
  }), { total: 0, success: 0, failed: 0, refunded: 0 });

  return {
    rows,
    totals: {
      ...totals,
      success_rate: totals.total > 0 ? ((totals.success / totals.total) * 100).toFixed(1) : '0.0',
    },
  };
}

function apiCodeToDisplayName(code) {
  const names = {
    ITR_ANALYTICS: 'ITR — 3 Years',
    GST_FETCH: 'GST — 2 Years',
    BUREAU_PULL: 'Bureau (CIBIL / Exp / CRIF)',
    BANK_STATEMENT: 'Bank Statement (AA)',
    PAN_VERIFY: 'PAN Verification',
  };
  return names[code] || code;
}

async function getPlatformFunnel(period, customStart, customEnd) {
  const range = getDateRange(period, customStart, customEnd);

  // Count unique cases that entered each stage during the period using stage_history
  const stages = ['LEAD_CREATED', 'ESR_GENERATED', 'LEAD_SENT_TO_LENDER', 'APPROVED', 'DISBURSED'];

  const uniqueHistory = await prisma.caseStageHistory.findMany({
    where: { new_stage: { in: stages }, changed_at: range },
    select: { new_stage: true, case_id: true },
    distinct: ['new_stage', 'case_id'],
  });

  const counts = {};
  for (const s of stages) counts[s] = 0;
  for (const row of uniqueHistory) {
    counts[row.new_stage] = (counts[row.new_stage] || 0) + 1;
  }

  const funnel = [
    { label: 'Lead Created', stage: 'LEAD_CREATED', count: counts['LEAD_CREATED'] },
    { label: 'Eligibility Checked', stage: 'ESR_GENERATED', count: counts['ESR_GENERATED'] },
    { label: 'Application Submitted', stage: 'LEAD_SENT_TO_LENDER', count: counts['LEAD_SENT_TO_LENDER'] },
    { label: 'Sanctioned', stage: 'APPROVED', count: counts['APPROVED'] },
    { label: 'Disbursed', stage: 'DISBURSED', count: counts['DISBURSED'] },
  ];

  // Add conversion pct to next stage
  for (let i = 0; i < funnel.length - 1; i++) {
    const curr = funnel[i].count;
    const next = funnel[i + 1].count;
    funnel[i + 1].conversion_pct = curr > 0 ? Math.round((next / curr) * 100) : 0;
    funnel[i + 1].conversion_label = `+${funnel[i + 1].conversion_pct}% ${funnel[i + 1].conversion_label || ''}`.trim();
  }

  return funnel;
}

async function getTopDsas(period, customStart, customEnd, limit = 5) {
  const range = getDateRange(period, customStart, customEnd);

  const dsaTenants = await prisma.tenant.findMany({
    where: { type: 'DSA', status: 'ACTIVE' },
    select: { id: true, name: true, status: true, created_at: true },
  });

  const results = await Promise.all(
    dsaTenants.map(async (t) => {
      const [apiCalls, applications] = await Promise.all([
        prisma.apiUsageLog.count({ where: { tenant_id: t.id, created_at: range } }),
        prisma.case.count({ where: { tenant_id: t.id, stage: { not: 'DRAFT' }, lead_date: range } }),
      ]);
      return {
        dsa_name: t.name, // DSA name is allowed (not customer PII)
        since: t.created_at,
        status: t.status,
        api_calls: apiCalls,
        applications,
      };
    })
  );

  return results
    .sort((a, b) => b.api_calls - a.api_calls)
    .slice(0, limit);
}

async function getTopLenders(period, customStart, customEnd, limit = 5) {
  const range = getDateRange(period, customStart, customEnd);

  // Fetch all active lenders from the database first
  const platformLenders = await prisma.lender.findMany({
    where: { status: 'ACTIVE' },
    select: { name: true },
  });

  // Applied = cases with a lender name in period
  const applied = await prisma.case.groupBy({
    by: ['lender_name'],
    where: { lender_name: { not: null }, lead_date: range },
    _count: { id: true },
  });

  // Sanctioned
  const sanctioned = await prisma.caseSanction.groupBy({
    by: ['lender_name'],
    where: { sanction_date: range },
    _count: { id: true },
  });

  // Disbursed
  const disbursed = await prisma.disbursement.groupBy({
    by: ['lender_name'],
    where: { disbursement_date: range },
    _count: { id: true },
  });

  const appliedMap = Object.fromEntries(applied.map((r) => [r.lender_name, r._count.id]));
  const sanctionedMap = Object.fromEntries(sanctioned.map((r) => [r.lender_name, r._count.id]));
  const disbursedMap = Object.fromEntries(disbursed.map((r) => [r.lender_name, r._count.id]));

  const allLenderNames = [
    ...new Set([
      ...platformLenders.map((l) => l.name),
      ...Object.keys(appliedMap),
      ...Object.keys(sanctionedMap),
      ...Object.keys(disbursedMap),
    ]),
  ].filter(Boolean);

  return allLenderNames
    .map((name) => ({
      lender_name: name,
      applied: appliedMap[name] || 0,
      sanctioned: sanctionedMap[name] || 0,
      disbursed: disbursedMap[name] || 0,
    }))
    .sort((a, b) => {
      const scoreA = a.applied * 3 + a.sanctioned * 5 + a.disbursed * 10;
      const scoreB = b.applied * 3 + b.sanctioned * 5 + b.disbursed * 10;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.lender_name.localeCompare(b.lender_name);
    })
    .slice(0, limit);
}

module.exports = {
  getDsaWalletBalance,
  getDsaSummary,
  getDsaRecentCases,
  getDsaStageSummary,
  getPlatformSummary,
  getPlatformApiUsage,
  getPlatformFunnel,
  getTopDsas,
  getTopLenders,
};
