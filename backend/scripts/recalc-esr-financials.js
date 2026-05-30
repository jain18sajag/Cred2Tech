const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { extractEsrFinancials } = require('../src/services/esrFinancials.service');

async function run() {
    console.log("=== ESR Financials Extraction Backfill Script ===");
    
    // Find all cases that already have an ESR financial record
    const casesWithEsr = await prisma.caseEsrFinancials.findMany({
        select: { case_id: true }
    });

    console.log(`Found ${casesWithEsr.length} cases with ESR financials to process.\n`);

    let successCount = 0;
    let failCount = 0;

    for (const c of casesWithEsr) {
        try {
            console.log(`-> Re-extracting financials for Case ID: ${c.case_id}`);
            
            // We need the tenant_id to pass to extractEsrFinancials, so fetch the Case
            const caseData = await prisma.case.findUnique({
                where: { id: c.case_id },
                select: { tenant_id: true }
            });
            
            // Call the existing extraction logic
            await extractEsrFinancials(c.case_id, caseData?.tenant_id || 1);
            
            successCount++;
        } catch (e) {
            console.error(`❌ Failed to re-extract for Case ID ${c.case_id}: ${e.message}`);
            failCount++;
        }
    }

    console.log(`\n=== Backfill Summary ===`);
    console.log(`Total Processed: ${casesWithEsr.length}`);
    console.log(`Successful:      ${successCount}`);
    console.log(`Failed:          ${failCount}`);
    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
