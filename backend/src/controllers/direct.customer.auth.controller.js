const directCustomerAuthService = require('../services/direct.customer.auth.service');
const { sendCaughtError } = require('../utils/sendError');

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

    const result = await directCustomerAuthService.verifyOtp(String(mobile).trim(), String(otp).trim());
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to verify OTP');
  }
}

module.exports = { sendOtp, verifyOtp };
