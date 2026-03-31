const prisma = require('./config/db');

async function check() {
  const users = await prisma.user.findMany({ include: { tenant: true } });
  console.log(users.map(u => ({ name: u.name, tenantType: u.tenant.type })));
}

check().finally(() => prisma.$disconnect());
