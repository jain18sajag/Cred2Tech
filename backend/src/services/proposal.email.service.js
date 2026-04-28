// proposal.email.service.js
// Sends formatted proposal emails and SMS notifications.
// Uses a simple transporter pattern with graceful fallback if SMTP is not configured.

const nodemailer = require('nodemailer');
const prisma = require('../../config/db');

// ── Build transporter (lazy-init) ─────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  console.log('[email] SMTP config check:', {
    host: SMTP_HOST || '(missing)',
    port: SMTP_PORT || '(missing)',
    user: SMTP_USER || '(missing)',
    passLength: SMTP_PASS ? SMTP_PASS.length : 0,
  });

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[email] SMTP not configured — emails will be logged only');
    return null;
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587'),
    secure: parseInt(SMTP_PORT || '587') === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
    debug: true,
    logger: false,
  });

  // Verify connection asynchronously — logs error but doesn't block
  transport.verify((err) => {
    if (err) {
      console.error('[email] SMTP verify FAILED:', err.message);
      console.error('[email] Full error:', err.code, err.response);
    } else {
      console.log('[email] SMTP connection verified OK ✓ — ready to send');
    }
  });

  _transporter = transport;
  return _transporter;
}

// ── Format currency ───────────────────────────────────────────────────────────
function fmtINR(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (num >= 100000)   return `₹${(num / 100000).toFixed(1)}L`;
  return `₹${num.toLocaleString('en-IN')}`;
}

function amountInLakhs(n) {
  if (!n) return '—';
  return `₹${(Number(n) / 100000).toFixed(0)}L`;
}

// ── Fetch case metadata for email ─────────────────────────────────────────────
async function fetchCaseMeta(caseId, tenantId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.id, c.product_type, c.loan_amount, c.stage,
           cu.business_name, cu.business_pan,
           t.name AS tenant_name,
           u.name AS created_by_name
    FROM cases c
    JOIN customers cu ON cu.id = c.customer_id
    JOIN tenants t ON t.id = c.tenant_id
    JOIN users u ON u.id = c.created_by_user_id
    WHERE c.id = $1 AND c.tenant_id = $2
    LIMIT 1
  `, caseId, tenantId);
  return rows[0] || null;
}

// ── Fetch sender user details ─────────────────────────────────────────────────
async function fetchUser(userId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, email, mobile FROM users WHERE id = $1 LIMIT 1`, userId
  );
  return rows[0] || {};
}

// ── Fetch DSA code for subject line ──────────────────────────────────────────
async function fetchDsaCode(tenantId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM tenants WHERE id = $1 LIMIT 1`, tenantId
  );
  const t = rows[0];
  if (!t) return `DSA-${tenantId}`;
  return `DSA-${String(t.id).padStart(4, '0')}`;
}

// ── Build email content ───────────────────────────────────────────────────────
function buildEmailContent({ caseMeta, sender, contact, dsaCode, loanAmount }) {
  const businessName = caseMeta.business_name || 'Customer';
  const productType  = caseMeta.product_type || 'LAP';
  const amountStr    = loanAmount ? amountInLakhs(loanAmount) : amountInLakhs(caseMeta.loan_amount);

  const subject = `${businessName} | ${productType} | ${amountStr} | ${dsaCode}`;

  const bodyText = [
    `Dear ${contact.contact_name},`,
    ``,
    `Please find the captioned proposal attached for further processing. Do let us know in case of any additional requirements.`,
    ``,
    `Regards,`,
    `${sender.name}`,
    `DSA — Cred2Tech Platform`,
    `Ref: CASE-${caseMeta.id}`,
  ].join('\n');

  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; max-width: 600px;">
      <p>Dear <strong>${contact.contact_name}</strong>,</p>
      <p>Please find the captioned proposal attached for further processing.
         Do let us know in case of any additional requirements.</p>
      <table style="margin: 20px 0; border-collapse: collapse; width: 100%; font-size: 13px;">
        <tr>
          <td style="padding: 8px 12px; background: #f8f9fa; border: 1px solid #e2e8f0; font-weight: 600; width: 40%;">Customer</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${businessName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f8f9fa; border: 1px solid #e2e8f0; font-weight: 600;">Product</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${productType}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f8f9fa; border: 1px solid #e2e8f0; font-weight: 600;">Loan Amount</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #276749;">${amountStr}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f8f9fa; border: 1px solid #e2e8f0; font-weight: 600;">Case Reference</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">CASE-${caseMeta.id}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f8f9fa; border: 1px solid #e2e8f0; font-weight: 600;">DSA Code</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${dsaCode}</td>
        </tr>
      </table>
      <p style="margin-top: 24px;">Regards,<br/>
        <strong>${sender.name}</strong><br/>
        DSA — Cred2Tech Platform
      </p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="font-size: 11px; color: #a0aec0;">
        This email was sent via Cred2Tech DSA Platform. Please do not reply to this automated message.
      </p>
    </div>
  `;

  return { subject, bodyText, bodyHtml };
}

// ── Fetch case documents for attachment ───────────────────────────────────────
async function fetchCaseDocuments(caseId, tenantId) {
  return prisma.$queryRawUnsafe(`
    SELECT id, document_type, original_file_name, file_name, storage_path, source_url, mime_type
    FROM documents
    WHERE case_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'
    ORDER BY document_type ASC
  `, caseId, tenantId);
}

// ── Main: Send proposal email ─────────────────────────────────────────────────
async function sendProposalToLender({
  caseId, tenantId, userId, contact, lenderName, loanAmount
}) {
  const [caseMeta, sender, dsaCode] = await Promise.all([
    fetchCaseMeta(caseId, tenantId),
    fetchUser(userId),
    fetchDsaCode(tenantId),
  ]);

  if (!caseMeta) throw new Error('Case not found');

  const { subject, bodyText, bodyHtml } = buildEmailContent({
    caseMeta, sender, contact, dsaCode, loanAmount
  });

  // Fetch documents
  const docs = await fetchCaseDocuments(caseId, tenantId);

  // Build attachment list — only include files that actually exist on disk
  const fs = require('fs');
  const attachments = docs
    .filter(d => {
      if (d.storage_path) {
        // Local file — verify it exists before attaching
        const exists = fs.existsSync(d.storage_path);
        if (!exists) {
          console.warn(`[email] Skipping missing attachment: ${d.storage_path}`);
        }
        return exists;
      }
      if (d.source_url && d.source_url.startsWith('http')) {
        // Remote URL — include directly (nodemailer will fetch it)
        return true;
      }
      return false;
    })
    .map(d => ({
      filename: d.original_file_name || d.file_name || `${d.document_type}.pdf`,
      path: d.storage_path || d.source_url,
    }));

  console.log(`[email] Attachments: ${attachments.length} of ${docs.length} docs included`);

  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'platform@cred2tech.com';
  const fromName  = process.env.SMTP_FROM_NAME  || 'Cred2Tech Platform';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: contact.contact_email,
    subject,
    text: bodyText,
    html: bodyHtml,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  const transporter = getTransporter();

  let messageId = null;
  let emailSent = false;

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      messageId = info.messageId;
      emailSent = true;
      console.log(`[email] Sent to ${contact.contact_email} | MsgId: ${messageId}`);
    } catch (emailErr) {
      console.error('[email] Send failed:', emailErr.message);
      // Don't throw — log and continue, activity log will reflect
    }
  } else {
    // Fallback: log the email (dev mode)
    console.log('[email] MOCK SEND (SMTP not configured):');
    console.log('  To:', contact.contact_email);
    console.log('  Subject:', subject);
    console.log('  Body preview:', bodyText.slice(0, 200));
    emailSent = true; // treat as success in dev
  }

  return {
    emailSent,
    messageId,
    to:        contact.contact_email,
    contact_name: contact.contact_name,
    subject,
    body_preview: bodyText,
    attachments_count: attachments.length,
    case_meta: {
      business_name: caseMeta.business_name,
      product_type:  caseMeta.product_type,
      loan_amount:   caseMeta.loan_amount,
    },
  };
}

// ── Build SMS message ─────────────────────────────────────────────────────────
function buildSmsMessage({ caseMeta, sender, dsaCode, lenderName, loanAmount }) {
  const businessName = caseMeta.business_name || 'Customer';
  const productType  = caseMeta.product_type  || 'LAP';
  const amountStr    = amountInLakhs(loanAmount || caseMeta.loan_amount);

  return (
    `Cred2Tech: New proposal from DSA ${sender.name} (${dsaCode}). ` +
    `Customer: ${businessName}. Product: ${productType}. Amount: ${amountStr}. ` +
    `Case Ref: CASE-${caseMeta.id}. Please check your email for the full proposal.`
  );
}

// ── Send SMS (Twilio or silent fallback) ──────────────────────────────────────
async function sendProposalSms({ mobile, message }) {
  if (!mobile) return { smsSent: false, reason: 'No mobile number' };

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log('[sms] Twilio not configured — SMS skipped:', message);
    return { smsSent: false, reason: 'SMS provider not configured' };
  }

  try {
    // Dynamic require to avoid crash if twilio is not installed
    const twilio = require('twilio');
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to: mobile.startsWith('+') ? mobile : `+91${mobile}`,
    });
    console.log(`[sms] Sent to ${mobile} | SID: ${msg.sid}`);
    return { smsSent: true, sid: msg.sid };
  } catch (err) {
    console.error('[sms] Send failed:', err.message);
    return { smsSent: false, reason: err.message };
  }
}

// ── Orchestrator: send email + SMS for a proposal ────────────────────────────
async function dispatchProposalEmail({ caseId, tenantId, userId, contact, lenderName, loanAmount }) {
  const [caseMeta, sender, dsaCode] = await Promise.all([
    fetchCaseMeta(caseId, tenantId),
    fetchUser(userId),
    fetchDsaCode(tenantId),
  ]);
  if (!caseMeta) throw new Error('Case not found');

  const emailResult = await sendProposalToLender({
    caseId, tenantId, userId, contact, lenderName, loanAmount
  });

  const smsMessage = buildSmsMessage({ caseMeta, sender, dsaCode, lenderName, loanAmount });
  const smsResult = await sendProposalSms({
    mobile: contact.contact_mobile,
    message: smsMessage,
  });

  return {
    ...emailResult,
    sms: { ...smsResult, message: smsMessage, to: contact.contact_mobile || null },
  };
}

module.exports = { dispatchProposalEmail };
