const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listTables() {
  const result = await prisma.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema='public';
  `;
  console.log(result.map(r => r.table_name).join(', '));
  await prisma.$disconnect();
}
listTables();
