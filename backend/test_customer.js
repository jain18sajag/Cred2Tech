const prisma = require('./config/db');

async function test() {
  try {
     const customerId = 8;
     const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
         cases: { orderBy: { created_at: 'desc' }, include: { applicants: true } },
         activity_logs: { orderBy: { created_at: 'desc' }, include: { user: true } },
         api_logs: true
      }
    });
    console.log(customer ? "Found" : "Not Found", customer);
  } catch(e) {
    console.error("Prisma error:", e);
  } finally {
     await prisma.$disconnect();
  }
}
test();
