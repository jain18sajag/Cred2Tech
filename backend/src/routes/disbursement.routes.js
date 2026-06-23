const express = require('express');
const router = express.Router();
const disbursementController = require('../controllers/disbursement.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const upload = require('../middleware/upload.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA'));

// GET /api/disbursements/bulk-upload/template
router.get('/bulk-upload/template', disbursementController.downloadTemplate);

// POST /api/disbursements/bulk-upload
router.post('/bulk-upload', upload.single('file'), disbursementController.uploadBulkDisbursements);

// GET /api/disbursements/partial - List all cases in PARTLY_DISBURSED stage
router.get('/partial', disbursementController.listPartialDisbursements);

module.exports = router;
