const prisma = require('../../config/db');

async function getDsaPerformance(req, res) {
  try {
    // Aggregated metrics grouped by tenant_id
    const metrics = await prisma.user.groupBy({
      by: ['tenant_id'],
      _count: {
        id: true,
      },
    });
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
}

module.exports = {
  getDsaPerformance
};
