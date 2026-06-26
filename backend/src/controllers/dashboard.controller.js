const svc = require('../services/dashboard.service');

// ─── DSA Dashboard Controllers ────────────────────────────────────────────────

async function getDsaSummary(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getDsaSummary(req.user, period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/dsa/summary]', err);
    res.status(500).json({ error: 'Failed to fetch DSA summary.' });
  }
}

async function getDsaWallet(req, res) {
  try {
    const balance = await svc.getDsaWalletBalance(req.user);
    res.json({ balance });
  } catch (err) {
    console.error('[dashboard/dsa/wallet]', err);
    res.status(500).json({ error: 'Failed to fetch wallet balance.' });
  }
}

async function getDsaCases(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getDsaRecentCases(req.user, period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/dsa/cases]', err);
    res.status(500).json({ error: 'Failed to fetch recent cases.' });
  }
}

async function getDsaStageSummary(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getDsaStageSummary(req.user, period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/dsa/stage-summary]', err);
    res.status(500).json({ error: 'Failed to fetch stage summary.' });
  }
}

// ─── Platform Dashboard Controllers (SUPER_ADMIN only) ───────────────────────

async function getPlatformSummary(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getPlatformSummary(period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/platform/summary]', err);
    res.status(500).json({ error: 'Failed to fetch platform summary.' });
  }
}

async function getPlatformApiUsage(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getPlatformApiUsage(period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/platform/api-usage]', err);
    res.status(500).json({ error: 'Failed to fetch API usage.' });
  }
}

async function getPlatformFunnel(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end } = req.query;
    const data = await svc.getPlatformFunnel(period, custom_start, custom_end);
    res.json(data);
  } catch (err) {
    console.error('[dashboard/platform/funnel]', err);
    res.status(500).json({ error: 'Failed to fetch customer funnel.' });
  }
}

async function getTopDsas(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end, limit = 5 } = req.query;
    const data = await svc.getTopDsas(period, custom_start, custom_end, parseInt(limit));
    res.json(data);
  } catch (err) {
    console.error('[dashboard/platform/top-dsas]', err);
    res.status(500).json({ error: 'Failed to fetch top DSAs.' });
  }
}

async function getTopLenders(req, res) {
  try {
    const { period = 'mtd', custom_start, custom_end, limit = 5 } = req.query;
    const data = await svc.getTopLenders(period, custom_start, custom_end, parseInt(limit));
    res.json(data);
  } catch (err) {
    console.error('[dashboard/platform/top-lenders]', err);
    res.status(500).json({ error: 'Failed to fetch top lenders.' });
  }
}

module.exports = {
  getDsaSummary,
  getDsaWallet,
  getDsaCases,
  getDsaStageSummary,
  getPlatformSummary,
  getPlatformApiUsage,
  getPlatformFunnel,
  getTopDsas,
  getTopLenders,
};
