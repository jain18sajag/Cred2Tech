// subDsaPayout.service.js
// Service layer for SubDSA payout configuration, calculation, ledger, and invoice management.
// Strictly tenant-scoped. SubDSA partner commissions are separate from employee incentives.

const prisma = require('../../config/db');

// ── Valid status transitions ─────────────────────────────────────────────────
const VALID_TRANSITIONS = {
  DRAFT: ['INVOICE_RAISED', 'PDD_PENDING', 'REJECTED'],
  INVOICE_RAISED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['RECONCILED', 'REJECTED'],
  RECONCILED: ['PAID', 'REJECTED'],
  PDD_PENDING: ['RECONCILED', 'REJECTED'],
  PAID: [],          // immutable
  REJECTED: ['DRAFT'], // allow re-open to DRAFT
};

// ── Get or upsert the payout config for a SubDSA ────────────────────────────
async function getPayoutConfig(tenantId, subDsaUserId) {
  const user = await prisma.user.findFirst({
    where: { id: subDsaUserId, tenant_id: tenantId },
    include: { role: true }
  });
  if (!user) throw Object.assign(new Error('SubDSA user not found'), { status: 404 });

  let rule = await prisma.subDsaPayoutRule.findUnique({
    where: { sub_dsa_user_id: subDsaUserId },
    include: {
      overrides: { include: { rule: false } },
      case_count_slabs: true,
      special_schemes: true
    }
  });

  return rule;
}

async function upsertPayoutConfig(tenantId, subDsaUserId, body) {
  const { default_payout_rate, payout_trigger, tds_applicable, overrides = [], slabs = [], schemes = [] } = body;

  // Find existing rule
  const existing = await prisma.subDsaPayoutRule.findUnique({ where: { sub_dsa_user_id: subDsaUserId } });

  const parseNum = (val, fallback = 0) => {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  };
  const parseIntSafe = (val, fallback = 0) => {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  };

  const payload = {
    default_payout_rate: parseNum(default_payout_rate, 0),
    payout_trigger: payout_trigger || 'ON_DSA_RECEIPT',
    tds_applicable: !!tds_applicable,
    overrides: {
      create: (overrides || []).map(o => ({
        tenant_lender_id: parseIntSafe(o.tenant_lender_id),
        products: o.products || '',
        override_rate: parseNum(o.override_rate, 0),
        effective_from: o.effective_from ? new Date(o.effective_from) : null
      }))
    },
    case_count_slabs: {
      create: (slabs || []).map(s => ({
        from_cases: parseIntSafe(s.from_cases, 1),
        to_cases: s.to_cases ? parseIntSafe(s.to_cases, null) : null,
        payout_per_case: parseNum(s.payout_per_case, 0)
      }))
    },
    special_schemes: {
      create: (schemes || []).map(sc => ({
        scheme_name: sc.scheme_name || 'Bonus Scheme',
        basis: sc.basis || 'Cases',
        tenant_lender_id: sc.tenant_lender_id ? parseIntSafe(sc.tenant_lender_id, null) : null,
        products: sc.products || null,
        valid_from: sc.valid_from ? new Date(sc.valid_from) : new Date(),
        valid_to: sc.valid_to ? new Date(sc.valid_to) : new Date(),
        bonus_per_case: sc.bonus_per_case ? parseNum(sc.bonus_per_case, null) : null,
        bonus_percent: sc.bonus_percent ? parseNum(sc.bonus_percent, null) : null,
        min_case_count: sc.min_case_count ? parseIntSafe(sc.min_case_count, null) : null,
        is_active: sc.is_active !== undefined ? !!sc.is_active : true
      }))
    }
  };

  if (existing) {
    // Delete children to replace them
    await prisma.subDsaLenderOverride.deleteMany({ where: { rule_id: existing.id } });
    await prisma.subDsaCaseCountSlab.deleteMany({ where: { rule_id: existing.id } });
    await prisma.subDsaSpecialScheme.deleteMany({ where: { rule_id: existing.id } });

    return prisma.subDsaPayoutRule.update({
      where: { id: existing.id },
      data: payload,
      include: { overrides: true, case_count_slabs: true, special_schemes: true }
    });
  }

  return prisma.subDsaPayoutRule.create({
    data: {
      tenant_id: tenantId,
      sub_dsa_user_id: subDsaUserId,
      ...payload
    },
    include: { overrides: true, case_count_slabs: true, special_schemes: true }
  });
}

// ── Calculate SubDSA payout for a commission ledger entry ───────────────────
// Priority: Base → Override → Slabs → Schemes → Subvention → Adjustment → TDS
async function calculatePayout(tenantId, subDsaUserId, commissionLedgerId) {
  const commLedger = await prisma.commissionLedger.findUnique({
    where: { id: commissionLedgerId },
    include: { case_entity: true }
  });
  if (!commLedger) throw new Error('Commission ledger not found');
  if (Number(commLedger.tenant_id) !== tenantId) throw new Error('Cross-tenant access denied');

  const rule = await prisma.subDsaPayoutRule.findUnique({
    where: { sub_dsa_user_id: subDsaUserId },
    include: { overrides: true, case_count_slabs: true, special_schemes: true }
  });
  if (!rule) throw new Error('No payout configuration found for this SubDSA');

  const dsaEarned = parseFloat(commLedger.calculated_commission);
  const productType = commLedger.product_type;
  const tenantLenderId = commLedger.tenant_lender_id;

  // Step 1 + 2: Base or Override rate
  let applicableRate = rule.default_payout_rate;
  let appliedOverride = null;
  for (const ov of rule.overrides) {
    if (ov.tenant_lender_id === tenantLenderId) {
      const products = ov.products ? ov.products.split(',').map(p => p.trim()) : [];
      if (!products.length || products.includes('ALL') || products.includes(productType)) {
        applicableRate = ov.override_rate;
        appliedOverride = ov;
        break;
      }
    }
  }
  let subDsaPayout = (dsaEarned * applicableRate) / 100;

  // Step 3: MTD case count slabs (cumulative fixed per case)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtdCaseCount = await prisma.subDsaPayoutLedger.count({
    where: {
      tenant_id: tenantId,
      sub_dsa_user_id: subDsaUserId,
      created_at: { gte: monthStart }
    }
  });
  const thisMonthCaseNumber = mtdCaseCount + 1; // including this new entry

  let slabBonus = 0;
  let appliedSlab = null;
  for (const slab of rule.case_count_slabs) {
    const from = slab.from_cases;
    const to = slab.to_cases || Infinity;
    if (thisMonthCaseNumber >= from && thisMonthCaseNumber <= to) {
      slabBonus = parseFloat(slab.payout_per_case);
      appliedSlab = slab;
      break;
    }
  }
  subDsaPayout += slabBonus;

  // Step 4: Special Schemes (cumulative)
  const appliedSchemes = [];
  let schemeBonus = 0;
  for (const scheme of rule.special_schemes) {
    if (!scheme.is_active) continue;
    if (now < scheme.valid_from || now > scheme.valid_to) continue;
    if (scheme.min_case_count && thisMonthCaseNumber < scheme.min_case_count) continue;
    if (scheme.tenant_lender_id && scheme.tenant_lender_id !== tenantLenderId) continue;
    if (scheme.products) {
      const sp = scheme.products.split(',').map(p => p.trim());
      if (!sp.includes('ALL') && !sp.includes(productType)) continue;
    }

    let bonus = 0;
    if (scheme.bonus_per_case) bonus = parseFloat(scheme.bonus_per_case);
    if (scheme.bonus_percent) bonus += (dsaEarned * parseFloat(scheme.bonus_percent)) / 100;
    schemeBonus += bonus;
    appliedSchemes.push({ id: scheme.id, scheme_name: scheme.scheme_name, bonus });
  }
  subDsaPayout += schemeBonus;

  // Step 5: Subvention (not auto-calculated here — set to 0, DSA admin updates manually)
  const subventionAmount = 0;

  // Step 6: Adjustment (manual — set to 0 initially)
  const adjustmentAmount = 0;

  // Step 7: TDS
  const TDS_RATE = 0.05; // 5% under Section 194H
  const tdsAmount = rule.tds_applicable ? subDsaPayout * TDS_RATE : 0;

  const netPayable = subDsaPayout - subventionAmount + adjustmentAmount - tdsAmount;

  const calculationMetadata = {
    dsa_earned: dsaEarned,
    applicable_rate: applicableRate,
    applied_override: appliedOverride,
    mtd_case_number: thisMonthCaseNumber,
    slab_bonus: slabBonus,
    applied_slab: appliedSlab,
    scheme_bonus: schemeBonus,
    applied_schemes: appliedSchemes,
    tds_rate: rule.tds_applicable ? TDS_RATE : 0,
    tds_amount: tdsAmount,
    net_payable: netPayable
  };

  return {
    dsa_earned_amount: dsaEarned,
    sub_dsa_payout: subDsaPayout,
    subvention_amount: subventionAmount,
    adjustment_amount: adjustmentAmount,
    tds_amount: tdsAmount,
    net_payable: netPayable,
    applied_scheme_snapshot: appliedSchemes,
    calculation_metadata: calculationMetadata,
    case_id: commLedger.case_id,
    commission_ledger_id: commissionLedgerId
  };
}

// ── Create a payout ledger entry (triggered after commission is recorded) ────
async function createPayoutEntry(tenantId, subDsaUserId, commissionLedgerId) {
  // Idempotency check
  const existing = await prisma.subDsaPayoutLedger.findUnique({
    where: { commission_ledger_id: commissionLedgerId }
  });
  if (existing) return existing;

  const calc = await calculatePayout(tenantId, subDsaUserId, commissionLedgerId);

  return prisma.subDsaPayoutLedger.create({
    data: {
      tenant_id: tenantId,
      sub_dsa_user_id: subDsaUserId,
      case_id: calc.case_id,
      commission_ledger_id: commissionLedgerId,
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

// ── List payout ledgers with aggregates ─────────────────────────────────────
async function listPayouts(tenantId, filters, currentUser) {
  const { month, sub_dsa_user_id, status, product, search, page = 1, limit = 50 } = filters;

  const where = { tenant_id: tenantId };

  // SubDSA isolation: they can only see their own records
  if (currentUser.role === 'SUB_DSA') {
    where.sub_dsa_user_id = currentUser.id;
  } else if (sub_dsa_user_id) {
    where.sub_dsa_user_id = parseInt(sub_dsa_user_id);
  }

  if (status) where.status = status;

  if (month) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    where.created_at = { gte: start, lt: end };
  }

  if (product) {
    where.calculation_metadata = { path: ['product_type'], equals: product };
  }

  const ledgers = await prisma.subDsaPayoutLedger.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true } },
      case_entity: {
        select: {
          id: true,
          case_number: true,
          customer: { select: { name: true, id: true } }
        }
      },
      invoice: { select: { id: true, invoice_number: true, month_year: true } }
    },
    orderBy: { created_at: 'desc' },
    skip: (parseInt(page) - 1) * parseInt(limit),
    take: parseInt(limit)
  });

  // Aggregate summary
  const allForTenant = await prisma.subDsaPayoutLedger.findMany({
    where: { tenant_id: tenantId, ...(currentUser.role === 'SUB_DSA' ? { sub_dsa_user_id: currentUser.id } : {}) },
    select: {
      dsa_earned_amount: true,
      sub_dsa_payout: true,
      subvention_amount: true,
      net_payable: true,
      status: true,
      case_id: true,
      created_at: true
    }
  });

  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const summarize = (rows) => ({
    cases: rows.length,
    volume: rows.reduce((s, r) => s + parseFloat(r.dsa_earned_amount || 0), 0),
    payout_eligible: rows.reduce((s, r) => s + parseFloat(r.sub_dsa_payout || 0), 0),
    subvention: rows.reduce((s, r) => s + parseFloat(r.subvention_amount || 0), 0),
    paid_dues: rows.filter(r => r.status === 'PAID').reduce((s, r) => s + parseFloat(r.net_payable || 0), 0),
    pending: rows.filter(r => r.status !== 'PAID' && r.status !== 'REJECTED').reduce((s, r) => s + parseFloat(r.net_payable || 0), 0)
  });

  const summary = {
    current_month: summarize(allForTenant.filter(r => r.created_at >= currentMonthStart)),
    previous_month: summarize(allForTenant.filter(r => r.created_at >= prevMonthStart && r.created_at < currentMonthStart)),
    older: summarize(allForTenant.filter(r => r.created_at < prevMonthStart))
  };

  return { ledgers, summary };
}

// ── Update payout status ─────────────────────────────────────────────────────
async function updatePayoutStatus(tenantId, ledgerId, newStatus, remarks, updatedByUserId) {
  const ledger = await prisma.subDsaPayoutLedger.findUnique({ where: { id: parseInt(ledgerId) } });
  if (!ledger) throw Object.assign(new Error('Payout ledger entry not found'), { status: 404 });
  if (ledger.tenant_id !== tenantId) throw Object.assign(new Error('Cross-tenant access denied'), { status: 403 });

  const allowed = VALID_TRANSITIONS[ledger.status] || [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Invalid transition: ${ledger.status} → ${newStatus}. Allowed: ${allowed.join(', ') || 'none'}`),
      { status: 400 }
    );
  }

  if (newStatus === 'REJECTED' && !remarks?.trim()) {
    throw Object.assign(new Error('Remarks are mandatory when rejecting a payout'), { status: 400 });
  }

  const [updated] = await prisma.$transaction([
    prisma.subDsaPayoutLedger.update({
      where: { id: parseInt(ledgerId) },
      data: { status: newStatus, remarks: remarks || ledger.remarks }
    }),
    prisma.subDsaPayoutHistory.create({
      data: {
        ledger_id: parseInt(ledgerId),
        old_status: ledger.status,
        new_status: newStatus,
        remarks: remarks || null,
        updated_by_id: updatedByUserId
      }
    })
  ]);

  return updated;
}

// ── Generate Invoice ─────────────────────────────────────────────────────────
async function generateInvoice(tenantId, subDsaUserId, monthYear, ledgerIds, currentUserId) {
  // Validate: ensure these entries belong to this tenant/subdsa and are in DRAFT status
  const entries = await prisma.subDsaPayoutLedger.findMany({
    where: {
      id: { in: ledgerIds.map(Number) },
      tenant_id: tenantId,
      sub_dsa_user_id: parseInt(subDsaUserId)
    }
  });

  const invalidEntries = entries.filter(e => e.status !== 'DRAFT');
  if (invalidEntries.length > 0) {
    throw Object.assign(
      new Error(`${invalidEntries.length} entries are not in DRAFT status and cannot be invoiced`),
      { status: 400 }
    );
  }

  const alreadyInvoiced = entries.filter(e => e.invoice_id);
  if (alreadyInvoiced.length > 0) {
    throw Object.assign(new Error('Some entries are already attached to an invoice'), { status: 400 });
  }

  const totalPayout = entries.reduce((s, e) => s + parseFloat(e.net_payable), 0);

  // Generate a unique invoice number: INV-SDSA-{tenantId}-{YYYYMM}-{seq}
  const monthStr = monthYear.replace('-', '');
  const seqCount = await prisma.subDsaInvoice.count({ where: { tenant_id: tenantId } });
  const invoiceNumber = `INV-SDSA-${tenantId}-${monthStr}-${String(seqCount + 1).padStart(4, '0')}`;

  const invoice = await prisma.subDsaInvoice.create({
    data: {
      tenant_id: tenantId,
      sub_dsa_user_id: parseInt(subDsaUserId),
      invoice_number: invoiceNumber,
      month_year: monthYear,
      total_payout: totalPayout,
      status: 'INVOICE_RAISED'
    }
  });

  // Update all selected ledger entries
  await prisma.$transaction([
    prisma.subDsaPayoutLedger.updateMany({
      where: { id: { in: ledgerIds.map(Number) } },
      data: { status: 'INVOICE_RAISED', invoice_id: invoice.id }
    }),
    ...ledgerIds.map(id =>
      prisma.subDsaPayoutHistory.create({
        data: {
          ledger_id: Number(id),
          old_status: 'DRAFT',
          new_status: 'INVOICE_RAISED',
          remarks: `Invoice ${invoiceNumber} generated`,
          updated_by_id: currentUserId
        }
      })
    )
  ]);

  return { invoice, invoice_number: invoiceNumber, total_payout: totalPayout, entries_count: entries.length };
}

// ── Get status history for an entry ─────────────────────────────────────────
async function getPayoutHistory(tenantId, ledgerId) {
  const ledger = await prisma.subDsaPayoutLedger.findUnique({ where: { id: parseInt(ledgerId) } });
  if (!ledger || ledger.tenant_id !== tenantId) {
    throw Object.assign(new Error('Payout ledger entry not found'), { status: 404 });
  }

  return prisma.subDsaPayoutHistory.findMany({
    where: { ledger_id: parseInt(ledgerId) },
    include: { updated_by: { select: { id: true, name: true } } },
    orderBy: { updated_at: 'asc' }
  });
}

// ── List SubDSA users in a tenant ────────────────────────────────────────────
async function listSubDsaUsers(tenantId) {
  const subDsaRole = await prisma.role.findUnique({ where: { name: 'SUB_DSA' } });
  if (!subDsaRole) return [];

  return prisma.user.findMany({
    where: { tenant_id: tenantId, role_id: subDsaRole.id },
    select: {
      id: true, name: true, email: true, mobile: true, status: true, created_at: true,
      sub_dsa_payout_rule: {
        select: { default_payout_rate: true, payout_trigger: true, tds_applicable: true }
      }
    }
  });
}

module.exports = {
  getPayoutConfig,
  upsertPayoutConfig,
  createPayoutEntry,
  calculatePayout,
  listPayouts,
  updatePayoutStatus,
  generateInvoice,
  getPayoutHistory,
  listSubDsaUsers
};
