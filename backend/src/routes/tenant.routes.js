const express = require('express');
const { createTenant, getTenants, updateTenantStatus, publicRegisterDSA } = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

// ⚡ Public route — no auth required (DSA self-onboarding)
router.post('/public-register', publicRegisterDSA);

// Authenticated + role-gated routes
router.post('/', authenticate, requireRole('SUPER_ADMIN'), createTenant);
router.get('/', authenticate, requireRole('SUPER_ADMIN'), getTenants);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN'), updateTenantStatus);

module.exports = router;
