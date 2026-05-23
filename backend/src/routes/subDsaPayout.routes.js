// subDsaPayout.routes.js
// Routes for SubDSA payout management.
// DSA_ADMIN: full access. SUB_DSA: read-only on own payout records.

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/subDsaPayout.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);

// ── SubDSA user listing (Admin only) ────────────────────────────────────────
router.get('/users', requireRole('DSA_ADMIN'), ctrl.listSubDsaUsers);

// ── Payout Configuration (Admin only) ───────────────────────────────────────
router.get('/:userId/payout-config', requireRole('DSA_ADMIN'), ctrl.getPayoutConfig);
router.put('/:userId/payout-config', requireRole('DSA_ADMIN'), ctrl.upsertPayoutConfig);
router.post('/:userId/calculate', requireRole('DSA_ADMIN'), ctrl.previewPayout);

// ── Payout Ledger ────────────────────────────────────────────────────────────
// Both DSA_ADMIN and SUB_DSA can read — service enforces isolation for SUB_DSA
router.get('/payouts', requireRole('DSA_ADMIN', 'SUB_DSA'), ctrl.listPayouts);
router.get('/payouts/:id/history', requireRole('DSA_ADMIN', 'SUB_DSA'), ctrl.getPayoutHistory);

// Status transitions: Admin only
router.put('/payouts/:id/status', requireRole('DSA_ADMIN'), ctrl.updatePayoutStatus);

// ── Invoice Generation ───────────────────────────────────────────────────────
router.post('/invoices', requireRole('DSA_ADMIN'), ctrl.generateInvoice);

module.exports = router;
