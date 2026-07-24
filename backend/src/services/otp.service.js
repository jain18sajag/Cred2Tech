const crypto = require('crypto');
const prisma = require('../../config/db');

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * OTP endpoints accept an arbitrary target_id in the request body. Without this
 * check, any authenticated tenant user could send/verify/resend an OTP against
 * a customer or applicant they don't own (IDOR) — e.g. an MSME_CUSTOMER forcing
 * verification on another customer's mobile-verification record. `user` is the
 * req.user object (role, tenant_id, id).
 */
async function assertOtpTargetOwnership(targetType, targetId, user) {
  if (targetType === 'CUSTOMER') {
    const customer = await prisma.customer.findUnique({
      where: { id: targetId },
      select: { tenant_id: true, created_by_user_id: true }
    });
    if (!customer || customer.tenant_id !== user.tenant_id) {
      throw Object.assign(new Error('Target not found or access denied'), { status: 403 });
    }
    if (user.role === 'MSME_CUSTOMER' && customer.created_by_user_id !== user.id) {
      throw Object.assign(new Error('Target not found or access denied'), { status: 403 });
    }
  } else if (targetType === 'APPLICANT') {
    const applicant = await prisma.applicant.findUnique({
      where: { id: targetId },
      include: { case: { select: { tenant_id: true, msme_customer_user_id: true } } }
    });
    if (!applicant || !applicant.case || applicant.case.tenant_id !== user.tenant_id) {
      throw Object.assign(new Error('Target not found or access denied'), { status: 403 });
    }
    if (user.role === 'MSME_CUSTOMER' && applicant.case.msme_customer_user_id !== user.id) {
      throw Object.assign(new Error('Target not found or access denied'), { status: 403 });
    }
  } else {
    throw Object.assign(new Error('Unsupported OTP target type'), { status: 400 });
  }
}

const otpService = {
  sendOtp: async (mobile, purpose, targetType, targetId, tenantId, userId) => {
    // 5 minutes expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = generateOtp();

  console.log('[OTP GENERATED]', {
    otp,
    mobile,
    purpose,
    targetType,
    targetId,
    tenantId,
    createdAt: new Date().toISOString()
  });
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
console.log('[OTP SERVICE]', {
  nodeEnv: process.env.NODE_ENV,
  isDev,
  mobile,
  targetType,
  targetId,
  generatedOtp: isDev ? otp : '[hidden]'
})
    const response = {
  success: true,
  otp: isDev ? otp : undefined,
  message: isDev
    ? 'OTP returned for development'
    : 'OTP sent via SMS'
};

console.log('[OTP RESPONSE]', response);

return response;
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
        data: { 
          mobile_verified: true,
          business_mobile: record.mobile // Use the number that was actually verified
        }
      });
    } else if (targetType === 'APPLICANT') {
      await prisma.applicant.update({
        where: { id: targetId },
        data: { 
          otp_verified: true,
          mobile: record.mobile // Use the number that was actually verified
        }
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
module.exports.assertOtpTargetOwnership = assertOtpTargetOwnership;
