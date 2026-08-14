// platformLender.service.js
// Handles platform-wide lender master data (managed by SUPER_ADMIN).

const prisma = require('../../config/db');

/**
 * List all active platform lenders for linking.
 * DSA_ADMINs use this to populate the dropdown in Lender Directory.
 */
async function listActivePlatformLenders() {
    return prisma.lender.findMany({
        where: { status: 'ACTIVE' },
        select: {
            id: true,
            name: true,
            code: true,
            status: true
        },
        orderBy: { name: 'asc' }
    });
}

/**
 * List all platform lenders (including inactive) for SUPER_ADMIN.
 */
async function listAllPlatformLenders() {
    return prisma.lender.findMany({
        select: {
            id: true,
            name: true,
            code: true,
            status: true,
            created_at: true
        },
        orderBy: { name: 'asc' }
    });
}

module.exports = {
    listActivePlatformLenders,
    listAllPlatformLenders
};
