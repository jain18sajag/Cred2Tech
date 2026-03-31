const express = require('express');
const { createTenant, getTenants, updateTenantStatus } = require('../controllers/tenant.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.post('/', authenticate, requireRole('SUPER_ADMIN'), createTenant);
router.get('/', authenticate, requireRole('SUPER_ADMIN'), getTenants);
router.patch('/:id/status', authenticate, requireRole('SUPER_ADMIN'), updateTenantStatus);

module.exports = router;
