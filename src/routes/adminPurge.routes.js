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
// Permanent, irreversible full-case deletion — every related row across
// every table, plus storage files. Deliberately its own route/verb rather
// than folded into purgeCase above, so it can never be reached by accident.
router.delete('/case/:caseId/hard-delete', adminPurgeController.hardDeleteCase);

module.exports = router;
