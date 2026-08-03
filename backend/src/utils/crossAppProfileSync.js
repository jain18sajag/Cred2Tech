const { signSsoToken } = require('./ssoCookie');

// Real production URL, confirmed live — overridable for staging/local via env.
const SCHEME_API_URL = (process.env.SCHEME_API_URL || 'https://api.scheme.cred2tech.com').replace(/\/+$/, '');

// Pushes whatever verified profile fields this app has for a mobile to
// scheme.cred2tech.com's backend, so a borrower never has to re-type name/
// DOB/PAN there just because they entered it here first. The signed SSO
// token proves this call really is a legitimate cross-app push for this
// mobile (same secret/mechanism as the SSO bootstrap cookie and sso-revoke)
// — no separate credential, and the fields themselves ride in the body.
//
// Best-effort and bounded: never throws, never blocks login longer than the
// timeout — this is a nice-to-have prefill, not something login should ever
// fail or slow down over.
async function pushProfileToScheme(mobile, { name, dob, pan_number }) {
  if (!name && !dob && !pan_number) return; // nothing worth sending
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(`${SCHEME_API_URL}/api/msme-auth/sso-profile-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signSsoToken(mobile)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, dob, pan_number }),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn('[cross-app profile sync] failed to push to scheme.cred2tech.com:', err.message);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { pushProfileToScheme };
