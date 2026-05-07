/**
 * One-time backfill script: Set is_primary = true for all PRIMARY type applicants
 * that currently have is_primary = false (created before the CA-3 fix).
 * Run once: node src/scripts/backfill_is_primary.js
 */
const prisma = require('../../config/db');

async function main() {
    const result = await prisma.applicant.updateMany({
        where: {
            type: 'PRIMARY',
            is_primary: false
        },
        data: {
            is_primary: true
        }
    });
    console.log(`[Backfill] Updated ${result.count} PRIMARY applicants to is_primary = true`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('[Backfill] Error:', err);
    process.exit(1);
});
