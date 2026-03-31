const express = require('express');
const { getDsaPerformance } = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.get('/dsa-performance', authenticate, requireRole('SUPER_ADMIN'), getDsaPerformance);

module.exports = router;
