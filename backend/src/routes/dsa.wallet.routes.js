const express = require('express');
const router = express.Router();
const dsaWalletController = require('../controllers/dsa.wallet.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER'));

router.get('/balance', dsaWalletController.getBalance);
router.get('/api-costs', dsaWalletController.getApiCosts);
router.get('/transactions', dsaWalletController.getTransactions);
router.get('/api-usage-history', dsaWalletController.getUsageHistory);

module.exports = router;
