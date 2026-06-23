const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.$queryRawUnsafe(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`);
  console.log(JSON.stringify(res, null, 2));
}
main().finally(() => prisma.$disconnect());
