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
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.some(allowedUrl =>
      origin === allowedUrl || (allowedUrl.includes('localhost') && origin.includes('localhost'))
    );
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin} | Allowed: ${allowedOrigins.join(', ')}`);
      callback(null, false);
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

// Liveness + release identity. Used by the CI/CD pipeline for the post-deploy
// health check AND version verification (confirms PM2 is serving THIS release,
// not stale code). version.json is written into the release root by Jenkins; in
// local dev it's absent and we report 'dev'. Intentionally does NOT touch the DB
// so a transient DB blip can never trip a false rollback.
app.get('/health', (req, res) => {
  let version = { release: 'dev', commit: 'unknown', build: 'local' };
  try {
    version = JSON.parse(
      fs.readFileSync(require('path').join(__dirname, '..', 'version.json'), 'utf8'),
    );
  } catch (_) { /* version.json only exists in CI-built releases */ }
  res.status(200).json({ status: 'ok', ...version });
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
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 failed login attempts per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
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

const directCustomerAuthRoutes = require('./routes/direct.customer.auth.routes');
const directCustomerRoutes = require('./routes/direct.customer.routes');
const adminDirectCustomerRoutes = require('./routes/admin.direct.customer.routes');

// Tenant-scoped lender contact configuration (DSA only)
apiRouter.use('/tenant/lenders', tenantLenderRoutes);
apiRouter.use('/tenant/lender-contacts', tenantLenderContactRoutes);
apiRouter.use('/platform-lenders', platformLenderRoutes);
apiRouter.use('/disbursements', disbursementRoutes);
apiRouter.use('/pdd-tasks', pddRoutes);
apiRouter.use('/sub-dsa', subDsaPayoutRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/sales-incentives', salesIncentiveRoutes);
apiRouter.use('/msme/auth', directCustomerAuthRoutes);
apiRouter.use('/msme', directCustomerRoutes);
apiRouter.use('/admin/msme-cases', adminDirectCustomerRoutes);

app.use((req, res, next) => { if (req.url.includes('clone')) require('fs').appendFileSync('clone_debug.json', new Date() + ' ' + req.method + ' ' + req.url + '\n'); next(); });
app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Seed canonical roles on startup (idempotent — safe to run every restart)
const CANONICAL_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA', 'MSME_CUSTOMER'];

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

async function seedMsmePricing() {
  try {
    await prisma.apiPricing.upsert({
      where: { api_code: 'DIRECT_MSME_ELIGIBILITY' },
      update: {},
      create: {
        api_code: 'DIRECT_MSME_ELIGIBILITY',
        api_name: 'Direct MSME Eligibility Assessment',
        description: 'One-time fee for individual MSME customers to run eligibility check and get lender recommendations',
        vendor_cost: 0,
        default_credit_cost: 99900,
        is_active: true,
      }
    });
    console.log('[startup] MSME Pricing seeded');
  } catch (err) {
    console.error('[startup] Failed to seed MSME Pricing:', err.message);
  }
}

seedRolesIfMissing();
seedMsmePricing();

const seedLendersIfMissing = require('./utils/seed_lenders');
const seedDataMatrix = require('./utils/seed_matrix');

// seedLendersIfMissing().then(() => {
//    seedDataMatrix();
// });

module.exports = app;
