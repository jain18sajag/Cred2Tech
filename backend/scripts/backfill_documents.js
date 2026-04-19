/**
 * backfill_documents.js
 *
 * One-time migration script that downloads existing vendor URLs stored in DB
 * and creates Document records for them.
 *
 * Safe to run multiple times (idempotent — skips records that already have document_id set).
 *
 * Usage: node scripts/backfill_documents.js
 *
 * Run from: backend/ directory
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { ingestFromUrl } = require('../src/services/document.service');

const prisma = new PrismaClient();

let processed = 0, skipped = 0, failed = 0;

async function log(msg) {
    console.log(`[backfill] ${new Date().toISOString()} ${msg}`);
}

// ── Bank Statement records ────────────────────────────────────────────────────

async function backfillBankStatements() {
    log('Backfilling BankStatementAnalysisRequest...');
    const records = await prisma.bankStatementAnalysisRequest.findMany({
        where: {
            OR: [
                { report_excel_url: { not: null }, bank_excel_document_id: null },
                { report_json_url: { not: null },  bank_json_document_id: null },
            ]
        }
    });

    log(`Found ${records.length} bank statement records to backfill`);

    for (const rec of records) {
        try {
            let excelDocId = rec.bank_excel_document_id;
            let jsonDocId  = rec.bank_json_document_id;

            if (rec.report_excel_url && !excelDocId) {
                try {
                    const doc = await ingestFromUrl({
                        vendorUrl: rec.report_excel_url,
                        documentType: 'BANK_EXCEL',
                        tenantId: rec.tenant_id,
                        customerId: rec.customer_id,
                        caseId: rec.case_id,
                        applicantId: rec.applicant_id,
                        originalFileName: `bank_statement_${rec.report_id}.xlsx`,
                        metadata: { report_id: rec.report_id, source: 'backfill' }
                    });
                    excelDocId = doc.id;
                    log(`  Bank Excel ingested → doc#${doc.id} for request#${rec.id}`);
                } catch (e) {
                    log(`  WARN: Bank Excel ingestion failed for request#${rec.id}: ${e.message}`);
                    failed++;
                }
            }

            if (rec.report_json_url && !jsonDocId) {
                try {
                    const doc = await ingestFromUrl({
                        vendorUrl: rec.report_json_url,
                        documentType: 'BANK_JSON',
                        tenantId: rec.tenant_id,
                        customerId: rec.customer_id,
                        caseId: rec.case_id,
                        applicantId: rec.applicant_id,
                        originalFileName: `bank_statement_${rec.report_id}.json`,
                        metadata: { report_id: rec.report_id, source: 'backfill' }
                    });
                    jsonDocId = doc.id;
                    log(`  Bank JSON ingested → doc#${doc.id} for request#${rec.id}`);
                } catch (e) {
                    log(`  WARN: Bank JSON ingestion failed for request#${rec.id}: ${e.message}`);
                    failed++;
                }
            }

            if (excelDocId !== rec.bank_excel_document_id || jsonDocId !== rec.bank_json_document_id) {
                await prisma.bankStatementAnalysisRequest.update({
                    where: { id: rec.id },
                    data: {
                        bank_excel_document_id: excelDocId || undefined,
                        bank_json_document_id:  jsonDocId  || undefined
                    }
                });
                processed++;
            } else {
                skipped++;
            }
        } catch (e) {
            log(`  ERROR: request#${rec.id}: ${e.message}`);
            failed++;
        }
    }
}

// ── ITR Analytics records ─────────────────────────────────────────────────────

async function backfillItrAnalytics() {
    log('Backfilling ItrAnalyticsRequest...');
    const records = await prisma.itrAnalyticsRequest.findMany({
        where: { excel_url: { not: null }, itr_document_id: null, status: 'COMPLETED' }
    });

    log(`Found ${records.length} ITR analytics records to backfill`);

    for (const rec of records) {
        try {
            const doc = await ingestFromUrl({
                vendorUrl: rec.excel_url,
                documentType: 'ITR_EXCEL',
                tenantId: rec.tenant_id,
                customerId: rec.customer_id,
                caseId: rec.case_id,
                applicantId: rec.applicant_id,
                originalFileName: `itr_analytics_${rec.pan}.xlsx`,
                metadata: { reference_id: rec.reference_id, pan: rec.pan, source: 'backfill' }
            });
            await prisma.itrAnalyticsRequest.update({
                where: { id: rec.id },
                data: { itr_document_id: doc.id }
            });
            log(`  ITR Excel ingested → doc#${doc.id} for request#${rec.id}`);
            processed++;
        } catch (e) {
            log(`  WARN: ITR ingestion failed for request#${rec.id}: ${e.message}`);
            failed++;
        }
    }
}

// ── GST Analytics records ─────────────────────────────────────────────────────

async function backfillGstAnalytics() {
    log('Backfilling GstrAnalyticsRequest...');
    const records = await prisma.gstrAnalyticsRequest.findMany({
        where: {
            OR: [
                { report_pdf_url: { not: null },   gst_pdf_document_id: null },
                { report_excel_url: { not: null },  gst_excel_document_id: null },
                { report_json_url: { not: null },   gst_json_document_id: null },
            ]
        }
    });

    log(`Found ${records.length} GST request records to backfill`);

    for (const rec of records) {
        try {
            const base = {
                tenantId: rec.tenant_id,
                customerId: rec.customer_id,
                caseId: rec.case_id,
                metadata: { gst_request_id: rec.id, gstin: rec.gstin, source: 'backfill' }
            };

            let pdfDocId   = rec.gst_pdf_document_id;
            let excelDocId = rec.gst_excel_document_id;
            let jsonDocId  = rec.gst_json_document_id;

            if (rec.report_pdf_url && !pdfDocId) {
                try {
                    const doc = await ingestFromUrl({ ...base, vendorUrl: rec.report_pdf_url, documentType: 'GST_REPORT_PDF', originalFileName: `gst_${rec.gstin}.pdf` });
                    pdfDocId = doc.id;
                    log(`  GST PDF → doc#${doc.id} for request#${rec.id}`);
                } catch (e) { log(`  WARN GST PDF: ${e.message}`); failed++; }
            }
            if (rec.report_excel_url && !excelDocId) {
                try {
                    const doc = await ingestFromUrl({ ...base, vendorUrl: rec.report_excel_url, documentType: 'GST_REPORT_EXCEL', originalFileName: `gst_${rec.gstin}.xlsx` });
                    excelDocId = doc.id;
                    log(`  GST Excel → doc#${doc.id} for request#${rec.id}`);
                } catch (e) { log(`  WARN GST Excel: ${e.message}`); failed++; }
            }
            if (rec.report_json_url && !jsonDocId) {
                try {
                    const doc = await ingestFromUrl({ ...base, vendorUrl: rec.report_json_url, documentType: 'GST_REPORT_JSON', originalFileName: `gst_${rec.gstin}.json` });
                    jsonDocId = doc.id;
                    log(`  GST JSON → doc#${doc.id} for request#${rec.id}`);
                } catch (e) { log(`  WARN GST JSON: ${e.message}`); failed++; }
            }

            if (pdfDocId !== rec.gst_pdf_document_id || excelDocId !== rec.gst_excel_document_id || jsonDocId !== rec.gst_json_document_id) {
                await prisma.gstrAnalyticsRequest.update({
                    where: { id: rec.id },
                    data: {
                        gst_pdf_document_id:   pdfDocId   || undefined,
                        gst_excel_document_id: excelDocId || undefined,
                        gst_json_document_id:  jsonDocId  || undefined,
                    }
                });
                processed++;
            } else {
                skipped++;
            }
        } catch (e) {
            log(`  ERROR GST request#${rec.id}: ${e.message}`);
            failed++;
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    log('=== Document Backfill Script Starting ===');
    log(`NOTE: Vendor URLs that have expired (>24h) will fail ingestion — this is expected.`);

    await backfillBankStatements();
    await backfillItrAnalytics();
    await backfillGstAnalytics();

    log('=== Backfill Complete ===');
    log(`Processed: ${processed} | Skipped (already done): ${skipped} | Failed/Expired: ${failed}`);
    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('Backfill script fatal error:', e);
    await prisma.$disconnect();
    process.exit(1);
});
