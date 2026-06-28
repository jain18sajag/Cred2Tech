const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');

const ACTIVE = 'ACTIVE';
const RULE_STATUSES = new Set(['ACTIVE', 'INACTIVE']);
const COMMISSION_TYPES = new Set(['PERCENTAGE', 'FIXED']);
const CALCULATION_BASES = new Set(['DISBURSED_AMOUNT', 'LENDER_COMMISSION', 'PROCESSING_FEE', 'FIXED_PER_CASE']);
const LEDGER_TRANSITIONS = {
  CALCULATED: ['APPROVED', 'REJECTED', 'ON_HOLD'],
  ON_HOLD: ['CALCULATED', 'REJECTED'],
  APPROVED: ['PAID', 'REJECTED'],
  PAID: [],
  REJECTED: []
};

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Prisma.Decimal(value);
  if (!d.isFinite()) fail('Invalid monetary value');
  return d.toDecimalPlaces(2);
}

function asDate(value, field) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(`${field} must be a valid date`);
  return d;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dateRange(month) {
  if (!month) return null;
  if (!/^\d{4}-\d{2}$/.test(month)) fail('month must be YYYY-MM');
  const [year, mon] = month.split('-').map(Number);
  return { gte: new Date(year, mon - 1, 1), lt: new Date(year, mon, 1) };
}

function productValue(value) {
  if (!value || String(value).toUpperCase() === 'ALL') return null;
  return String(value).trim().toUpperCase();
}

function intersectsExactOrAll(a, b) {
  return !a || !b || a === b;
}

function rangesIntersect(aFrom, aTo, bFrom, bTo) {
  const min = new Date(0);
  const max = new Date('9999-12-31T00:00:00.000Z');
  const af = aFrom || min;
  const at = aTo || max;
  const bf = bFrom || min;
  const bt = bTo || max;
  return af <= bt && at >= bf;
}

async function ensureTenantLender(tenantId, tenantLenderId) {
  if (!tenantLenderId) return null;
  const lender = await prisma.tenantLender.findFirst({ where: { id: Number(tenantLenderId), tenant_id: tenantId } });
  if (!lender) fail('tenant_lender_id is not valid for this tenant');
  return lender.id;
}

function normalizeRuleInput(body, existing = {}) {
  const allowed = [
    'hierarchy_level', 'product_type', 'tenant_lender_id', 'commission_type',
    'commission_value', 'calculation_base', 'min_amount', 'max_cap_amount',
    'effective_from', 'effective_to', 'status'
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
  }

  const merged = { ...existing, ...patch };
  if (!merged.hierarchy_level) fail('hierarchy_level is required');
  merged.hierarchy_level = String(merged.hierarchy_level).trim();
  merged.product_type = productValue(merged.product_type);
  merged.tenant_lender_id = merged.tenant_lender_id ? Number(merged.tenant_lender_id) : null;
  merged.status = merged.status || ACTIVE;
  if (!RULE_STATUSES.has(merged.status)) fail('status must be ACTIVE or INACTIVE');
  if (!COMMISSION_TYPES.has(merged.commission_type)) fail('commission_type must be PERCENTAGE or FIXED');
  if (!CALCULATION_BASES.has(merged.calculation_base)) fail('Unsupported calculation_base');
  if (merged.calculation_base === 'FIXED_PER_CASE' && merged.commission_type !== 'FIXED') {
    fail('FIXED_PER_CASE must use FIXED commission_type');
  }

  merged.commission_value = money(merged.commission_value);
  merged.min_amount = money(merged.min_amount);
  merged.max_cap_amount = money(merged.max_cap_amount);
  if (merged.commission_value.lt(0)) fail('commission_value must be non-negative');
  if (merged.commission_type === 'PERCENTAGE' && merged.commission_value.gt(100)) fail('percentage cannot exceed 100');
  if (merged.min_amount && merged.min_amount.lt(0)) fail('min_amount must be non-negative');
  if (merged.max_cap_amount && merged.max_cap_amount.lt(0)) fail('max_cap_amount must be non-negative');
  if (merged.min_amount && merged.max_cap_amount && merged.min_amount.gt(merged.max_cap_amount)) {
    fail('min_amount cannot exceed max_cap_amount');
  }

  merged.effective_from = asDate(merged.effective_from, 'effective_from');
  merged.effective_to = asDate(merged.effective_to, 'effective_to');
  if (merged.effective_from && merged.effective_to && merged.effective_from > merged.effective_to) {
    fail('effective_from cannot be after effective_to');
  }
  return merged;
}

async function rejectOverlappingRule(tenantId, rule, excludeId) {
  if (rule.status !== ACTIVE) return;
  const rules = await prisma.salesIncentiveRule.findMany({
    where: { tenant_id: tenantId, hierarchy_level: rule.hierarchy_level, status: ACTIVE, ...(excludeId ? { id: { not: excludeId } } : {}) }
  });
  const conflict = rules.find(r =>
    intersectsExactOrAll(rule.product_type, r.product_type) &&
    intersectsExactOrAll(rule.tenant_lender_id, r.tenant_lender_id) &&
    rangesIntersect(rule.effective_from, rule.effective_to, r.effective_from, r.effective_to)
  );
  if (conflict) fail(`Overlapping active incentive rule exists (id ${conflict.id})`);
}

function precedence(rule, product, lenderId) {
  const exactProduct = rule.product_type && rule.product_type === product;
  const exactLender = rule.tenant_lender_id && Number(rule.tenant_lender_id) === Number(lenderId);
  if (exactProduct && exactLender) return 4;
  if (exactProduct && !rule.tenant_lender_id) return 3;
  if (!rule.product_type && exactLender) return 2;
  if (!rule.product_type && !rule.tenant_lender_id) return 1;
  return 0;
}

function pickRule(rules, product, lenderId, eventDate) {
  const candidates = rules
    .filter(r => (!r.effective_from || r.effective_from <= eventDate) && (!r.effective_to || r.effective_to >= eventDate))
    .filter(r => (!r.product_type || r.product_type === product) && (!r.tenant_lender_id || Number(r.tenant_lender_id) === Number(lenderId)))
    .map(r => ({ rule: r, score: precedence(r, product, lenderId) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id - b.id);
  if (!candidates.length) return null;
  if (candidates.filter(x => x.score === candidates[0].score).length > 1) fail('Multiple incentive rules with identical precedence');
  return candidates[0].rule;
}

function calculateAmount(rule, baseAmount) {
  let incentive = rule.commission_type === 'PERCENTAGE'
    ? baseAmount.mul(rule.commission_value).div(100)
    : new Prisma.Decimal(rule.commission_value);
  if (rule.min_amount && incentive.lt(rule.min_amount)) incentive = new Prisma.Decimal(rule.min_amount);
  if (rule.max_cap_amount && incentive.gt(rule.max_cap_amount)) incentive = new Prisma.Decimal(rule.max_cap_amount);
  return incentive.toDecimalPlaces(2);
}

function customerName(customer) {
  return customer?.business_name || customer?.legal_business_name || customer?.trade_name || customer?.proprietor_name || 'Customer';
}

function ledgerDto(row) {
  const metadata = row.calculation_metadata || {};
  return {
    ...row,
    case_display_id: `CASE-${row.case_id}`,
    customer_name: customerName(row.case_entity?.customer),
    product_type: row.case_entity?.product_type || metadata.product_type || null,
    lender: row.case_entity?.lender_name || metadata.lender_name || null,
    source_date: metadata.source_date || null,
    rule_snapshot_summary: metadata.rule_snapshot ? {
      id: metadata.rule_snapshot.id,
      calculation_base: metadata.rule_snapshot.calculation_base,
      commission_type: metadata.rule_snapshot.commission_type,
      commission_value: metadata.rule_snapshot.commission_value
    } : null
  };
}

async function listRules(tenantId) {
  return prisma.salesIncentiveRule.findMany({
    where: { tenant_id: tenantId },
    include: { lender: true },
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }]
  });
}

async function createRule(tenantId, userId, body) {
  const rule = normalizeRuleInput(body);
  rule.tenant_lender_id = await ensureTenantLender(tenantId, rule.tenant_lender_id);
  await rejectOverlappingRule(tenantId, rule);
  return prisma.salesIncentiveRule.create({ data: { ...rule, tenant_id: tenantId, created_by: userId } });
}

async function updateRule(tenantId, ruleId, userId, body) {
  const existing = await prisma.salesIncentiveRule.findFirst({ where: { id: ruleId, tenant_id: tenantId } });
  if (!existing) fail('Rule not found', 404);
  const rule = normalizeRuleInput(body, existing);
  rule.tenant_lender_id = await ensureTenantLender(tenantId, rule.tenant_lender_id);
  await rejectOverlappingRule(tenantId, rule, ruleId);
  return prisma.salesIncentiveRule.update({ where: { id: ruleId }, data: { ...rule, updated_by: userId } });
}

async function deleteRule(tenantId, ruleId, userId) {
  const rule = await prisma.salesIncentiveRule.findFirst({ where: { id: ruleId, tenant_id: tenantId } });
  if (!rule) fail('Rule not found', 404);
  return prisma.salesIncentiveRule.update({ where: { id: ruleId }, data: { status: 'INACTIVE', updated_by: userId } });
}

function buildEvents(caseEntity, body) {
  const requestedDisb = new Set((body.disbursement_ids || []).map(Number));
  const requestedComm = new Set((body.commission_ledger_ids || []).map(Number));
  const events = [];
  for (const d of caseEntity.disbursements || []) {
    if (requestedDisb.size && !requestedDisb.has(d.id)) continue;
    if (d.status !== 'RECORDED') continue;
    events.push({ source_type: 'DISBURSEMENT', source_id: d.id, date: d.disbursement_date, amount: d.amount, disbursement_id: d.id });
  }
  for (const c of caseEntity.commission_ledgers || []) {
    if (requestedComm.size && !requestedComm.has(c.id)) continue;
    if (c.entry_type !== 'BASE_COMMISSION' || c.is_reversed || c.status === 'CANCELLED') continue;
    events.push({ source_type: 'COMMISSION_LEDGER', source_id: c.id, date: c.created_at, amount: c.calculated_commission, commission_ledger_id: c.id });
  }
  if (caseEntity.sanction) {
    events.push({ source_type: 'PROCESSING_FEE', source_id: caseEntity.sanction.id, date: caseEntity.sanction.sanction_date, amount: caseEntity.sanction.processing_fee });
  }
  events.push({ source_type: 'CASE', source_id: caseEntity.id, date: caseEntity.lead_date || caseEntity.created_at, amount: new Prisma.Decimal(1) });
  return events;
}

async function calculateIncentives(tenantId, body) {
  const caseIds = new Set((body.case_ids || []).map(Number));
  const disbursementIds = (body.disbursement_ids || []).map(Number);
  const commissionLedgerIds = (body.commission_ledger_ids || []).map(Number);
  if (!caseIds.size && !disbursementIds.length && !commissionLedgerIds.length) fail('Provide case_ids, disbursement_ids, or commission_ledger_ids');

  if (disbursementIds.length) {
    const rows = await prisma.disbursement.findMany({ where: { id: { in: disbursementIds }, tenant_id: tenantId }, select: { case_id: true } });
    if (rows.length !== disbursementIds.length) fail('One or more disbursement_ids were not found for this tenant');
    rows.forEach(r => caseIds.add(r.case_id));
  }
  if (commissionLedgerIds.length) {
    const rows = await prisma.commissionLedger.findMany({ where: { id: { in: commissionLedgerIds }, tenant_id: tenantId }, select: { case_id: true } });
    if (rows.length !== commissionLedgerIds.length) fail('One or more commission_ledger_ids were not found for this tenant');
    rows.forEach(r => caseIds.add(r.case_id));
  }

  const results = [];
  for (const caseId of caseIds) {
    const caseEntity = await prisma.case.findFirst({
      where: { id: caseId, tenant_id: tenantId },
      include: {
        created_by: { include: { role: true } },
        customer: true,
        sanction: true,
        disbursements: true,
        commission_ledgers: true
      }
    });
    if (!caseEntity) {
      results.push({ case_id: caseId, status: 'NOT_FOUND', reason: 'Case not found for tenant' });
      continue;
    }
    const employee = caseEntity.created_by;
    if (!employee || ['SUB_DSA', 'CUSTOMER', 'MSME_CUSTOMER'].includes(employee.role?.name)) {
      results.push({ case_id: caseId, status: 'OWNER_NOT_CONFIGURED', reason: 'Case owner is not incentive-eligible' });
      continue;
    }
    if (!employee.hierarchy_level) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: 'Employee hierarchy level missing' });
      continue;
    }

    const rules = await prisma.salesIncentiveRule.findMany({
      where: { tenant_id: tenantId, hierarchy_level: employee.hierarchy_level, status: ACTIVE }
    });
    if (!rules.length) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: 'No active rules for hierarchy' });
      continue;
    }

    for (const event of buildEvents(caseEntity, body)) {
      const product = productValue(caseEntity.product_type || event.product_type);
      const lenderId = caseEntity.tenant_lender_id || caseEntity.sanction?.tenant_lender_id || null;
      const rule = pickRule(rules, product, lenderId, event.date);
      if (!rule || (rule.calculation_base === 'DISBURSED_AMOUNT' && event.source_type !== 'DISBURSEMENT') ||
        (rule.calculation_base === 'LENDER_COMMISSION' && event.source_type !== 'COMMISSION_LEDGER') ||
        (rule.calculation_base === 'PROCESSING_FEE' && event.source_type !== 'PROCESSING_FEE') ||
        (rule.calculation_base === 'FIXED_PER_CASE' && event.source_type !== 'CASE')) continue;

      const baseAmount = rule.calculation_base === 'FIXED_PER_CASE' ? new Prisma.Decimal(1) : new Prisma.Decimal(event.amount);
      const incentive = calculateAmount(rule, baseAmount);
      const idempotencyKey = `INCENTIVE:${tenantId}:${employee.id}:${caseId}:${event.source_type}:${event.source_id}`;
      const metadata = {
        source_type: event.source_type,
        source_id: event.source_id,
        source_date: event.date.toISOString(),
        product_type: product,
        lender_id: lenderId,
        lender_name: caseEntity.sanction?.lender_name || caseEntity.lender_name,
        rule_precedence: 'exact product + exact lender, exact product + all lenders, all products + exact lender, then global',
        rule_snapshot: {
          id: rule.id,
          hierarchy_level: rule.hierarchy_level,
          product_type: rule.product_type,
          tenant_lender_id: rule.tenant_lender_id,
          calculation_base: rule.calculation_base,
          commission_type: rule.commission_type,
          commission_value: rule.commission_value.toString(),
          min_amount: rule.min_amount?.toString() || null,
          max_cap_amount: rule.max_cap_amount?.toString() || null,
          effective_from: rule.effective_from?.toISOString() || null,
          effective_to: rule.effective_to?.toISOString() || null
        }
      };

      const existing = await prisma.salesIncentiveLedger.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing && existing.status !== 'CALCULATED') {
        results.push({ id: existing.id, case_id: caseId, status: 'SKIPPED', reason: `Existing entry is ${existing.status}` });
        continue;
      }
      const ledger = await prisma.salesIncentiveLedger.upsert({
        where: { idempotency_key: idempotencyKey },
        update: {
          rule_id: rule.id,
          hierarchy_level: employee.hierarchy_level,
          base_amount: baseAmount.toDecimalPlaces(2),
          calculated_incentive: incentive,
          calculation_metadata: metadata,
          payout_period: monthKey(event.date)
        },
        create: {
          tenant_id: tenantId,
          user_id: employee.id,
          case_id: caseId,
          disbursement_id: event.disbursement_id || null,
          commission_ledger_id: event.commission_ledger_id || null,
          idempotency_key: idempotencyKey,
          hierarchy_level: employee.hierarchy_level,
          rule_id: rule.id,
          base_amount: baseAmount.toDecimalPlaces(2),
          calculated_incentive: incentive,
          status: 'CALCULATED',
          calculation_metadata: metadata,
          payout_period: monthKey(event.date)
        }
      });
      results.push(ledgerDto(ledger));
    }
  }
  return results;
}

async function listEmployeesWithConfig(tenantId) {
  const users = await prisma.user.findMany({
    where: { tenant_id: tenantId, status: 'ACTIVE', role: { name: { notIn: ['SUB_DSA', 'CUSTOMER', 'MSME_CUSTOMER'] } } },
    select: { id: true, name: true, email: true, hierarchy_level: true, status: true }
  });
  const activeRules = await prisma.salesIncentiveRule.findMany({ where: { tenant_id: tenantId, status: ACTIVE } });
  return users.map(user => ({ ...user, rules_configured: activeRules.filter(r => r.hierarchy_level === user.hierarchy_level).length }));
}

async function listPayouts(tenantId, filters = {}, currentUser = {}) {
  const { user_id, status, hierarchy_level, month, product, lender, search, page = 1, limit = 50 } = filters;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const where = { tenant_id: tenantId };
  if (currentUser.role === 'DSA_MEMBER') where.user_id = currentUser.id;
  else if (user_id) where.user_id = Number(user_id);
  if (status) where.status = status;
  if (hierarchy_level) where.hierarchy_level = hierarchy_level;
  if (month) where.payout_period = month;
  if (product) where.case_entity = { product_type: productValue(product) };
  if (lender) where.case_entity = { ...(where.case_entity || {}), tenant_lender_id: Number(lender) };
  if (search) {
    const q = String(search);
    const id = q.replace(/^CASE-/i, '');
    where.OR = [
      ...(Number.isInteger(Number(id)) ? [{ case_id: Number(id) }] : []),
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { case_entity: { customer: { business_name: { contains: q, mode: 'insensitive' } } } },
      { case_entity: { customer: { legal_business_name: { contains: q, mode: 'insensitive' } } } }
    ];
  }

  const include = {
    user: { select: { id: true, name: true, email: true } },
    case_entity: {
      select: {
        id: true, product_type: true, lender_name: true, tenant_lender_id: true,
        customer: { select: { id: true, business_name: true, legal_business_name: true, trade_name: true, proprietor_name: true } }
      }
    },
    rule: { select: { calculation_base: true, commission_type: true, commission_value: true } }
  };
  const [rows, total, all] = await Promise.all([
    prisma.salesIncentiveLedger.findMany({ where, include, orderBy: { created_at: 'desc' }, skip: (pageNum - 1) * take, take }),
    prisma.salesIncentiveLedger.count({ where }),
    prisma.salesIncentiveLedger.findMany({ where, select: { case_id: true, base_amount: true, calculated_incentive: true, status: true, payout_period: true } })
  ]);
  const now = new Date();
  const current = monthKey(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previous = monthKey(prevDate);
  const summarize = rows => ({
    cases: new Set(rows.map(r => r.case_id)).size,
    volume: rows.reduce((s, r) => s.plus(r.base_amount || 0), new Prisma.Decimal(0)).toFixed(2),
    payout_eligible: rows.reduce((s, r) => s.plus(r.calculated_incentive || 0), new Prisma.Decimal(0)).toFixed(2),
    paid_dues: rows.filter(r => r.status === 'PAID').reduce((s, r) => s.plus(r.calculated_incentive || 0), new Prisma.Decimal(0)).toFixed(2),
    pending: rows.filter(r => !['PAID', 'REJECTED'].includes(r.status)).reduce((s, r) => s.plus(r.calculated_incentive || 0), new Prisma.Decimal(0)).toFixed(2)
  });
  return {
    ledgers: rows.map(ledgerDto),
    data: rows.map(ledgerDto),
    pagination: { total, page: pageNum, page_size: take },
    summary: {
      current_month: summarize(all.filter(r => r.payout_period === current)),
      previous_month: summarize(all.filter(r => r.payout_period === previous)),
      older: summarize(all.filter(r => r.payout_period && r.payout_period < previous))
    }
  };
}

async function updatePayoutStatus(tenantId, ledgerId, status, remarks, userId) {
  const ledger = await prisma.salesIncentiveLedger.findFirst({ where: { id: ledgerId, tenant_id: tenantId } });
  if (!ledger) fail('Ledger entry not found', 404);
  const allowed = LEDGER_TRANSITIONS[ledger.status] || [];
  if (!allowed.includes(status)) fail(`Invalid transition: ${ledger.status} to ${status}`);
  if (status === 'REJECTED' && !remarks?.trim()) fail('Remarks are mandatory when rejecting');
  const data = { status, remarks: remarks || null };
  if (status === 'APPROVED') Object.assign(data, { approved_by: userId, approved_at: new Date(), paid_by: null, paid_at: null, rejected_by: null, rejected_at: null });
  if (status === 'PAID') Object.assign(data, { paid_by: userId, paid_at: new Date(), rejected_by: null, rejected_at: null });
  if (status === 'REJECTED') Object.assign(data, { rejected_by: userId, rejected_at: new Date(), paid_by: null, paid_at: null });
  if (status === 'CALCULATED') Object.assign(data, { approved_by: null, approved_at: null, paid_by: null, paid_at: null, rejected_by: null, rejected_at: null });
  return prisma.salesIncentiveLedger.update({ where: { id: ledgerId }, data });
}

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  calculateIncentives,
  listEmployeesWithConfig,
  listPayouts,
  updatePayoutStatus
};
