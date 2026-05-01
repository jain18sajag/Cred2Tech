const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.$queryRaw`SELECT api_code, COUNT(*) as count FROM api_usage_logs WHERE status = 'SUCCESS' GROUP BY api_code`;
  console.log(logs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
