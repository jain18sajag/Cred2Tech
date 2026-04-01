const otpService = require('../services/otp.service');

const otpController = {
  send: async (req, res, next) => {
    try {
      const { mobile, purpose, target_type, target_id } = req.body;
      const tenantId = req.user.tenant_id;
      const userId = req.user.id;

      if (!mobile || !purpose || !target_type || !target_id) {
        return res.status(400).json({ error: 'Missing required OTP send parameters' });
      }

      const result = await otpService.sendOtp(mobile, purpose, target_type, parseInt(target_id), tenantId, userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  verify: async (req, res, next) => {
    try {
      const { otp, target_type, target_id } = req.body;
      const tenantId = req.user.tenant_id;

      if (!otp || !target_type || !target_id) {
        return res.status(400).json({ error: 'Missing required OTP verification parameters' });
      }

      const result = await otpService.verifyOtp(otp, target_type, parseInt(target_id), tenantId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  resend: async (req, res, next) => {
    try {
      const { mobile, purpose, target_type, target_id } = req.body;
      const tenantId = req.user.tenant_id;
      const userId = req.user.id;

      if (!mobile || !purpose || !target_type || !target_id) {
        return res.status(400).json({ error: 'Missing required OTP resend parameters' });
      }

      const result = await otpService.resendOtp(mobile, purpose, target_type, parseInt(target_id), tenantId, userId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

module.exports = otpController;
