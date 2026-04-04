const prisma = require('../config/db');

async function auditExecutionTracing() {
    console.log("=== Running Execution Tracing Consistency Check ===");

    try {
        const usageLogs = await prisma.apiUsageLog.findMany({
            where: {
                status: { in: ['SUCCESS', 'REFUNDED'] },
                credits_used: { gt: 0 }
            },
            include: { user: true, tenant: true }
        });

        console.log(`Found ${usageLogs.length} paid API execution logs for auditing...`);

        let anomalies = 0;
        let successfulAudits = 0;

        for (const log of usageLogs) {
             if (!log.reference_id) {
                  console.error(`[CRITICAL ANOMALY] ApiUsageLog ID ${log.id} has NULL reference_id but credits were consumed!`);
                  anomalies++;
                  continue;
             }

             const walletTx = await prisma.walletTransaction.findUnique({
                 where: { id: log.reference_id }
             });

             if (!walletTx) {
                  console.error(`[CRITICAL ANOMALY] ApiUsageLog ID ${log.id} has NO matching WalletTransaction for reference_id: ${log.reference_id}`);
                  anomalies++;
                  continue;
             }

             if (walletTx.api_code !== log.api_code) {
                  console.error(`[ANOMALY] API Code Mismatch -> Log: ${log.api_code}, Tx: ${walletTx.api_code}`);
                  anomalies++;
                  continue;
             }
             
             if (log.status === 'REFUNDED') {
                  const refundTx = await prisma.walletTransaction.findFirst({
                       where: { reference_type: 'REFUND', reference_id: log.id }
                  });

                  if (!refundTx) {
                      console.error(`[CRITICAL ANOMALY] ApiUsageLog ID ${log.id} marked as REFUNDED, but no REFUND WalletTransaction trace exists!`);
                      anomalies++;
                      continue; 
                  }
             }

             successfulAudits++;
        }

        console.log("=== Audit Complete ===");
        console.log(`Total Scanned: ${usageLogs.length}`);
        console.log(`Clean Traces: ${successfulAudits}`);
        console.log(`Anomalies Found: ${anomalies}`);

        if (anomalies > 0) {
            console.error("WARNING: Execution tracing consistency is BROKEN.");
            process.exit(1);
        } else {
            console.log("SUCCESS: Execution tracing consistency is fully VERIFIED! All invariants held.");
            process.exit(0);
        }

    } catch (e) {
        console.error("Audit failed fatally:", e);
        process.exit(1);
    }
}

auditExecutionTracing();
