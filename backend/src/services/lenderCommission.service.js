// lenderCommission.service.js
// Service layer for managing DSA lender commission configurations.
// Strict tenant isolation enforced.

const prisma = require('../../config/db');

async function listRules(tenantId) {
  return prisma.lenderCommissionRule.findMany({
    where: { tenant_id: tenantId },
    include: {
      tenant_lender: true,
      volume_slabs: { orderBy: { from_amount: 'asc' } },
      case_count_slabs: { orderBy: { from_cases: 'asc' } },
      special_schemes: { orderBy: { valid_from: 'asc' } }
    },
    orderBy: { updated_at: 'desc' }
  });
}

async function getRule(id, tenantId) {
  const rule = await prisma.lenderCommissionRule.findFirst({
    where: { id, tenant_id: tenantId },
    include: {
      tenant_lender: true,
      volume_slabs: { orderBy: { from_amount: 'asc' } },
      case_count_slabs: { orderBy: { from_cases: 'asc' } },
      special_schemes: { orderBy: { valid_from: 'asc' } }
    }
  });
  if (!rule) throw new Error('Commission rule not found or unauthorized');
  return rule;
}

async function createRule(tenantId, data) {
  const {
    tenant_lender_id, product_type, payout_basis, commission_type, is_active,
    volume_slabs, case_count_slabs, special_schemes
  } = data;

  // 1. Validation: Existing tenant lender (Tenant scoped)
  const lender = await prisma.tenantLender.findFirst({ 
    where: { id: tenant_lender_id, tenant_id: tenantId } 
  });
  if (!lender) throw new Error('Tenant lender not found or unauthorized');

  // 2. Validation: Unique per tenant + tenant_lender + product
  const existing = await prisma.lenderCommissionRule.findFirst({
    where: { tenant_id: tenantId, tenant_lender_id, product_type }
  });
  if (existing) throw new Error('Commission rule already configured for this lender-product.');

  // 3. Create with nested relations
  return prisma.lenderCommissionRule.create({
    data: {
      tenant_id: tenantId,
      tenant_lender_id,
      product_type,
      payout_basis,
      commission_type,
      is_active: is_active !== false,
      volume_slabs: {
        create: (volume_slabs || []).map(s => ({
          from_amount: parseFloat(s.from_amount),
          to_amount: s.to_amount ? parseFloat(s.to_amount) : null,
          percent_rate: parseFloat(s.percent_rate)
        }))
      },
      case_count_slabs: {
        create: (case_count_slabs || []).map(s => ({
          from_cases: parseInt(s.from_cases),
          to_cases: s.to_cases ? parseInt(s.to_cases) : null,
          payout_per_case: parseFloat(s.payout_per_case)
        }))
      },
      special_schemes: {
        create: (special_schemes || []).map(s => ({
          scheme_name: s.scheme_name,
          bonus_percent: s.bonus_percent ? parseFloat(s.bonus_percent) : null,
          bonus_per_case: s.bonus_per_case ? parseFloat(s.bonus_per_case) : null,
          basis: s.basis,
          valid_from: new Date(s.valid_from),
          valid_to: new Date(s.valid_to),
          is_active: s.is_active !== false
        }))
      }
    },
    include: {
      volume_slabs: true,
      case_count_slabs: true,
      special_schemes: true
    }
  });
}

async function updateRule(id, tenantId, data) {
  // Verify ownership
  const existingRule = await prisma.lenderCommissionRule.findFirst({
    where: { id, tenant_id: tenantId }
  });
  if (!existingRule) throw new Error('Rule not found or unauthorized');

  const {
    payout_basis, commission_type, is_active,
    volume_slabs, case_count_slabs, special_schemes
  } = data;

  return prisma.$transaction(async (tx) => {
    // 1. Clear existing slabs/schemes for full replacement (simpler for prototype)
    await tx.commissionVolumeSlab.deleteMany({ where: { rule_id: id } });
    await tx.commissionCaseCountSlab.deleteMany({ where: { rule_id: id } });
    await tx.commissionSpecialScheme.deleteMany({ where: { rule_id: id } });

    // 2. Update main rule
    return tx.lenderCommissionRule.update({
      where: { id },
      data: {
        payout_basis,
        commission_type,
        is_active: is_active !== false,
        volume_slabs: {
          create: (volume_slabs || []).map(s => ({
            from_amount: parseFloat(s.from_amount),
            to_amount: s.to_amount ? parseFloat(s.to_amount) : null,
            percent_rate: parseFloat(s.percent_rate)
          }))
        },
        case_count_slabs: {
          create: (case_count_slabs || []).map(s => ({
            from_cases: parseInt(s.from_cases),
            to_cases: s.to_cases ? parseInt(s.to_cases) : null,
            payout_per_case: parseFloat(s.payout_per_case)
          }))
        },
        special_schemes: {
          create: (special_schemes || []).map(s => ({
            scheme_name: s.scheme_name,
            bonus_percent: s.bonus_percent ? parseFloat(s.bonus_percent) : null,
            bonus_per_case: s.bonus_per_case ? parseFloat(s.bonus_per_case) : null,
            basis: s.basis,
            valid_from: new Date(s.valid_from),
            valid_to: new Date(s.valid_to),
            is_active: s.is_active !== false
          }))
        }
      },
      include: {
        volume_slabs: true,
        case_count_slabs: true,
        special_schemes: true
      }
    });
  });
}

async function deleteRule(id, tenantId) {
  const rule = await prisma.lenderCommissionRule.findFirst({
    where: { id, tenant_id: tenantId }
  });
  if (!rule) throw new Error('Rule not found or unauthorized');

  await prisma.lenderCommissionRule.delete({ where: { id } });
  return { success: true };
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule
};
