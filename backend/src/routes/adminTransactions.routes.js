const express = require('express');
const router = express.Router();
const adminTransactionsController = require('../controllers/adminTransactions.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN')); // Platform-wide payment data — Super Admin only

router.get('/', adminTransactionsController.list);
router.get('/summary', adminTransactionsController.summary);
router.get('/export.xlsx', adminTransactionsController.exportExcel);
router.get('/export.pdf', adminTransactionsController.exportPdf);

module.exports = router;
