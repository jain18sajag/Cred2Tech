// trustedDevice.service.js
// "Trust this device for 30 days" — lets a login skip the MFA challenge on a
// device the user previously opted to trust. Follows the same
// opaque-token + sha256-hash pattern already used for MfaChallenge /
// PasswordResetToken / backup codes elsewhere in this codebase: only the
// hash is ever persisted, the raw token exists only in an httpOnly cookie on
// the client (see utils/trustDeviceCookie.js) and is never logged.

const crypto = require('crypto');
const prisma = require('../../config/db');
const { logMfaAudit } = require('./mfa.service');
const { sendDeviceTrustAlert } = require('./securityAlert.service');

const TRUST_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_DEVICES_PER_USER = 10;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Small, dependency-free UA parser — good enough for a display label on the
// Profile page, not meant to be exhaustive. Order matters: Edge and Chrome
// UAs both contain "Safari", and Edge's also contains "Chrome", so the more
// specific tokens must be checked first.
function labelFromUserAgent(ua) {
  if (!ua) return 'Unknown device';

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  // iPhone/iPad UAs contain "like Mac OS X" — iOS must be checked before
  // macOS or every iPhone gets mislabeled "macOS". Same for Android, whose
  // UAs also contain "Linux".
  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  return `${browser} on ${os}`;
}

// ── Issue a new trust grant (called on MFA-verify success with trustDevice=true) ──
// Takes the full `user` row (not just an id) — needed to send the
// security-alert email below, and avoids an extra DB round-trip since every
// caller already has it in hand.
async function issueTrustedDevice({ user, ipAddress, userAgent }) {
  const userId = user.id;
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TRUST_TOKEN_TTL_MS);
  const deviceLabel = labelFromUserAgent(userAgent);

  // Cap enforcement: evict the least-recently-used active device once the
  // cap would otherwise be exceeded, rather than letting the list grow
  // unbounded for an account that clicks "trust" on every browser it ever
  // touches.
  const activeCount = await prisma.trustedDevice.count({
    where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
  });
  if (activeCount >= MAX_DEVICES_PER_USER) {
    const oldest = await prisma.trustedDevice.findFirst({
      where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
      orderBy: { last_used_at: 'asc' },
    });
    if (oldest) {
      await prisma.trustedDevice.update({ where: { id: oldest.id }, data: { revoked_at: new Date() } });
    }
  }

  await prisma.trustedDevice.create({
    data: {
      user_id: userId,
      token_hash: tokenHash,
      device_label: deviceLabel,
      ip_address: ipAddress || null,
      user_agent: userAgent ? String(userAgent).slice(0, 500) : null,
      expires_at: expiresAt,
    },
  });

  await logMfaAudit({ userId, action: 'TRUSTED_DEVICE_ADDED', ipAddress });

  // Best-effort — a slow/failed geo lookup or SMTP hiccup must never block
  // the actual trust grant (which has already been committed above).
  sendDeviceTrustAlert({ user, eventType: 'DEVICE_TRUSTED', ipAddress, userAgent, deviceLabel })
    .catch((err) => console.error('[trustedDevice.service] Failed to send device-trust alert email:', err.message));

  return rawToken; // only time the raw token is ever available
}

// Scoped by BOTH user_id and token_hash together — critical on a shared
// browser: if the cookie present belongs to a *different* user than the one
// currently entering their password, no row matches and this correctly
// falls through to a normal MFA challenge instead of leaking a bypass.
async function validateTrustedDevice({ userId, rawToken }) {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  const device = await prisma.trustedDevice.findFirst({
    where: { user_id: userId, token_hash: tokenHash, revoked_at: null, expires_at: { gt: new Date() } },
  });
  if (!device) return null;
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { last_used_at: new Date() } });
  return device;
}

// For the Profile page's "Trusted Devices" card.
async function listTrustedDevices({ userId, currentRawToken }) {
  const devices = await prisma.trustedDevice.findMany({
    where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
    orderBy: { last_used_at: 'desc' },
  });
  const currentHash = currentRawToken ? hashToken(currentRawToken) : null;
  return devices.map(({ token_hash, ...d }) => ({ ...d, isCurrentDevice: token_hash === currentHash }));
}

async function revokeTrustedDevice({ userId, deviceId, ipAddress }) {
  const device = await prisma.trustedDevice.findUnique({ where: { id: Number(deviceId) } });
  if (!device || device.user_id !== userId) {
    const err = new Error('Trusted device not found');
    err.status = 404;
    throw err;
  }
  await prisma.trustedDevice.update({ where: { id: device.id }, data: { revoked_at: new Date() } });
  await logMfaAudit({ userId, action: 'TRUSTED_DEVICE_REVOKED', ipAddress });
  return device.token_hash; // caller compares to the browser's own current cookie to decide whether to clear it
}

// Used by the security hardening hooks (password change, admin MFA reset).
async function revokeAllTrustedDevices({ userId, ipAddress = null }) {
  await prisma.trustedDevice.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  await logMfaAudit({ userId, action: 'TRUSTED_DEVICE_REVOKED', ipAddress, detail: 'all' });
}

module.exports = {
  TRUST_TOKEN_TTL_MS,
  MAX_DEVICES_PER_USER,
  hashToken,
  labelFromUserAgent,
  issueTrustedDevice,
  validateTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  revokeAllTrustedDevices,
};
