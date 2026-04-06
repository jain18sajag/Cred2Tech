const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customer.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Apply authentication and RBAC to all customer routes
router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN'));

// GET /customers/check-existing-by-pan
router.get('/check-existing-by-pan', customerController.checkCustomer);

// POST /customers/create-or-attach
router.post('/create-or-attach', customerController.createOrAttach);

// Drilldowns
router.get('/:customer_id/profile', customerController.getProfile);
router.get('/:customer_id/api-availability', customerController.getApiAvailability);

module.exports = router;
