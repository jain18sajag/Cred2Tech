const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const res = await prisma.lender.create({ data: { name: 'Test', code: 'TEST_1' }});
    console.log(res);
  } catch(e) {
    console.log(e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
