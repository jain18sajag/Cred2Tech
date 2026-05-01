const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.$queryRaw`SELECT DISTINCT api_code FROM api_usage_logs`;
  console.log('Distinct API Codes:', logs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
