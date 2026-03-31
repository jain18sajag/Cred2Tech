const prisma = require('../../config/db');

async function getRoles(req, res) {
  try {
    const roles = await prisma.role.findMany({ orderBy: { id: 'asc' } });
    res.json(roles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
}

module.exports = { getRoles };
