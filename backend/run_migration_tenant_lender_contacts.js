/**
 * Migration: Tenant Lender Contact Configuration
 * Creates tenant_lenders and tenant_lender_contacts tables.
 * Safe: uses IF NOT EXISTS everywhere. Run multiple times without harm.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('[migration] Starting tenant_lender_contacts migration...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_lenders (
      id                  SERIAL PRIMARY KEY,
      tenant_id           INTEGER NOT NULL,
      lender_name         VARCHAR(200) NOT NULL,
      is_active           BOOLEAN NOT NULL DEFAULT true,
      created_by_user_id  INTEGER,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('[migration] tenant_lenders table: OK');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tl_tenant_id ON tenant_lenders(tenant_id);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_lender_contacts (
      id                   SERIAL PRIMARY KEY,
      tenant_lender_id     INTEGER NOT NULL REFERENCES tenant_lenders(id) ON DELETE CASCADE,
      tenant_id            INTEGER NOT NULL,
      product_type         VARCHAR(20) NOT NULL,
      contact_name         VARCHAR(200) NOT NULL,
      contact_email        VARCHAR(300) NOT NULL,
      contact_mobile       VARCHAR(20),
      is_primary           BOOLEAN NOT NULL DEFAULT true,
      created_by_user_id   INTEGER,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('[migration] tenant_lender_contacts table: OK');

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tlc_tenant_id       ON tenant_lender_contacts(tenant_id);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tlc_tenant_lender_id ON tenant_lender_contacts(tenant_lender_id);
  `);

  // Add proposal_sent_at and proposal_sent_by_user_id to cases if not present
  await prisma.$executeRawUnsafe(`
    ALTER TABLE cases
      ADD COLUMN IF NOT EXISTS proposal_sent_at          TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS proposal_sent_by_user_id  INTEGER;
  `);
  console.log('[migration] cases.proposal_sent_at / proposal_sent_by_user_id: OK');

  console.log('[migration] All done. tenant_lender_contacts migration complete.');
}

run()
  .catch(e => { console.error('[migration] FAILED:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
