const express = require('express');
const { sendOtp, verifyOtp, ssoCheck, ssoLogout, logout, ssoRevoke } = require('../controllers/direct.customer.auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
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

// Same shape again — this is the sibling backend's server-to-server call,
// not a browser-facing endpoint, but still worth bounding.
const ssoRevokeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: { error: 'Too many revoke requests.' }
});

router.post('/send-otp', otpSendLimiter, sendOtp);
// router.post('/verify-otp', otpVerifyLimiter, verifyOtp);
router.post('/verify-otp', verifyOtp);
router.get('/sso-check', ssoCheckLimiter, ssoCheck);
router.post('/sso-logout', ssoLogout);
router.post('/logout', authenticate, logout);
router.post('/sso-revoke', ssoRevokeLimiter, ssoRevoke);


module.exports = router;
