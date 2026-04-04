const prisma = require('../../config/db');

/**
 * Retrieves the cost of an API for a specific tenant,
 * falling back to global defaults if no override exists.
 */
async function getApiCost(api_code, tenant_id) {
  // 1. Check for a tenant specific override
  const override = await prisma.tenantApiPricingOverride.findUnique({
    where: {
      tenant_id_api_code: {
        tenant_id: tenant_id,
        api_code: api_code
      }
    }
  });

  if (override) {
    return override.custom_credit_cost;
  }

  // 2. Fallback to default pricing
  const defaultPricing = await prisma.apiPricing.findUnique({
    where: { api_code: api_code }
  });

  if (!defaultPricing || !defaultPricing.is_active) {
    throw new Error(`API Pricing not configured or inactive for: ${api_code}`);
  }

  return defaultPricing.default_credit_cost;
}

/**
 * Superadmin utility: Returns a clean list mapping real-time exact costs for a specific tenant.
 */
async function getTenantCostsMatrix(tenant_id) {
    const defaultPrices = await prisma.apiPricing.findMany();
    const overrides = await prisma.tenantApiPricingOverride.findMany({
        where: { tenant_id }
    });

    const overrideMap = overrides.reduce((acc, curr) => {
        acc[curr.api_code] = curr.custom_credit_cost;
        return acc;
    }, {});

    return defaultPrices.map(pricing => ({
        api_code: pricing.api_code,
        api_name: pricing.api_name,
        default_cost: pricing.default_credit_cost,
        tenant_cost: overrideMap[pricing.api_code] !== undefined ? overrideMap[pricing.api_code] : pricing.default_credit_cost,
        is_overridden: overrideMap[pricing.api_code] !== undefined
    }));
}

module.exports = {
  getApiCost,
  getTenantCostsMatrix
};
