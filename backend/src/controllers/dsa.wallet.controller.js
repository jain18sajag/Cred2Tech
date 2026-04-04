const prisma = require('../../config/db');
const walletService = require('../services/wallet.service');
const pricingService = require('../services/pricing.service');

async function getBalance(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const balance = await walletService.getWalletBalance(tenant_id);
    res.json({ balance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
}

async function getTransactions(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const transactions = await prisma.walletTransaction.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

async function getUsageHistory(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const logs = await prisma.apiUsageLog.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: {
        customer: { select: { business_name: true, business_pan: true } },
        user: { select: { name: true } }
      }
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch API usage' });
  }
}

async function getApiCosts(req, res) {
   try {
      const matrix = await pricingService.getTenantCostsMatrix(req.user.tenant_id);
      res.json(matrix);
   } catch(error) {
      res.status(500).json({ error: 'Failed to fetch pricing config' });
   }
}

module.exports = {
  getBalance,
  getTransactions,
  getUsageHistory,
  getApiCosts
};
