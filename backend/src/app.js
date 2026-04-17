const express = require('express');
const cors = require('cors');
const prisma = require('../config/db');

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const swaggerUi = require('swagger-ui-express');
const fs = require('fs');

try {
  const swaggerDocument = JSON.parse(fs.readFileSync('./docs/swagger.json', 'utf8'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log("Swagger UI mounted cleanly at /api-docs");
} catch (e) {
  console.log("Swagger JSON not found at ./docs/swagger.json. Run node scripts/generate_swagger.js");
}

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the platform APIs' });
});

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const tenantRoutes = require('./routes/tenant.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const roleRoutes = require('./routes/role.routes');
const customerRoutes = require('./routes/customer.routes');
const caseRoutes = require('./routes/case.routes');
const otpRoutes = require('./routes/otp.routes');
const dsaWalletRoutes = require('./routes/dsa.wallet.routes');
const adminWalletRoutes = require('./routes/admin.wallet.routes');
const adminApiLogsRoutes = require('./routes/adminApiLogs.routes');
const adminTenantRoutes = require('./routes/admin.tenant.routes');
const adminLenderRoutes = require('./routes/admin.lender.routes');
const externalApiRoutes = require('./routes/externalApi.routes');
const bureauRoutes = require('./routes/bureau.routes');

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/tenants', tenantRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/roles', roleRoutes);
app.use('/customers', customerRoutes);
app.use('/cases', caseRoutes);
app.use('/otp', otpRoutes);
app.use('/wallet', dsaWalletRoutes);
app.use('/admin/wallet', adminWalletRoutes);
app.use('/admin/api-logs', adminApiLogsRoutes);
app.use('/admin/tenants', adminTenantRoutes);
app.use('/admin/lenders', adminLenderRoutes);
app.use('/external', externalApiRoutes);
app.use('/verification', bureauRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Seed canonical roles on startup (idempotent — safe to run every restart)
const CANONICAL_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN', 'DSA_MEMBER'];

async function seedRolesIfMissing() {
  try {
    const count = await prisma.role.count();
    if (count === 0) {
      console.log('[startup] Roles table empty — seeding canonical roles...');
    }
    for (const name of CANONICAL_ROLES) {
      await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    }
    console.log('[startup] Roles verified:', CANONICAL_ROLES.join(', '));
  } catch (err) {
    console.error('[startup] Failed to seed roles:', err.message);
  }
}

seedRolesIfMissing();

module.exports = app;
