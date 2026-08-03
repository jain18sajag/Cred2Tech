const directCustomerAuthService = require('../services/direct.customer.auth.service');
const { sendCaughtError } = require('../utils/sendError');
const { SSO_COOKIE_NAME, signSsoToken, verifySsoToken, ssoCookieOptions, clearSsoCookieOptions } = require('../utils/ssoCookie');
const { notifySchemeRevoke } = require('../utils/crossAppRevoke');
const prisma = require('../../config/db');

async function sendOtp(req, res) {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ error: 'A valid 10-digit mobile number is required' });
    }

    const result = await directCustomerAuthService.sendOtp(String(mobile).trim());
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to send OTP');
  }
}

async function verifyOtp(req, res) {
  try {
    const { mobile, otp } = req.body;
    if (!mobile || !otp) {
      return res.status(400).json({ error: 'Mobile and OTP are required' });
    }

    const trimmedMobile = String(mobile).trim();
    const result = await directCustomerAuthService.verifyOtp(trimmedMobile, String(otp).trim());
    // Bootstraps a silent login on scheme.cred2tech.com the next time that
    // app is opened — additive, doesn't touch the bearer-token response below.
    res.cookie(SSO_COOKIE_NAME, signSsoToken(trimmedMobile), ssoCookieOptions(req));
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to verify OTP');
  }
}

// Called by the frontend once, on initial load, only when it has no local
// session token — silently logs the user in if they were recently
// authenticated on scheme.cred2tech.com (proven by the shared c2t_sso cookie
// set on that app's own OTP verify). No cookie / invalid / expired → 401,
// frontend just falls back to showing the normal login screen.
async function ssoCheck(req, res) {
  try {
    const token = req.cookies?.[SSO_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ success: false, error: 'No SSO session' });
    }

    let mobile;
    try {
      mobile = verifySsoToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired SSO session' });
    }

    const result = await directCustomerAuthService.ssoLogin(mobile);
    // Refresh the cookie's TTL so a user actively bouncing between the two
    // apps doesn't get logged out of the silent-SSO window mid-session.
    res.cookie(SSO_COOKIE_NAME, signSsoToken(mobile), ssoCookieOptions(req));
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to check SSO session');
  }
}

// Just clears the SSO bootstrap cookie (stops a *future* silent relogin) —
// does NOT revoke the caller's own active session. See `logout` below for
// the real, full cross-app logout; the frontend calls both.
async function ssoLogout(req, res) {
  res.clearCookie(SSO_COOKIE_NAME, clearSsoCookieOptions(req));
  return res.status(200).json({ success: true });
}

// Real logout: revokes every session this MSME user has on THIS app (so the
// bearer token dies immediately, not just at its natural 1-day expiry), then
// tells scheme.cred2tech.com's backend to do the same for the same mobile —
// so logging out here ends both apps' sessions, not just this one's cookie.
async function logout(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { mobile: true } });
    await directCustomerAuthService.logout(req.user.id);
    res.clearCookie(SSO_COOKIE_NAME, clearSsoCookieOptions(req));
    if (user?.mobile) {
      await notifySchemeRevoke(user.mobile); // best-effort, bounded — never blocks/fails local logout
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to log out');
  }
}

// Server-to-server only — called by scheme.cred2tech.com's backend when a
// user logs out over there. Authenticated by a short-lived token signed with
// the same shared CRED2TECH_SSO_SECRET used for the SSO bootstrap cookie
// (not a normal user bearer token, and not a browser-facing endpoint).
async function ssoRevoke(req, res) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing signed revoke token' });
    }

    let mobile;
    try {
      mobile = verifySsoToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired revoke token' });
    }

    const result = await directCustomerAuthService.ssoRevoke(mobile);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to process cross-app revoke');
  }
}

// Server-to-server only — called by scheme.cred2tech.com's backend with
// whatever verified name/dob/PAN it has for this mobile, so this app already
// has it the first time the person actually shows up here. Same signed-token
// auth as sso-revoke; not a browser-facing endpoint.
async function ssoProfileSync(req, res) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Missing signed sync token' });
    }

    let mobile;
    try {
      mobile = verifySsoToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired sync token' });
    }

    const { name, dob, pan_number } = req.body || {};
    const result = await directCustomerAuthService.ssoProfileSync(mobile, { name, dob, pan_number });
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to process cross-app profile sync');
  }
}

module.exports = { sendOtp, verifyOtp, ssoCheck, ssoLogout, logout, ssoRevoke, ssoProfileSync };
