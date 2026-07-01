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

async function deductCredits({ tenantId, userId, customerId, caseId, apiCode, idempotencyKey }) {
  const cost = await pricingService.getApiCost(apiCode, tenantId);

  return await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const user = await tx.user.findUnique({ where: { id: userId }, include: { role: true } });
    
    const isDsaAdmin = ['SUPER_ADMIN', 'DSA_ADMIN'].includes(user.role.name);
    let employeeAllocationEnabled = process.env.EMPLOYEE_CREDIT_ALLOCATION_ENABLED === 'true';
    if (tenant.metadata && typeof tenant.metadata === 'object' && tenant.metadata.employee_allocation_enabled !== undefined) {
      employeeAllocationEnabled = tenant.metadata.employee_allocation_enabled;
    }

    let updatedWallet = null;
    let walletTx = null;
    let employeeWalletTx = null;

    let empWallet = null;
    if (!isDsaAdmin) {
      empWallet = await tx.employeeWallet.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } }
      });
      if (empWallet) {
        employeeAllocationEnabled = true;
      }
    }

    if (employeeAllocationEnabled && !isDsaAdmin) {
      
      if (!empWallet || empWallet.status !== 'ACTIVE' || empWallet.allocated_balance < cost) {
        const error = new Error('Your allocated credits have been exhausted. Please request the admin to allocate more credits.');
        error.status = 402;
        throw error;
      }
      
      const updatedEmpWallet = await tx.employeeWallet.update({
        where: { id: empWallet.id },
        data: {
          allocated_balance: { decrement: cost },
          consumed_credits: { increment: cost }
        }
      });
      
      if (updatedEmpWallet.allocated_balance < 0) throw new Error('Concurrency violation: Employee balance below zero');
      
      if (cost > 0) {
        employeeWalletTx = await tx.employeeWalletTransaction.create({
          data: {
            tenant_id: tenantId,
            user_id: userId,
            type: 'DEBIT_USAGE',
            credits: cost,
            opening_balance: empWallet.allocated_balance,
            closing_balance: updatedEmpWallet.allocated_balance,
            reference_type: 'API_CALL',
            reference_id: apiCode
          }
        });
      }
      updatedWallet = { is_employee: true, ...updatedEmpWallet };
    } else {
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

      updatedWallet = await tx.tenantWallet.update({
        where: { tenant_id: tenantId },
        data: {
          balance: { decrement: cost }
        }
      });
      if (updatedWallet.balance < 0) throw new Error('Concurrency violation: Resulting balance below zero');

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
    }

    const usageLog = await tx.apiUsageLog.create({
      data: {
        tenant_id: tenantId,
        triggered_by_user_id: userId,
        customer_id: customerId,
        case_id: caseId || null,
        api_code: apiCode,
        idempotency_key: idempotencyKey,
        credits_used: cost,
        status: 'SUCCESS'
      }
    });

    if (walletTx) {
      await tx.apiUsageLog.update({ where: { id: usageLog.id }, data: { reference_id: walletTx.id } });
    } else if (employeeWalletTx) {
      await tx.apiUsageLog.update({ where: { id: usageLog.id }, data: { reference_id: employeeWalletTx.id } });
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
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    const user = await tx.user.findUnique({ where: { id: userId }, include: { role: true } });
    const isDsaAdmin = ['SUPER_ADMIN', 'DSA_ADMIN'].includes(user.role.name);
    
    let employeeAllocationEnabled = process.env.EMPLOYEE_CREDIT_ALLOCATION_ENABLED === 'true';
    if (tenant.metadata && tenant.metadata.employee_allocation_enabled !== undefined) {
      employeeAllocationEnabled = tenant.metadata.employee_allocation_enabled;
    }

    let updatedWallet = null;

    let empWallet = null;
    if (!isDsaAdmin) {
      empWallet = await tx.employeeWallet.findUnique({
        where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } }
      });
      if (empWallet) {
        employeeAllocationEnabled = true;
      }
    }

    if (employeeAllocationEnabled && !isDsaAdmin) {
      if (empWallet) {
        updatedWallet = await tx.employeeWallet.update({
          where: { id: empWallet.id },
          data: {
            allocated_balance: { increment: cost },
            consumed_credits: { decrement: cost }
          }
        });
        
        if (cost > 0) {
          await tx.employeeWalletTransaction.create({
            data: {
              tenant_id: tenantId,
              user_id: userId,
              type: 'REFUND_USAGE',
              credits: cost,
              opening_balance: empWallet.allocated_balance,
              closing_balance: updatedWallet.allocated_balance,
              reference_type: 'API_CALL_REFUND',
              reference_id: logId.toString()
            }
          });
        }
      }
    } else {
      updatedWallet = await tx.tenantWallet.update({
        where: { tenant_id: tenantId },
        data: {
          balance: { increment: cost }
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
    }

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
async function executePaidApi({ apiCode, tenantId, userId, customerId, caseId, requestPayload, idempotencyKey, handlerFunction, userRole }) {
  // Idempotency check 
  if (idempotencyKey) {
    const previousLog = await prisma.apiUsageLog.findUnique({
      where: { tenant_id_api_code_idempotency_key: { tenant_id: tenantId, api_code: apiCode, idempotency_key: idempotencyKey } }
    });
    if (previousLog) {
      if (previousLog.status === 'SUCCESS') return previousLog.request_payload;
      
      // If the previous attempt failed or was blocked, allow retry by removing the old log
      await prisma.apiUsageLog.delete({ where: { id: previousLog.id } });
    }
  }

  // MSME customers have paid upfront — skip all credit deductions
  const isMsmeCustomer = userRole === 'MSME_CUSTOMER';

  // Free APIs immediately skip deduction
  if (apiCode === 'PAN_FETCH' || isMsmeCustomer) {
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
          response_payload: result,
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
    deductionResult = await deductCredits({ tenantId, userId, customerId, caseId, apiCode, idempotencyKey });
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
  if (requestPayload || result) {
    const updateData = {};
    if (requestPayload) updateData.request_payload = requestPayload;
    if (result) updateData.response_payload = result;

    prisma.apiUsageLog.update({
      where: { id: deductionResult.usageLog.id },
      data: updateData
    }).catch(e => console.error("Failed to commit payloads to ApiUsageLog:", e));
  }
  return result;
}

function calculateCreditsForAmount(amountInr) {
  // Phase 1: 1 INR = 1 credit
  return Math.floor(amountInr);
}

async function creditWalletForRazorpayTopup(topupId, paymentObj, sourceEventId) {
  return await prisma.$transaction(async (tx) => {
    const topup = await tx.walletTopupRequest.findUnique({
      where: { id: topupId },
    });

    if (!topup) throw new Error("Top-up request not found");
    if (topup.status === 'CREDITED') return { status: 'ALREADY_CREDITED', topup };

    // Strict validation inside the transactional boundary
    if (paymentObj.amount !== topup.amount_paise) {
      throw new Error(`Amount mismatch: expected ${topup.amount_paise}, got ${paymentObj.amount}`);
    }
    if (paymentObj.currency !== 'INR' || topup.currency !== 'INR') {
      throw new Error(`Currency mismatch or not INR: got ${paymentObj.currency}`);
    }
    if (paymentObj.status !== 'captured') {
      throw new Error(`Payment not captured: got ${paymentObj.status}`);
    }

    const idempotencyKey = `RAZORPAY_PAYMENT:${paymentObj.id}`;
    const existingTx = await tx.walletTransaction.findUnique({
      where: { idempotency_key: idempotencyKey }
    });

    if (existingTx) {
      if (topup.status !== 'CREDITED') {
        await tx.walletTopupRequest.update({
          where: { id: topupId },
          data: { status: 'CREDITED', credited_at: new Date() }
        });
      }
      return { status: 'ALREADY_CREDITED_IN_LEDGER', topup };
    }

    const wallet = await tx.tenantWallet.upsert({
      where: { tenant_id: topup.tenant_id },
      update: { balance: { increment: topup.credits_to_add } },
      create: {
        tenant_id: topup.tenant_id,
        balance: topup.credits_to_add,
        status: 'ACTIVE'
      }
    });

    await tx.walletTransaction.create({
      data: {
        tenant_id: topup.tenant_id,
        amount: topup.credits_to_add,
        transaction_type: 'CREDIT',
        reference_type: 'RAZORPAY_TOPUP',
        remarks: `Razorpay Topup: ${paymentObj.id}`,
        balance_after: wallet.balance,
        created_by: topup.requested_by_user_id,
        idempotency_key: idempotencyKey
      }
    });

    const updatedTopup = await tx.walletTopupRequest.update({
      where: { id: topupId },
      data: { 
        status: 'CREDITED', 
        credited_at: new Date(),
        razorpay_payment_id: paymentObj.id
      }
    });

    return { status: 'CREDITED', topup: updatedTopup };
  }, {
    isolationLevel: 'Serializable',
    maxWait: 5000,
    timeout: 10000
  });
}

module.exports = {
  getWalletBalance,
  checkCredits,
  deductCredits,
  topupWallet,
  executePaidApi,
  calculateCreditsForAmount,
  creditWalletForRazorpayTopup
};
