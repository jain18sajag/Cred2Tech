const crypto = require('crypto');
const prisma = require('../../config/db');

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const otpService = {
  sendOtp: async (mobile, purpose, targetType, targetId, tenantId, userId) => {
    // 5 minutes expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = generateOtp();
    const otpHash = hashOtp(otp);

    await prisma.otpVerification.create({
      data: {
        tenant_id: tenantId,
        created_by_user_id: userId,
        mobile,
        otp_hash: otpHash,
        purpose,
        target_type: targetType,
        target_id: targetId,
        expires_at: expiresAt
      }
    });

    const isDev = process.env.NODE_ENV !== 'production';

    return {
      success: true,
      otp: isDev ? otp : undefined,
      message: isDev ? 'OTP returned for development' : 'OTP sent via SMS'
    };
  },

  verifyOtp: async (otp, targetType, targetId, tenantId) => {
    const record = await prisma.otpVerification.findFirst({
      where: {
        tenant_id: tenantId,
        target_type: targetType,
        target_id: targetId,
        is_verified: false
      },
      orderBy: { created_at: 'desc' }
    });

    if (!record) {
      throw new Error('No active OTP request found for this target.');
    }

    if (record.attempt_count >= 5) {
      throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    if (new Date() > record.expires_at) {
      throw new Error('OTP has expired. Please request a new one.');
    }

    const hashedInput = hashOtp(otp);
    if (hashedInput !== record.otp_hash) {
      await prisma.otpVerification.update({
        where: { id: record.id },
        data: { attempt_count: { increment: 1 } }
      });
      throw new Error('Invalid OTP');
    }

    await prisma.otpVerification.update({
      where: { id: record.id },
      data: {
        is_verified: true,
        verified_at: new Date()
      }
    });

    if (targetType === 'CUSTOMER') {
      await prisma.customer.update({
        where: { id: targetId },
        data: { mobile_verified: true }
      });
    } else if (targetType === 'APPLICANT') {
      await prisma.applicant.update({
        where: { id: targetId },
        data: { otp_verified: true }
      });
    }

    return { success: true, message: 'OTP verified successfully' };
  },

  resendOtp: async (mobile, purpose, targetType, targetId, tenantId, userId) => {
    const lastRecord = await prisma.otpVerification.findFirst({
      where: {
        tenant_id: tenantId,
        target_type: targetType,
        target_id: targetId
      },
      orderBy: { created_at: 'desc' }
    });

    if (lastRecord) {
      const timeDiffMs = new Date() - lastRecord.created_at;
      if (timeDiffMs < 30 * 1000) {
        throw new Error('Please wait 30 seconds before requesting another OTP.');
      }
    }

    return await otpService.sendOtp(mobile, purpose, targetType, targetId, tenantId, userId);
  }
};

module.exports = otpService;
