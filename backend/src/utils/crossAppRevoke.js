const { signSsoToken } = require('./ssoCookie');

// Real production URL, confirmed live — overridable for staging/local via env.
const SCHEME_API_URL = (process.env.SCHEME_API_URL || 'https://api.scheme.cred2tech.com').replace(/\/+$/, '');

// Tells scheme.cred2tech.com's backend to revoke its own sessions for this
// mobile too, so a logout on this app ends both. The signed SSO token proves
// this call really is a legitimate cross-app revoke for this mobile (same
// secret/mechanism as the SSO bootstrap cookie) — no separate credential.
//
// Best-effort and bounded: a user's own logout must always succeed locally
// even if the sibling app is slow or unreachable, so this never throws and
// never blocks longer than the timeout.
async function notifySchemeRevoke(mobile) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(`${SCHEME_API_URL}/api/msme-auth/sso-revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signSsoToken(mobile)}` },
      signal: controller.signal,
    });
  } catch (err) {
    console.warn('[cross-app logout] failed to notify scheme.cred2tech.com:', err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { notifySchemeRevoke };
