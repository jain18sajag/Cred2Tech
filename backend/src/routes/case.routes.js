const express = require('express');
const router = express.Router();
const caseController = require('../controllers/case.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Apply authentication and RBAC to all case routes
router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN'));

// GET /cases
router.get('/', caseController.getCases);

// Drilldown Views
router.get('/:id/summary', caseController.getSummary);
router.get('/:id/co-borrowers', caseController.getCoBorrowers);
router.get('/:id/activity-log', caseController.getActivityLog);

// GET /cases/:id
router.get('/:id', caseController.getCaseById);

// POST /cases/create
router.post('/create', caseController.createCase);

// POST /cases/:id/add-applicant
router.post('/:id/add-applicant', caseController.addApplicant);

// PATCH /cases/:id/product  (legacy — kept for backward compat)
router.patch('/:id/product', caseController.updateProduct);

// PUT /cases/:id/product-property  (Phase 1 — saves product + property in one call)
router.put('/:id/product-property', caseController.updateProductProperty);

module.exports = router;
