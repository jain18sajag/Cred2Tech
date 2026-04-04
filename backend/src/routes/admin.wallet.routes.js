const express = require('express');
const router = express.Router();
const adminWalletController = require('../controllers/admin.wallet.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN')); // Only Super Admins can manage wallets and pricing globally

router.get('/api-pricing', adminWalletController.getPricing);
router.patch('/api-pricing/:id', adminWalletController.updatePricing);
router.post('/tenants/:tenant_id/wallet/topup', adminWalletController.topupWallet);
router.post('/tenants/:tenant_id/wallet/deduct', adminWalletController.deductWallet);
router.get('/tenants/wallets', adminWalletController.getAllWallets);
router.get('/tenants/:tenant_id/wallet/ledger', adminWalletController.getLedger);

module.exports = router;
