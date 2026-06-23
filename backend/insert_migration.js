const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
  const migrationName = '20260502000000_real_baseline';
  const fileContent = fs.readFileSync(`./prisma/migrations/${migrationName}/migration.sql`, 'utf8');
  const checksum = crypto.createHash('sha256').update(fileContent).digest('hex');

  const id = crypto.randomUUID();

  await prisma.$executeRawUnsafe(`
    INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, applied_steps_count, started_at)
    VALUES ('${id}', '${checksum}', NOW(), '${migrationName}', NULL, 1, NOW())
  `);
  console.log('Migration inserted successfully.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
