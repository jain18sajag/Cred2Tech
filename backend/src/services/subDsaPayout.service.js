const { Prisma } = require('@prisma/client');
const prisma = require('../../config/db');

const VALID_TRANSITIONS = {
  DRAFT: ['PDD_PENDING', 'REJECTED'],
  INVOICE_RAISED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['RECONCILED', 'REJECTED'],
  RECONCILED: ['PAID', 'REJECTED'],
  PDD_PENDING: ['RECONCILED', 'REJECTED'],
  PAID: [],
  REJECTED: ['DRAFT']
};
const PAYOUT_TRIGGERS = new Set(['ON_DISBURSEMENT', 'ON_DSA_RECEIPT', 'MANUAL']);
const TDS_RATE = new Prisma.Decimal('0.05');

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function dec(value, field, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) fail(`${field} is required`);
    return null;
  }
  const d = new Prisma.Decimal(value);
  if (!d.isFinite() || d.lt(0)) fail(`${field} must be a non-negative number`);
  return d.toDecimalPlaces(2);
}

function intVal(value, field, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) fail(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`${field} must be a non-negative integer`);
  return n;
}

function boolVal(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
}

function dateVal(value, field, required = false) {
  if (!value) {
    if (required) fail(`${field} is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(`${field} must be a valid date`);
  return d;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) fail('month_year must be YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

function normalizeProducts(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim().toUpperCase()).filter(Boolean).join(',');
  return String(value || 'ALL').split(',').map(v => v.trim().toUpperCase()).filter(Boolean).join(',') || 'ALL';
}

function productMatches(csv, product) {
  const products = normalizeProducts(csv).split(',');
  return products.includes('ALL') || products.includes(String(product || '').toUpperCase());
}

async function ensureSubDsaUser(tenantId, subDsaUserId, client = prisma) {
  const user = await client.user.findFirst({
    where: { id: Number(subDsaUserId), tenant_id: tenantId, status: 'ACTIVE', role: { name: 'SUB_DSA' } },
    include: { role: true }
  });
  if (!user) fail('Active SUB_DSA user not found for this tenant', 404);
  return user;
}

async function ensureTenantLenders(tenantId, ids, client = prisma) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  if (!unique.length) return;
  const count = await client.tenantLender.count({ where: { tenant_id: tenantId, id: { in: unique } } });
  if (count !== unique.length) fail('One or more lenders do not belong to this tenant');
}

async function getMtdStats(tenantId, subDsaUserId) {
  await ensureSubDsaUser(tenantId, subDsaUserId);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const ledgers = await prisma.commissionLedger.findMany({
    where: {
      tenant_id: tenantId,
      entry_type: 'BASE_COMMISSION',
      is_reversed: false,
      status: { not: 'CANCELLED' },
      case_entity: {
        OR: [
          { created_by_user_id: Number(subDsaUserId) },
          { assigned_dsa_user_id: Number(subDsaUserId) }
        ]
      },
      disbursement: {
        disbursement_date: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    },
    select: {
      total_amount: true,
      case_id: true
    }
  });

  const uniqueCases = new Set();
  let dsa_earned = 0;

  for (const ledger of ledgers) {
    uniqueCases.add(ledger.case_id);
    dsa_earned += Number(ledger.total_amount || 0);
  }

  return {
    cases: uniqueCases.size,
    dsa_earned
  };
}

async function getPayoutConfig(tenantId, subDsaUserId) {
  await ensureSubDsaUser(tenantId, subDsaUserId);
  return prisma.subDsaPayoutRule.findFirst({
    where: { 
      sub_dsa_user_id: Number(subDsaUserId),
      status: 'ACTIVE'
    },
    include: {
      overrides: { include: { lender: { select: { bank_name: true } } } },
      case_count_slabs: { orderBy: { from_cases: 'asc' } },
      special_schemes: { orderBy: { valid_from: 'asc' } }
    }
  });
}

function validateConfig(body) {
  const defaultRate = dec(body.default_payout_rate, 'default_payout_rate', true);
  if (defaultRate.gt(100)) fail('default_payout_rate cannot exceed 100');
  const payoutTrigger = body.payout_trigger || 'ON_DSA_RECEIPT';
  if (!PAYOUT_TRIGGERS.has(payoutTrigger)) fail('Invalid payout_trigger');
  const calculationBase = body.calculation_base || 'DISBURSED_AMOUNT';

  const overrides = (body.overrides || []).map((o, idx) => {
    const rate = dec(o.override_rate, `overrides[${idx}].override_rate`, true);
    if (rate.gt(100)) fail(`overrides[${idx}].override_rate cannot exceed 100`);
    const from = dateVal(o.effective_from, `overrides[${idx}].effective_from`);
    const to = dateVal(o.effective_to, `overrides[${idx}].effective_to`);
    if (from && to && from > to) fail(`overrides[${idx}] effective_from cannot be after effective_to`);
    return {
      tenant_lender_id: intVal(o.tenant_lender_id, `overrides[${idx}].tenant_lender_id`, true),
      products: normalizeProducts(o.products),
      override_rate: rate,
      calculation_base: o.calculation_base || 'DISBURSED_AMOUNT',
      effective_from: from,
      effective_to: to
    };
  });
  for (let i = 0; i < overrides.length; i += 1) {
    for (let j = i + 1; j < overrides.length; j += 1) {
      const a = overrides[i], b = overrides[j];
      const sameLender = a.tenant_lender_id === b.tenant_lender_id;
      const productOverlap = a.products.split(',').some(p => productMatches(b.products, p));
      const startA = a.effective_from || new Date(0);
      const endA = a.effective_to || new Date('9999-12-31');
      const startB = b.effective_from || new Date(0);
      const endB = b.effective_to || new Date('9999-12-31');
      if (sameLender && productOverlap && startA <= endB && startB <= endA) fail('Duplicate/overlapping lender override');
    }
  }

  const slabs = (body.slabs || body.case_count_slabs || []).map((s, idx) => ({
    from_cases: intVal(s.from_cases, `slabs[${idx}].from_cases`, true),
    to_cases: s.to_cases === null || s.to_cases === '' || s.to_cases === undefined ? null : intVal(s.to_cases, `slabs[${idx}].to_cases`, true),
    payout_per_case: dec(s.payout_per_case, `slabs[${idx}].payout_per_case`, true)
  })).sort((a, b) => a.from_cases - b.from_cases);
  for (let i = 0; i < slabs.length; i += 1) {
    const s = slabs[i];
    if (s.from_cases < 1) fail('slab from_cases must be positive');
    if (s.to_cases && s.from_cases > s.to_cases) fail('slab from_cases cannot exceed to_cases');
    if (i > 0 && slabs[i - 1].to_cases && s.from_cases <= slabs[i - 1].to_cases) fail('Slabs cannot overlap');
    if (i < slabs.length - 1 && s.to_cases === null) fail('Only the final slab may be open-ended');
  }

  const schemes = (body.schemes || body.special_schemes || []).map((sc, idx) => {
    const from = dateVal(sc.valid_from, `schemes[${idx}].valid_from`, true);
    const to = dateVal(sc.valid_to, `schemes[${idx}].valid_to`, true);
    if (from > to) fail(`schemes[${idx}] valid_from cannot be after valid_to`);
    const bonusPerCase = dec(sc.bonus_per_case, `schemes[${idx}].bonus_per_case`);
    const bonusPercent = dec(sc.bonus_percent, `schemes[${idx}].bonus_percent`);
    if (!bonusPerCase && !bonusPercent) fail(`schemes[${idx}] requires bonus_per_case or bonus_percent`);
    return {
      scheme_name: String(sc.scheme_name || '').trim(),
      basis: sc.basis || 'Cases',
      tenant_lender_id: sc.tenant_lender_id ? intVal(sc.tenant_lender_id, `schemes[${idx}].tenant_lender_id`) : null,
      products: normalizeProducts(sc.products),
      valid_from: from,
      valid_to: to,
      bonus_per_case: bonusPerCase,
      bonus_percent: bonusPercent,
      min_case_count: sc.min_case_count ? intVal(sc.min_case_count, `schemes[${idx}].min_case_count`) : null,
      is_active: sc.is_active === undefined ? true : boolVal(sc.is_active)
    };
  });
  schemes.forEach((s, idx) => {
    if (!s.scheme_name) fail(`schemes[${idx}].scheme_name is required`);
    if (!['Cases', 'Volume'].includes(s.basis)) fail(`schemes[${idx}].basis must be Cases or Volume`);
  });

  return {
    defaultRate, payoutTrigger, tdsApplicable: boolVal(body.tds_applicable), calculationBase,
    overrides, slabs, schemes
  };
}

async function upsertPayoutConfig(tenantId, subDsaUserId, body) {
  const parsed = validateConfig(body);
  return prisma.$transaction(async tx => {
    await ensureSubDsaUser(tenantId, subDsaUserId, tx);
    await ensureTenantLenders(tenantId, [...parsed.overrides.map(o => o.tenant_lender_id), ...parsed.schemes.map(s => s.tenant_lender_id)], tx);
    const existing = await tx.subDsaPayoutRule.findFirst({ 
      where: { 
        sub_dsa_user_id: Number(subDsaUserId),
        status: 'ACTIVE'
      } 
    });
    
    if (existing) {
      await tx.subDsaPayoutRule.update({
        where: { id: existing.id },
        data: { status: 'ARCHIVED', effective_to: new Date() }
      });
    }

    const parentData = {
      default_payout_rate: parsed.defaultRate.toNumber(),
      payout_trigger: parsed.payoutTrigger,
      tds_applicable: parsed.tdsApplicable,
      calculation_base: parsed.calculationBase,
      status: 'ACTIVE',
      effective_from: new Date()
    };
    
    const rule = await tx.subDsaPayoutRule.create({ 
      data: { tenant_id: tenantId, sub_dsa_user_id: Number(subDsaUserId), ...parentData } 
    });

    if (parsed.overrides.length) await tx.subDsaLenderOverride.createMany({ data: parsed.overrides.map(o => ({ ...o, override_rate: o.override_rate.toNumber(), rule_id: rule.id })) });
    if (parsed.slabs.length) await tx.subDsaCaseCountSlab.createMany({ data: parsed.slabs.map(s => ({ ...s, payout_per_case: s.payout_per_case.toNumber(), rule_id: rule.id })) });
    if (parsed.schemes.length) await tx.subDsaSpecialScheme.createMany({ data: parsed.schemes.map(s => ({ ...s, bonus_per_case: s.bonus_per_case?.toNumber() ?? null, bonus_percent: s.bonus_percent?.toNumber() ?? null, rule_id: rule.id })) });
    return tx.subDsaPayoutRule.findFirst({ where: { id: rule.id }, include: { overrides: true, case_count_slabs: true, special_schemes: true } });
  });
}

function sourceDateFor(ledger) {
  return ledger.disbursement?.disbursement_date || ledger.created_at;
}

async function calculatePayout(tenantId, subDsaUserId, commissionLedgerId, client = prisma, mode = 'AUTO') {
  await ensureSubDsaUser(tenantId, subDsaUserId, client);
  const commLedger = await client.commissionLedger.findFirst({
    where: { id: Number(commissionLedgerId), tenant_id: tenantId },
    include: { case_entity: true, disbursement: true }
  });
  if (!commLedger) fail('Commission ledger not found', 404);
  if (commLedger.case_entity.created_by_user_id !== Number(subDsaUserId) && commLedger.case_entity.assigned_dsa_user_id !== Number(subDsaUserId)) {
    fail('Commission ledger does not belong to this Sub-DSA', 403);
  }
  if (commLedger.entry_type !== 'BASE_COMMISSION' || commLedger.is_reversed || commLedger.status === 'CANCELLED') {
    fail('Commission ledger is not eligible for Sub-DSA payout');
  }

  const eventDate = sourceDateFor(commLedger);

  let rule = await client.subDsaPayoutRule.findFirst({
    where: { 
      sub_dsa_user_id: Number(subDsaUserId),
      status: { in: ['ACTIVE', 'ARCHIVED'] },
      effective_from: { lte: eventDate },
      OR: [
        { effective_to: null },
        { effective_to: { gte: eventDate } }
      ]
    },
    orderBy: { id: 'desc' },
    include: { overrides: true, case_count_slabs: { orderBy: { from_cases: 'asc' } }, special_schemes: true }
  });

  if (!rule) {
    rule = await client.subDsaPayoutRule.findFirst({
      where: { sub_dsa_user_id: Number(subDsaUserId) },
      orderBy: { effective_from: 'asc' },
      include: { overrides: true, case_count_slabs: { orderBy: { from_cases: 'asc' } }, special_schemes: true }
    });
  }

  if (!rule) fail('No payout configuration found for this Sub-DSA');
  if (mode === 'AUTO' && rule.payout_trigger === 'MANUAL') fail('Payout trigger is MANUAL');
  if (mode === 'AUTO' && rule.payout_trigger === 'ON_DSA_RECEIPT' && commLedger.status !== 'PAID') fail('Payout requires DSA receipt/paid commission status');

  const dsaEarned = new Prisma.Decimal(commLedger.calculated_commission).toDecimalPlaces(2);
  const disbursedAmount = new Prisma.Decimal(commLedger.disbursed_amount || 0).toDecimalPlaces(2);
  const product = commLedger.product_type;
  const lenderId = commLedger.tenant_lender_id;
  const applicableOverrides = rule.overrides
    .filter(o => Number(o.tenant_lender_id) === Number(lenderId))
    .filter(o => productMatches(o.products, product))
    .filter(o => (!o.effective_from || o.effective_from <= eventDate) && (!o.effective_to || o.effective_to >= eventDate))
    .sort((a, b) => (b.effective_from || new Date(0)) - (a.effective_from || new Date(0)) || a.id - b.id);
  const appliedOverride = applicableOverrides[0] || null;
  const applicableRate = new Prisma.Decimal(appliedOverride?.override_rate ?? rule.default_payout_rate);
  const appliedBase = (appliedOverride?.calculation_base ?? rule.calculation_base) === 'LENDER_COMMISSION' ? dsaEarned : disbursedAmount;
  
  let subDsaPayout = appliedBase.mul(applicableRate).div(100).toDecimalPlaces(2);

  const period = monthKey(eventDate);
  const previousCases = await client.subDsaPayoutLedger.findMany({
    where: { 
      tenant_id: tenantId, 
      sub_dsa_user_id: Number(subDsaUserId), 
      status: { notIn: ['REJECTED'] }, 
      calculation_metadata: { path: ['payout_period'], equals: period }
    },
    select: { case_id: true }
  });
  const distinct = new Set(previousCases.map(r => r.case_id));
  distinct.add(commLedger.case_id);
  const thisMonthCaseNumber = distinct.size;

  let slabBonus = new Prisma.Decimal(0);
  let appliedSlab = null;
  for (const slab of rule.case_count_slabs) {
    if (thisMonthCaseNumber >= slab.from_cases && (slab.to_cases === null || thisMonthCaseNumber <= slab.to_cases)) {
      slabBonus = new Prisma.Decimal(slab.payout_per_case).toDecimalPlaces(2);
      appliedSlab = slab;
      break;
    }
  }
  subDsaPayout = subDsaPayout.plus(slabBonus).toDecimalPlaces(2);

  const appliedSchemes = [];
  let schemeBonus = new Prisma.Decimal(0);
  for (const scheme of rule.special_schemes) {
    if (!scheme.is_active || eventDate < scheme.valid_from || eventDate > scheme.valid_to) continue;
    if (scheme.min_case_count && thisMonthCaseNumber < scheme.min_case_count) continue;
    if (scheme.tenant_lender_id && Number(scheme.tenant_lender_id) !== Number(lenderId)) continue;
    if (!productMatches(scheme.products, product)) continue;
    let bonus = new Prisma.Decimal(0);
    if (scheme.basis === 'Cases' && scheme.bonus_per_case) bonus = bonus.plus(scheme.bonus_per_case);
    if (scheme.basis === 'Volume' && scheme.bonus_percent) bonus = bonus.plus(disbursedAmount.mul(scheme.bonus_percent).div(100));
    bonus = bonus.toDecimalPlaces(2);
    schemeBonus = schemeBonus.plus(bonus);
    appliedSchemes.push({ id: scheme.id, scheme_name: scheme.scheme_name, basis: scheme.basis, bonus: bonus.toFixed(2) });
  }
  subDsaPayout = subDsaPayout.plus(schemeBonus).toDecimalPlaces(2);

  const tdsAmount = rule.tds_applicable ? subDsaPayout.mul(TDS_RATE).toDecimalPlaces(2) : new Prisma.Decimal(0);
  const netPayable = subDsaPayout.minus(tdsAmount).toDecimalPlaces(2);
  const metadata = {
    product_type: product,
    lender_id: lenderId,
    lender_name: commLedger.lender_name,
    source_date: eventDate.toISOString(),
    payout_period: period,
    rule_id: rule.id,
    payout_trigger: rule.payout_trigger,
    default_rate: rule.default_payout_rate,
    override_snapshot: appliedOverride,
    slab_snapshot: appliedSlab,
    scheme_snapshots: appliedSchemes,
    tds_rate: rule.tds_applicable ? TDS_RATE.toString() : '0',
    tds_base: subDsaPayout.toFixed(2),
    formula_components: {
      dsa_earned: dsaEarned.toFixed(2),
      rate_payout: dsaEarned.mul(applicableRate).div(100).toDecimalPlaces(2).toFixed(2),
      slab_bonus: slabBonus.toFixed(2),
      scheme_bonus: schemeBonus.toDecimalPlaces(2).toFixed(2)
    }
  };
  return {
    dsa_earned_amount: dsaEarned,
    sub_dsa_payout: subDsaPayout,
    subvention_amount: new Prisma.Decimal(0),
    adjustment_amount: new Prisma.Decimal(0),
    tds_amount: tdsAmount,
    net_payable: netPayable,
    applied_scheme_snapshot: appliedSchemes,
    calculation_metadata: metadata,
    case_id: commLedger.case_id,
    commission_ledger_id: Number(commissionLedgerId)
  };
}

async function createPayoutEntry(tenantId, subDsaUserId, commissionLedgerId, client = prisma, options = {}) {
  const existing = await client.subDsaPayoutLedger.findUnique({ where: { commission_ledger_id: Number(commissionLedgerId) } });
  if (existing) {
    if (existing.tenant_id !== tenantId || existing.sub_dsa_user_id !== Number(subDsaUserId)) fail('Existing payout source belongs to a different tenant or Sub-DSA', 409);
    return existing;
  }
  const calc = await calculatePayout(tenantId, subDsaUserId, commissionLedgerId, client, options.mode || 'AUTO');
  return client.subDsaPayoutLedger.create({
    data: {
      tenant_id: tenantId,
      sub_dsa_user_id: Number(subDsaUserId),
      case_id: calc.case_id,
      commission_ledger_id: calc.commission_ledger_id,
      dsa_earned_amount: calc.dsa_earned_amount,
      sub_dsa_payout: calc.sub_dsa_payout,
      subvention_amount: calc.subvention_amount,
      adjustment_amount: calc.adjustment_amount,
      tds_amount: calc.tds_amount,
      net_payable: calc.net_payable,
      applied_scheme_snapshot: calc.applied_scheme_snapshot,
      calculation_metadata: calc.calculation_metadata
    }
  });
}

function customerName(customer) {
  return customer?.business_name || customer?.legal_business_name || customer?.trade_name || customer?.proprietor_name || 'Customer';
}

function payoutDto(row) {
  return {
    ...row,
    case_display_id: `CASE-${row.case_id}`,
    customer_name: customerName(row.case_entity?.customer),
    product_type: row.calculation_metadata?.product_type || row.case_entity?.product_type || null,
    lender: row.calculation_metadata?.lender_name || row.case_entity?.lender_name || null,
    source_date: row.calculation_metadata?.source_date || null,
    payout_period: row.calculation_metadata?.payout_period || monthKey(row.created_at)
  };
}

async function listPayouts(tenantId, filters, currentUser) {
  const { month, sub_dsa_user_id, status, product, search, page = 1, limit = 50 } = filters;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const take = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const baseWhere = { tenant_id: tenantId };
  if (currentUser.role === 'SUB_DSA') baseWhere.sub_dsa_user_id = currentUser.id;
  else if (sub_dsa_user_id) baseWhere.sub_dsa_user_id = Number(sub_dsa_user_id);

  // Extract available months from records matching user/tenant
  const monthRecords = await prisma.subDsaPayoutLedger.findMany({
    where: baseWhere,
    select: { calculation_metadata: true, created_at: true }
  });

  const uniqueMonths = new Set();
  const nowForMonths = new Date();
  for (let i = 0; i < 6; i++) {
    uniqueMonths.add(monthKey(new Date(nowForMonths.getFullYear(), nowForMonths.getMonth() - i, 1)));
  }
  for (const r of monthRecords) {
    uniqueMonths.add(r.calculation_metadata?.payout_period || monthKey(r.created_at));
  }
  
  const availableMonths = Array.from(uniqueMonths).filter(Boolean).sort().reverse();
  if (availableMonths.length === 0) availableMonths.push(monthKey(new Date()));

  const selectedMonth = month === 'all' ? null : (month || availableMonths[0]);

  const where = { ...baseWhere };
  if (status) where.status = status;
  
  if (selectedMonth) {
    monthRange(selectedMonth);
    where.calculation_metadata = { path: ['payout_period'], equals: selectedMonth };
  }
  if (product) where.calculation_metadata = { path: ['product_type'], equals: String(product).toUpperCase() };
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
        id: true, product_type: true, lender_name: true,
        customer: { select: { id: true, business_name: true, legal_business_name: true, trade_name: true, proprietor_name: true } }
      }
    },
    invoice: { select: { id: true, invoice_number: true, month_year: true } }
  };
  const [ledgers, total, all] = await Promise.all([
    prisma.subDsaPayoutLedger.findMany({ where, include, orderBy: { created_at: 'desc' }, skip: (pageNum - 1) * take, take }),
    prisma.subDsaPayoutLedger.count({ where }),
    prisma.subDsaPayoutLedger.findMany({ where, select: { dsa_earned_amount: true, sub_dsa_payout: true, subvention_amount: true, net_payable: true, status: true, case_id: true, created_at: true, calculation_metadata: true } })
  ]);
  const now = new Date();
  const currentPeriod = monthKey(now);
  const previousPeriod = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const summarize = rows => ({
    cases: new Set(rows.map(r => r.case_id)).size,
    volume: rows.reduce((s, r) => s.plus(r.dsa_earned_amount || 0), new Prisma.Decimal(0)).toFixed(2),
    payout_eligible: rows.reduce((s, r) => s.plus(r.sub_dsa_payout || 0), new Prisma.Decimal(0)).toFixed(2),
    subvention: rows.reduce((s, r) => s.plus(r.subvention_amount || 0), new Prisma.Decimal(0)).toFixed(2),
    paid_dues: rows.filter(r => r.status === 'PAID').reduce((s, r) => s.plus(r.net_payable || 0), new Prisma.Decimal(0)).toFixed(2),
    pending: rows.filter(r => !['PAID', 'REJECTED'].includes(r.status)).reduce((s, r) => s.plus(r.net_payable || 0), new Prisma.Decimal(0)).toFixed(2)
  });
  return {
    ledgers: ledgers.map(payoutDto),
    pagination: { total, page: pageNum, page_size: take },
    summary: {
      current_month: summarize(all.filter(r => (r.calculation_metadata?.payout_period || monthKey(r.created_at)) === currentPeriod)),
      previous_month: summarize(all.filter(r => (r.calculation_metadata?.payout_period || monthKey(r.created_at)) === previousPeriod)),
      older: summarize(all.filter(r => (r.calculation_metadata?.payout_period || monthKey(r.created_at)) < previousPeriod))
    },
    availableMonths
  };
}

async function updatePayoutStatus(tenantId, ledgerId, newStatus, remarks, updatedByUserId) {
  const ledger = await prisma.subDsaPayoutLedger.findFirst({ where: { id: Number(ledgerId), tenant_id: tenantId } });
  if (!ledger) fail('Payout ledger entry not found', 404);
  const allowed = VALID_TRANSITIONS[ledger.status] || [];
  if (!allowed.includes(newStatus)) fail(`Invalid transition: ${ledger.status} to ${newStatus}`);
  if (newStatus === 'REJECTED' && !remarks?.trim()) fail('Remarks are mandatory when rejecting a payout');
  return prisma.$transaction(async tx => {
    const data = { status: newStatus, remarks: remarks || ledger.remarks };
    if (newStatus === 'DRAFT') data.invoice_id = null;
    const updated = await tx.subDsaPayoutLedger.update({ where: { id: Number(ledgerId) }, data });
    await tx.subDsaPayoutHistory.create({ data: { ledger_id: Number(ledgerId), old_status: ledger.status, new_status: newStatus, remarks: remarks || null, updated_by_id: updatedByUserId } });
    return updated;
  });
}

async function generateInvoice(tenantId, subDsaUserId, monthYear, ledgerIds, currentUserId) {
  if (!/^\d{4}-\d{2}$/.test(monthYear)) fail('month_year must be YYYY-MM');
  const ids = [...new Set((ledgerIds || []).map(Number))];
  if (!ids.length || ids.length !== ledgerIds.length) fail('ledger_ids must be a non-empty unique ID set');
  monthRange(monthYear);
  return prisma.$transaction(async tx => {
    await ensureSubDsaUser(tenantId, subDsaUserId, tx);
    const entries = await tx.subDsaPayoutLedger.findMany({
      where: { id: { in: ids }, tenant_id: tenantId, sub_dsa_user_id: Number(subDsaUserId), status: 'DRAFT', invoice_id: null }
    });
    if (entries.length !== ids.length || entries.some(e => (e.calculation_metadata?.payout_period || monthKey(e.created_at)) !== monthYear)) {
      fail('Selected payouts must all belong to the tenant, Sub-DSA, month, be DRAFT, and have no invoice');
    }
    const totalPayout = entries.reduce((s, e) => s.plus(e.net_payable), new Prisma.Decimal(0)).toDecimalPlaces(2);
    const monthStr = monthYear.replace('-', '');
    const seqCount = await tx.subDsaInvoice.count({ where: { tenant_id: tenantId, month_year: monthYear } });
    const invoiceNumber = `INV-SDSA-${tenantId}-${monthStr}-${String(seqCount + 1).padStart(4, '0')}`;
    const invoice = await tx.subDsaInvoice.create({
      data: { tenant_id: tenantId, sub_dsa_user_id: Number(subDsaUserId), invoice_number: invoiceNumber, month_year: monthYear, total_payout: totalPayout, status: 'INVOICE_RAISED' }
    });
    const updated = await tx.subDsaPayoutLedger.updateMany({
      where: { id: { in: ids }, tenant_id: tenantId, sub_dsa_user_id: Number(subDsaUserId), status: 'DRAFT', invoice_id: null },
      data: { status: 'INVOICE_RAISED', invoice_id: invoice.id }
    });
    if (updated.count !== ids.length) fail('Invoice update failed exact-ID validation');
    await Promise.all(ids.map(id => tx.subDsaPayoutHistory.create({
      data: { ledger_id: id, old_status: 'DRAFT', new_status: 'INVOICE_RAISED', remarks: `Invoice ${invoiceNumber} generated`, updated_by_id: currentUserId }
    })));
    return { invoice, invoice_number: invoiceNumber, total_payout: totalPayout.toFixed(2), entries_count: entries.length };
  });
}

async function getPayoutHistory(tenantId, ledgerId, currentUser) {
  const where = { id: Number(ledgerId), tenant_id: tenantId };
  if (currentUser?.role === 'SUB_DSA') where.sub_dsa_user_id = currentUser.id;
  const ledger = await prisma.subDsaPayoutLedger.findFirst({ where });
  if (!ledger) fail('Payout ledger entry not found', 404);
  return prisma.subDsaPayoutHistory.findMany({
    where: { ledger_id: Number(ledgerId) },
    include: { updated_by: { select: { id: true, name: true } } },
    orderBy: { updated_at: 'asc' }
  });
}

async function listSubDsaUsers(tenantId) {
  return prisma.user.findMany({
    where: { tenant_id: tenantId, role: { name: 'SUB_DSA' } },
    select: {
      id: true, name: true, email: true, mobile: true, status: true, created_at: true,
      sub_dsa_payout_rule: { select: { default_payout_rate: true, payout_trigger: true, tds_applicable: true } }
    }
  });
}

async function syncMissingPayouts(tenantId, subDsaUserId) {
  const ledgers = await prisma.commissionLedger.findMany({
    where: {
      tenant_id: tenantId,
      entry_type: 'BASE_COMMISSION',
      is_reversed: false,
      status: { not: 'CANCELLED' },
      case_entity: {
        OR: [
          { created_by_user_id: Number(subDsaUserId) },
          { assigned_dsa_user_id: Number(subDsaUserId) }
        ]
      },
      SubDsaPayoutLedger: {
        none: { sub_dsa_user_id: Number(subDsaUserId) }
      }
    }
  });

  let processedCount = 0;
  for (const ledger of ledgers) {
    try {
      await createPayoutEntry(tenantId, subDsaUserId, ledger.id, prisma, { mode: 'MANUAL' });
      processedCount++;
    } catch (e) {
      console.error(`[COMMISSION] Failed to sync retroactive Sub DSA payout for commission ledger ${ledger.id}:`, e.message);
    }
  }
  return processedCount;
}

module.exports = {
  getPayoutConfig,
  upsertPayoutConfig,
  getMtdStats,
  createPayoutEntry,
  calculatePayout,
  listPayouts,
  updatePayoutStatus,
  generateInvoice,
  getPayoutHistory,
  listSubDsaUsers,
  syncMissingPayouts
};
