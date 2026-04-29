// migrate_document_types.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const NEW_TYPES = [
  'PAN_CARD',
  'AADHAAR',
  'GST_PDF',
  'ITR',
  'BANK_STATEMENT',
  'PROPERTY_DOCUMENT',
  'SALE_DEED'
];

async function run() {
  console.log('[migration] Adding new document types to DocumentType enum...');
  
  for (const type of NEW_TYPES) {
    try {
      // Check if value exists
      const check = await prisma.$queryRawUnsafe(`
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'DocumentType' AND e.enumlabel = $1
      `, type);

      if (check.length === 0) {
        // Use executeRawUnsafe for DDL
        // Postgres doesn't allow parameters in ALTER TYPE, so we template it
        await prisma.$executeRawUnsafe(`ALTER TYPE "DocumentType" ADD VALUE '${type}'`);
        console.log(`[migration] ✅ Added ${type}`);
      } else {
        console.log(`[migration] Skipping ${type} (already exists)`);
      }
    } catch (err) {
      console.error(`[migration] Failed to add ${type}:`, err.message);
    }
  }

  console.log('[migration] Done.');
  await prisma.$disconnect();
}

run();
