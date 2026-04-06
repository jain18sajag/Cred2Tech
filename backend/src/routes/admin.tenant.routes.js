const express = require('express');
const router = express.Router();
const adminTenantController = require('../controllers/admin.tenant.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN'));

router.get('/:tenant_id/summary', adminTenantController.getTenantSummary);

module.exports = router;
