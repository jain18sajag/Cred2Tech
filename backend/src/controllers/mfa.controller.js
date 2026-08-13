const prisma = require('../../config/db');
const mfaService = require('../services/mfa.service');
const trustedDeviceService = require('../services/trustedDevice.service');
const { TRUST_COOKIE_NAME, trustDeviceCookieOptions } = require('../utils/trustDeviceCookie');
const { sendCaughtError } = require('../utils/sendError');

function safeUser(user) {
  const { password_hash, mfa_totp_secret, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// First-time forced setup (requireMfaSetupToken)
// ---------------------------------------------------------------------------

async function setupStatus(req, res) {
  const user = req.mfaUser;
  res.json({
    mfaEmailEnabled: user.mfa_email_enabled,
    mfaTotpEnabled: user.mfa_totp_enabled,
    email: mfaService.maskEmail(user.email),
  });
}

async function setupTotpInit(req, res) {
  try {
    const result = await mfaService.totpInit(req.mfaUser);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to start TOTP setup');
  }
}

async function setupTotpConfirm(req, res) {
  try {
    const { secret, code } = req.body;
    const { backupCodes } = await mfaService.totpConfirm(req.mfaUser, secret, code);
    const finished = await finishSetupIfComplete(req.mfaUser, req.ip, req.headers['user-agent'] || null);
    res.json({ message: 'TOTP enabled.', backupCodes: backupCodes || undefined, ...finished });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to confirm TOTP');
  }
}

async function setupEmailInit(req, res) {
  try {
    const result = await mfaService.emailSetupInit(req.mfaUser, null);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to send verification email');
  }
}

async function setupEmailConfirm(req, res) {
  try {
    const { code } = req.body;
    const { backupCodes } = await mfaService.emailSetupConfirm(req.mfaUser, code);
    const finished = await finishSetupIfComplete(req.mfaUser, req.ip, req.headers['user-agent'] || null);
    res.json({ message: 'Email verification enabled.', backupCodes: backupCodes || undefined, ...finished });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to confirm email code');
  }
}

// Once at least one method is enabled, the setup token's job is done — issue
// the real session exactly as a completed login-time challenge would.
async function finishSetupIfComplete(mfaUserStale, ipAddress, userAgent) {
  const fresh = await prisma.user.findUnique({
    where: { id: mfaUserStale.id },
    include: { role: true, tenant: true },
  });
  if (!mfaService.hasMfaEnabled(fresh)) return {};
  const { user, token, activeSessionsCount } = await mfaService.finalizeSetupSuccess(fresh, ipAddress, userAgent);
  return { setupComplete: true, user, token, activeSessionsCount };
}

// Local-dev only (mfaService.devBypassMfa enforces NODE_ENV !== 'production'
// regardless of how this is reached) — skips real setup entirely.
async function setupDevBypass(req, res) {
  try {
    const fresh = await prisma.user.findUnique({
      where: { id: req.mfaUser.id },
      include: { role: true, tenant: true },
    });
    await mfaService.devBypassMfa(fresh, req.ip);
    const { user, token, activeSessionsCount } = await mfaService.finalizeSetupSuccess(fresh, req.ip, req.headers['user-agent'] || null);
    res.json({ message: 'MFA bypassed (dev mode).', setupComplete: true, user, token, activeSessionsCount });
  } catch (error) {
    sendCaughtError(res, error, 'Dev bypass failed');
  }
}

// ---------------------------------------------------------------------------
// Settings-driven management (authenticate + step-up password)
// ---------------------------------------------------------------------------

async function manageStatus(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const remainingBackupCodes = await prisma.mfaBackupCode.count({ where: { user_id: user.id, used_at: null } });
    res.json({
      mfaEmailEnabled: user.mfa_email_enabled,
      mfaTotpEnabled: user.mfa_totp_enabled,
      email: mfaService.maskEmail(user.email),
      remainingBackupCodes,
    });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to load MFA status');
  }
}

async function manageTotpInit(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.requireStepUp(user, req.body.currentPassword);
    const result = await mfaService.totpInit(user);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to start TOTP setup');
  }
}

async function manageTotpConfirm(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { secret, code } = req.body;
    const { backupCodes } = await mfaService.totpConfirm(user, secret, code);
    res.json({ message: 'TOTP device updated.', backupCodes: backupCodes || undefined });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to confirm TOTP');
  }
}

async function manageTotpDisable(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.requireStepUp(user, req.body.currentPassword);
    await mfaService.assertAtLeastOneMethodRemains(user, { removingTotp: true });
    await prisma.user.update({ where: { id: user.id }, data: { mfa_totp_enabled: false, mfa_totp_secret: null } });
    res.json({ message: 'TOTP disabled.' });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to disable TOTP');
  }
}

async function manageEmailInit(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.requireStepUp(user, req.body.currentPassword);
    const result = await mfaService.emailSetupInit(user, req.body.newEmail || null);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to send verification email');
  }
}

async function manageEmailConfirm(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { code } = req.body;
    const { backupCodes } = await mfaService.emailSetupConfirm(user, code);
    res.json({ message: 'Email verification updated.', backupCodes: backupCodes || undefined });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to confirm email code');
  }
}

async function manageEmailDisable(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.requireStepUp(user, req.body.currentPassword);
    await mfaService.assertAtLeastOneMethodRemains(user, { removingEmail: true });
    await prisma.user.update({ where: { id: user.id }, data: { mfa_email_enabled: false } });
    res.json({ message: 'Email verification disabled.' });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to disable email verification');
  }
}

async function manageRegenerateBackupCodes(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.requireStepUp(user, req.body.currentPassword);
    const backupCodes = await mfaService.regenerateBackupCodes(user.id);
    res.json({ backupCodes });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to regenerate backup codes');
  }
}

async function changePassword(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { currentPassword, newPassword } = req.body;
    await mfaService.changePassword(user, currentPassword, newPassword);
    res.json({ message: 'Password changed successfully. Other sessions have been signed out.' });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to change password');
  }
}

// Local-dev only, mirrors setupDevBypass for the "existing session, MFA now
// mandatory" path — no setup token to exchange, so just flips the flag on
// the already-authenticated account and lets the frontend refresh its user.
async function manageDevBypass(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.devBypassMfa(user, req.ip);
    res.json({ message: 'MFA bypassed (dev mode).' });
  } catch (error) {
    sendCaughtError(res, error, 'Dev bypass failed');
  }
}

// ---------------------------------------------------------------------------
// Login-time challenge verification (requireMfaChallengeToken)
// ---------------------------------------------------------------------------

async function challengeSendEmailOtp(req, res) {
  try {
    const result = await mfaService.sendChallengeEmailOtp(req.mfaUser, req.mfaChallenge);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to send code');
  }
}

// Mints the "trust this device" cookie when the DSA opted in on the
// challenge screen. Called after finalizeChallengeSuccess so a failed
// cookie-mint (extremely unlikely — no external call, just DB + res.cookie)
// never blocks a login that already succeeded.
async function maybeIssueTrustCookie(req, res) {
  if (!req.body.trustDevice) return;
  const rawToken = await trustedDeviceService.issueTrustedDevice({
    user: req.mfaUser,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || null,
  });
  res.cookie(TRUST_COOKIE_NAME, rawToken, trustDeviceCookieOptions(req));
}

async function challengeVerifyTotp(req, res) {
  try {
    await mfaService.verifyChallengeTotp(req.mfaUser, req.mfaChallenge, req.body.code);
    const result = await mfaService.finalizeChallengeSuccess(req.mfaUser, req.mfaChallenge, req.ip);
    await maybeIssueTrustCookie(req, res);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to verify code');
  }
}

async function challengeVerifyEmailOtp(req, res) {
  try {
    await mfaService.verifyChallengeEmailOtp(req.mfaUser, req.mfaChallenge, req.body.code);
    const result = await mfaService.finalizeChallengeSuccess(req.mfaUser, req.mfaChallenge, req.ip);
    await maybeIssueTrustCookie(req, res);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to verify code');
  }
}

async function challengeSendMobileOtp(req, res) {
  try {
    const result = await mfaService.sendChallengeMobileOtp(req.mfaUser, req.mfaChallenge);
    res.json(result);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to send code');
  }
}

async function challengeVerifyMobileOtp(req, res) {
  try {
    await mfaService.verifyChallengeMobileOtp(req.mfaUser, req.mfaChallenge, req.body.code);
    const result = await mfaService.finalizeChallengeSuccess(req.mfaUser, req.mfaChallenge, req.ip);
    await maybeIssueTrustCookie(req, res);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to verify code');
  }
}

async function challengeVerifyBackupCode(req, res) {
  try {
    await mfaService.verifyChallengeBackupCode(req.mfaUser, req.mfaChallenge, req.body.code);
    const result = await mfaService.finalizeChallengeSuccess(req.mfaUser, req.mfaChallenge, req.ip);
    await maybeIssueTrustCookie(req, res);
    res.json({ message: 'Login successful', ...result });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to verify backup code');
  }
}

// Local-dev only — mfaService.devBypassChallenge hard-refuses when
// NODE_ENV === 'production'. Skips real code verification entirely.
async function challengeDevBypass(req, res) {
  try {
    const result = await mfaService.devBypassChallenge(req.mfaUser, req.mfaChallenge, req.ip);
    res.json({ message: 'MFA bypassed (dev mode).', ...result });
  } catch (error) {
    sendCaughtError(res, error, 'Dev bypass failed');
  }
}

// ---------------------------------------------------------------------------
// Admin-forced reset
// ---------------------------------------------------------------------------

async function adminResetMfa(req, res) {
  try {
    const targetId = parseInt(req.params.id, 10);
    const targetUser = await prisma.user.findUnique({ where: { id: targetId }, include: { role: true } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    // SUPER_ADMIN/CRED2TECH_MEMBER can reset anyone. DSA_ADMIN can only reset
    // DSA_MEMBER/SUB_DSA within their own tenant — mirrors the scoping already
    // used for user creation (assertRoleAssignable in user.service.js).
    if (req.user.role === 'DSA_ADMIN') {
      const targetInTenant = targetUser.tenant_id === req.user.tenant_id;
      const targetRoleAllowed = ['DSA_MEMBER', 'SUB_DSA'].includes(targetUser.role.name);
      if (!targetInTenant || !targetRoleAllowed) {
        return res.status(403).json({ error: 'You do not have permission to reset MFA for this user.' });
      }
    }

    const actorUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    await mfaService.adminResetMfa(targetUser, actorUser, req.ip);
    res.json({ message: `MFA has been reset for ${targetUser.email}. They will be asked to set it up again on next login.` });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to reset MFA');
  }
}

// Public, unauthenticated — the frontend needs to know whether to even show
// the "Skip MFA (dev only)" button before a user has a setup/challenge
// token, let alone a session. Exposes nothing but a boolean; the actual
// bypass endpoints (setupDevBypass/challengeDevBypass) independently
// re-check the same condition server-side via mfaService, so this endpoint
// returning a stale/spoofed answer could never itself grant a bypass.
function devBypassStatus(req, res) {
  res.json({ available: process.env.NODE_ENV !== 'production' });
}

module.exports = {
  setupStatus,
  devBypassStatus,
  setupTotpInit,
  setupTotpConfirm,
  setupEmailInit,
  setupEmailConfirm,
  setupDevBypass,
  manageDevBypass,
  manageStatus,
  manageTotpInit,
  manageTotpConfirm,
  manageTotpDisable,
  manageEmailInit,
  manageEmailConfirm,
  manageEmailDisable,
  manageRegenerateBackupCodes,
  changePassword,
  challengeSendEmailOtp,
  challengeVerifyTotp,
  challengeVerifyEmailOtp,
  challengeSendMobileOtp,
  challengeVerifyMobileOtp,
  challengeVerifyBackupCode,
  challengeDevBypass,
  adminResetMfa,
};
