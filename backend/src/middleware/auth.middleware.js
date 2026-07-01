const { verifyToken } = require('../utils/jwt');
const prisma = require('../../config/db');

async function authenticate(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

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
