const prisma = require('../../config/db');

/**
 * Append-only log of sensitive-data reads (documents, KYC/PAN profiles,
 * bureau pulls) — RBI requirement, see VAPT H-7. Fire-and-forget: a logging
 * failure must never block the actual request.
 */
async function logSensitiveAccess({ tenantId, userId, resourceType, resourceId, action, ip }) {
  try {
    await prisma.sensitiveDataAccessLog.create({
      data: {
        tenant_id: tenantId,
        user_id: userId ?? null,
        resource_type: resourceType,
        resource_id: resourceId !== undefined && resourceId !== null ? String(resourceId) : null,
        action,
        ip_address: ip ?? null,
      }
    });
  } catch (err) {
    console.error('[auditLog] Failed to record sensitive-data access:', err.message);
  }
}

module.exports = { logSensitiveAccess };
