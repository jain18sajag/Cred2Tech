const { verifyToken } = require('../utils/jwt');
const prisma = require('../../config/db');

async function authenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  // NOTE: a `?token=` query-string fallback used to exist here — dropped
  // because bearer tokens in URLs leak into access logs, browser history,
  // and Referer headers on outbound links.

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = verifyToken(token);
    const userId = decoded.id || decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        tenant: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Account is not active.' });
    }

    // Session revocation check: a token surviving until its JWT expiry is
    // otherwise unstoppable even after "Revoke session" / logout / password
    // change flip is_active=false on the matching UserSession row.
    const session = await prisma.userSession.findUnique({
      where: { session_token: token },
      select: { is_active: true }
    });
    if (session && !session.is_active) {
      return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
    }
    if (session) {
      // Best-effort activity heartbeat — don't block the request if this fails.
      prisma.userSession.update({
        where: { session_token: token },
        data: { last_activity_at: new Date() }
      }).catch(() => {});
    }

    req.user = {
      id: user.id,
      role: user.role.name,
      tenant_id: user.tenant_id,
      tenant_type: user.tenant.type,
      hierarchy_level: user.hierarchy_level,
      hierarchy_path: user.hierarchy_path
    };

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

module.exports = {
  authenticate,
};
