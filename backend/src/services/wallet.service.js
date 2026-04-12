const prisma = require('../../config/db');
const pricingService = require('./pricing.service');

async function getWalletBalance(tenantId) {
  const wallet = await prisma.tenantWallet.findUnique({
    where: { tenant_id: tenantId }
  });
  return wallet ? wallet.balance : 0;
}

async function checkCredits(tenantId, apiCode) {
  const cost = await pricingService.getApiCost(apiCode, tenantId);

  const wallet = await prisma.tenantWallet.findUnique({
    where: { tenant_id: tenantId }
  });

  if (!wallet || wallet.status !== 'ACTIVE') {
    throw new Error('Wallet not found or not active');
  }

  if (wallet.balance < cost) {
    const error = new Error('Insufficient credits. Please recharge wallet.');
    error.status = 402;
    throw error;
  }

  return { wallet, cost };
}

async function deductCredits({ tenantId, userId, customerId, caseId, apiCode }) {
  // Pull dynamic price hook externally before we drop into isolated transaction (prevents dirty reads on complex join queries)
  const cost = await pricingService.getApiCost(apiCode, tenantId);

  // Start an interactive transaction to guarantee isolation
  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.tenantWallet.findUnique({
      where: { tenant_id: tenantId }
    });

    if (!wallet || wallet.status !== 'ACTIVE') {
      const error = new Error('Wallet not found or not active');
      error.status = 402;
      throw error;
    }

    if (wallet.balance < cost) {
      const error = new Error('Insufficient credits. Please recharge wallet.');
      error.status = 402;
      throw error;
    }

    // Deduct
    const updatedWallet = await tx.tenantWallet.update({
      where: { tenant_id: tenantId },
      data: {
        balance: {
          decrement: cost
        }
      }
    });

    // We do a post-update sanity check
    if (updatedWallet.balance < 0) {
      // Should never happen natively under strict transactional workflows, but extra safe
      throw new Error('Concurrency violation: Resulting balance below zero');
    }

    // Insert Wallet Transaction Ledger
    let walletTx = null;
    if (cost > 0) {
      walletTx = await tx.walletTransaction.create({
        data: {
          tenant_id: tenantId,
          amount: cost,
          transaction_type: 'DEBIT',
          reference_type: 'API_CALL',
          api_code: apiCode,
          balance_after: updatedWallet.balance,
          created_by: userId
        }
      });
    }

    // Insert Initial API Usage Log (Pending/Success)
    const usageLog = await tx.apiUsageLog.create({
      data: {
        tenant_id: tenantId,
        triggered_by_user_id: userId,
        customer_id: customerId,
        case_id: caseId || null,
        api_code: apiCode,
        idempotency_key: idempotencyKey,
        credits_used: cost,
        status: 'SUCCESS' // Optimistically assuming success initially. Wrapper will override.
      }
    });

    // Tie WalletTx to UsageLog ideally, or UsageLog reference to WalletTx
    if (walletTx) {
      await tx.apiUsageLog.update({ where: { id: usageLog.id }, data: { reference_id: walletTx.id } });
    }

    return { updatedWallet, cost, usageLog };
  }, {
    isolationLevel: 'Serializable',
    maxWait: 5000,
    timeout: 10000
  });
}

async function refundCredits(tenantId, logId, cost, userId) {
  return await prisma.$transaction(async (tx) => {
    const updatedWallet = await tx.tenantWallet.update({
      where: { tenant_id: tenantId },
      data: {
        balance: {
          increment: cost
        }
      }
    });

    if (cost > 0) {
      await tx.walletTransaction.create({
        data: {
          tenant_id: tenantId,
          amount: cost,
          transaction_type: 'CREDIT',
          reference_type: 'REFUND',
          reference_id: logId,
          remarks: "System Refund for failed execution",
          balance_after: updatedWallet.balance,
          created_by: userId
        }
      });
    }

    // Mark log as REFUNDED accurately
    await tx.apiUsageLog.update({
      where: { id: logId },
      data: { status: 'REFUNDED' }
    });

    return updatedWallet;
  });
}

async function topupWallet({ tenantId, amount, adminUserId }) {
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.tenantWallet.upsert({
      where: { tenant_id: tenantId },
      update: {
        balance: {
          increment: amount
        }
      },
      create: {
        tenant_id: tenantId,
        balance: amount,
        status: 'ACTIVE'
      }
    });

    await tx.walletTransaction.create({
      data: {
        tenant_id: tenantId,
        amount: amount,
        transaction_type: 'CREDIT',
        reference_type: 'ADMIN_TOPUP',
        remarks: "Topup via Service Layer",
        balance_after: wallet.balance,
        created_by: adminUserId
      }
    });

    return wallet;
  });
}

// Wrapper for executing paid APIs
async function executePaidApi({ apiCode, tenantId, userId, customerId, caseId, requestPayload, idempotencyKey, handlerFunction }) {
  // Idempotency check 
  if (idempotencyKey) {
    const previousLog = await prisma.apiUsageLog.findUnique({
      where: { tenant_id_api_code_idempotency_key: { tenant_id: tenantId, api_code: apiCode, idempotency_key: idempotencyKey } }
    });
    if (previousLog) {
      if (previousLog.status === 'SUCCESS') return previousLog.request_payload; // Or parse actual API cached response if needed
      throw new Error('Duplicate execution blocked by idempotency key');
    }
  }

  // Free APIs immediately skip deduction
  if (apiCode === 'PAN_FETCH') {
    let result;
    try {
      result = await handlerFunction();
      await prisma.apiUsageLog.create({
        data: {
          tenant_id: tenantId,
          triggered_by_user_id: userId,
          customer_id: customerId,
          case_id: caseId || null,
          api_code: apiCode,
          credits_used: 0,
          status: 'SUCCESS',
          request_payload: requestPayload,
          idempotency_key: idempotencyKey
        }
      });
      return result;
    } catch (apiError) {
      await prisma.apiUsageLog.create({
        data: {
          tenant_id: tenantId,
          triggered_by_user_id: userId,
          customer_id: customerId,
          case_id: caseId || null,
          api_code: apiCode,
          credits_used: 0,
          status: 'FAILED',
          error_message: apiError.message,
          idempotency_key: idempotencyKey
        }
      });
      throw apiError;
    }
  }

  // 1. Deduct strict logic
  let deductionResult;
  try {
    deductionResult = await deductCredits({ tenantId, userId, customerId, caseId, apiCode });
  } catch (error) {
    const isInactiveError = error.message.includes("inactive");
    if (error.status === 402 || error.message.includes("not found") || isInactiveError) {
      // Log blocked attempt natively capturing context
      await prisma.apiUsageLog.create({
        data: {
          tenant_id: tenantId,
          triggered_by_user_id: userId,
          customer_id: customerId,
          case_id: caseId || null,
          api_code: apiCode,
          credits_used: 0,
          status: isInactiveError ? 'BLOCKED_INACTIVE_API' : 'BLOCKED_INSUFFICIENT_CREDITS',
          error_message: error.message,
          idempotency_key: idempotencyKey
        }
      });
    }
    throw error;
  }

  // 2. Execute Handler
  let result;
  try {
    result = await handlerFunction();
  } catch (apiError) {
    // 3. Catch handler errors and REFUND seamlessly explicitly returning REFUNDED state!
    await refundCredits(tenantId, deductionResult.usageLog.id, deductionResult.cost, userId);

    // Log the actual error mapping
    await prisma.apiUsageLog.update({
      where: { id: deductionResult.usageLog.id },
      data: { error_message: apiError.message, response_status: '500' }
    });

    throw apiError;
  }

  // 4. Update usage log payload asynchronously to prevent blocking or refunding on local DB fails
  if (requestPayload) {
    prisma.apiUsageLog.update({
      where: { id: deductionResult.usageLog.id },
      data: { request_payload: requestPayload }
    }).catch(e => console.error("Failed to commit requestPayload to ApiUsageLog:", e));
  }
  return result;
}

module.exports = {
  getWalletBalance,
  checkCredits,
  deductCredits,
  topupWallet,
  executePaidApi
};
