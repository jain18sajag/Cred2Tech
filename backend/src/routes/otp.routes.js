const express = require('express');
const router = express.Router();
const otpController = require('../controllers/otp.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER'));

router.post('/send', otpController.send);
router.post('/verify', otpController.verify);
router.post('/resend', otpController.resend);

module.exports = router;
