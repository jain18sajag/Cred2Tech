const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { ADMIN_ROLES } = require('../services/ticket.service');
const caseFeedbackController = require('../controllers/caseFeedback.controller');

// Same roles that are allowed to record a disbursement (see case.routes.js) —
// only a DSA who could actually trigger the PARTLY_DISBURSED/DISBURSED
// transition can submit journey feedback for it.
const SUBMITTER_ROLES = ['DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'];

router.use(authenticate);

router.post('/', requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), caseFeedbackController.submit);
router.get('/', requireRole(...ADMIN_ROLES), caseFeedbackController.listForAdmin);

module.exports = router;
