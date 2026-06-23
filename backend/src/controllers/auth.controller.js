const authService = require('../services/auth.service');
const prisma = require('../../config/db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { user, token, activeSessionsCount } = await authService.loginUser(email, password, ipAddress);

    // Limit sessions
    if (activeSessionsCount > 3) {
      // You can notify or automatically revoke the oldest, or just pass a warning.
    }

    res.json({ message: 'Login successful', user, token });
  } catch (error) {
    res.status(401).json({ error: error.message || 'Authentication failed' });
  }
}

async function getMe(req, res) {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, tenant: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
}

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Always return a success response to prevent email enumeration
    res.json({ message: 'If the email is registered, a password reset link has been sent.' });

    await authService.initiatePasswordReset(email.toLowerCase().trim());
  } catch (error) {
    console.error('forgotPassword error', error);
  }
}

async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    await authService.resetPassword(token, newPassword);
    res.json({ message: 'Password has been successfully reset.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getSessions(req, res) {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { user_id: req.user.id, is_active: true },
      orderBy: { last_activity_at: 'desc' }
    });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

async function revokeSession(req, res) {
  try {
    const sessionId = parseInt(req.params.id, 10);
    const session = await prisma.userSession.findUnique({ where: { id: sessionId } });

    if (!session || session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to revoke this session' });
    }

    await prisma.userSession.update({
      where: { id: sessionId },
      data: { is_active: false }
    });

    res.json({ message: 'Session revoked successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke session' });
  }
}

module.exports = {
  login,
  getMe,
  forgotPassword,
  resetPassword,
  getSessions,
  revokeSession
};
