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

const razorpayService = require('../services/razorpay.service');

async function createOrder(req, res) {
  try {
    const { amount_inr } = req.body;
    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const minAmount = parseInt(process.env.WALLET_TOPUP_MIN_AMOUNT) || 100;
    const maxAmount = parseInt(process.env.WALLET_TOPUP_MAX_AMOUNT) || 500000;

    if (!amount_inr || amount_inr < minAmount || amount_inr > maxAmount) {
      return res.status(400).json({ error: `Invalid top-up amount. Must be between ${minAmount} and ${maxAmount} INR.` });
    }

    const amount_paise = Math.floor(amount_inr * 100);
    const credits_to_add = walletService.calculateCreditsForAmount(amount_inr);

    const topup = await prisma.walletTopupRequest.create({
      data: {
        tenant_id,
        requested_by_user_id: user_id,
        amount_inr,
        amount_paise,
        credits_to_add,
        status: 'INITIATED',
      }
    });

    const receipt = `wallet_topup_${topup.id}`;
    const order = await razorpayService.createOrder(amount_paise, receipt, 'INR');

    await prisma.walletTopupRequest.update({
      where: { id: topup.id },
      data: {
        razorpay_order_id: order.id,
        status: 'CREATED'
      }
    });

    res.json({
      key_id: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: amount_paise,
      currency: 'INR',
      topup_id: topup.id
    });
  } catch (error) {
    console.error("createOrder error:", error);
    res.status(500).json({ error: 'Failed to create top-up order' });
  }
}

async function verifyCheckout(req, res) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, topup_id } = req.body;
    const tenant_id = req.user.tenant_id;

    const isValid = razorpayService.verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const topup = await prisma.walletTopupRequest.findUnique({ where: { id: parseInt(topup_id) } });
    if (!topup || topup.tenant_id !== tenant_id || topup.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Invalid topup request' });
    }

    if (topup.status === 'CREDITED') {
      return res.json({ status: 'CREDITED', message: 'Wallet already credited.' });
    }

    await prisma.walletTopupRequest.update({
      where: { id: topup.id },
      data: {
        status: 'VERIFIED',
        verified_at: new Date(),
        razorpay_payment_id,
        raw_checkout_payload: req.body
      }
    });

    const payment = await razorpayService.getPayment(razorpay_payment_id);
    if (payment.status === 'captured') {
       try {
         const creditResult = await walletService.creditWalletForRazorpayTopup(topup.id, payment, payment.id);
         return res.json({ status: creditResult.status, message: 'Payment verified and wallet credited successfully.' });
       } catch (err) {
         console.error("Credit error:", err.message);
         return res.json({ status: 'FAILED', message: err.message });
       }
    }

    res.json({ status: 'PAID_PENDING_WEBHOOK', message: 'Payment verified, credits will be updated shortly' });
  } catch (error) {
    console.error("verifyCheckout error:", error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
}

async function getWalletSummary(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const wallet = await prisma.tenantWallet.findUnique({ where: { tenant_id } });
    
    const employeeAllocations = await prisma.employeeWallet.aggregate({
      where: { tenant_id, status: 'ACTIVE' },
      _sum: { allocated_balance: true, consumed_credits: true }
    });

    res.json({
      unallocated_balance: wallet ? wallet.balance : 0,
      employee_allocated: employeeAllocations._sum.allocated_balance || 0,
      employee_consumed: employeeAllocations._sum.consumed_credits || 0,
      total_available: (wallet ? wallet.balance : 0) + (employeeAllocations._sum.allocated_balance || 0)
    });
  } catch (error) {
    console.error('getWalletSummary error:', error);
    res.status(500).json({ error: 'Failed to fetch wallet summary' });
  }
}

async function getEmployees(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const employees = await prisma.user.findMany({
      where: { tenant_id },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: { select: { name: true } },
        EmployeeWallet: {
          select: { allocated_balance: true, consumed_credits: true, status: true, updated_at: true }
        }
      }
    });
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
}

async function allocateEmployeeCredits(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const { userId } = req.params;
    const { credits, note } = req.body;

    if (!credits || credits <= 0) return res.status(400).json({ error: 'Invalid credits' });

    const targetUser = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!targetUser || targetUser.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Unauthorized to allocate to this employee' });
    }

    await prisma.$transaction(async (tx) => {
      const tenantWallet = await tx.tenantWallet.findUnique({ where: { tenant_id } });
      if (!tenantWallet || tenantWallet.balance < credits) {
        throw new Error('Insufficient unallocated tenant credits');
      }

      await tx.tenantWallet.update({
        where: { tenant_id },
        data: { balance: { decrement: credits } }
      });

      const empWallet = await tx.employeeWallet.upsert({
        where: { tenant_id_user_id: { tenant_id, user_id: targetUser.id } },
        update: { allocated_balance: { increment: credits } },
        create: { tenant_id, user_id: targetUser.id, allocated_balance: credits, status: 'ACTIVE' }
      });

      await tx.employeeWalletTransaction.create({
        data: {
          tenant_id,
          user_id: targetUser.id,
          type: 'ALLOCATE',
          credits,
          opening_balance: empWallet.allocated_balance - credits,
          closing_balance: empWallet.allocated_balance,
          created_by_user_id: req.user.id,
          metadata: { note }
        }
      });

      await tx.walletTransaction.create({
        data: {
          tenant_id,
          amount: credits,
          transaction_type: 'DEBIT',
          reference_type: 'EMPLOYEE_ALLOCATION',
          reference_id: empWallet.id,
          remarks: `Allocated to user ${targetUser.id}: ${note || ''}`,
          balance_after: tenantWallet.balance - credits,
          created_by: req.user.id
        }
      });
    }, { isolationLevel: 'Serializable' });

    res.json({ message: 'Credits allocated successfully' });
  } catch (error) {
    res.status(error.message === 'Insufficient unallocated tenant credits' ? 400 : 500).json({ error: error.message });
  }
}

async function revokeEmployeeCredits(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const { userId } = req.params;
    const { credits, note } = req.body;

    if (!credits || credits <= 0) return res.status(400).json({ error: 'Invalid credits' });

    const targetUser = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!targetUser || targetUser.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await prisma.$transaction(async (tx) => {
      const empWallet = await tx.employeeWallet.findUnique({
        where: { tenant_id_user_id: { tenant_id, user_id: targetUser.id } }
      });

      if (!empWallet || empWallet.allocated_balance < credits) {
        throw new Error('Insufficient employee credits to revoke');
      }

      await tx.employeeWallet.update({
        where: { id: empWallet.id },
        data: { allocated_balance: { decrement: credits } }
      });

      const tenantWallet = await tx.tenantWallet.update({
        where: { tenant_id },
        data: { balance: { increment: credits } }
      });

      await tx.employeeWalletTransaction.create({
        data: {
          tenant_id,
          user_id: targetUser.id,
          type: 'REVOKE',
          credits,
          opening_balance: empWallet.allocated_balance,
          closing_balance: empWallet.allocated_balance - credits,
          created_by_user_id: req.user.id,
          metadata: { note }
        }
      });

      await tx.walletTransaction.create({
        data: {
          tenant_id,
          amount: credits,
          transaction_type: 'CREDIT',
          reference_type: 'EMPLOYEE_REVOCATION',
          reference_id: empWallet.id,
          remarks: `Revoked from user ${targetUser.id}: ${note || ''}`,
          balance_after: tenantWallet.balance,
          created_by: req.user.id
        }
      });
    }, { isolationLevel: 'Serializable' });

    res.json({ message: 'Credits revoked successfully' });
  } catch (error) {
    res.status(error.message === 'Insufficient employee credits to revoke' ? 400 : 500).json({ error: error.message });
  }
}

async function getEmployeeTransactions(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const { userId } = req.params;

    const targetUser = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!targetUser || targetUser.tenant_id !== tenant_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const txs = await prisma.employeeWalletTransaction.findMany({
      where: { tenant_id, user_id: parseInt(userId) },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    res.json(txs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
}

async function getTopups(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const topups = await prisma.walletTopupRequest.findMany({
      where: { tenant_id },
      orderBy: { created_at: 'desc' },
      take: 50
    });
    res.json(topups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch topups' });
  }
}

async function cancelTopup(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const topup_id = parseInt(req.params.id);

    const topup = await prisma.walletTopupRequest.findUnique({
      where: { id: topup_id }
    });

    if (!topup || topup.tenant_id !== tenant_id) {
      return res.status(404).json({ error: 'Top-up not found' });
    }

    if (topup.status === 'CREDITED' || topup.status === 'FAILED' || topup.status === 'REFUND_REVIEW_REQUIRED' || topup.status === 'CANCELLED') {
      return res.json(topup); // Already in a terminal state, do nothing
    }

    const updatedTopup = await prisma.walletTopupRequest.update({
      where: { id: topup_id },
      data: {
        status: 'CANCELLED',
        failure_code: 'CHECKOUT_DISMISSED',
        failure_reason: 'User closed Razorpay Checkout before completing payment',
        failed_at: new Date()
      }
    });

    res.json(updatedTopup);
  } catch (error) {
    console.error('cancelTopup error:', error);
    res.status(500).json({ error: 'Failed to cancel top-up' });
  }
}

module.exports = {
  getBalance,
  getTransactions,
  getUsageHistory,
  getApiCosts,
  createOrder,
  verifyCheckout,
  getWalletSummary,
  getEmployees,
  allocateEmployeeCredits,
  revokeEmployeeCredits,
  getEmployeeTransactions,
  getTopups,
  cancelTopup
};
