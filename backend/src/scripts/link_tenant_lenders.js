/**
 * Linker Script: Auto-link TenantLenders to Platform Lenders by name.
 * 
 * Usage:
 *   Dry-run: node src/scripts/link_tenant_lenders.js
 *   Apply:   node src/scripts/link_tenant_lenders.js --apply
 */

const prisma = require('../../config/db');

async function main() {
    const isApply = process.argv.includes('--apply');
    console.log(`\n======================================================`);
    console.log(`[LINKER] Starting Tenant Lender linking script`);
    console.log(`[LINKER] Mode: ${isApply ? 'APPLY (Making changes)' : 'DRY-RUN (Reporting only)'}`);
    console.log(`======================================================\n`);

    // 1. Fetch all Platform Lenders
    const platformLenders = await prisma.lender.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, code: true }
    });

    // 2. Fetch all Tenant Lenders that are NOT linked yet
    const tenantLenders = await prisma.tenantLender.findMany({
        where: { platform_lender_id: null },
        include: { tenant: { select: { name: true } } }
    });

    console.log(`[LINKER] Found ${platformLenders.length} platform lenders.`);
    console.log(`[LINKER] Found ${tenantLenders.length} unlinked tenant lenders across all tenants.\n`);

    const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    const platformMap = {};
    platformLenders.forEach(p => {
        const key = normalize(p.name);
        if (!platformMap[key]) platformMap[key] = [];
        platformMap[key].push(p);
    });

    const results = {
        exactMatches: [],
        unmatched: [],
        ambiguous: []
    };

    for (const tl of tenantLenders) {
        const key = normalize(tl.lender_name);
        const matches = platformMap[key];

        if (!matches || matches.length === 0) {
            results.unmatched.push({ tenantLender: tl });
        } else if (matches.length === 1) {
            results.exactMatches.push({ tenantLender: tl, platformLender: matches[0] });
        } else {
            results.ambiguous.push({ tenantLender: tl, matches });
        }
    }

    // Report Results
    console.log(`--- RESULTS SUMMARY ---`);
    console.log(`Exact Matches: ${results.exactMatches.length}`);
    console.log(`Unmatched:     ${results.unmatched.length}`);
    console.log(`Ambiguous:     ${results.ambiguous.length}\n`);

    if (results.exactMatches.length > 0) {
        console.log(`[EXACT MATCHES]`);
        results.exactMatches.forEach(m => {
            console.log(` - Tenant: ${m.tenantLender.tenant.name} | "${m.tenantLender.lender_name}" -> Platform: "${m.platformLender.name}" (${m.platformLender.code})`);
        });
        console.log('');
    }

    if (results.ambiguous.length > 0) {
        console.log(`[AMBIGUOUS MATCHES] (No changes will be made)`);
        results.ambiguous.forEach(m => {
            console.log(` - Tenant: ${m.tenantLender.tenant.name} | "${m.tenantLender.lender_name}" matches ${m.matches.length} platform lenders: ${m.matches.map(p => p.name).join(', ')}`);
        });
        console.log('');
    }

    if (results.unmatched.length > 0) {
        console.log(`[UNMATCHED] (Will remain manual/non-ESR)`);
        results.unmatched.forEach(m => {
            console.log(` - Tenant: ${m.tenantLender.tenant.name} | "${m.tenantLender.lender_name}"`);
        });
        console.log('');
    }

    // Apply Changes
    if (isApply && results.exactMatches.length > 0) {
        console.log(`[APPLYING CHANGES]`);
        let count = 0;
        for (const m of results.exactMatches) {
            await prisma.tenantLender.update({
                where: { id: m.tenantLender.id },
                data: {
                    platform_lender_id: m.platformLender.id,
                    is_esr_enabled: true
                }
            });
            count++;
        }
        console.log(`[APPLY DONE] Successfully linked ${count} lenders and enabled ESR for them.`);
    }

    console.log(`\n[LINKER] Script finished.`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(`[LINKER ERROR]`, err);
    process.exit(1);
});
