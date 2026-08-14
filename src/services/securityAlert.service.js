// securityAlert.service.js
// Notifies a user by email whenever a security-relevant device event happens
// on their account — a new MFA method being set up, or a device being
// granted a 30-day "skip MFA" trust — so they have a real chance to notice
// and react to activity they don't recognize. Every alert points at the
// forgot-password flow and explicitly says what resetting the password does
// (auth.service.js#resetPassword / mfa.service.js#changePassword already
// revoke every active session AND every trusted device on a password
// change — this email is just telling the user that lever exists).

const { sendMail } = require('../utils/mailer');
const { renderBrandedEmail, esc, BRAND_COLORS: C, BRAND_FONT: FONT } = require('../utils/emailTemplate');
const { resolveIpLocation } = require('../utils/geoLocation');

const FORGOT_PASSWORD_URL = 'https://app.cred2tech.com/forgot-password';

const EVENT_COPY = {
  MFA_SETUP: {
    subject: 'Security alert: two-factor authentication was set up on your account',
    heading: 'New Two-Factor Method Added',
    intro: (name) => `Hi ${name || ''}`.trim() + ',',
    lead: 'A new two-factor authentication method was just set up on your Cred2Tech account.',
  },
  DEVICE_TRUSTED: {
    subject: 'Security alert: a new device was trusted on your account',
    heading: 'New Trusted Device Added',
    intro: (name) => `Hi ${name || ''}`.trim() + ',',
    lead: 'A device was just granted 30 days of skipping the two-factor login check on your Cred2Tech account.',
  },
};

function fmtDateTime(d) {
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

/**
 * @param {object} params
 * @param {object} params.user - full User row (needs at least name, email)
 * @param {'MFA_SETUP'|'DEVICE_TRUSTED'} params.eventType
 * @param {string} params.ipAddress
 * @param {string|null} params.userAgent
 * @param {string|null} [params.deviceLabel] - e.g. "Chrome on Windows"
 */
async function sendDeviceTrustAlert({ user, eventType, ipAddress, userAgent, deviceLabel }) {
  if (!user?.email) return;
  const copy = EVENT_COPY[eventType];
  if (!copy) throw new Error(`Unknown security alert eventType: ${eventType}`);

  const location = await resolveIpLocation(ipAddress);

  const infoTable = (rows) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:${FONT};font-size:13px;margin:0 0 20px;">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:9px 12px;border:1px solid ${C.line};background:${C.panel};font-weight:700;color:${C.ink};width:38%;">${esc(label)}</td>
          <td style="padding:9px 12px;border:1px solid ${C.line};color:${C.body};">${esc(value)}</td>
        </tr>
      `).join('')}
    </table>`;

  const rows = [
    ['Device', deviceLabel || 'Unknown device'],
    ['IP Address', ipAddress || 'Unknown'],
    ['Location', location?.label || 'Unknown'],
    ['Time', fmtDateTime(new Date())],
  ];

  const customBody = infoTable(rows);

  const { html, text } = renderBrandedEmail({
    title: copy.heading,
    preheader: copy.lead,
    heading: copy.heading,
    intro: copy.intro(user.name),
    paragraphs: [copy.lead],
    customBody,
    button: { label: 'Reset Your Password', url: FORGOT_PASSWORD_URL },
    note: "If this wasn't you, reset your password immediately using the button above. Resetting your password instantly signs you out of every active session and revokes every trusted device on your account, including this one.",
  });

  const sent = await sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Cred2Tech Platform'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to: user.email,
    subject: copy.subject,
    text,
    html,
  });
  if (!sent) {
    console.warn(`[securityAlert] ${eventType} alert email could not be sent to ${user.email}.`);
  }
}

module.exports = { sendDeviceTrustAlert };
