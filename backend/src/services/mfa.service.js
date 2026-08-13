// Mandatory MFA for staff/DSA/admin logins (SUPER_ADMIN, CRED2TECH_MEMBER,
// DSA_ADMIN, DSA_MEMBER, SUB_DSA). MSME_CUSTOMER borrowers are out of scope —
// they use a separate mobile-OTP-only login (direct.customer.auth.service.js).
//
// Login flow: password success (auth.service.js loginUser) never issues a
// real session token directly anymore. It issues either:
//   - an mfa_setup token (user has no method enabled yet) — see issueSetupToken
//   - an mfa_pending challenge token (user has >=1 method enabled) — see issueChallenge
// Only a successful verify* call here (finalizeChallengeSuccess) issues the
// real session JWT + UserSession row, mirroring what loginUser used to do
// unconditionally.
const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const prisma = require('../../config/db');
const { hashPassword, comparePassword } = require('../utils/hash');
const { encryptString, decryptString } = require('../utils/fieldEncryption');
const { generateToken, verifyToken } = require('../utils/jwt');
const { sendMail } = require('../utils/mailer');
const { renderBrandedEmail } = require('../utils/emailTemplate');
const { sendSms, isSmsConfigured } = require('../utils/sms');
const { sendDeviceTrustAlert } = require('./securityAlert.service');

const SETUP_TOKEN_TTL = '15m';
const CHALLENGE_TOKEN_TTL = '10m';
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;
const MAX_EMAIL_OTP_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 10;
const TOTP_ISSUER = 'Cred2Tech';

authenticator.options = { window: 1 }; // ±30s clock drift tolerance

function unauthorized(message) {
  return Object.assign(new Error(message), { status: 401 });
}
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function otpHash(otp) {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateBackupCode() {
  // 10 chars, groups of 5, unambiguous alphabet (no 0/O/1/I/L)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 10; i++) raw += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

async function logMfaAudit({ userId, action, actorId = null, ipAddress = null, detail = null }) {
  try {
    await prisma.mfaAuditLog.create({
      data: { user_id: userId, action, actor_id: actorId, ip_address: ipAddress, detail },
    });
  } catch (err) {
    console.error('[mfa.service] failed to write audit log:', err.message);
  }
}

function hasMfaEnabled(user) {
  return !!(user.mfa_email_enabled || user.mfa_totp_enabled);
}

async function sendOtpEmail({ toEmail, name, otp, purpose }) {
  const { html, text } = renderBrandedEmail({
    title: 'Your verification code',
    preheader: `Your Cred2Tech verification code is ${otp}`,
    heading: purpose === 'login' ? 'Sign-in Verification Code' : 'Verification Code',
    intro: `Hi ${name || ''},`.trim(),
    paragraphs: [
      purpose === 'login'
        ? 'Use the code below to complete signing in to your Cred2Tech account.'
        : 'Use the code below to verify this email address for two-factor authentication.',
    ],
    highlight: { label: 'Verification code', value: otp, mono: true },
    note: "If you didn't request this, you can safely ignore this email.",
  });
  const sent = await sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Cred2Tech Platform'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Your Cred2Tech verification code',
    text,
    html,
  });
  if (!sent) {
    console.warn(`[mfa.service] OTP email could not be sent to ${toEmail} — SMTP not configured or send failed.`);
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Login-flow token issuance (called from auth.service.js loginUser)
// ---------------------------------------------------------------------------

function issueSetupToken(user) {
  return generateToken({ userId: user.id, purpose: 'mfa_setup' }, { expiresIn: SETUP_TOKEN_TTL });
}

async function issueChallenge(user) {
  const token = generateToken({ userId: user.id, purpose: 'mfa_pending' }, { expiresIn: CHALLENGE_TOKEN_TTL });
  await prisma.mfaChallenge.create({
    data: {
      user_id: user.id,
      challenge_token_hash: hashToken(token),
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  const methods = [];
  if (user.mfa_totp_enabled) methods.push('TOTP');
  if (user.mfa_email_enabled) methods.push('EMAIL_OTP');

  return {
    challengeToken: token,
    methods,
    recoveryOptions: {
      backupCodes: true,
      mobileOtp: !!(user.mobile && isSmsConfigured()),
    },
  };
}

// ---------------------------------------------------------------------------
// Purpose-token verification (used by src/middleware/mfaToken.middleware.js)
// ---------------------------------------------------------------------------

function verifySetupToken(token) {
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw unauthorized('Invalid or expired setup token. Please log in again.');
  }
  if (decoded.purpose !== 'mfa_setup') throw unauthorized('Invalid token.');
  return decoded.userId;
}

async function loadActiveChallenge(token) {
  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    throw unauthorized('Invalid or expired verification session. Please log in again.');
  }
  if (decoded.purpose !== 'mfa_pending') throw unauthorized('Invalid token.');

  const challenge = await prisma.mfaChallenge.findUnique({ where: { challenge_token_hash: hashToken(token) } });
  if (!challenge || challenge.consumed || challenge.expires_at < new Date()) {
    throw unauthorized('Invalid or expired verification session. Please log in again.');
  }
  if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    throw unauthorized('Too many incorrect attempts. Please log in again.');
  }
  return { userId: decoded.userId, challenge };
}

async function recordChallengeFailure(challengeId) {
  await prisma.mfaChallenge.update({ where: { id: challengeId }, data: { attempts: { increment: 1 } } });
}

// ---------------------------------------------------------------------------
// TOTP setup (stateless init→confirm — the pending secret round-trips
// through the client rather than being persisted; the confirm step's code
// check is itself cryptographic proof the caller possesses that secret, so
// there's no privilege-escalation risk in trusting the resubmitted value)
// ---------------------------------------------------------------------------

async function totpInit(user) {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, TOTP_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrCodeDataUrl };
}

async function totpConfirm(user, pendingSecret, code) {
  if (!pendingSecret || !code) throw badRequest('Secret and code are required.');
  const valid = authenticator.check(String(code).trim(), pendingSecret);
  if (!valid) throw badRequest('Incorrect code. Please try again.');

  const encryptedSecret = encryptString(pendingSecret);
  await prisma.user.update({
    where: { id: user.id },
    data: { mfa_totp_enabled: true, mfa_totp_secret: encryptedSecret },
  });
  await logMfaAudit({ userId: user.id, action: 'SETUP_TOTP' });

  const backupCodes = await ensureBackupCodes(user.id);
  return { backupCodes };
}

// ---------------------------------------------------------------------------
// Email MFA setup / change
// ---------------------------------------------------------------------------

async function emailSetupInit(user, newEmail) {
  const targetEmail = newEmail ? newEmail.toLowerCase().trim() : user.email;
  if (newEmail) {
    const existing = await prisma.user.findUnique({ where: { email: targetEmail } });
    if (existing && existing.id !== user.id) throw badRequest('That email is already in use.');
  }

  const otp = generateOtp();
  await prisma.mfaEmailOtp.deleteMany({ where: { user_id: user.id } });
  await prisma.mfaEmailOtp.create({
    data: {
      user_id: user.id,
      pending_email: newEmail ? targetEmail : null,
      otp_hash: otpHash(otp),
      expires_at: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await sendOtpEmail({ toEmail: targetEmail, name: user.name, otp, purpose: 'setup' });
  return { maskedEmail: maskEmail(targetEmail) };
}

async function emailSetupConfirm(user, code) {
  const pending = await prisma.mfaEmailOtp.findFirst({ where: { user_id: user.id }, orderBy: { created_at: 'desc' } });
  if (!pending || pending.expires_at < new Date()) throw badRequest('No pending verification found. Please request a new code.');
  if (pending.attempts >= MAX_EMAIL_OTP_ATTEMPTS) throw badRequest('Too many incorrect attempts. Please request a new code.');

  if (otpHash(String(code).trim()) !== pending.otp_hash) {
    await prisma.mfaEmailOtp.update({ where: { id: pending.id }, data: { attempts: { increment: 1 } } });
    throw badRequest('Incorrect code. Please try again.');
  }

  const data = { mfa_email_enabled: true };
  if (pending.pending_email) data.email = pending.pending_email;

  await prisma.user.update({ where: { id: user.id }, data });
  await prisma.mfaEmailOtp.deleteMany({ where: { user_id: user.id } });
  await logMfaAudit({ userId: user.id, action: pending.pending_email ? 'METHOD_CHANGED' : 'SETUP_EMAIL', detail: pending.pending_email ? 'MFA email changed' : null });

  const backupCodes = await ensureBackupCodes(user.id);
  return { backupCodes };
}

async function ensureBackupCodes(userId) {
  const existingCount = await prisma.mfaBackupCode.count({ where: { user_id: userId, used_at: null } });
  if (existingCount > 0) return null; // already has unused codes — don't silently regenerate
  return regenerateBackupCodes(userId);
}

async function regenerateBackupCodes(userId) {
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
  const hashed = await Promise.all(codes.map((c) => hashPassword(c)));

  await prisma.$transaction([
    prisma.mfaBackupCode.deleteMany({ where: { user_id: userId } }),
    prisma.mfaBackupCode.createMany({
      data: hashed.map((code_hash) => ({ user_id: userId, code_hash })),
    }),
  ]);
  await logMfaAudit({ userId, action: 'BACKUP_CODES_REGENERATED' });
  return codes;
}

// ---------------------------------------------------------------------------
// Server-side "can't fully disable" guard
// ---------------------------------------------------------------------------

async function assertAtLeastOneMethodRemains(user, { removingEmail = false, removingTotp = false } = {}) {
  const emailWillRemain = user.mfa_email_enabled && !removingEmail;
  const totpWillRemain = user.mfa_totp_enabled && !removingTotp;
  if (!emailWillRemain && !totpWillRemain) {
    throw badRequest('At least one MFA method must remain enabled. Add another method before removing this one.');
  }
}

// ---------------------------------------------------------------------------
// Step-up re-authentication (Settings-driven MFA changes only)
// ---------------------------------------------------------------------------

async function requireStepUp(user, suppliedPassword) {
  if (!suppliedPassword) throw badRequest('Please re-enter your password to continue.');
  const valid = await comparePassword(suppliedPassword, user.password_hash);
  if (!valid) throw badRequest('Incorrect password.');
}

// ---------------------------------------------------------------------------
// Login-time challenge verification
// ---------------------------------------------------------------------------

async function verifyChallengeTotp(user, challenge, code) {
  if (!user.mfa_totp_enabled || !user.mfa_totp_secret) throw badRequest('TOTP is not enabled for this account.');
  const secret = decryptString(user.mfa_totp_secret);
  const valid = authenticator.check(String(code).trim(), secret);
  if (!valid) {
    await recordChallengeFailure(challenge.id);
    await logMfaAudit({ userId: user.id, action: 'LOGIN_MFA_FAIL', detail: 'TOTP' });
    throw badRequest('Incorrect code. Please try again.');
  }
  return true;
}

async function sendChallengeEmailOtp(user, challenge) {
  const otp = generateOtp();
  await prisma.mfaChallenge.update({
    where: { id: challenge.id },
    data: { method: 'EMAIL_OTP', otp_hash: otpHash(otp), otp_expires_at: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sendOtpEmail({ toEmail: user.email, name: user.name, otp, purpose: 'login' });
  return { maskedEmail: maskEmail(user.email) };
}

async function verifyChallengeEmailOtp(user, challenge, code) {
  if (!challenge.otp_hash || !challenge.otp_expires_at || challenge.otp_expires_at < new Date()) {
    throw badRequest('No active code — please request a new one.');
  }
  if (otpHash(String(code).trim()) !== challenge.otp_hash) {
    await recordChallengeFailure(challenge.id);
    await logMfaAudit({ userId: user.id, action: 'LOGIN_MFA_FAIL', detail: 'EMAIL_OTP' });
    throw badRequest('Incorrect code. Please try again.');
  }
  return true;
}

async function sendChallengeMobileOtp(user, challenge) {
  if (!user.mobile || !isSmsConfigured()) throw badRequest('Mobile OTP recovery is not available for this account.');
  const otp = generateOtp();
  await prisma.mfaChallenge.update({
    where: { id: challenge.id },
    data: { method: 'MOBILE_OTP', otp_hash: otpHash(otp), otp_expires_at: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sendSms({ mobile: user.mobile, message: `${otp} is your Cred2Tech sign-in verification code. Valid for 10 minutes.` });
  return { maskedMobile: maskMobile(user.mobile) };
}

// Mobile OTP reuses the same otp_hash/otp_expires_at columns as email OTP —
// only one can be pending on a given challenge at a time, which is fine
// since the frontend only has one active "enter code" step per challenge.
const verifyChallengeMobileOtp = verifyChallengeEmailOtp;

async function verifyChallengeBackupCode(user, challenge, code) {
  const candidates = await prisma.mfaBackupCode.findMany({ where: { user_id: user.id, used_at: null } });
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await comparePassword(String(code).trim(), candidate.code_hash)) {
      await prisma.mfaBackupCode.update({ where: { id: candidate.id }, data: { used_at: new Date() } });
      await logMfaAudit({ userId: user.id, action: 'BACKUP_CODE_USED' });
      return true;
    }
  }
  await recordChallengeFailure(challenge.id);
  await logMfaAudit({ userId: user.id, action: 'LOGIN_MFA_FAIL', detail: 'BACKUP_CODE' });
  throw badRequest('Incorrect or already-used backup code.');
}

// ---------------------------------------------------------------------------
// Finalize: issue the real session (mirrors auth.service.js loginUser's tail)
// ---------------------------------------------------------------------------

async function finalizeChallengeSuccess(user, challenge, ipAddress) {
  await prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { consumed: true } });

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: now, failed_login_attempts: 0, locked_until: null },
  });

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: user.role.name,
    tenantId: user.tenant_id,
    hierarchyLevel: user.hierarchy_level,
    hierarchyPath: user.hierarchy_path,
  };
  const token = generateToken(tokenPayload);

  await prisma.userSession.create({
    data: { user_id: user.id, session_token: token, ip_address: ipAddress, is_active: true, last_activity_at: now },
  });
  const activeSessionsCount = await prisma.userSession.count({ where: { user_id: user.id, is_active: true } });

  await logMfaAudit({ userId: user.id, action: 'LOGIN_MFA_SUCCESS', ipAddress });

  const { password_hash, mfa_totp_secret, ...userSafe } = user;
  return { user: { ...userSafe, last_login_at: now }, token, activeSessionsCount };
}

// Same finalize path for completing first-time MFA setup (setup token, not a challenge row)
async function finalizeSetupSuccess(user, ipAddress, userAgent = null) {
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: now, failed_login_attempts: 0, locked_until: null },
  });

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: user.role.name,
    tenantId: user.tenant_id,
    hierarchyLevel: user.hierarchy_level,
    hierarchyPath: user.hierarchy_path,
  };
  const token = generateToken(tokenPayload);

  await prisma.userSession.create({
    data: { user_id: user.id, session_token: token, ip_address: ipAddress, is_active: true, last_activity_at: now },
  });
  const activeSessionsCount = await prisma.userSession.count({ where: { user_id: user.id, is_active: true } });

  // Best-effort — must never block finishing MFA setup itself.
  const { labelFromUserAgent } = require('./trustedDevice.service');
  sendDeviceTrustAlert({ user, eventType: 'MFA_SETUP', ipAddress, userAgent, deviceLabel: labelFromUserAgent(userAgent) })
    .catch((err) => console.error('[mfa.service] Failed to send MFA-setup alert email:', err.message));

  const { password_hash, mfa_totp_secret, ...userSafe } = user;
  return { user: { ...userSafe, last_login_at: now }, token, activeSessionsCount };
}

// Same finalize path for a login that skipped the MFA challenge entirely
// because it presented a valid "trust this device" cookie (see
// services/trustedDevice.service.js#validateTrustedDevice, called from
// auth.service.js#loginUser before a challenge would otherwise be issued).
// No MfaChallenge row exists in this path — there's nothing to mark
// consumed — but it still writes its own audit action so admins retain
// login-outcome visibility distinct from a normally-verified login.
async function finalizeTrustedDeviceLogin(user, ipAddress, device) {
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: now, failed_login_attempts: 0, locked_until: null },
  });

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: user.role.name,
    tenantId: user.tenant_id,
    hierarchyLevel: user.hierarchy_level,
    hierarchyPath: user.hierarchy_path,
  };
  const token = generateToken(tokenPayload);

  await prisma.userSession.create({
    data: { user_id: user.id, session_token: token, ip_address: ipAddress, is_active: true, last_activity_at: now },
  });
  const activeSessionsCount = await prisma.userSession.count({ where: { user_id: user.id, is_active: true } });

  await logMfaAudit({ userId: user.id, action: 'LOGIN_MFA_SKIPPED_TRUSTED_DEVICE', ipAddress, detail: device.device_label || null });

  const { password_hash, mfa_totp_secret, ...userSafe } = user;
  return { user: { ...userSafe, last_login_at: now }, token, activeSessionsCount };
}

// ---------------------------------------------------------------------------
// Admin-forced reset
// ---------------------------------------------------------------------------

async function adminResetMfa(targetUser, actorUser, ipAddress) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetUser.id },
      data: { mfa_email_enabled: false, mfa_totp_enabled: false, mfa_totp_secret: null },
    }),
    prisma.mfaBackupCode.deleteMany({ where: { user_id: targetUser.id } }),
  ]);
  // Without this, a trust grant issued before the reset (if still within its
  // 30-day window) would silently let the next login skip the challenge
  // again once the user re-completes setup — defeating the point of an
  // admin-forced reset, which is typically done on suspected compromise.
  // Lazy require — see the identical note in changePassword() above.
  await require('./trustedDevice.service').revokeAllTrustedDevices({ userId: targetUser.id });
  await logMfaAudit({ userId: targetUser.id, action: 'ADMIN_RESET', actorId: actorUser.id, ipAddress });

  const { html, text } = renderBrandedEmail({
    title: 'Your MFA was reset',
    preheader: 'Your Cred2Tech two-factor authentication was reset by an administrator.',
    heading: 'Two-Factor Authentication Reset',
    intro: `Hi ${targetUser.name || ''},`.trim(),
    paragraphs: [
      `An administrator (${actorUser.name || actorUser.email}) reset two-factor authentication on your Cred2Tech account. You'll be asked to set it up again the next time you log in.`,
      "If you didn't request this, contact your administrator immediately.",
    ],
  });
  const sent = await sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Cred2Tech Platform'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: targetUser.email,
    subject: 'Your Cred2Tech two-factor authentication was reset',
    text,
    html,
  });
  if (!sent) {
    console.warn(`[mfa.service] Admin-reset notification email could not be sent to ${targetUser.email}.`);
  }
}

// ---------------------------------------------------------------------------
// Local-dev bypass (never available in production)
// ---------------------------------------------------------------------------

// Lets a throwaway local account skip real TOTP/email verification during
// setup, instead of hand-writing an encrypted TOTP secret into the DB for
// every test account (the previous workaround). Trivially marks email OTP as
// "enabled" without ever sending/verifying a code — acceptable only because
// this never runs against a real account. Gated on NODE_ENV here (not just at
// the route) so every caller gets the same guarantee regardless of how it's
// invoked.
async function devBypassMfa(user, ipAddress) {
  if (process.env.NODE_ENV === 'production') {
    throw forbidden('Not available.');
  }
  if (!hasMfaEnabled(user)) {
    await prisma.user.update({ where: { id: user.id }, data: { mfa_email_enabled: true } });
    user.mfa_email_enabled = true;
  }
  await logMfaAudit({ userId: user.id, action: 'DEV_MFA_BYPASS', ipAddress });
  return user;
}

// Same local-dev-only guarantee as devBypassMfa, for the login-time challenge
// (an account that already has a method enabled) instead of first-time
// setup — skips actually checking the TOTP/email/mobile/backup code and
// finalizes the login as if it had been verified.
async function devBypassChallenge(user, challenge, ipAddress) {
  if (process.env.NODE_ENV === 'production') {
    throw forbidden('Not available.');
  }
  await logMfaAudit({ userId: user.id, action: 'DEV_MFA_BYPASS', ipAddress });
  return finalizeChallengeSuccess(user, challenge, ipAddress);
}

// ---------------------------------------------------------------------------
// Change password (authenticated, current-password-verified)
// ---------------------------------------------------------------------------

async function changePassword(user, currentPassword, newPassword) {
  const { validatePasswordPolicy } = require('../utils/passwordPolicy');
  const valid = await comparePassword(currentPassword || '', user.password_hash);
  if (!valid) throw badRequest('Current password is incorrect.');
  validatePasswordPolicy(newPassword);

  const newHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { password_hash: newHash } }),
    // Revoke every other session — a password change should force re-auth
    // everywhere except the session making this request.
    prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: { is_active: false },
    }),
  ]);

  // A password change is exactly the "assume compromise" moment a trust
  // grant should not survive — revoke every trusted device too, not just
  // sessions. Lazy require: trustedDevice.service.js itself requires this
  // file (for logMfaAudit), so a top-level require here would create a
  // circular import and silently get an empty module.
  await require('./trustedDevice.service').revokeAllTrustedDevices({ userId: user.id });
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function maskMobile(mobile) {
  const str = String(mobile);
  return `${'*'.repeat(Math.max(str.length - 4, 0))}${str.slice(-4)}`;
}

module.exports = {
  hasMfaEnabled,
  issueSetupToken,
  issueChallenge,
  verifySetupToken,
  loadActiveChallenge,
  totpInit,
  totpConfirm,
  emailSetupInit,
  emailSetupConfirm,
  ensureBackupCodes,
  regenerateBackupCodes,
  assertAtLeastOneMethodRemains,
  requireStepUp,
  verifyChallengeTotp,
  sendChallengeEmailOtp,
  verifyChallengeEmailOtp,
  sendChallengeMobileOtp,
  verifyChallengeMobileOtp,
  verifyChallengeBackupCode,
  finalizeChallengeSuccess,
  finalizeSetupSuccess,
  finalizeTrustedDeviceLogin,
  devBypassMfa,
  devBypassChallenge,
  adminResetMfa,
  changePassword,
  maskEmail,
  maskMobile,
  logMfaAudit,
};
