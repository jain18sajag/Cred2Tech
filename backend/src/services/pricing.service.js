const prisma = require('../../config/db');

// Future-proof Cache Adapter layer (Can be swapped with Redis easily)
const localCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const cacheAdapter = {
  get: async (key) => {
    const cached = localCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) return cached.value;
    return null;
  },
  set: async (key, value) => {
    localCache.set(key, { value, timestamp: Date.now() });
  },
  clear: async () => {
    localCache.clear();
  }
};

async function clearPricingCache() {
  await cacheAdapter.clear();
}

/**
 * Retrieves the cost of an API for a specific tenant,
 * falling back to global defaults if no override exists.
 */
async function getApiCost(api_code, tenant_id) {
  const cacheKey = `${api_code}_${tenant_id}`;
  
  const cachedCost = await cacheAdapter.get(cacheKey);
  if (cachedCost !== null) {
     return cachedCost;
  }

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
      await cacheAdapter.set(cacheKey, override.custom_credit_cost);
      return override.custom_credit_cost;
    }

  // 2. Fallback to default pricing
  const defaultPricing = await prisma.apiPricing.findUnique({
    where: { api_code: api_code }
  });

  if (!defaultPricing || !defaultPricing.is_active) {
    // If inactive or missing, default to 0 instead of rejecting as requested.
    await cacheAdapter.set(cacheKey, 0);
    return 0;
  }

  const resolvedCost = defaultPricing.default_credit_cost;
  await cacheAdapter.set(cacheKey, resolvedCost);

  return resolvedCost;
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
  getTenantCostsMatrix,
  clearPricingCache
};
