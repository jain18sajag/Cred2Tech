const express = require('express');
const router = express.Router();
const salesIncentiveController = require('../controllers/salesIncentive.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN'));

// Rule Configuration
router.get('/config', salesIncentiveController.getRules);
router.post('/config', salesIncentiveController.createRule);
router.put('/config/:id', salesIncentiveController.updateRule);
router.delete('/config/:id', salesIncentiveController.deleteRule);

// Employees and their applicable incentives
router.get('/employees', salesIncentiveController.getEmployeesConfig);

// Incentives / Payouts Management
router.get('/payouts', salesIncentiveController.getPayouts);
router.post('/calculate', salesIncentiveController.calculateIncentives);
router.post('/payouts/:id/status', salesIncentiveController.updatePayoutStatus);

module.exports = router;
