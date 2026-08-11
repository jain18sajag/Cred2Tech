const express = require('express');
const router = express.Router();
const adminPurgeController = require('../controllers/adminPurge.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
// Manual data purge (right-to-erasure / early-deletion requests) — Cred2Tech's
// own internal admin only, never DSA_ADMIN (an external partner/channel role).
router.use(requireRole('SUPER_ADMIN'));

router.get('/case/:caseId', adminPurgeController.getStatus);
router.post('/case/:caseId', adminPurgeController.purgeCase);

module.exports = router;
