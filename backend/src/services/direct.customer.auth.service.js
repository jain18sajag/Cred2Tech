const crypto = require('crypto');
const prisma = require('../../config/db');
const { generateToken } = require('../utils/jwt');
const { hashPassword } = require('../utils/hash');

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const directCustomerAuthService = {
  sendOtp: async (mobile) => {
    // 5 minutes expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    
    // Check for recent requests (rate limit)
    const lastRecord = await prisma.loginOtp.findFirst({
      where: { mobile, purpose: 'MSME_CUSTOMER_LOGIN' },
      orderBy: { created_at: 'desc' }
    });

    if (lastRecord) {
      const timeDiffMs = new Date() - lastRecord.created_at;
      if (timeDiffMs < 30 * 1000) {
        throw new Error('Please wait 30 seconds before requesting another OTP.');
      }
    }

    await prisma.loginOtp.create({
      data: {
        mobile,
        otp_hash: otpHash,
        purpose: 'MSME_CUSTOMER_LOGIN',
        expires_at: expiresAt
      }
    });

    const isDev = process.env.NODE_ENV !== 'production';

    // In a real production scenario, trigger SMS Gateway here.
    return {
      success: true,
      otp: isDev ? otp : undefined,
      message: isDev ? 'OTP returned for development' : 'OTP sent via SMS'
    };
  },

  verifyOtp: async (mobile, otp) => {
    const record = await prisma.loginOtp.findFirst({
      where: {
        mobile,
        purpose: 'MSME_CUSTOMER_LOGIN',
        is_verified: false
      },
      orderBy: { created_at: 'desc' }
    });

    if (!record) {
      throw new Error('No active OTP request found for this mobile number.');
    }

    if (record.attempt_count >= 5) {
      throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    if (new Date() > record.expires_at) {
      throw new Error('OTP has expired. Please request a new one.');
    }

    const hashedInput = hashOtp(otp);
    if (hashedInput !== record.otp_hash) {
      await prisma.loginOtp.update({
        where: { id: record.id },
        data: { attempt_count: { increment: 1 } }
      });
      throw new Error('Invalid OTP');
    }

    await prisma.loginOtp.update({
      where: { id: record.id },
      data: {
        is_verified: true,
        verified_at: new Date()
      }
    });

    // Resolve Platform Tenant (CRED2TECH)
    const cred2techTenant = await prisma.tenant.findFirst({
      where: { type: 'CRED2TECH', status: 'ACTIVE' }
    });

    if (!cred2techTenant) {
      throw new Error('Platform configuration error: CRED2TECH tenant not found.');
    }

    // Resolve MSME_CUSTOMER Role
    const role = await prisma.role.findUnique({
      where: { name: 'MSME_CUSTOMER' }
    });

    if (!role) {
      throw new Error('Platform configuration error: MSME_CUSTOMER role not found.');
    }

    // Upsert User
    const email = `${mobile}@direct.cred2tech.local`;
    const randomPassword = crypto.randomUUID();
    const passwordHash = await hashPassword(randomPassword);

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        mobile,
        name: `Customer_${mobile}`,
        password_hash: passwordHash,
        role_id: role.id,
        tenant_id: cred2techTenant.id,
        status: 'ACTIVE'
      },
      update: {
        last_login_at: new Date()
      }
    });

    const tokenPayload = {
      userId: user.id,
      roleId: user.role_id,
      roleName: 'MSME_CUSTOMER',
      tenantId: user.tenant_id,
    };

    const token = generateToken(tokenPayload);
    const { password_hash, ...safeUser } = user;

    return {
      success: true,
      user: safeUser,
      token,
      is_new_user: user.created_at.getTime() === user.updated_at.getTime()
    };
  }
};

module.exports = directCustomerAuthService;
