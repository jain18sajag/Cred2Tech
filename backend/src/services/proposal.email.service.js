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
    } else {
      console.log('[email] SMTP connection verified OK ✓ — ready to send');
    }
  });

  _transporter = transport;
  return _transporter;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtINR(n) {
  if (n == null || isNaN(Number(n))) return '—';
  const num = Number(n);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)} Lakhs`;
  return `₹${num.toLocaleString('en-IN')}`;
}

function fmtLakhs(val) {
  if (val == null || val === '' || isNaN(Number(val))) return '—';
  return `₹${(Number(val) / 100000).toFixed(2)} Lakhs`;
}

function fmtDate(d) {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ── Build professional template-based email ──────────────────────────────────
function buildProposalEmailFromTemplate({
  proposal,
  caseData,
  customer,
  applicants,
  esrFinancials,
  lenderContact,
  sender,
  tenant,
  documents
}) {
  const customerName = customer.name || 'Customer';
  const businessName = customer.business_name || customer.name || 'Customer';
  const productType = proposal.product_type || caseData.product_type || 'LAP';

  // Use proposal terms as the single source of truth
  const amountLakhs = proposal.requested_amount ? (proposal.requested_amount / 100000).toFixed(2) : '—';
  const tenureMonths = proposal.tenure_months || '—';

  const dsaName = tenant.name || 'DSA';
  const dsaCode = lenderContact?.dsa_code || `DSA-${String(tenant.id).padStart(4, '0')}`;

  const subject = `Loan Application – ${customerName} | ${productType} | ₹${amountLakhs} Lakhs | ${tenureMonths} Months`;

  const contactName = lenderContact?.contact_name || 'Sir/Madam';

  // Financial summary logic
  const grossTurnover = esrFinancials?.itr_gross_receipts;
  const netProfit = esrFinancials?.itr_pat;
  const gstTurnover = esrFinancials?.gst_avg_monthly_sales ? esrFinancials.gst_avg_monthly_sales * 12 : null;
  const avgBankBalance = esrFinancials?.bank_avg_balance;

  // Salaried Income fields
  const salariedIncome = esrFinancials?.salaried_income;
  const salariedSource = esrFinancials?.salaried_income_source || '—';
  const salariedSlipCount = esrFinancials?.salaried_slip_count || 0;

  const docListHtml = documents.length > 0
    ? `<ol style="margin-top: 10px; padding-left: 20px;">${documents.map(d => `<li style="margin-bottom: 4px;">${d.original_file_name || d.file_name || d.document_type}</li>`).join('')}</ol>`
    : `<p style="color: #c53030; font-style: italic;">No documents attached.</p>`;

  const docListText = documents.length > 0
    ? documents.map((d, i) => `${i + 1}. ${d.original_file_name || d.file_name || d.document_type}`).join('\n')
    : 'No documents attached.';

  const bodyHtml = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #2d3748; line-height: 1.6; max-width: 700px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background: #f7fafc; padding: 20px 30px; border-bottom: 2px solid #edf2f7; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-size: 12px; font-weight: 700; color: #4a5568; text-transform: uppercase; letter-spacing: 1px;">DSA / Channel Partner Name</div>
          <div style="font-size: 18px; font-weight: 800; color: #2b6cb0;">${dsaName}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 11px; color: #718096;">DSA Code: <strong style="color: #2d3748;">${dsaCode}</strong></div>
          <div style="font-size: 11px; color: #718096;">Date: <strong style="color: #2d3748;">${fmtDate()}</strong></div>
        </div>
      </div>

      <div style="padding: 30px;">
        <p style="margin-top: 0;">Dear <strong>${contactName}</strong>,</p>
        
        <p>I hope this message finds you well. I am writing to introduce a loan application from one of our customers for your consideration. Kindly find the relevant details and supporting documents below.</p>

        <div style="margin: 25px 0;">
          <h3 style="font-size: 14px; font-weight: 800; color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">Customer & Loan Details</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700; width: 35%;">Customer Name</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Business Name</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${customer.business_name || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Entity Type</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${customer.company_type || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Product Type</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${productType}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Loan Amount Required</td>
              <td style="padding: 10px; border: 1px solid #edf2f7; font-weight: 800; color: #276749;">₹${amountLakhs} Lakhs</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Loan Tenor Required</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${tenureMonths} Months</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Loan Purpose</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${proposal.loan_purpose || '—'}</td>
            </tr>
          </table>
        </div>

        <div style="margin: 25px 0;">
          <h3 style="font-size: 14px; font-weight: 800; color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">Financial Summary</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            ${(grossTurnover || gstTurnover || avgBankBalance) ? `
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700; width: 35%;">GST Turnover</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${gstTurnover != null ? fmtLakhs(gstTurnover) : '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Net Profit Income</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${netProfit != null ? fmtLakhs(netProfit) : '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Banking Income / Avg Bal</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${avgBankBalance != null ? fmtINR(avgBankBalance) : '—'}</td>
            </tr>
            ` : ''}
            ${salariedIncome != null ? `
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Salaried Income</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${fmtINR(salariedIncome)} / month</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Salary Source</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${salariedSource} (${salariedSlipCount} slips)</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Selected Monthly Income</td>
              <td style="padding: 10px; border: 1px solid #edf2f7; font-weight: 700;">${fmtINR(esrFinancials?.selected_monthly_income)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">Existing Obligations</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${fmtINR(esrFinancials?.existing_obligations)}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #edf2f7; background: #f8fafc; font-weight: 700;">CIBIL Score</td>
              <td style="padding: 10px; border: 1px solid #edf2f7;">${esrFinancials?.bureau_score || '—'}</td>
            </tr>
          </table>
        </div>

        <div style="margin: 25px 0;">
          <h3 style="font-size: 14px; font-weight: 800; color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">Documents Enclosed</h3>
          <p style="font-size: 12px; color: #718096; margin-bottom: 5px;">The following supporting documents are attached to this email:</p>
          ${docListHtml}
        </div>

        <p style="margin-top: 30px;">Kindly review the application at your earliest convenience. Please feel free to reach out to us should you require any additional information or clarification.</p>
        <p>We look forward to a positive response.</p>

        <div style="margin-top: 40px;">
          <p style="margin: 0; font-size: 14px; color: #4a5568;">Warm regards,</p>
          <br/>
          <p style="margin: 0; font-size: 14px; font-weight: 700; color: #2d3748;">${sender.name}</p>
          ${sender.designation ? `<p style="margin: 0; font-size: 13px; color: #718096;">${sender.designation}</p>` : ''}
          <p style="margin: 0; font-size: 13px; color: #718096;">${dsaName}</p>
          <p style="margin: 0; font-size: 13px; color: #718096;">${sender.mobile || '—'} | ${sender.email}</p>
        </div>
      </div>

      <div style="background: #f7fafc; padding: 20px 30px; border-top: 1px solid #edf2f7; font-size: 11px; color: #a0aec0; text-align: justify;">
        Disclaimer: This application is being submitted by ${dsaName} on behalf of the applicant. All credit assessment, KYC verification, and sanction decisions rest solely with your institution. The financial figures above are indicative, based on data provided by the applicant and retrieved through consent-based data APIs.
      </div>
    </div>
  `;

  const bodyText = `
DSA / Channel Partner Name: ${dsaName}
DSA Code: ${dsaCode}
Date: ${fmtDate()}

Subject: Loan Application – ${customerName} | ${productType} | ₹${amountLakhs} Lakhs | ${tenureMonths} Months

Dear ${contactName},

I hope this message finds you well. I am writing to introduce a loan application from one of our customers for your consideration. Kindly find the relevant details and supporting documents below.

Customer & Loan Details
- Customer Name: ${customerName}
- Business Name: ${customer.business_name || '—'}
- Entity Type: ${customer.company_type || '—'}
- Product Type: ${productType}
- Loan Amount Required: ₹${amountLakhs} Lakhs
- Loan Tenor Required: ${tenureMonths} Months
- Indicative ROI: ${proposal.roi_min || '—'}% ${proposal.roi_max ? `to ${proposal.roi_max}%` : ''}
- Processing Fee: ${proposal.processing_fee || '—'}%
- Loan Purpose: ${proposal.loan_purpose || '—'}

Financial Summary
- GST Turnover: ${gstTurnover != null ? fmtLakhs(gstTurnover) : '—'}
- Net Profit Income: ${netProfit != null ? fmtLakhs(netProfit) : '—'}
- Banking Income / Avg Bal: ${avgBankBalance != null ? fmtINR(avgBankBalance) : '—'}
- Salaried Income: ${salariedIncome != null ? `${fmtINR(salariedIncome)}/mo` : '—'}
- Selected Monthly Income: ${fmtINR(esrFinancials?.selected_monthly_income)}
- Existing Obligations: ${fmtINR(esrFinancials?.existing_obligations)}
- CIBIL Score: ${esrFinancials?.bureau_score || '—'}

Documents Enclosed
The following supporting documents are attached to this email:
${docListText}

Kindly review the application at your earliest convenience. Please feel free to reach out to us should you require any additional information or clarification.

We look forward to a positive response.

Warm regards,

${sender.name}
${sender.designation || ''}
${dsaName}
${sender.mobile || '—'} | ${sender.email}

Disclaimer: This application is being submitted by ${dsaName} on behalf of the applicant. All credit assessment, KYC verification, and sanction decisions rest solely with your institution. The financial figures above are indicative, based on data provided by the applicant and retrieved through consent-based data APIs.
  `.trim();

  return { subject, bodyText, bodyHtml };
}

// ── Send SMS (Twilio or silent fallback) ──────────────────────────────────────
async function sendProposalSms({ mobile, message }) {
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

// ── Orchestrator: Send by Proposal ID ─────────────────────────────────────────
async function dispatchProposalEmailByProposalId({ proposalId, tenantId, userId }) {
  // 1. Fetch full context
  const proposal = await prisma.proposal.findFirst({
    where: { id: Number(proposalId), tenant_id: Number(tenantId) },
    include: {
      case: {
        include: {
          customer: true,
          tenant: true,
          applicants: true,
          esr_financials: true
        }
      },
      lender: true,
      tenant_lender: true,
      documents: {
        include: {
          document: true
        }
      }
    }
  });

  if (!proposal) throw new Error('Proposal not found');

  const caseData = proposal.case;
  const customer = caseData.customer;
  const tenant = caseData.tenant;
  const esrFinancials = caseData.esr_financials || {};
  const applicants = caseData.applicants;
  const selectedDocs = proposal.documents.map(pd => pd.document);

  if (selectedDocs.length === 0) {
    throw new Error('Please attach at least one document before sending proposal.');
  }

  // 2. Resolve lender contact
  const { resolveContactForLender } = require('./tenantLender.service');
  const lenderName = proposal.lender?.name || proposal.tenant_lender?.lender_name;

  if (!lenderName) throw new Error('Target lender name not found on proposal.');

  const contact = await resolveContactForLender({
    tenantId,
    lenderName,
    productType: proposal.product_type || caseData.product_type
  });

  if (!contact || !contact.contact_email) {
    throw new Error('No email contact configured for this lender/product. Please check Lender Contacts.');
  }

  // 3. Fetch sender (DSA user)
  const sender = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, email: true, mobile: true, designation: true }
  });

  // 4. Build content
  const { subject, bodyText, bodyHtml } = buildProposalEmailFromTemplate({
    proposal,
    caseData,
    customer,
    applicants,
    esrFinancials,
    lenderContact: contact,
    sender,
    tenant,
    documents: selectedDocs
  });

  // 5. Resolve attachments
  const fs = require('fs');
  const path = require('path');
  const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');

  const attachments = selectedDocs
    .filter(d => {
      if (d.storage_path) {
        const absPath = path.resolve(UPLOADS_ROOT, d.storage_path);
        return fs.existsSync(absPath);
      }
      return d.source_url && d.source_url.startsWith('http');
    })
    .map(d => ({
      filename: d.original_file_name || d.file_name || `${d.document_type}.pdf`,
      path: d.storage_path ? path.resolve(UPLOADS_ROOT, d.storage_path) : d.source_url,
    }));

  // 6. Mandatory Runtime Logging
  console.log('[PROPOSAL SEND] Using template email builder');
  console.log('[PROPOSAL SEND] proposal_id:', proposal.id);
  console.log('[PROPOSAL SEND] requested_amount:', proposal.requested_amount);
  console.log('[PROPOSAL SEND] tenure_months:', proposal.tenure_months);
  console.log('[PROPOSAL SEND] document_count:', selectedDocs.length);
  console.log('[PROPOSAL SEND] email_subject:', subject);

  // 7. Send
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'platform@cred2tech.com';
  const fromName = process.env.SMTP_FROM_NAME || 'Cred2Tech Platform';

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
      console.log(`[PROPOSAL SEND] ✅ Email actually dispatched! MsgId: ${messageId}`);
    } catch (err) {
      console.error('[PROPOSAL SEND] ❌ Email Send failed:', err.message);
      throw new Error(`Failed to send email to lender: ${err.message}`);
    }
  } else {
    console.log('[PROPOSAL SEND] MOCK SEND (No SMTP):', subject);
    emailSent = true;
  }

  // 8. SMS (Optional)
  const dsaCode = contact.dsa_code || `DSA-${String(tenant.id).padStart(4, '0')}`;
  const smsMessage = `Cred2Tech: New proposal from DSA ${sender.name} (${dsaCode}). Customer: ${customer.name || customer.business_name}. Amount: ₹${(proposal.requested_amount / 100000).toFixed(1)}L. Case: CASE-${caseData.id}.`;

  if (contact.contact_mobile) {
    await sendProposalSms({ mobile: contact.contact_mobile, message: smsMessage }).catch(() => { });
  }

  // 9. Child Case Lifecycle Linkage (Standardize Lender Tracking)
  let childCaseId = proposal.child_case_id;
  try {
    const { cloneCaseForLender } = require('./case.clone.service');
    const lenderSnapshot = {
      product_type: proposal.product_type || caseData.product_type,
      lender_name: lenderName,
      platform_lender_id: proposal.lender_id,
      tenant_lender_id: proposal.tenant_lender_id,
      contact_id: contact.id,
      dsa_code: contact.dsa_code,
      contact_name: contact.contact_name,
      contact_email: contact.contact_email,
      contact_mobile: contact.contact_mobile
    };

    const cloneResult = await cloneCaseForLender(caseData.id, tenantId, lenderSnapshot, userId);
    childCaseId = cloneResult.case.id;

    // Link Proposal to Child Case
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { child_case_id: childCaseId }
    });
    console.log(`[PROPOSAL SEND] Linked to Child Case: CASE-${childCaseId}`);
  } catch (err) {
    console.error('[PROPOSAL SEND] Child Case Linkage Error (Non-Fatal):', err.message);
  }

  return {
    emailSent,
    messageId,
    childCaseId,
    to: contact.contact_email,
    contact_name: contact.contact_name,
    subject,
    bodyText,
    bodyHtml,
    attachments_count: attachments.length
  };
}

module.exports = {
  dispatchProposalEmailByProposalId,
  buildProposalEmailFromTemplate
};
