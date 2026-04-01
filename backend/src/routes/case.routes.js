const express = require('express');
const router = express.Router();
const caseController = require('../controllers/case.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Apply authentication and RBAC to all case routes
router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER'));

// GET /cases
router.get('/', caseController.getCases);

// GET /cases/:id
router.get('/:id', caseController.getCaseById);

// POST /cases/create
router.post('/create', caseController.createCase);

// POST /cases/:id/add-applicant
router.post('/:id/add-applicant', caseController.addApplicant);

// PATCH /cases/:id/product
router.patch('/:id/product', caseController.updateProduct);

module.exports = router;
