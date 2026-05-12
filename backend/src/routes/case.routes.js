const express = require('express');
const router = express.Router();
const caseController = require('../controllers/case.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// Apply authentication and RBAC to all case routes
router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN'));

// ─── Sanction & Disbursement Flow ──────────────────────────────────────────
const sanctionController = require('../controllers/sanction.controller');
const disbursementController = require('../controllers/disbursement.controller');

router.post('/:id/sanction', sanctionController.sanctionCase);
router.post('/:id/disbursements', disbursementController.recordDisbursement);
router.get('/:id/disbursements', disbursementController.getCaseSummary);

// Pipeline Route
router.get('/pipeline', caseController.getPipeline);
router.patch('/:id/stage', caseController.updateStage);
router.post('/:id/stage-rollback', caseController.rollbackStage);

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
router.post('/create-from-existing', caseController.createFromExisting);

// POST /cases/:id/add-applicant
router.post('/:id/add-applicant', caseController.addApplicant);

// POST /cases/:id/applicants/reuse
router.post('/:id/applicants/reuse', caseController.reuseApplicant);

// DELETE /cases/:id/applicants/:applicantId
router.delete('/:id/applicants/:applicantId', caseController.removeApplicant);

// PATCH /cases/:id/product  (legacy — kept for backward compat)
router.patch('/:id/product', caseController.updateProduct);

// PUT /cases/:id/product-property  (Phase 1 — saves product + property in one call)
router.put('/:id/product-property', caseController.updateProductProperty);

// ─── Salary Slip & OCR Endpoints ─────────────────────────────────────────────
const salaryOcrController = require('../controllers/salaryOcr.controller');
const documentController = require('../controllers/document.controller');
const upload = require('../middleware/upload.middleware');

// Upload a salary slip
router.post('/:caseId/applicants/:applicantId/salary-slips', upload.single('file'), documentController.uploadDocument);

// Trigger OCR on a specific salary slip
router.post('/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr', salaryOcrController.triggerSalarySlipOcr);

// Trigger OCR batch for multiple salary slips
router.post('/:caseId/applicants/:applicantId/salary-slips/ocr-batch', salaryOcrController.processSalarySlipOcrBatch);

// Poll async OCR status
router.post('/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr/poll', salaryOcrController.pollSalarySlipOcr);

// Get salary summary for a case
router.get('/:caseId/salary-summary', salaryOcrController.getSalarySummary);

module.exports = router;
