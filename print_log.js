const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const log = await prisma.bureauVerificationLog.findFirst({
    orderBy: { created_at: 'desc' }
  });
  console.log(JSON.stringify(log.response_payload, null, 2));
  console.log('Request Payload:');
  console.log(JSON.stringify(log.request_payload, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
