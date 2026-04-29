const prisma = require('../../config/db');
const walletService = require('../services/wallet.service');
const pricingService = require('../services/pricing.service');

// Admin side management for Wallets

async function getPricing(req, res) {
  try {
    const pricing = await prisma.apiPricing.findMany({ orderBy: { id: 'asc' } });

    // Use raw query for discounts because model might not be in Prisma client yet
    let discounts = [];
    try {
      if (prisma.volumeDiscount) {
        discounts = await prisma.volumeDiscount.findMany({ where: { is_active: true }, orderBy: { min_topup_amount: 'asc' } });
      } else {
        discounts = await prisma.$queryRawUnsafe(`SELECT * FROM volume_discounts WHERE is_active = true ORDER BY min_topup_amount ASC`);
      }
    } catch (e) {
      console.warn('VolumeDiscount model not ready, using empty array');
    }

    res.json({ pricing, discounts });
  } catch (error) {
    console.error('getPricing error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing' });
  }
}

async function updatePricing(req, res) {
  try {
    const { id } = req.params;
    const { api_name, description, vendor_cost, credit_cost, is_active } = req.body;

    const pricing = await prisma.apiPricing.update({
      where: { id: parseInt(id, 10) },
      data: {
        api_name,
        description,
        vendor_cost: typeof vendor_cost === 'number' ? vendor_cost : parseFloat(vendor_cost),
        default_credit_cost: typeof credit_cost === 'number' ? credit_cost : parseInt(credit_cost, 10),
        is_active,
        updated_by: req.user.id
      }
    });

    // Admin updated pricing, immediately invalidate the memory caches
    pricingService.clearPricingCache();

    res.json(pricing);
  } catch (error) {
    console.error('updatePricing error:', error);
    res.status(500).json({ error: 'Failed to update pricing' });
  }
}

async function topupWallet(req, res) {
  // #swagger.tags = ['Admin Controls', 'Wallet']
  // #swagger.summary = 'Topup a DSA Wallet'
  // #swagger.description = 'Manually add credits to a DSA tenant wallet. Only usable by Superadmins.'
  /* #swagger.parameters['tenant_id'] = { description: 'ID of the tenant', type: 'integer' } */
  /* #swagger.requestBody = {
       content: { 'application/json': { schema: { type: 'object', properties: { credits: { type: 'integer', example: 100 } } } } }
  } */
  /* #swagger.responses[200] = { description: 'Topup successful', schema: { type: 'object', properties: { message: { type: 'string', example: 'Topup successful' }, wallet: { $ref: '#/components/schemas/Tenant' } } } } */
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
  // #swagger.tags = ['Admin Controls', 'Wallet']
  // #swagger.summary = 'Deduct from a DSA Wallet'
  // #swagger.description = 'Manually subtract credits natively.'
  /* #swagger.requestBody = {
       content: { 'application/json': { schema: { type: 'object', properties: { credits: { type: 'integer', example: 50 }, remarks: { type: 'string', example: 'Manual deduction' } } } } }
  } */
  try {
    const { tenant_id } = req.params;
    const { credits, remarks } = req.body;
    if (!tenant_id || !credits) return res.status(400).json({ error: 'Tenant ID and credits are required' });

    const deduction = await prisma.$transaction(async (tx) => {
      const wallet = await tx.tenantWallet.findUnique({ where: { tenant_id: parseInt(tenant_id, 10) } });
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
  // #swagger.tags = ['Admin Controls']
  // #swagger.summary = 'Get all DSA wallets'
  /* #swagger.responses[200] = { description: 'List of all tenants and wallet balances natively offset paginated' } */
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where: { type: 'DSA' },
        skip: offset,
        take: limit,
        include: {
          wallet: true,
          _count: { select: { api_logs: true } }
        }
      }),
      prisma.tenant.count({ where: { type: 'DSA' } })
    ]);

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

    res.json({ tenants: mapped, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
}

async function getLedger(req, res) {
  // #swagger.tags = ['Admin Controls', 'Wallet']
  // #swagger.summary = 'Fetch Tenant Wallet Ledger'
  /* #swagger.responses[200] = {
      description: 'Paginated historical transaction records',
      schema: { type: 'object', properties: { ledger: { type: 'array', items: { $ref: '#/components/schemas/WalletTransaction' } }, total: { type: 'integer' }, page: { type: 'integer' }, totalPages: { type: 'integer' } } }
  } */
  try {
    const { tenant_id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;

    const [ledger, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { tenant_id: parseInt(tenant_id, 10) },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.walletTransaction.count({ where: { tenant_id: parseInt(tenant_id, 10) } })
    ]);

    res.json({ ledger, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
}

async function updateVolumeDiscounts(req, res) {
  try {
    const { slabs } = req.body;

    // Use raw SQL because model might not be in Prisma client yet
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM volume_discounts`);
      if (slabs && slabs.length > 0) {
        for (const s of slabs) {
          await tx.$executeRaw`INSERT INTO volume_discounts (min_topup_amount, bonus_percentage) VALUES (${parseFloat(s.min_topup_amount)}, ${parseFloat(s.bonus_percentage)})`;
        }
      }
    });

    res.json({ message: 'Volume discounts updated' });
  } catch (error) {
    console.error('updateVolumeDiscounts error:', error);
    res.status(500).json({ error: 'Failed to update volume discounts' });
  }
}

module.exports = {
  getPricing,
  updatePricing,
  updateVolumeDiscounts,
  topupWallet,
  deductWallet,
  getAllWallets,
  getLedger
};
