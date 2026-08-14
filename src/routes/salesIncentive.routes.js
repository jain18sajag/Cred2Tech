const express = require('express');
const router = express.Router();
const salesIncentiveController = require('../controllers/salesIncentive.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);

// Rule Configuration
router.get('/config', requireRole('DSA_ADMIN'), salesIncentiveController.getRules);
router.post('/config', requireRole('DSA_ADMIN'), salesIncentiveController.createRule);
router.put('/config/:id', requireRole('DSA_ADMIN'), salesIncentiveController.updateRule);
router.delete('/config/:id', requireRole('DSA_ADMIN'), salesIncentiveController.deleteRule);

// Employees and their applicable incentives
router.get('/employees', requireRole('DSA_ADMIN'), salesIncentiveController.getEmployeesConfig);

// Incentives / Payouts Management
router.get('/payouts', requireRole('DSA_ADMIN', 'DSA_MEMBER'), salesIncentiveController.getPayouts);
router.post('/calculate', requireRole('DSA_ADMIN'), salesIncentiveController.calculateIncentives);
router.post('/payouts/:id/status', requireRole('DSA_ADMIN'), salesIncentiveController.updatePayoutStatus);
router.post('/config/:hierarchyLevel/sync-missing', requireRole('DSA_ADMIN'), salesIncentiveController.syncMissingIncentives);

module.exports = router;
