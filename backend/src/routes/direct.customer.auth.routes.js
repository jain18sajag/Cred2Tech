const express = require('express');
const { sendOtp, verifyOtp } = require('../controllers/direct.customer.auth.controller');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please try again after 10 minutes.' }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many OTP verification attempts. Please try again after 10 minutes.' }
});

router.post('/send-otp', otpSendLimiter, sendOtp);
// router.post('/verify-otp', otpVerifyLimiter, verifyOtp);
router.post('/verify-otp', verifyOtp);


module.exports = router;
