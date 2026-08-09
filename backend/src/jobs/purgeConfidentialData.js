const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function purgeConfidentialData() {
  console.log('Starting confidential data purge job...');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  console.log(`Purging raw JSON data older than: ${cutoffDate.toISOString()}`);

  try {
    // 1. Purge BureauVerification
    const bureauRows = await prisma.$queryRaw`
      UPDATE "bureau_verifications"
      SET "raw_response" = NULL
      WHERE "created_at" < ${cutoffDate}
        AND "raw_response" IS NOT NULL
      RETURNING id, case_id
    `;
    
    if (bureauRows.length > 0) {
      const caseIds = [...new Set(bureauRows.map(r => r.case_id))];
      const cases = await prisma.case.findMany({
        where: { id: { in: caseIds } },
        select: { id: true, customer_id: true }
      });
      const caseToCustomer = cases.reduce((acc, c) => ({ ...acc, [c.id]: c.customer_id }), {});

      const auditLogs = bureauRows.map(r => ({
        customer_id: caseToCustomer[r.case_id],
        table_name: 'bureau_verifications',
        record_id: String(r.id),
        purged_fields: ['raw_response']
      }));
      await prisma.purgeAuditLog.createMany({ data: auditLogs });
    }
    console.log(`Purged Bureau records: ${bureauRows.length}`);

    // 2. Purge GstrAnalyticsRequest
    const gstRows = await prisma.$queryRaw`
      UPDATE "gstr_analytics_requests"
      SET 
        "raw_fetch_data" = NULL,
        "raw_report_data" = NULL,
        "raw_gst_data" = NULL,
        "provider_callback_payload" = NULL
      WHERE "created_at" < ${cutoffDate}
        AND (
          "raw_fetch_data" IS NOT NULL OR 
          "raw_report_data" IS NOT NULL OR 
          "raw_gst_data" IS NOT NULL OR 
          "provider_callback_payload" IS NOT NULL
        )
      RETURNING id, customer_id
    `;
    
    if (gstRows.length > 0) {
      const auditLogs = gstRows.map(r => ({
        customer_id: r.customer_id,
        table_name: 'gstr_analytics_requests',
        record_id: String(r.id),
        purged_fields: ['raw_fetch_data', 'raw_report_data', 'raw_gst_data', 'provider_callback_payload']
      }));
      await prisma.purgeAuditLog.createMany({ data: auditLogs });
    }
    console.log(`Purged GST records: ${gstRows.length}`);

    // 3. Purge ItrAnalyticsRequest
    const itrRows = await prisma.$queryRaw`
      UPDATE "itr_analytics_requests"
      SET "analytics_payload" = NULL
      WHERE "created_at" < ${cutoffDate}
        AND "analytics_payload" IS NOT NULL
      RETURNING id, customer_id
    `;
    
    if (itrRows.length > 0) {
      const auditLogs = itrRows.map(r => ({
        customer_id: r.customer_id,
        table_name: 'itr_analytics_requests',
        record_id: String(r.id),
        purged_fields: ['analytics_payload']
      }));
      await prisma.purgeAuditLog.createMany({ data: auditLogs });
    }
    console.log(`Purged ITR records: ${itrRows.length}`);

    // 4. Purge BankStatementAnalysisRequest
    const bankRows = await prisma.$queryRaw`
      UPDATE "bank_statement_analysis_requests"
      SET 
        "files_payload" = NULL,
        "raw_analyze_response" = NULL,
        "raw_retrieve_response" = NULL,
        "raw_download_response" = NULL
      WHERE "created_at" < ${cutoffDate}
        AND (
          "files_payload" IS NOT NULL OR
          "raw_analyze_response" IS NOT NULL OR
          "raw_retrieve_response" IS NOT NULL OR
          "raw_download_response" IS NOT NULL
        )
      RETURNING id, customer_id
    `;
    
    if (bankRows.length > 0) {
      const auditLogs = bankRows.map(r => ({
        customer_id: r.customer_id,
        table_name: 'bank_statement_analysis_requests',
        record_id: String(r.id),
        purged_fields: ['files_payload', 'raw_analyze_response', 'raw_retrieve_response', 'raw_download_response']
      }));
      await prisma.purgeAuditLog.createMany({ data: auditLogs });
    }
    console.log(`Purged Bank Statement records: ${bankRows.length}`);

    console.log('Confidential data purge job completed successfully.');
  } catch (error) {
    console.error('Error during data purge:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Execute if run directly
if (require.main === module) {
  purgeConfidentialData();
}

module.exports = purgeConfidentialData;
