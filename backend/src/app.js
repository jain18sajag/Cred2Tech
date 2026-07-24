const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logger } = require('./logger');
const pinoHttp = require('pino-http');
const prisma = require('../config/db');

const app = express();
app.set('trust proxy', 1); // Trust the reverse proxy for accurate client IPs

// ── Request logging ──────────────────────────────────────────────────────────
app.use(pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
}));

// Secure backend HTTP headers using Helmet. CSP only affects browser-rendered
// HTML (this is a pure JSON API for every route except /api-docs, which gets
// its own, more permissive policy below since Swagger UI needs inline
// scripts/styles) — helmet's default policy is safe to enable app-wide.
app.use(helmet());

// CORS Policy Lockdown using env variables
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const allowAnyOrigin = allowedOrigins.includes('*');

// Matches ONLY a genuine http(s)://localhost[:port] or http(s)://127.0.0.1[:port]
// origin — not any string that merely contains the substring "localhost"
// (the old check would wrongly allow e.g. http://localhost.attacker.io).
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowsAnyLocalhostPort = allowedOrigins.some(o => LOCALHOST_ORIGIN_RE.test(o));

function isCorsOriginAllowed(origin) {
  if (!origin) return true;
  if (allowAnyOrigin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Dev convenience: any localhost port is allowed once at least one
  // localhost origin is configured, so new local frontend ports don't need
  // an .env change — but exact-match only, never substring.
  if (allowsAnyLocalhostPort && LOCALHOST_ORIGIN_RE.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin, allowedOrigins }, 'CORS blocked origin');
      callback(null, false);
    }
  },
  credentials: true
}));

const webhookRoutes = require('./routes/webhook.routes');
app.use('/api/webhooks', webhookRoutes);

// 20mb was an unnecessarily large default for a JSON API — file uploads go
// through multer (its own fileSize limit), not this JSON/urlencoded parser.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const crypto = require('crypto');

// /api-docs exposes the full API surface/schema and was previously reachable
// pre-auth by anyone. A JWT Bearer check doesn't work here (browsers can't
// attach an Authorization header on a plain navigation to the URL), so this
// gates it with HTTP Basic Auth instead — fails closed (blocks entirely) if
// SWAGGER_DOCS_USER/PASSWORD aren't configured, rather than falling open.
function swaggerBasicAuth(req, res, next) {
  const expectedUser = process.env.SWAGGER_DOCS_USER;
  const expectedPass = process.env.SWAGGER_DOCS_PASSWORD;
  if (!expectedUser || !expectedPass) {
    return res.status(503).json({ error: 'API docs are not available (SWAGGER_DOCS_USER/PASSWORD not configured).' });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const userBuf = Buffer.from(String(user || ''));
    const passBuf = Buffer.from(String(pass || ''));
    const expectedUserBuf = Buffer.from(expectedUser);
    const expectedPassBuf = Buffer.from(expectedPass);
    const userMatches = userBuf.length === expectedUserBuf.length && crypto.timingSafeEqual(userBuf, expectedUserBuf);
    const passMatches = passBuf.length === expectedPassBuf.length && crypto.timingSafeEqual(passBuf, expectedPassBuf);
    if (userMatches && passMatches) return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="API Docs"');
  return res.status(401).json({ error: 'Authentication required to view API docs.' });
}

try {
  const swaggerDocument = JSON.parse(fs.readFileSync('./docs/swagger.json', 'utf8'));
  // Swagger UI's bundled assets need inline scripts/styles — scope a more
  // permissive CSP to just this route rather than weakening the app-wide default.
  const swaggerCsp = helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  });
  app.use('/api-docs', swaggerBasicAuth, swaggerCsp, swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  console.log("Swagger UI mounted cleanly at /api-docs (behind Basic Auth)");
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
const loanApplicationSummaryRoutes = require('./routes/loanApplicationSummary.routes');

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

// Conservative default for every route not covered by a more specific
// limiter below — previously only login/OTP/upload had any limit at all.
const defaultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});

const apiRouter = express.Router();
apiRouter.use(defaultLimiter);

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
apiRouter.use('/loan-application-summary', loanApplicationSummaryRoutes);
apiRouter.use('/msme/auth', directCustomerAuthRoutes);
apiRouter.use('/msme', directCustomerRoutes);
apiRouter.use('/admin/msme-cases', adminDirectCustomerRoutes);

app.use('/api', apiRouter);

app.use((err, req, res, next) => {
  logger.error({ err }, 'request handler error');
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

const seedLendersIfMissing = require('./utils/seed_lenders');
const seedDataMatrix = require('./utils/seed_matrix');

// seedLendersIfMissing().then(() => {
//    seedDataMatrix();
// });

module.exports = app;
module.exports.seedRolesIfMissing = seedRolesIfMissing;
module.exports.seedMsmePricing = seedMsmePricing;
