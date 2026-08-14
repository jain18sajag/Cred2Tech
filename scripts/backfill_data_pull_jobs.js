const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('[Backfill] Starting backfill of DataPullBackgroundJob for existing requests...');

    // 1. Backfill ITR
    const itrReqs = await prisma.itrAnalyticsRequest.findMany({
        where: {
            status: { in: ['PENDING', 'PROCESSING', 'INITIATED'] }
        }
    });

    let itrCount = 0;
    for (const req of itrReqs) {
        if (!req.case_id) continue;
        const existing = await prisma.dataPullBackgroundJob.findFirst({
            where: { pull_type: 'ITR', module_request_id: req.id }
        });

        if (!existing) {
            let flowType = req.status === 'INITIATED' ? 'ITR_FORM' : 'ITR_ANALYTICS';
            let jobStatus = req.status === 'INITIATED' ? 'AWAITING_CUSTOMER_ACTION' : 'PENDING';
            
            await prisma.dataPullBackgroundJob.create({
                data: {
                    tenant_id: req.tenant_id,
                    case_id: req.case_id,
                    applicant_id: req.applicant_id,
                    pull_type: 'ITR',
                    module_request_id: req.id,
                    provider_request_id: req.reference_id,
                    flow_type: flowType,
                    status: jobStatus,
                    next_run_at: new Date(),
                    maximum_attempts: 5,
                    processing_deadline_at: new Date(Date.now() + 120 * 60000)
                }
            });
            itrCount++;
        }
    }
    console.log(`[Backfill] Created ${itrCount} missing ITR jobs.`);

    // 2. Backfill GST
    const gstReqs = await prisma.gstrAnalyticsRequest.findMany({
        where: {
            status: { in: ['PENDING', 'PROCESSING', 'OTP_PENDING'] }
        }
    });

    let gstCount = 0;
    for (const req of gstReqs) {
        if (!req.case_id) continue;
        const existing = await prisma.dataPullBackgroundJob.findFirst({
            where: { pull_type: 'GST', module_request_id: req.id }
        });

        if (!existing) {
            let flowType = req.mode === 'AUTH_LINK' ? 'GST_AUTH_LINK' : (req.auth_type === 'OTP' ? 'GST_OTP' : 'GST_PASSWORD');
            let jobStatus = (req.auth_type === 'OTP' && req.status === 'OTP_PENDING') || req.mode === 'AUTH_LINK' ? 'AWAITING_CUSTOMER_ACTION' : 'PENDING';

            await prisma.dataPullBackgroundJob.create({
                data: {
                    tenant_id: req.tenant_id,
                    case_id: req.case_id,
                    applicant_id: req.applicant_id,
                    pull_type: 'GST',
                    module_request_id: req.id,
                    provider_request_id: req.provider_request_id,
                    flow_type: flowType,
                    status: jobStatus,
                    next_run_at: new Date(),
                    maximum_attempts: 3,
                    processing_deadline_at: new Date(Date.now() + 120 * 60000)
                }
            });
            gstCount++;
        }
    }
    console.log(`[Backfill] Created ${gstCount} missing GST jobs.`);

    // 3. Backfill BANK
    const bankReqs = await prisma.bankStatementAnalysisRequest.findMany({
        where: {
            status: { in: ['ANALYZING', 'PENDING'] }
        }
    });

    let bankCount = 0;
    for (const req of bankReqs) {
        if (!req.case_id) continue;
        const existing = await prisma.dataPullBackgroundJob.findFirst({
            where: { pull_type: 'BANK', module_request_id: req.id }
        });

        if (!existing) {
            await prisma.dataPullBackgroundJob.create({
                data: {
                    tenant_id: req.tenant_id,
                    case_id: req.case_id,
                    applicant_id: req.applicant_id,
                    pull_type: 'BANK',
                    module_request_id: req.id,
                    provider_request_id: req.report_id,
                    status: 'PENDING',
                    next_run_at: new Date(),
                    maximum_attempts: 3,
                    processing_deadline_at: new Date(Date.now() + 120 * 60000)
                }
            });
            bankCount++;
        }
    }
    console.log(`[Backfill] Created ${bankCount} missing BANK jobs.`);

    console.log('[Backfill] Completed.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
