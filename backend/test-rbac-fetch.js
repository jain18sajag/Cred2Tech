const { generateToken } = require('./src/utils/jwt');
const app = require('./src/app');
const http = require('http');
const prisma = require('./config/db');

async function cleanupDb() {
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});
  await prisma.role.deleteMany({});
}

async function seedDb() {
  console.log('--- Seeding Roles ---');
  const superAdminRole = await prisma.role.create({ data: { name: 'SUPER_ADMIN' } });
  const dsaAdminRole = await prisma.role.create({ data: { name: 'DSA_ADMIN' } });
  const credMemberRole = await prisma.role.create({ data: { name: 'CRED2TECH_MEMBER' } });
  const dsaMemberRole = await prisma.role.create({ data: { name: 'DSA_MEMBER' } });

  console.log('--- Seeding Tenants ---');
  const credTenant = await prisma.tenant.create({
    data: {
      name: 'Cred2Tech Platform',
      email: 'admin@cred2tech.com',
      type: 'CRED2TECH'
    }
  });

  const dsaTenant1 = await prisma.tenant.create({
    data: {
      name: 'Alpha DSA',
      email: 'admin@alphadsa.com',
      type: 'DSA'
    }
  });

  const dsaTenant2 = await prisma.tenant.create({
    data: {
      name: 'Beta DSA',
      email: 'admin@betadsa.com',
      type: 'DSA'
    }
  });

  return {
    superAdminRole: superAdminRole.id,
    dsaAdminRole: dsaAdminRole.id,
    dsaMemberRole: dsaMemberRole.id,
    credTenant: credTenant.id,
    dsaTenant1: dsaTenant1.id,
    dsaTenant2: dsaTenant2.id
  };
}

const server = http.createServer(app);

server.listen(3001, async () => {
  console.log('--- Starting RBAC API Tests on port 3001 ---');

  try {
    await cleanupDb();
    const ids = await seedDb();

    console.log('--- Generating JWT Tokens ---');
    
    // Create actual admin user for JWT to match DB
    const superAdminUser = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: 'superadmin@example.com',
        password_hash: 'hashed',
        role_id: ids.superAdminRole,
        tenant_id: ids.credTenant
      }
    });
    const superAdminToken = generateToken({ id: superAdminUser.id });

    const dsaAdminUser = await prisma.user.create({
      data: {
        name: 'DSA Admin 1',
        email: 'dsaadmin1@example.com',
        password_hash: 'hashed',
        role_id: ids.dsaAdminRole,
        tenant_id: ids.dsaTenant1
      }
    });
    const dsaAdminToken = generateToken({ id: dsaAdminUser.id });

    const dsaMemberUser = await prisma.user.create({
      data: {
        name: 'DSA Member 1',
        email: 'dsamember1@example.com',
        password_hash: 'hashed',
        role_id: ids.dsaMemberRole,
        tenant_id: ids.dsaTenant1
      }
    });
    const dsaMemberToken = generateToken({ id: dsaMemberUser.id });

    // Test 1: SUPER_ADMIN accessing analytics (Should succeed 200)
    console.log('\n[Test 1] SUPER_ADMIN fetching analytics GET /analytics/dsa-performance');
    const res1 = await fetch('http://localhost:3001/analytics/dsa-performance', {
      headers: { 'Authorization': `Bearer ${superAdminToken}` }
    });
    console.log('Status:', res1.status, res1.status === 200 ? '✅ PASS' : '❌ FAIL');

    // Test 2: DSA_ADMIN trying to access analytics (Should fail 403)
    console.log('\n[Test 2] DSA_ADMIN fetching analytics GET /analytics/dsa-performance');
    const res2 = await fetch('http://localhost:3001/analytics/dsa-performance', {
      headers: { 'Authorization': `Bearer ${dsaAdminToken}` }
    });
    console.log('Status:', res2.status, res2.status === 403 ? '✅ PASS' : '❌ FAIL');

    // Test 3: DSA_ADMIN cross-tenant POST (Should fail 403)
    console.log('\n[Test 3] DSA_ADMIN cross-tenant POST /users');
    const res3 = await fetch('http://localhost:3001/users', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${dsaAdminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Sneaky User',
        email: 'sneaky@example.com',
        password: 'password123',
        role_id: ids.dsaMemberRole,
        tenant_id: ids.dsaTenant2 // Requesting tenant 2 but admin is tenant 1
      })
    });
    console.log('Status:', res3.status, res3.status === 403 ? '✅ PASS' : '❌ FAIL');

    // Test 4: DSA_MEMBER creating user (Should fail 403 role mismatch)
    console.log('\n[Test 4] DSA_MEMBER user POST /users');
    const res4 = await fetch('http://localhost:3001/users', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${dsaMemberToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Normal User',
        email: 'normal@example.com',
        password: 'password123',
        role_id: ids.dsaMemberRole,
        tenant_id: ids.dsaTenant1
      })
    });
    console.log('Status:', res4.status, res4.status === 403 ? '✅ PASS' : '❌ FAIL');

    // Test 5: DSA_ADMIN fetches GET /users (Should fetch only own tenant isolation)
    console.log('\n[Test 5] DSA_ADMIN fetches GET /users');
    const res5 = await fetch('http://localhost:3001/users', {
      headers: { 'Authorization': `Bearer ${dsaAdminToken}` }
    });
    const users = await res5.json();
    const isolated = users.every(u => u.tenant_id === ids.dsaTenant1);
    console.log('Status:', res5.status, (res5.status === 200 && isolated) ? '✅ PASS (Isolated results)' : '❌ FAIL');

  } catch (err) {
    console.error('Test Execution Error:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
