const prisma = require('../../config/db');
const walletService = require('../services/wallet.service');

// Admin side management for Wallets

async function getPricing(req, res) {
  try {
    const pricing = await prisma.apiPricing.findMany();
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pricing' });
  }
}

async function updatePricing(req, res) {
  try {
    const { id } = req.params;
    const { credit_cost, is_active } = req.body;
    const pricing = await prisma.apiPricing.update({
      where: { id: parseInt(id, 10) },
      data: { default_credit_cost: typeof credit_cost === 'number' ? credit_cost : parseInt(credit_cost, 10), is_active, updated_by: req.user.id }
    });
    res.json(pricing);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pricing' });
  }
}

async function topupWallet(req, res) {
  try {
    const { tenant_id } = req.params;
    const { credits } = req.body;
    
    if (!tenant_id || !credits) {
      return res.status(400).json({ error: 'Tenant ID and credits are required' });
    }

    const wallet = await walletService.topupWallet({
      tenantId: parseInt(tenant_id, 10),
      amount: parseInt(credits, 10),
      adminUserId: req.user.id
    });

    res.json({ message: 'Topup successful', wallet });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to topup wallet' });
  }
}

async function deductWallet(req, res) {
  try {
    const { tenant_id } = req.params;
    const { credits, remarks } = req.body;
    if (!tenant_id || !credits) return res.status(400).json({ error: 'Tenant ID and credits are required' });

    const deduction = await prisma.$transaction(async (tx) => {
        const wallet = await tx.tenantWallet.findUnique({ where: { tenant_id: parseInt(tenant_id, 10)} });
        if (!wallet || wallet.balance < credits) throw new Error("Insufficient wallet balance for this deduction");

        const updated = await tx.tenantWallet.update({
            where: { tenant_id: wallet.tenant_id },
            data: { balance: { decrement: parseInt(credits, 10) } }
        });

        await tx.walletTransaction.create({
            data: {
                tenant_id: wallet.tenant_id,
                amount: parseInt(credits, 10),
                transaction_type: 'DEBIT',
                reference_type: 'MANUAL_ADJUSTMENT',
                remarks: remarks || 'Manual Superadmin deduction',
                balance_after: updated.balance,
                created_by: req.user.id
            }
        });
        return updated;
    });

    res.json({ message: 'Deduction successful', wallet: deduction });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to deduct wallet' });
  }
}

async function getAllWallets(req, res) {
   try {
     const tenants = await prisma.tenant.findMany({
         where: { type: 'DSA' },
         include: { 
            wallet: true,
            _count: { select: { api_logs: true } }
         }
     });

     // Map last transaction natively
     const mapped = await Promise.all(tenants.map(async t => {
        const lastTx = await prisma.walletTransaction.findFirst({
           where: { tenant_id: t.id },
           orderBy: { created_at: 'desc' }
        });
        return {
           tenant_id: t.id,
           tenant_name: t.name,
           wallet_balance: t.wallet?.balance || 0,
           total_usage: t._count.api_logs,
           last_transaction_date: lastTx?.created_at || null
        };
     }));

     res.json(mapped);
   } catch (error) {
      res.status(500).json({ error: 'Failed to fetch wallets' });
   }
}

async function getLedger(req, res) {
   try {
      const { tenant_id } = req.params;
      const ledger = await prisma.walletTransaction.findMany({
         where: { tenant_id: parseInt(tenant_id, 10) },
         orderBy: { created_at: 'desc' },
         take: 100
      });
      res.json(ledger);
   } catch(e) {
      res.status(500).json({ error: 'Failed' });
   }
}

module.exports = {
  getPricing,
  updatePricing,
  topupWallet,
  deductWallet,
  getAllWallets,
  getLedger
};
