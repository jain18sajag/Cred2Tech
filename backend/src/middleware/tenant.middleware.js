function ensureSameTenant(resourceTenantId) {
  return (req, res, next) => {
    // If the resourceTenantId is a function, we evaluate it with req
    const resolvedTenantId = typeof resourceTenantId === 'function' 
      ? resourceTenantId(req) 
      : resourceTenantId;

    if (req.user.tenant_id !== parseInt(resolvedTenantId, 10)) {
      return res.status(403).json({ error: 'Forbidden: Cross-tenant access denied.' });
    }
    next();
  };
}

module.exports = {
  ensureSameTenant,
};
