const express = require('express');
const router = express.Router();
const bureauController = require('../controllers/bureau.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);

router.post(
  '/bureau/run/:caseId',
  requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'DSA_MEMBER'),
  bureauController.runBureauVerification
);

module.exports = router;
