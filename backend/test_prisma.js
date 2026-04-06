const prisma = require('./config/db');

async function test() {
  try {
     const tenantId = 1;
     const result = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.tenantWallet.findUnique({ where: { tenant_id: tenantId } }),
      prisma.customer.count({ where: { tenant_id: tenantId } }),
      prisma.case.count({ where: { tenant_id: tenantId } }),
      prisma.user.count({ where: { tenant_id: tenantId } }),
      prisma.apiUsageLog.findMany({ where: { tenant_id: tenantId, status: 'SUCCESS' } }),
      prisma.walletTransaction.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        take: 5
      }),
      prisma.activityLog.findFirst({
        where: { customer: { tenant_id: tenantId } },
        orderBy: { created_at: 'desc' }
      })
    ]);
     console.log("Success");
  } catch(e) {
     console.error("Prisma error:", e);
  } finally {
     await prisma.$disconnect();
  }
}
test();
