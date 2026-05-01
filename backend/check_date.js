const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.$queryRaw`SELECT MAX(created_at) as max_date, COUNT(*) as total FROM api_usage_logs`;
  console.log(logs);
}
main().catch(console.error).finally(() => prisma.$disconnect());
