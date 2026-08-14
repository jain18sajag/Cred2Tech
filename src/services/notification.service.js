const prisma = require('../../config/db');

/**
 * Determines the best recipient for a notification based on the requested hierarchy:
 * Assignee -> Owner -> Initiator -> Tenant Admin
 * 
 * Returns { recipient_user_id, audience_type }
 */
exports.determineNotificationRecipient = async (tenantId, caseId, initiatorId = null) => {
    let caseRecord = null;
    
    if (caseId) {
        caseRecord = await prisma.case.findUnique({
            where: { id: parseInt(caseId, 10) },
            select: { assigned_dsa_user_id: true, created_by_user_id: true }
        });
    }

    if (caseRecord && caseRecord.assigned_dsa_user_id) {
        return { recipient_user_id: caseRecord.assigned_dsa_user_id, audience_type: 'CASE_ASSIGNEE' };
    }

    if (caseRecord && caseRecord.created_by_user_id) {
        return { recipient_user_id: caseRecord.created_by_user_id, audience_type: 'CASE_OWNER' };
    }

    if (initiatorId) {
        return { recipient_user_id: initiatorId, audience_type: 'USER' };
    }

    // Fallback to the tenant's admin. 'role' is a relation (Role), not a scalar
    // string, so `role: 'TENANT_ADMIN'` was a type mismatch that threw at runtime
    // whenever this branch was reached — and 'TENANT_ADMIN' isn't a seeded role
    // name anyway (real tenant-admin roles are DSA_ADMIN / CRED2TECH_MEMBER).
    const tenantAdmin = await prisma.user.findFirst({
        where: { tenant_id: tenantId, role: { name: { in: ['DSA_ADMIN', 'CRED2TECH_MEMBER'] } } },
        orderBy: { id: 'asc' }
    });

    if (tenantAdmin) {
        return { recipient_user_id: tenantAdmin.id, audience_type: 'TENANT_ROLE' };
    }

    // Ultimate fallback if no admin is found
    return { recipient_user_id: null, audience_type: 'TENANT_PERMISSION' };
};
