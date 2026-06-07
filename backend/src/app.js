const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');

const app = express();
app.set('trust proxy', 1); // Trust the reverse proxy for accurate client IPs

// Secure backend HTTP headers using Helmet (with CSP disabled for API-frontend routing compatibility)
// TODO: Review and enable CSP policies in production if client hosts scripts directly
app.use(helmet({ contentSecurityPolicy: false }));

// CORS Policy Lockdown using env variables
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(o => {
      const allowedUrl = o.trim();
      return origin === allowedUrl || (allowedUrl.includes('localhost') && origin.includes('localhost'));
    });
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS: Origin not allowed'));
    }
  },
  credentials: true
}));

const webhookRoutes = require('./routes/webhook.routes');
app.use('/api/webhooks', webhookRoutes);

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
const documentRoutes = require('./routes/document.routes');
const onboardingRoutes       = require('./routes/onboarding.routes');
const tenantLenderRoutes     = require('./routes/tenantLender.routes');
const tenantLenderContactRoutes = require('./routes/tenantLenderContacts.routes');
const platformLenderRoutes = require('./routes/platformLender.routes');
const vendorRoutes = require('./routes/vendor.routes');
const commissionRoutes = require('./routes/lenderCommission.routes');
const commissionOperationsRoutes = require('./routes/commissionOperations.routes');
const disbursementRoutes = require('./routes/disbursement.routes');
const pddRoutes = require('./routes/pdd.routes');
const subDsaPayoutRoutes = require('./routes/subDsaPayout.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const salesIncentiveRoutes = require('./routes/salesIncentive.routes');

// Rate Limiting Middlewares
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 attempts per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' }
});

const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // Limit each IP to 3 requests per 10 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests from this IP, please try again after 10 minutes.' }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // Limit each IP to 5 attempts per 10 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP verification attempts from this IP, please try again after 10 minutes.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 uploads per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many file uploads from this IP, please try again after 15 minutes.' }
});

const apiRouter = express.Router();

// Apply global rate limiting to all API requests
apiRouter.use(globalLimiter);

// Specific rate limiters for sensitive endpoints
apiRouter.use('/auth/login', loginLimiter);
apiRouter.use('/otp/send', otpSendLimiter);
apiRouter.use('/otp/verify', otpVerifyLimiter);
apiRouter.use('/documents/upload', uploadLimiter);
apiRouter.use('/cases/:caseId/applicants/:applicantId/salary-slips', uploadLimiter);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/tenants', tenantRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/roles', roleRoutes);
apiRouter.use('/customers', customerRoutes);
apiRouter.use('/cases', caseRoutes);
apiRouter.use('/otp', otpRoutes);
apiRouter.use('/wallet', dsaWalletRoutes);
apiRouter.use('/admin/wallet', adminWalletRoutes);
apiRouter.use('/admin/api-logs', adminApiLogsRoutes);
apiRouter.use('/admin/tenants', adminTenantRoutes);
apiRouter.use('/admin/vendors', vendorRoutes);
apiRouter.use('/admin/lenders', adminLenderRoutes);
apiRouter.use('/lender-commission', commissionRoutes);
apiRouter.use('/commission-operations', commissionOperationsRoutes);
apiRouter.use('/external', externalApiRoutes);
apiRouter.use('/verification', bureauRoutes);
apiRouter.use('/documents', documentRoutes);
// Phase 1 onboarding: income, obligations, ESR — mounted under /api/cases/:id/
apiRouter.use('/cases/:id', onboardingRoutes);

// Tenant-scoped lender contact configuration (DSA only)
apiRouter.use('/tenant/lenders', tenantLenderRoutes);
apiRouter.use('/tenant/lender-contacts', tenantLenderContactRoutes);
apiRouter.use('/platform-lenders', platformLenderRoutes);
apiRouter.use('/disbursements', disbursementRoutes);
apiRouter.use('/pdd-tasks', pddRoutes);
apiRouter.use('/sub-dsa', subDsaPayoutRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/sales-incentives', salesIncentiveRoutes);

app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Seed canonical roles on startup (idempotent — safe to run every restart)
const CANONICAL_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'];

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

const seedLendersIfMissing = require('./utils/seed_lenders');
const seedDataMatrix = require('./utils/seed_matrix');

// seedLendersIfMissing().then(() => {
//    seedDataMatrix();
// });

module.exports = app;
