const express = require('express');
const router = express.Router();
const dsaWalletController = require('../controllers/dsa.wallet.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'));

router.get('/balance', dsaWalletController.getBalance);
router.get('/transactions', dsaWalletController.getTransactions);
router.get('/api-usage-history', dsaWalletController.getUsageHistory);
router.get('/api-costs', dsaWalletController.getApiCosts);

// Razorpay Top-ups
router.post('/topups/create-order', dsaWalletController.createOrder);
router.post('/topups/verify-checkout', dsaWalletController.verifyCheckout);
router.get('/topups', dsaWalletController.getTopups);
router.post('/topups/:id/cancel', dsaWalletController.cancelTopup);

// Wallet Overview & Employee Allocation
router.get('/summary', dsaWalletController.getWalletSummary);
router.get('/employees', dsaWalletController.getEmployees);
// Non-admin DSA_MEMBER/SUB_DSA staff could otherwise move the tenant wallet
// balance into any employee's wallet (incl. their own) — restrict to admins.
router.post('/employees/:userId/allocate', requireRole('DSA_ADMIN'), dsaWalletController.allocateEmployeeCredits);
router.post('/employees/:userId/revoke', requireRole('DSA_ADMIN'), dsaWalletController.revokeEmployeeCredits);
router.get('/employees/:userId/transactions', dsaWalletController.getEmployeeTransactions);

module.exports = router;
