const prisma = require('./config/db');
const walletService = require('./src/services/wallet.service');

async function test() {
  console.log('--- Starting System Test for Wallet Credit Module ---');
  try {
    const user = await prisma.user.findFirst({ where: { role: { name: 'DSA_MEMBER' } } });
    if (!user) {
        console.log('No DSA_MEMBER user found to test with.');
        return;
    }
    
    // 1. Seed Pricing
    console.log("Seeding Pricing...");
    await prisma.apiPricing.upsert({ where: { api_code: 'BANK_ANALYSIS' }, update: {}, create: { api_code: 'BANK_ANALYSIS', display_name: 'Bank Analysis', credit_cost: 15 } });
    await prisma.apiPricing.upsert({ where: { api_code: 'GST_FETCH' }, update: {}, create: { api_code: 'GST_FETCH', display_name: 'GST Records', credit_cost: 15 } });
    await prisma.apiPricing.upsert({ where: { api_code: 'ITR_FETCH' }, update: {}, create: { api_code: 'ITR_FETCH', display_name: 'ITR Assesment', credit_cost: 10 } });

    
    // 2. Ensure Wallet is fresh (0 balance)
    console.log("Resetting wallet balance to 0...");
    await prisma.tenantWallet.upsert({ where: { tenant_id: user.tenant_id }, update: { balance: 0 }, create: { tenant_id: user.tenant_id, balance: 0 } });

    // 3. Test 402 Insufficient logic
    try {
      console.log(`Executing API with 0 balance (expecting 402)...`);
      await walletService.executePaidApi({
         apiCode: 'BANK_ANALYSIS', tenantId: user.tenant_id, userId: user.id, customerId: 1, caseId: null,
         handlerFunction: async () => { return { success: true } }
      });
      console.log('FAIL: API executed without credits!');
    } catch(e) {
      if (e.status === 402) console.log('PASS: Caught Insufficient Credits (402)');
      else console.log('FAIL:', e.message);
    }
    
    // 4. Topup Admin logic
    console.log(`Topping up Wallet with 20 credits...`);
    const superAdmin = await prisma.user.findFirst({ where: { role: { name: 'SUPER_ADMIN' } } });
    await walletService.topupWallet({ tenantId: user.tenant_id, amount: 20, adminUserId: superAdmin ? superAdmin.id : 1 });
    
    const balanceCheck = await walletService.getWalletBalance(user.tenant_id);
    console.log(`New balance: ${balanceCheck} (Expected: 20)`);

    // 5. Success execution
    console.log(`Executing API perfectly...`);
    const result1 = await walletService.executePaidApi({
         apiCode: 'BANK_ANALYSIS', tenantId: user.tenant_id, userId: user.id, customerId: 1, caseId: null,
         handlerFunction: async () => { return { parsed: true } }
    });
    console.log(`Execution mapped -> Balance is now:`, await walletService.getWalletBalance(user.tenant_id)); // Should be 5

    // 6. FAILED execution refund trigger
    console.log(`Executing Failing API (forces refund)...`);
    try {
       await walletService.executePaidApi({
         apiCode: 'BANK_ANALYSIS', tenantId: user.tenant_id, userId: user.id, customerId: 1, caseId: null,
         handlerFunction: async () => { throw new Error("MOCK_FAIL"); }
      });
    } catch(e) {
      console.log("Mock Fail Thrown! Checking refund...");
    }
    const finalBalance = await walletService.getWalletBalance(user.tenant_id);
    if (finalBalance === 5) {
       console.log("PASS: Balance stayed at 5. Initial deduction was fully refunded after failing.");
    } else {
       console.log("FAIL: Balance is " + finalBalance);
    }

    console.log('Test Suite Complete.');
    process.exit(0);

  } catch(e) {
    console.error('Test Suite Crashed:', e);
    process.exit(1);
  }
}
test();
