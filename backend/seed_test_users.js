const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding tests users...');
  
  // Create / Verify Tenants
  let credTenant = await prisma.tenant.findFirst({ where: { type: 'CRED2TECH' } });
  if (!credTenant) {
    credTenant = await prisma.tenant.create({
      data: {
        name: 'Cred2Tech Platform',
        email: 'platform@cred2tech.com',
        mobile: '9000000001',
        type: 'CRED2TECH',
        status: 'ACTIVE',
      }
    });
  }

  let dsaTenant = await prisma.tenant.findFirst({ where: { type: 'DSA' } });
  if (!dsaTenant) {
    dsaTenant = await prisma.tenant.create({
      data: {
        name: 'Test DSA Partners',
        email: 'admin@testdsa.com',
        mobile: '9000000002',
        type: 'DSA',
        status: 'ACTIVE',
      }
    });
  }

  const hash = await bcrypt.hash('password123', 10);

  // Roles
  const roles = ['SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER', 'DSA_MEMBER'];
  const roleMap = {};
  for (const r of roles) {
    const dbRole = await prisma.role.upsert({
      where: { name: r },
      update: {},
      create: { name: r }
    });
    roleMap[r] = dbRole.id;
  }

  // Users
  const usersToSeed = [
    { email: 'super@cred2tech.com', role_id: roleMap['SUPER_ADMIN'], tenant_id: credTenant.id, name: 'Super Admin' },
    { email: 'member@cred2tech.com', role_id: roleMap['CRED2TECH_MEMBER'], tenant_id: credTenant.id, name: 'Cred2Tech Member' },
    { email: 'admin@dsa.com', role_id: roleMap['DSA_ADMIN'], tenant_id: dsaTenant.id, name: 'DSA Admin' },
    { email: 'member@dsa.com', role_id: roleMap['DSA_MEMBER'], tenant_id: dsaTenant.id, name: 'DSA Member' },
  ];

  for (const u of usersToSeed) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { password_hash: hash, tenant_id: u.tenant_id, role_id: u.role_id, status: 'ACTIVE' },
      create: {
        email: u.email,
        name: u.name,
        password_hash: hash,
        role_id: u.role_id,
        tenant_id: u.tenant_id,
        status: 'ACTIVE',
        mobile: '1234567890'
      }
    });
  }

  console.log('Seed complete. Passwords are "password123"');
}

seed().catch(e => console.error(e)).finally(() => prisma.$disconnect());
