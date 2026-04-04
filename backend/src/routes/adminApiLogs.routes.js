const express = require('express');
const router = express.Router();
const adminApiLogsController = require('../controllers/adminApiLogs.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN')); 

router.get('/summary', adminApiLogsController.getLogsSummary);
router.get('/', adminApiLogsController.getApiLogs);
router.get('/:tenant_id', adminApiLogsController.getTenantLogs);

module.exports = router;
