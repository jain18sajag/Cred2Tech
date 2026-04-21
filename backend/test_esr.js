const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { extractEsrFinancials } = require('./src/services/esrFinancials.service');

async function testExtraction() {
    try {
        console.log('--- Testing ESR Extraction for Customer ID 13 ---');

        const caseRec = await prisma.case.findFirst({
            where: { customer_id: 13 },
            orderBy: { created_at: 'desc' }
        });

        if (!caseRec) {
            console.log('No case found for customer 13.');
            return;
        }

        const caseId = caseRec.id;
        console.log(`Found Case ID: ${caseId} for Customer 13`);

        // Trigger extraction directly
        await extractEsrFinancials(caseId);

        // Fetch the generated ESR financials row
        const financials = await prisma.$queryRaw`SELECT * FROM case_esr_financials WHERE case_id = ${caseId}`;

        if (financials && financials.length > 0) {
            console.log('\n✅ Successfully Generated CaseEsrFinancials:');
            // Log properties nicely
            const row = financials[0];
            Object.keys(row).forEach(key => {
                if(row[key] !== null) {
                    console.log(`  ${key}:`, row[key]);
                }
            });
            
            // Also test some raw inputs available just for logging visibility
            const gst = await prisma.gstrAnalyticsRequest.findFirst({ where: { case_id: caseId }, select: { status: true, raw_gst_data: true } });
            const itr = await prisma.itrAnalyticsRequest.findFirst({ where: { case_id: caseId }, select: { status: true } });
            const bank = await prisma.bankStatementAnalysisRequest.findFirst({ where: { case_id: caseId }, select: { status: true } });
            
            console.log('\n--- Input Analytics Diagnosics ---');
            console.log(`GST Status: ${gst?.status || 'MISSING'}. Has Raw Data: ${gst?.raw_gst_data ? 'YES' : 'NO'}`);
            console.log(`ITR Status: ${itr?.status || 'MISSING'}.`);
            console.log(`BANK Status: ${bank?.status || 'MISSING'}.`);

        } else {
            console.log('\n❌ Extraction completed but no row found in case_esr_financials.');
        }

    } catch (e) {
        console.error('Error during test:', e);
    } finally {
        await prisma.$disconnect();
    }
}

testExtraction();
