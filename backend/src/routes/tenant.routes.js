const express = require('express');
const rateLimit = require('express-rate-limit');
const { createTenant, getTenants, updateTenantStatus, publicRegisterDSA, updateTenant } = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

// Unauthenticated, unlimited public tenant creation — a natural target for
// automated mass account creation (and chains with the mass-assignment fix
// elsewhere: an attacker who could self-register a DSA_ADMIN previously had
// a path toward unauth→SUPER_ADMIN). Rate-limited per IP; real CAPTCHA needs
// a provider key that isn't provisioned yet — see honeypot check below too.
const publicRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts from this network. Please try again later.' }
});

// ⚡ Public route — no auth required (DSA self-onboarding)
router.post('/public-register', publicRegisterLimiter, publicRegisterDSA);

// Authenticated + role-gated routes
router.post('/', authenticate, requireRole('SUPER_ADMIN'), createTenant);
router.get('/', authenticate, requireRole('SUPER_ADMIN'), getTenants);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN'), updateTenantStatus);
router.put('/:id', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN'), updateTenant);

module.exports = router;
