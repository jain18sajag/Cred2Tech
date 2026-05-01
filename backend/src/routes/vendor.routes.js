const express = require('express');
const { getVendors, updateVendor, updateVendorSlabs } = require('../controllers/admin.vendor.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

// All vendor management routes are restricted to SUPER_ADMIN
router.use(authenticate);
router.use(requireRole('SUPER_ADMIN'));

router.get('/', getVendors);
router.put('/:id', updateVendor);
router.put('/:id/slabs', updateVendorSlabs);

module.exports = router;
