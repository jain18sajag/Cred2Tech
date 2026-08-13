const express = require('express');
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/mfa.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireMfaSetupToken, requireMfaChallengeToken } = require('../middleware/mfaToken.middleware');

const router = express.Router();

// Public — lets the frontend decide whether to show the dev-bypass button at
// all, before there's any setup/challenge token or session to authenticate
// with. See mfa.controller.js#devBypassStatus for why this is safe to expose.
router.get('/dev-bypass-status', ctrl.devBypassStatus);

// Mirrors the shape of app.js's existing otpSendLimiter/otpVerifyLimiter.
const mfaSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests, please try again after 10 minutes.' },
});
const mfaVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again after 10 minutes.' },
});

// ---- First-time forced setup (post-password, no MFA configured yet) ----
router.get('/setup/status', requireMfaSetupToken, ctrl.setupStatus);
router.post('/setup/totp/init', requireMfaSetupToken, ctrl.setupTotpInit);
router.post('/setup/totp/confirm', requireMfaSetupToken, mfaVerifyLimiter, ctrl.setupTotpConfirm);
router.post('/setup/email/init', requireMfaSetupToken, mfaSendLimiter, ctrl.setupEmailInit);
router.post('/setup/email/confirm', requireMfaSetupToken, mfaVerifyLimiter, ctrl.setupEmailConfirm);
// Local-dev only — mfaService.devBypassMfa hard-refuses when
// NODE_ENV === 'production', independent of this route existing.
router.post('/setup/dev-bypass', requireMfaSetupToken, ctrl.setupDevBypass);

// ---- Settings-driven management (already logged in, step-up password) ----
router.get('/manage/status', authenticate, ctrl.manageStatus);
router.post('/manage/dev-bypass', authenticate, ctrl.manageDevBypass);
router.post('/manage/totp/init', authenticate, ctrl.manageTotpInit);
router.post('/manage/totp/confirm', authenticate, mfaVerifyLimiter, ctrl.manageTotpConfirm);
router.post('/manage/totp/disable', authenticate, ctrl.manageTotpDisable);
router.post('/manage/email/init', authenticate, mfaSendLimiter, ctrl.manageEmailInit);
router.post('/manage/email/confirm', authenticate, mfaVerifyLimiter, ctrl.manageEmailConfirm);
router.post('/manage/email/disable', authenticate, ctrl.manageEmailDisable);
router.post('/manage/backup-codes/regenerate', authenticate, ctrl.manageRegenerateBackupCodes);
router.post('/manage/change-password', authenticate, ctrl.changePassword);

// ---- Login-time challenge verification (post-password, MFA already configured) ----
router.post('/challenge/send-email-otp', requireMfaChallengeToken, mfaSendLimiter, ctrl.challengeSendEmailOtp);
router.post('/challenge/verify-totp', requireMfaChallengeToken, mfaVerifyLimiter, ctrl.challengeVerifyTotp);
router.post('/challenge/verify-email-otp', requireMfaChallengeToken, mfaVerifyLimiter, ctrl.challengeVerifyEmailOtp);
router.post('/challenge/send-mobile-otp', requireMfaChallengeToken, mfaSendLimiter, ctrl.challengeSendMobileOtp);
router.post('/challenge/verify-mobile-otp', requireMfaChallengeToken, mfaVerifyLimiter, ctrl.challengeVerifyMobileOtp);
router.post('/challenge/verify-backup-code', requireMfaChallengeToken, mfaVerifyLimiter, ctrl.challengeVerifyBackupCode);
// Local-dev only — mfaService.devBypassChallenge hard-refuses when
// NODE_ENV === 'production', independent of this route existing.
router.post('/challenge/dev-bypass', requireMfaChallengeToken, ctrl.challengeDevBypass);

// ---- Admin-forced reset ----
router.post('/admin/users/:id/reset', authenticate, requireRole('SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN'), ctrl.adminResetMfa);

module.exports = router;
