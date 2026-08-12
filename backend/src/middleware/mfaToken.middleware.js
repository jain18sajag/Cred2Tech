// Verifies the two purpose-scoped, short-lived tokens issued mid-login
// (before a real session exists): mfa_setup and mfa_pending. Kept separate
// from auth.middleware.js's `authenticate`, which only accepts fully-issued
// session tokens and explicitly rejects anything carrying a `purpose` claim —
// so a leaked setup/challenge token can never be replayed against a real
// protected route.
const prisma = require('../../config/db');
const mfaService = require('../services/mfa.service');

function extractBearer(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return null;
}

async function requireMfaSetupToken(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    const userId = mfaService.verifySetupToken(token);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, tenant: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Account is not active.' });

    req.mfaUser = user;
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Invalid token.' });
  }
}

async function requireMfaChallengeToken(req, res, next) {
  try {
    const token = extractBearer(req);
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    const { userId, challenge } = await mfaService.loadActiveChallenge(token);
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, tenant: true } });
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Account is not active.' });

    req.mfaUser = user;
    req.mfaChallenge = challenge;
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || 'Invalid token.' });
  }
}

module.exports = { requireMfaSetupToken, requireMfaChallengeToken };
