/**
 * MSME notification email for CT-004-DPP data purges. Built on the shared
 * utils/mailer.js transporter — never throws, sendMail() itself is
 * already best-effort (returns false on failure), so a mail outage never
 * blocks the purge itself. Mirrors ticket.email.js's structure.
 */
const { sendMail } = require('../../utils/mailer');
const { renderBrandedEmail } = require('../../utils/emailTemplate');

function fromAddress() {
  const name = process.env.SMTP_FROM_NAME || 'Cred2Tech';
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return email ? `"${name}" <${email}>` : undefined;
}

/**
 * Fired exactly once per case, the moment its last purge-eligible record
 * (bureau/GST/ITR/bank) is purged — by either the nightly retention job or
 * a manual admin request. Recipient resolution mirrors ticket.service.js's
 * resolveSubmitterEmail(): Case.customer.business_email is the reliable
 * source (MSME self-service User.email is a synthetic, unusable
 * @direct.cred2tech.local address), falling back to the linked User's
 * synced_email.
 */
async function sendCasePurgedNotification({ recipientEmail, customerName, caseId, productType }) {
  if (!recipientEmail) {
    console.warn(`[purge-notification] no recipient email resolved for case ${caseId} — skipping notification`);
    return false;
  }

  const { html, text } = renderBrandedEmail({
    title: 'Your Data Has Been Deleted',
    preheader: `Case #${caseId}'s credit information has been permanently deleted per our data retention policy.`,
    heading: 'Your Case Data Has Been Deleted',
    intro: customerName ? `Dear ${customerName},` : 'Dear Customer,',
    paragraphs: [
      `As per Cred2Tech's Data Purging Policy (CT-004-DPP, in line with CICRA Regulation 8), the credit information${productType ? ` for your ${productType}` : ''} associated with case #${caseId} has now been permanently and irreversibly deleted from our systems.`,
      'This case can no longer be reopened, edited, or progressed further — a fresh application would be required for any future loan request.',
      'If you believe this was done in error, or have any questions about this notice, please contact our support team.',
    ],
    note: 'This is an automated compliance notification and requires no action from you.',
  });

  return sendMail({
    from: fromAddress(),
    to: recipientEmail,
    subject: `Your data for case #${caseId} has been deleted`,
    text,
    html,
  });
}

module.exports = { sendCasePurgedNotification };
