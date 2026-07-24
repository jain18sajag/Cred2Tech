// Shared SMTP transporter — lazy-init, graceful no-op if SMTP isn't
// configured (matches the pattern already used in proposal.email.service.js).
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[mailer] SMTP not configured — emails will not be sent');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
  return _transporter;
}

/** Returns true if the email was actually handed off to SMTP, false otherwise. Never throws. */
async function sendMail(mailOptions) {
  const transporter = getTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('[mailer] sendMail failed:', err.message);
    return false;
  }
}

module.exports = { getTransporter, sendMail };
