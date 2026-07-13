const express = require('express');
const router = express.Router();
const commissionOperationsController = require('../controllers/commissionOperations.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);

// GET /api/commission-operations/sales-incentives
router.get(
    '/sales-incentives',
    requireRole('DSA_ADMIN', 'DSA_MEMBER'),
    commissionOperationsController.getSalesIncentives
);

// --- LENDER COMMISSION ROUTES ---

// GET /api/commission-operations/lender-commission
router.get(
    '/lender-commission',
    requireRole('DSA_ADMIN'),
    commissionOperationsController.getLenderCommissions
);

// GET /api/commission-operations/lender-commission/invoice-candidates
router.get(
    '/lender-commission/invoice-candidates',
    requireRole('DSA_ADMIN'),
    commissionOperationsController.getInvoiceCandidates
);

// POST /api/commission-operations/lender-commission/preview-invoice
router.post(
    '/lender-commission/preview-invoice',
    requireRole('DSA_ADMIN'),
    commissionOperationsController.previewInvoice
);

// PATCH /api/commission-operations/lender-commission/:ledgerId/status
router.patch(
    '/lender-commission/:ledgerId/status',
    requireRole('DSA_ADMIN'),
    commissionOperationsController.updateLedgerStatus
);

// POST /api/commission-operations/lender-commission/sync-missing
router.post(
    '/lender-commission/sync-missing',
    requireRole('DSA_ADMIN'),
    commissionOperationsController.syncMissingLenderCommissions
);

module.exports = router;
