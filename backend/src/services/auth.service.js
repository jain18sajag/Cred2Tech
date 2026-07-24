const prisma = require('../../config/db');
const { comparePassword, hashPassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');
const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

async function loginUser(email, password, ipAddress) {
  const normalizedEmail = email.toLowerCase().trim();
  
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { role: true, tenant: true },
  });

  const now = new Date();

  // IP Lockout Check: After 20 failed attempts from this IP within 15 minutes, block IP
  const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
  const ipFailures = await prisma.loginAttempt.count({
    where: {
      ip_address: ipAddress,
      success: false,
      created_at: { gte: fifteenMinsAgo }
    }
  });

  if (ipFailures >= 20) {
    throw new Error('Too many requests from this IP. Please try again later.');
  }

  // User Lockout Check
  if (user && user.locked_until && user.locked_until > now) {
    await prisma.loginAttempt.create({ data: { email: normalizedEmail, ip_address: ipAddress, success: false }});
    throw new Error('Account is temporarily locked. Please try again later.');
  }

  const placeholderHash = "$2b$10$abcdefghijklmnopqrstuvwxyzaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const hashToCompare = user ? user.password_hash : placeholderHash;
  const isPasswordValid = await comparePassword(password, hashToCompare);

  if (!user || !isPasswordValid || user.status !== 'ACTIVE') {
    await prisma.loginAttempt.create({ data: { email: normalizedEmail, ip_address: ipAddress, success: false }});
    
    if (user) {
      let failedAttempts = user.failed_login_attempts + 1;
      let lockedUntil = null;
      
      // Lock logic: 5 fails -> 15 min lock, 10 fails -> 60 min lock
      if (failedAttempts >= 10) {
        lockedUntil = new Date(now.getTime() + 60 * 60 * 1000); // 60 mins
      } else if (failedAttempts >= 5) {
        lockedUntil = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failed_login_attempts: failedAttempts, locked_until: lockedUntil }
      });
    }

    throw new Error('Invalid email or password');
  }

  // Success login
  await prisma.loginAttempt.create({ data: { email: normalizedEmail, ip_address: ipAddress, success: true }});

  await prisma.user.update({
    where: { id: user.id },
    data: { 
      last_login_at: now,
      failed_login_attempts: 0,
      locked_until: null
    },
  });

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: user.role.name,
    tenantId: user.tenant_id,
    hierarchyLevel: user.hierarchy_level,
    hierarchyPath: user.hierarchy_path,
  };

  const token = generateToken(tokenPayload);

  // Manage Sessions
  await prisma.userSession.create({
    data: {
      user_id: user.id,
      session_token: token,
      ip_address: ipAddress,
      is_active: true,
      last_activity_at: now
    }
  });

  const activeSessionsCount = await prisma.userSession.count({
    where: { user_id: user.id, is_active: true }
  });

  const { password_hash, ...userWithoutPassword } = user;

  return { user: { ...userWithoutPassword, last_login_at: now }, token, activeSessionsCount };
}

async function initiatePasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase().trim() } });
  if (!user || user.status !== 'ACTIVE') return;

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    }
  });

  // Previously just console.log'd the raw reset token (H-2/M-2) — never
  // functional in prod, and the token itself ended up in application logs.
  const resetUrl = `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')}/reset-password?token=${rawToken}`;
  const sent = await sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Cred2Tech Platform'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: email,
    subject: 'Reset your Cred2Tech password',
    text: `Reset your password using this link (valid for 1 hour): ${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
    html: `<p>Reset your password using the link below (valid for 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
  if (!sent) {
    console.warn(`[auth.service] Password reset email could not be sent to ${email} — SMTP not configured or send failed. Token was still issued.`);
  }
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token_hash: tokenHash },
    include: { user: true }
  });

  if (!resetToken || resetToken.used || resetToken.expires_at < new Date()) {
    throw new Error('Invalid or expired token');
  }

  validatePasswordPolicy(newPassword);
  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.user_id },
      data: { password_hash: newHash, locked_until: null, failed_login_attempts: 0 }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true }
    }),
    prisma.userSession.updateMany({
      where: { user_id: resetToken.user_id },
      data: { is_active: false }
    })
  ]);
}

module.exports = {
  loginUser,
  initiatePasswordReset,
  resetPassword
};
