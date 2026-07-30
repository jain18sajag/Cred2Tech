const directCustomerAuthService = require('../services/direct.customer.auth.service');
const { sendCaughtError } = require('../utils/sendError');
const { SSO_COOKIE_NAME, signSsoToken, verifySsoToken, ssoCookieOptions, clearSsoCookieOptions } = require('../utils/ssoCookie');

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

async function ssoLogout(req, res) {
  res.clearCookie(SSO_COOKIE_NAME, clearSsoCookieOptions(req));
  return res.status(200).json({ success: true });
}

module.exports = { sendOtp, verifyOtp, ssoCheck, ssoLogout };
