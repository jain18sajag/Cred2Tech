const express = require('express');
const router = express.Router();
const pddController = require('../controllers/pdd.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
// `checkRole` was imported here previously but doesn't exist on
// role.middleware.js (only `requireRole` is exported) and was never actually
// wired into the route chain below — every authenticated user of any role
// could list/update post-disbursement document tasks. Matches the role set
// used on disbursement.routes.js (internal DSA-staff operations, not customer-facing).
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA'));

// List PDD tasks
router.get('/', pddController.getPddTasks);

// Update PDD status
router.patch('/:id/status', pddController.updateStatus);

module.exports = router;
