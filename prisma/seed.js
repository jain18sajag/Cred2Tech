const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // 1. Seed Roles
  const roles = ['ADMIN', 'DSA', 'EMPLOYEE', 'PARTNER', 'MSME'];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }
  console.log('Roles seeded.');

  // Fetch created roles to get their IDs
  const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });
  const dsaRole = await prisma.role.findUnique({ where: { name: 'DSA' } });
  const employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });

  // 2. Seed DSA Account
  const dsaAccount = await prisma.dsaAccount.upsert({
    where: { email: 'dsa@company.com' },
    update: {},
    create: {
      name: 'Test DSA Company',
      email: 'dsa@company.com',
      mobile: '1234567890',
    },
  });
  console.log('DSA Account seeded.');

  // Common password for all seeded users
  const saltRounds = 10;
  const commonPasswordHash = await bcrypt.hash('password123', saltRounds);

  // 3. Seed Users
  // a. Admin User
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@platform.com' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@platform.com',
      password_hash: commonPasswordHash,
      role_id: adminRole.id,
      hierarchy_path: '/',
    },
  });
  console.log('Admin user seeded: admin@platform.com (password: password123)');

  // b. DSA Admin User (belongs to the test DSA)
  const dsaUser = await prisma.user.upsert({
    where: { email: 'admin@dsacompany.com' },
    update: {},
    create: {
      name: 'DSA Administrator',
      email: 'admin@dsacompany.com',
      password_hash: commonPasswordHash,
      role_id: dsaRole.id,
      dsa_id: dsaAccount.id,
      hierarchy_path: '/',
    },
  });
  console.log('DSA admin seeded: admin@dsacompany.com (password: password123)');

  // c. Employee L1 User (Manager)
  const employeeL1 = await prisma.user.upsert({
    where: { email: 'manager_l1@dsacompany.com' },
    update: {},
    create: {
      name: 'L1 Manager',
      email: 'manager_l1@dsacompany.com',
      password_hash: commonPasswordHash,
      role_id: employeeRole.id,
      dsa_id: dsaAccount.id,
      hierarchy_level: 'L1',
    },
  });

  // Calculate and update hierarchy path for L1
  await prisma.user.update({
    where: { id: employeeL1.id },
    data: { hierarchy_path: `/${employeeL1.id}/` }
  });
  console.log('L1 Employee seeded: manager_l1@dsacompany.com (password: password123)');

  // d. Employee L2 User (Reports to L1)
  const employeeL2 = await prisma.user.upsert({
    where: { email: 'employee_l2@dsacompany.com' },
    update: {},
    create: {
      name: 'L2 Employee',
      email: 'employee_l2@dsacompany.com',
      password_hash: commonPasswordHash,
      role_id: employeeRole.id,
      dsa_id: dsaAccount.id,
      hierarchy_level: 'L2',
      manager_id: employeeL1.id,
    },
  });

  // Calculate and update hierarchy path for L2 starting with L1's path
  await prisma.user.update({
    where: { id: employeeL2.id },
    data: { hierarchy_path: `/${employeeL1.id}/${employeeL2.id}/` }
  });
  console.log('L2 Employee seeded: employee_l2@dsacompany.com (password: password123)');

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
