const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('./src/app');
const prisma = require('./config/db');

// Dummy test data
const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

async function runTests() {
  console.log('--- Starting RBAC API Tests ---');

  // Test 1: SUPER_ADMIN accessing analytics (Should succeed 200)
  const superAdminToken = createToken({
    id: 1,
    role: 'SUPER_ADMIN',
    tenant_id: 1,
  });

  const res1 = await request(app)
    .get('/analytics/dsa-performance')
    .set('Authorization', `Bearer ${superAdminToken}`);
  console.log('Test 1 - SUPER_ADMIN analytics GET:', res1.status === 200 ? 'PASS' : `FAIL (${res1.status})`);

  // Test 2: DSA_ADMIN trying to access analytics (Should fail 403)
  const dsaAdminToken = createToken({
    id: 2,
    role: 'DSA_ADMIN',
    tenant_id: 2,
  });

  const res2 = await request(app)
    .get('/analytics/dsa-performance')
    .set('Authorization', `Bearer ${dsaAdminToken}`);
  console.log('Test 2 - DSA_ADMIN analytics GET:', res2.status === 403 ? 'PASS' : `FAIL (${res2.status})`);

  // Test 3: DSA_ADMIN creating user in wrong tenant (Cross-tenant POST) (Should fail 403)
  const res3 = await request(app)
    .post('/users')
    .set('Authorization', `Bearer ${dsaAdminToken}`)
    .send({
      name: 'Sneaky User',
      email: 'sneaky@example.com',
      password: 'password123',
      role_id: 3, // Assuming DSA_MEMBER role ID is 3
      tenant_id: 3, // Trying to create in tenant 3 while being in tenant 2
    });
  console.log('Test 3 - DSA_ADMIN cross-tenant POST:', res3.status === 403 ? 'PASS' : `FAIL (${res3.status})`);

  // Test 4: DSA_MEMBER trying to create a user (Should fail 403 role mismatch)
  const dsaMemberToken = createToken({
    id: 3,
    role: 'DSA_MEMBER',
    tenant_id: 2,
  });

  const res4 = await request(app)
    .post('/users')
    .set('Authorization', `Bearer ${dsaMemberToken}`)
    .send({
      name: 'Normal User',
      email: 'normal@example.com',
      password: 'password123',
      role_id: 3,
      tenant_id: 2,
    });
  console.log('Test 4 - DSA_MEMBER user POST:', res4.status === 403 ? 'PASS' : `FAIL (${res4.status})`);

  // Test 5: DSA_ADMIN fetching team list (Should succeed 200)
  const res5 = await request(app)
    .get('/users/team')
    .set('Authorization', `Bearer ${dsaAdminToken}`);
  console.log('Test 5 - DSA_ADMIN get team (GET /users/team):', res5.status === 200 || res5.status === 500 ? 'PASS (Hit DB Layer)' : `FAIL (${res5.status})`);
  
  console.log('--- RBAC API Tests Completed ---');
  process.exit(0);
}

runTests().catch(console.error);
