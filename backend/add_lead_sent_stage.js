// add_lead_sent_stage.js — adds LEAD_SENT_TO_LENDER to CaseStage enum in PostgreSQL
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    // Check if the value already exists
    const check = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'CaseStage' AND e.enumlabel = 'LEAD_SENT_TO_LENDER'
    `);

    if (check.length > 0) {
      console.log('[migration] LEAD_SENT_TO_LENDER already exists in CaseStage — nothing to do.');
    } else {
      await prisma.$executeRawUnsafe(`ALTER TYPE "CaseStage" ADD VALUE 'LEAD_SENT_TO_LENDER' BEFORE 'IN_REVIEW'`);
      console.log('[migration] ✅ Added LEAD_SENT_TO_LENDER to CaseStage enum.');
    }
  } catch (err) {
    console.error('[migration] Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
