const express = require('express');
const router = express.Router();
const caseController = require('../controllers/case.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const upload = require('../middleware/upload.middleware');
const enforceMsmeCaseOwnership = require('../middleware/msmeCaseOwnership.middleware');
const { requireCaseAccess } = require('../middleware/caseAccess.middleware');

// Apply authentication and RBAC to all case routes
router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA', 'MSME_CUSTOMER'));
router.use(enforceMsmeCaseOwnership);
router.use(requireCaseAccess);

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

router.get('/:id/loan-application-summary.xlsx', caseController.downloadLoanApplicationSummary);

// GET /cases/:id
router.get('/:id', caseController.getCaseById);
router.get('/:id/pull-statuses', caseController.getPullStatuses);

// POST /cases/create
router.post('/create', caseController.createCase);
router.post('/create-from-existing', caseController.createFromExisting);

// POST /cases/bulk-legacy-upload
// Lets the caller set cibil_score/bureau scores/ESR financials directly and
// marks the case as already ESR-generated — restricted to trusted migration
// roles only (was reachable by MSME_CUSTOMER/DSA_MEMBER via the router-level
// gate above, letting a customer fabricate their own creditworthiness).
const legacyUploadController = require('../controllers/legacyUpload.controller');
router.post('/bulk-legacy-upload', requireRole('DSA_ADMIN', 'SUPER_ADMIN'), legacyUploadController.bulkUploadLegacyCases);

// GET /cases/bulk-upload/template
// POST /cases/bulk-upload
// Restricted to DSA/staff roles for the same reason as bulk-legacy-upload
// above — this creates arbitrary customers/cases (with arbitrary PANs) from
// an uploaded spreadsheet and auto-runs ESR. It was reachable by
// MSME_CUSTOMER via the router-level gate, letting a single self-service
// customer mass-create case/customer records for other people's PANs.
router.get('/bulk-upload/template', requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA', 'SUPER_ADMIN'), caseController.downloadBulkTemplate);
router.post('/bulk-upload', requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA', 'SUPER_ADMIN'), upload.single('file'), caseController.uploadBulkCases);

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
const sseController = require('../controllers/sse.controller');
const salaryOcrController = require('../controllers/salaryOcr.controller');
const documentController = require('../controllers/document.controller');

// Upload a salary slip
router.post('/:caseId/applicants/:applicantId/salary-slips', upload.single('file'), documentController.uploadDocument);

// Trigger OCR on a specific salary slip
router.post('/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr', salaryOcrController.triggerSalarySlipOcr);

// Remove an uploaded salary slip
router.delete('/:caseId/applicants/:applicantId/salary-slips/:documentId', salaryOcrController.deleteSalarySlip);

// Add manual salary entry
router.post('/:caseId/applicants/:applicantId/salary-slips/manual', salaryOcrController.addManualSalaryEntry);

// Trigger OCR batch for multiple salary slips
router.post('/:caseId/applicants/:applicantId/salary-slips/ocr-batch', salaryOcrController.processSalarySlipOcrBatch);

// Poll async OCR status
router.post('/:caseId/applicants/:applicantId/salary-slips/:documentId/ocr/poll', salaryOcrController.pollSalarySlipOcr);

// Get salary summary for a case
router.get('/:caseId/salary-summary', salaryOcrController.getSalarySummary);

// SSE Financial Status Endpoints
router.get('/:caseId/pull-statuses', sseController.getPullStatuses);
router.get('/:caseId/pull-status-stream', sseController.getPullStatusStream);

// DSA Case Allocation
router.post('/:id/allocate-dsa-user', requireRole('DSA_ADMIN'), caseController.allocateDsaUser);

module.exports = router;
