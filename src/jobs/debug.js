const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debug() {
  const cases = await prisma.case.findMany({ where: { id: { in: [191, 192, 193, 195] } } });
  console.log('Cases:', cases);
  await prisma.$disconnect();
}
debug();
