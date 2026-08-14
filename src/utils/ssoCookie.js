const jwt = require('jsonwebtoken');

// Signs/verifies the short-lived c2t_sso bootstrap cookie shared with
// scheme.cred2tech.com (nestjs-backend). Deliberately a separate secret from
// JWT_SECRET (utils/jwt.js) — this token only ever proves "recently
// authenticated with mobile X on the sibling app" and bootstraps a fresh
// local session; it must never be usable to forge or extend this app's own
// session tokens, so the two secrets must never be the same value.
//
// The secret is read lazily (inside signSsoToken/verifySsoToken), not at
// module load — a plain `require('./app.js')` sanity check (e.g. CI's
// "does this app load" step) shouldn't need every downstream secret set,
// only whichever ones the code path it actually exercises touches.
const SSO_COOKIE_NAME = 'c2t_sso';
const SSO_EXPIRES_IN = '10m';
const SSO_ALGORITHM = 'HS256';

function getSsoSecret() {
  const secret = process.env.CRED2TECH_SSO_SECRET;
  if (!secret) {
    throw new Error('CRED2TECH_SSO_SECRET is not set — required for cross-app SSO cookie signing/verification');
  }
  return secret;
}

function signSsoToken(mobile) {
  return jwt.sign({ mobile }, getSsoSecret(), { expiresIn: SSO_EXPIRES_IN, algorithm: SSO_ALGORITHM });
}

function verifySsoToken(token) {
  const payload = jwt.verify(token, getSsoSecret(), { algorithms: [SSO_ALGORITHM] });
  return payload.mobile;
}

// Deliberately NOT derived from NODE_ENV — this server runs in production
// with NODE_ENV=development, so a NODE_ENV check would silently produce a
// host-only, non-Secure cookie there and break cross-subdomain SSO entirely.
// What actually matters for a cookie's Secure/Domain attributes is the real
// request: was it served over HTTPS, and is the host actually a
// *.cred2tech.com subdomain? `req.secure` respects `app.set('trust proxy')`
// (already configured in app.js), so it's correct behind the reverse proxy.
function isCred2techHost(req) {
  const host = (req.hostname || '').toLowerCase();
  return host === 'cred2tech.com' || host.endsWith('.cred2tech.com');
}

function ssoCookieOptions(req) {
  const onCred2tech = isCred2techHost(req);
  return {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000,
    // localhost/previews/etc aren't a cred2tech.com subdomain — omit Domain
    // so the cookie still works host-only for same-origin local testing.
    ...(onCred2tech ? { domain: '.cred2tech.com' } : {}),
  };
}

function clearSsoCookieOptions(req) {
  const onCred2tech = isCred2techHost(req);
  return {
    path: '/',
    ...(onCred2tech ? { domain: '.cred2tech.com' } : {}),
  };
}

module.exports = {
  SSO_COOKIE_NAME,
  signSsoToken,
  verifySsoToken,
  ssoCookieOptions,
  clearSsoCookieOptions,
};
