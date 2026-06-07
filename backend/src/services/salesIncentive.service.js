const prisma = require('../../config/db');

// ── Rule Management ─────────────────────────────────────────────────────────

async function listRules(tenantId) {
  return prisma.salesIncentiveRule.findMany({
    where: { tenant_id: tenantId },
    include: { lender: true },
    orderBy: { created_at: 'desc' }
  });
}

async function createRule(tenantId, userId, body) {
  const {
    hierarchy_level, product_type, tenant_lender_id, commission_type,
    commission_value, calculation_base, min_amount, max_cap_amount,
    effective_from, effective_to, status
  } = body;

  // Conflict validation
  const existingRules = await prisma.salesIncentiveRule.findMany({
    where: {
      tenant_id: tenantId,
      hierarchy_level,
      status: 'ACTIVE'
    }
  });

  const conflicts = existingRules.filter(r => {
    // overlapping products
    const prodMatch = (!product_type || product_type === 'ALL') && (!r.product_type || r.product_type === 'ALL')
      || product_type === r.product_type;
    
    // overlapping lenders
    const lenderMatch = !tenant_lender_id && !r.tenant_lender_id
      || tenant_lender_id === r.tenant_lender_id;

    // date overlap
    const newFrom = effective_from ? new Date(effective_from).getTime() : 0;
    const newTo = effective_to ? new Date(effective_to).getTime() : Infinity;
    const oldFrom = r.effective_from ? new Date(r.effective_from).getTime() : 0;
    const oldTo = r.effective_to ? new Date(r.effective_to).getTime() : Infinity;
    
    const dateOverlap = (newFrom <= oldTo) && (newTo >= oldFrom);

    return prodMatch && lenderMatch && dateOverlap;
  });

  if (conflicts.length > 0) {
    throw Object.assign(new Error('Overlapping ACTIVE rules found for this hierarchy, product, lender, and date range.'), { status: 400 });
  }

  return prisma.salesIncentiveRule.create({
    data: {
      tenant_id: tenantId,
      hierarchy_level,
      product_type: product_type || null,
      tenant_lender_id: tenant_lender_id || null,
      commission_type,
      commission_value: parseFloat(commission_value),
      calculation_base,
      min_amount: min_amount ? parseFloat(min_amount) : null,
      max_cap_amount: max_cap_amount ? parseFloat(max_cap_amount) : null,
      effective_from: effective_from ? new Date(effective_from) : null,
      effective_to: effective_to ? new Date(effective_to) : null,
      status: status || 'ACTIVE',
      created_by: userId
    }
  });
}

async function updateRule(tenantId, ruleId, userId, body) {
  const rule = await prisma.salesIncentiveRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.tenant_id !== tenantId) throw Object.assign(new Error('Rule not found'), { status: 404 });

  // Add more robust conflict checks if status is active
  // For simplicity, updating directly
  return prisma.salesIncentiveRule.update({
    where: { id: ruleId },
    data: {
      ...body,
      updated_by: userId
    }
  });
}

async function deleteRule(tenantId, ruleId, userId) {
  const rule = await prisma.salesIncentiveRule.findUnique({ where: { id: ruleId } });
  if (!rule || rule.tenant_id !== tenantId) throw Object.assign(new Error('Rule not found'), { status: 404 });

  return prisma.salesIncentiveRule.update({
    where: { id: ruleId },
    data: { status: 'INACTIVE', updated_by: userId }
  });
}

// ── Calculation ─────────────────────────────────────────────────────────────

async function calculateIncentives(tenantId, body) {
  const { case_ids = [], disbursement_ids = [], commission_ledger_ids = [] } = body;
  
  // Example trigger: specific cases
  let results = [];

  for (const caseId of case_ids) {
    const caseEntity = await prisma.case.findUnique({
      where: { id: caseId },
      include: {
        disbursements: true,
        commission_ledgers: true
      }
    });

    if (!caseEntity || caseEntity.tenant_id !== tenantId) continue;

    // Resolve owner
    const ownerId = caseEntity.sales_owner_id || caseEntity.assigned_to_user_id || caseEntity.rm_user_id || caseEntity.owner_id || caseEntity.created_by_user_id;

    if (!ownerId) {
      results.push({ case_id: caseId, status: 'OWNER_NOT_CONFIGURED', reason: 'No owner found on case' });
      continue;
    }

    const employee = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!employee || !employee.hierarchy_level) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: 'Employee missing hierarchy level' });
      continue;
    }

    // Find rules for this hierarchy
    const rules = await prisma.salesIncentiveRule.findMany({
      where: { tenant_id: tenantId, hierarchy_level: employee.hierarchy_level, status: 'ACTIVE' }
    });

    if (rules.length === 0) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: 'No active rules for hierarchy' });
      continue;
    }

    // Priority Matcher
    const matchRule = (product, lender) => {
      const candidates = rules.filter(r => {
        const prodMatch = !r.product_type || r.product_type === 'ALL' || r.product_type === product;
        const lenderMatch = !r.tenant_lender_id || r.tenant_lender_id === lender;
        return prodMatch && lenderMatch;
      });

      if (candidates.length === 0) return null;

      // Priority: exact lender + product > product only > lender only > global
      candidates.sort((a, b) => {
        let scoreA = (a.tenant_lender_id ? 2 : 0) + (a.product_type && a.product_type !== 'ALL' ? 1 : 0);
        let scoreB = (b.tenant_lender_id ? 2 : 0) + (b.product_type && b.product_type !== 'ALL' ? 1 : 0);
        return scoreB - scoreA;
      });

      // Check for multiples of same top priority
      const topScore = (candidates[0].tenant_lender_id ? 2 : 0) + (candidates[0].product_type && candidates[0].product_type !== 'ALL' ? 1 : 0);
      const topCandidates = candidates.filter(a => ((a.tenant_lender_id ? 2 : 0) + (a.product_type && a.product_type !== 'ALL' ? 1 : 0)) === topScore);

      if (topCandidates.length > 1) {
        throw new Error('MULTIPLE_INCENTIVE_RULES_FOUND');
      }

      return topCandidates[0];
    };

    let appliedRule;
    try {
      appliedRule = matchRule(caseEntity.product_type, caseEntity.tenant_lender_id);
    } catch (err) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: err.message });
      continue;
    }

    if (!appliedRule) {
      results.push({ case_id: caseId, status: 'RULE_NOT_CONFIGURED', reason: 'No matching rule found' });
      continue;
    }

    // Calculate per disbursement or ledger depending on base
    const base = appliedRule.calculation_base;

    let iterations = [];
    if (base === 'DISBURSED_AMOUNT') {
      iterations = caseEntity.disbursements.map(d => ({
        disb_id: d.id,
        comm_id: null,
        amount: parseFloat(d.amount),
        ref_id: d.id.toString()
      }));
    } else if (base === 'LENDER_COMMISSION' || base === 'DSA_NET_COMMISSION') {
      iterations = caseEntity.commission_ledgers.map(c => ({
        disb_id: null,
        comm_id: c.id,
        amount: parseFloat(base === 'LENDER_COMMISSION' ? c.calculated_commission : c.calculated_commission), // Assuming same for now
        ref_id: c.id.toString()
      }));
    } else if (base === 'FIXED_PER_CASE') {
      iterations = [{
        disb_id: null,
        comm_id: null,
        amount: 1, // Fixed per case is just calculated once
        ref_id: 'CASE'
      }];
    }

    for (const iter of iterations) {
      let calcIncentive = 0;
      if (appliedRule.commission_type === 'PERCENTAGE') {
        calcIncentive = iter.amount * (parseFloat(appliedRule.commission_value) / 100);
      } else {
        calcIncentive = parseFloat(appliedRule.commission_value); // FIXED
      }

      if (appliedRule.min_amount && calcIncentive < parseFloat(appliedRule.min_amount)) {
        calcIncentive = parseFloat(appliedRule.min_amount);
      }
      if (appliedRule.max_cap_amount && calcIncentive > parseFloat(appliedRule.max_cap_amount)) {
        calcIncentive = parseFloat(appliedRule.max_cap_amount);
      }

      const idempotencyKey = `INCENTIVE:${tenantId}:${caseId}:${ownerId}:${iter.ref_id}:${appliedRule.id}`;

      // Check idempotency & PAID status
      const existingLedger = await prisma.salesIncentiveLedger.findUnique({
        where: { idempotency_key: idempotencyKey }
      });

      if (existingLedger && ['PAID', 'APPROVED'].includes(existingLedger.status)) {
        results.push({ case_id: caseId, status: 'SKIPPED', reason: `Already ${existingLedger.status}` });
        continue;
      }

      const ledger = await prisma.salesIncentiveLedger.upsert({
        where: { idempotency_key: idempotencyKey },
        update: {
          base_amount: iter.amount,
          calculated_incentive: calcIncentive,
          calculation_metadata: { rule_snapshot: appliedRule }
        },
        create: {
          tenant_id: tenantId,
          user_id: ownerId,
          case_id: caseId,
          disbursement_id: iter.disb_id,
          commission_ledger_id: iter.comm_id,
          idempotency_key: idempotencyKey,
          hierarchy_level: employee.hierarchy_level,
          rule_id: appliedRule.id,
          base_amount: iter.amount,
          calculated_incentive: calcIncentive,
          status: 'CALCULATED',
          calculation_metadata: { rule_snapshot: appliedRule }
        }
      });

      results.push(ledger);
    }
  }

  return results;
}

// ── Read APIs ───────────────────────────────────────────────────────────────

async function listEmployeesWithConfig(tenantId) {
  const users = await prisma.user.findMany({
    where: { tenant_id: tenantId },
    select: { id: true, name: true, email: true, hierarchy_level: true, status: true }
  });

  const activeRules = await prisma.salesIncentiveRule.findMany({
    where: { tenant_id: tenantId, status: 'ACTIVE' }
  });

  return users.map(user => {
    const rulesForUser = activeRules.filter(r => r.hierarchy_level === user.hierarchy_level);
    return {
      ...user,
      rules_configured: rulesForUser.length
    };
  });
}

async function listPayouts(tenantId, filters = {}) {
  const { user_id, status, hierarchy_level } = filters;

  const where = { tenant_id: tenantId };
  if (user_id) where.user_id = parseInt(user_id);
  if (status) where.status = status;
  if (hierarchy_level) where.hierarchy_level = hierarchy_level;

  return prisma.salesIncentiveLedger.findMany({
    where,
    include: {
      user: { select: { name: true, email: true } },
      case_entity: { select: { id: true, product_type: true, lender_name: true } },
      rule: { select: { calculation_base: true, commission_type: true, commission_value: true } }
    },
    orderBy: { created_at: 'desc' }
  });
}

async function updatePayoutStatus(tenantId, ledgerId, status, remarks, userId) {
  const ledger = await prisma.salesIncentiveLedger.findUnique({ where: { id: ledgerId } });
  if (!ledger || ledger.tenant_id !== tenantId) throw Object.assign(new Error('Ledger entry not found'), { status: 404 });

  const data = { status, remarks };
  if (status === 'APPROVED') {
    data.approved_by = userId;
    data.approved_at = new Date();
  } else if (status === 'PAID') {
    data.paid_by = userId;
    data.paid_at = new Date();
  } else if (status === 'REJECTED') {
    data.rejected_by = userId;
    data.rejected_at = new Date();
  }

  return prisma.salesIncentiveLedger.update({
    where: { id: ledgerId },
    data
  });
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
