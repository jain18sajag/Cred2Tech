const express = require('express');
const cors = require('cors');
const prisma = require('../config/db');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the platform APIs' });
});

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const tenantRoutes = require('./routes/tenant.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const roleRoutes = require('./routes/role.routes');

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/tenants', tenantRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/roles', roleRoutes);

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
