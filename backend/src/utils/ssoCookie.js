const jwt = require('jsonwebtoken');

// Signs/verifies the short-lived c2t_sso bootstrap cookie shared with
// scheme.cred2tech.com (nestjs-backend). Deliberately a separate secret from
// JWT_SECRET (utils/jwt.js) — this token only ever proves "recently
// authenticated with mobile X on the sibling app" and bootstraps a fresh
// local session; it must never be usable to forge or extend this app's own
// session tokens, so the two secrets must never be the same value.
const CRED2TECH_SSO_SECRET = process.env.CRED2TECH_SSO_SECRET;
if (!CRED2TECH_SSO_SECRET) {
  throw new Error('CRED2TECH_SSO_SECRET is not set — required for cross-app SSO cookie signing/verification');
}
const SSO_COOKIE_NAME = 'c2t_sso';
const SSO_EXPIRES_IN = '10m';
const SSO_ALGORITHM = 'HS256';

function signSsoToken(mobile) {
  return jwt.sign({ mobile }, CRED2TECH_SSO_SECRET, { expiresIn: SSO_EXPIRES_IN, algorithm: SSO_ALGORITHM });
}

function verifySsoToken(token) {
  const payload = jwt.verify(token, CRED2TECH_SSO_SECRET, { algorithms: [SSO_ALGORITHM] });
  return payload.mobile;
}

function ssoCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000,
    // localhost isn't a cred2tech.com subdomain — omit Domain in dev so the
    // cookie still works for same-origin local testing.
    ...(isProd ? { domain: '.cred2tech.com' } : {}),
  };
}

function clearSsoCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    path: '/',
    ...(isProd ? { domain: '.cred2tech.com' } : {}),
  };
}

module.exports = {
  SSO_COOKIE_NAME,
  signSsoToken,
  verifySsoToken,
  ssoCookieOptions,
  clearSsoCookieOptions,
};
