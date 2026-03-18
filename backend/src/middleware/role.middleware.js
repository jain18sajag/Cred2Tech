function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roleName) {
      return res.status(403).json({ error: 'Access denied. No role found.' });
    }

    if (!allowedRoles.includes(req.user.roleName)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }

    next();
  };
}

module.exports = {
  requireRoles,
};
