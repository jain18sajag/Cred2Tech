// lenderCommission.service.js
// Service layer for managing DSA lender commission configurations.
// Strict tenant isolation enforced.

const prisma = require('../../config/db');

async function listRules(tenantId) {
  return prisma.lenderCommissionRule.findMany({
    where: {
      tenant_id: tenantId,
      status: 'ACTIVE'
    },
    include: {
      tenant_lender: {
        select: { bank_name: true }
      },
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

  // 2. Validation: Ensure only one active rule per product/lender
  const existing = await prisma.lenderCommissionRule.findFirst({
    where: { 
      tenant_id: tenantId, 
      tenant_lender_id: parseInt(tenant_lender_id), 
      product_type,
      status: 'ACTIVE'
    }
  });

  if (existing) throw new Error('An active configuration already exists for this lender and product.');

  // 3. Create with nested relations
  return prisma.lenderCommissionRule.create({
    data: {
      tenant_id: tenantId,
      tenant_lender_id: parseInt(tenant_lender_id),
      product_type,
      payout_basis,
      commission_type,
      status: 'ACTIVE',
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
    payout_basis, commission_type, status,
    volume_slabs, case_count_slabs, special_schemes
  } = data;

  return prisma.$transaction(async (tx) => {
    // 1. Archive the existing rule instead of overwriting it
    await tx.lenderCommissionRule.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        effective_to: new Date()
      }
    });

    // 2. Create the new active rule
    return tx.lenderCommissionRule.create({
      data: {
        tenant_id: tenantId,
        tenant_lender_id: existingRule.tenant_lender_id,
        product_type: existingRule.product_type,
        payout_basis,
        commission_type,
        status: status || 'ACTIVE',
        effective_from: new Date(),
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
            is_active: true
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

  // Archive instead of hard delete
  await prisma.lenderCommissionRule.update({ 
    where: { id },
    data: { status: 'ARCHIVED', effective_to: new Date() }
  });
  return { success: true };
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule
};
