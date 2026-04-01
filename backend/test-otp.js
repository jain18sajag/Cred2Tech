const otpService = require('./src/services/otp.service.js');
const prisma = require('./config/db.js');

async function test() {
  console.log('--- Starting System Test for OTP Module ---');
  try {
    const user = await prisma.user.findFirst();
    if (!user) {
        console.log('No user found in DB to test with. Aborting run.');
        return;
    }
    
    // Create a dummy customer
    const customer = await prisma.customer.create({
       data: {
          tenant_id: user.tenant_id,
          created_by_user_id: user.id,
          business_pan: 'TESTPAN123',
          business_mobile: '9999999999',
       }
    });
    console.log(`Created dummy customer ID: ${customer.id}`);

    // Test SEND OTP
    console.log(`Sending OTP to 9999999999...`);
    const sendResult = await otpService.sendOtp('9999999999', 'PRIMARY_APPLICANT', 'CUSTOMER', customer.id, user.tenant_id, user.id);
    console.log(`Send Result:`, sendResult);
    
    // Test RESEND OTP before cooldown passes
    try {
      console.log(`Attempting immediate resend to test 30-sec cooldown...`);
      await otpService.resendOtp('9999999999', 'PRIMARY_APPLICANT', 'CUSTOMER', customer.id, user.tenant_id, user.id);
      console.log('FAIL: Cooldown was bypassed!');
    } catch (e) {
      console.log(`PASS: Cooldown caught - ${e.message}`);
    }

    // Test VERIFY OTP
    console.log(`Verifying OTP: ${sendResult.otp}...`);
    const verifyResult = await otpService.verifyOtp(sendResult.otp, 'CUSTOMER', customer.id, user.tenant_id);
    console.log(`Verify Result:`, verifyResult);

    // Assert Customer was flagged
    const checkCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
    if (checkCustomer.mobile_verified) {
       console.log('PASS: Customer is successfully marked as mobile_verified = true in the actual PostgreSQL DB!');
    } else {
       console.log('FAIL: Customer was NOT updated.');
    }

    // Cleanup
    await prisma.otpVerification.deleteMany({ where: { target_id: customer.id, target_type: 'CUSTOMER' } });
    await prisma.customer.delete({ where: { id: customer.id } });
    console.log('Cleanup successful.');
    process.exit(0);

  } catch(e) {
    console.error('Test Failed:', e);
    process.exit(1);
  }
}
test();
