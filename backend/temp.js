const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const reqs = await prisma.bankStatementAnalysisRequest.findMany({ select: { id: true, status: true, report_excel_url: true, report_json_url: true }});
  console.log(JSON.stringify(reqs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
