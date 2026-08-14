// Cookie transport for the "trust this device for 30 days" MFA-skip grant.
// Mirrors utils/ssoCookie.js's cookie-option shape exactly (httpOnly, Secure
// based on the real request, SameSite=Lax, cross-subdomain Domain when on
// *.cred2tech.com) but carries a plain opaque bearer token instead of a
// signed JWT — the token itself is the secret, validated by a sha256-hash
// DB lookup in services/trustedDevice.service.js (same pattern as
// MfaChallenge/PasswordResetToken/backup codes), so no signing secret is
// needed here at all.
const TRUST_COOKIE_NAME = 'c2t_trust_device';
const TRUST_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — must match trustedDevice.service.js's TRUST_TOKEN_TTL_MS

// Deliberately NOT derived from NODE_ENV — see the identical note in
// ssoCookie.js. What actually matters for a cookie's Secure/Domain
// attributes is the real request: was it served over HTTPS, and is the host
// actually a *.cred2tech.com subdomain.
function isCred2techHost(req) {
  const host = (req.hostname || '').toLowerCase();
  return host === 'cred2tech.com' || host.endsWith('.cred2tech.com');
}

function trustDeviceCookieOptions(req) {
  const onCred2tech = isCred2techHost(req);
  return {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: TRUST_COOKIE_MAX_AGE_MS,
    // localhost/previews/etc aren't a cred2tech.com subdomain — omit Domain
    // so the cookie still works host-only for same-origin local testing.
    ...(onCred2tech ? { domain: '.cred2tech.com' } : {}),
  };
}

function clearTrustDeviceCookieOptions(req) {
  const onCred2tech = isCred2techHost(req);
  return {
    path: '/',
    ...(onCred2tech ? { domain: '.cred2tech.com' } : {}),
  };
}

module.exports = {
  TRUST_COOKIE_NAME,
  TRUST_COOKIE_MAX_AGE_MS,
  trustDeviceCookieOptions,
  clearTrustDeviceCookieOptions,
};
