const express = require('express');
const { sendOtp, verifyOtp, ssoCheck, ssoLogout } = require('../controllers/direct.customer.auth.controller');
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

// Same shape as otpVerifyLimiter — called automatically on every fresh page
// load with no local session, so it needs its own generous-but-bounded cap.
const ssoCheckLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many SSO checks. Please try again shortly.' }
});

router.post('/send-otp', otpSendLimiter, sendOtp);
// router.post('/verify-otp', otpVerifyLimiter, verifyOtp);
router.post('/verify-otp', verifyOtp);
router.get('/sso-check', ssoCheckLimiter, ssoCheck);
router.post('/sso-logout', ssoLogout);


module.exports = router;
