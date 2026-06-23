require('dotenv').config();
const prisma = require('../config/db');
const { finalizeGstAnalyticsRequest } = require('../src/services/gst.service');

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    console.log(`Starting GST Analytics Backfill... ${isDryRun ? '(DRY RUN)' : ''}`);

    const requests = await prisma.gstrAnalyticsRequest.findMany({
        where: {
            status: { in: ['COMPLETED', 'REPORT_READY'] },
            // Only backfill those that haven't been parsed into the new tables yet
            gst_financial_year_summaries: { none: {} }
        },
        select: { id: true, tenant_id: true, gstin: true, status: true, case_id: true }
    });

    console.log(`Found ${requests.length} requests eligible for backfill.`);

    let successCount = 0;
    let failCount = 0;

    for (const req of requests) {
        if (isDryRun) {
            console.log(`[DRY RUN] Would process Request ID: ${req.id} (GSTIN: ${req.gstin})`);
            successCount++;
        } else {
            try {
                await finalizeGstAnalyticsRequest(req.id, req.tenant_id);
                console.log(`Successfully backfilled Request ID: ${req.id} (GSTIN: ${req.gstin})`);
                successCount++;
            } catch (err) {
                console.error(`Failed to backfill Request ID: ${req.id}. Error: ${err.message}`);
                failCount++;
            }
        }
    }

    console.log(`\nBackfill complete. Success: ${successCount}, Failed: ${failCount}`);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
}).finally(() => {
    prisma.$disconnect();
});
