// Shared Twilio SMS sender — extracted from proposal.email.service.js
// (originally `sendProposalSms`) so mfa.service.js can reuse the exact same
// gated-provider pattern for mobile-OTP MFA recovery instead of duplicating
// the Twilio wiring. Graceful no-op if TWILIO_* env vars aren't set, same as
// mailer.js's SMTP fallback.
async function sendSms({ mobile, message }) {
  if (!mobile) return { smsSent: false, reason: 'No mobile number' };

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('[sms] Twilio not configured — SMS skipped');
    return { smsSent: false, reason: 'SMS provider not configured' };
  }

  try {
    const twilio = require('twilio');
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: mobile.startsWith('+') ? mobile : `+91${mobile}`,
    });
    return { smsSent: true, sid: msg.sid };
  } catch (err) {
    console.error('[sms] Send failed:', err.message);
    return { smsSent: false, reason: err.message };
  }
}

function isSmsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

module.exports = { sendSms, isSmsConfigured };
