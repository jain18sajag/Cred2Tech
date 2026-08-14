// proposal.email.service.js
// Sends formatted proposal emails and SMS notifications.
// Uses a simple transporter pattern with graceful fallback if SMTP is not configured.

const nodemailer = require('nodemailer');
const prisma = require('../../config/db');
const { renderBrandedEmail, esc, BRAND_COLORS: C, BRAND_FONT: FONT } = require('../utils/emailTemplate');
const { sendSms: sendProposalSms } = require('../utils/sms');
const { resolveCustomerName } = require('../utils/entityName');

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
  // Customer has no `name`/`company_type` columns — those were always
  // undefined, silently falling back to "Customer" / "—" on every proposal
  // email. resolveCustomerName() is the app's existing canonical fallback
  // chain (proprietor_name → legal_business_name → pan_holder_name →
  // business_name); entity_type is the real column for constitution
  // (Proprietorship/Partnership/Pvt Ltd/...).
  const customerName = resolveCustomerName(customer, 'Customer');
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
    ? `<ol style="margin:8px 0 0;padding-left:20px;font-family:${FONT};font-size:13px;color:${C.body};">${documents.map(d => `<li style="margin-bottom:4px;">${esc(d.original_file_name || d.file_name || d.document_type)}</li>`).join('')}</ol>`
    : `<p style="margin:8px 0 0;font-family:${FONT};font-size:13px;color:${C.muted};font-style:italic;">No documents attached.</p>`;

  const docListText = documents.length > 0
    ? documents.map((d, i) => `${i + 1}. ${d.original_file_name || d.file_name || d.document_type}`).join('\n')
    : 'No documents attached.';

  // Two-column "label / value" info table — same panel/border/left-accent
  // language as the branded wrapper's own highlight box (see
  // utils/emailTemplate.js), reused here for structured detail sections.
  const infoTable = (rows) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:${FONT};font-size:13px;margin-bottom:20px;">
      ${rows.map(([label, value, valueStyle]) => `
        <tr>
          <td style="padding:9px 12px;border:1px solid ${C.line};background:${C.panel};font-weight:700;color:${C.ink};width:38%;">${esc(label)}</td>
          <td style="padding:9px 12px;border:1px solid ${C.line};color:${C.body};${valueStyle || ''}">${value}</td>
        </tr>
      `).join('')}
    </table>`;

  const sectionHeading = (title) =>
    `<h3 style="margin:0 0 12px;font-family:${FONT};font-size:13px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:${C.primary};border-bottom:1px solid ${C.line};padding-bottom:8px;">${esc(title)}</h3>`;

  const customerLoanRows = [
    ['Customer Name', esc(customerName)],
    ['Business Name', esc(customer.business_name || '—')],
    ['Entity Type', esc(customer.entity_type || '—')],
    ['Product Type', esc(productType)],
    ['Loan Amount Required', `₹${amountLakhs} Lakhs`, `font-weight:800;color:${C.emerald};`],
    ['Loan Tenor Required', `${tenureMonths} Months`],
    ['Loan Purpose', esc(proposal.loan_purpose || '—')],
  ];

  const financialRows = [
    ...((grossTurnover || gstTurnover || avgBankBalance) ? [
      ['GST Turnover', gstTurnover != null ? fmtLakhs(gstTurnover) : '—'],
      ['Net Profit Income', netProfit != null ? fmtLakhs(netProfit) : '—'],
      ['Banking Income / Avg Bal', avgBankBalance != null ? fmtINR(avgBankBalance) : '—'],
    ] : []),
    ...(salariedIncome != null ? [
      ['Salaried Income', `${fmtINR(salariedIncome)} / month`],
      ['Salary Source', `${esc(salariedSource)} (${salariedSlipCount} slips)`],
    ] : []),
    ['Selected Monthly Income', fmtINR(esrFinancials?.selected_monthly_income), 'font-weight:700;'],
    ['Existing Obligations', fmtINR(esrFinancials?.existing_obligations)],
    ['CIBIL Score', esc(esrFinancials?.bureau_score || '—')],
  ];

  // Same left-accent panel language as the branded wrapper's highlight box —
  // carries the DSA/channel-partner identity that used to be its own header bar.
  const dsaPanel = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${C.primary};padding:12px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:${FONT};">
            <p style="margin:0 0 2px;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${C.faint};">DSA / Channel Partner</p>
            <p style="margin:0;font-size:15px;font-weight:800;color:${C.ink};">${esc(dsaName)}</p>
          </td>
          <td align="right" style="font-family:${FONT};font-size:11px;color:${C.muted};white-space:nowrap;">
            DSA Code: <strong style="color:${C.ink};">${esc(dsaCode)}</strong><br/>
            Date: <strong style="color:${C.ink};">${esc(fmtDate())}</strong>
          </td>
        </tr></table>
      </td></tr>
    </table>`;

  const signOff = `
    <p style="margin:24px 0 0;font-family:${FONT};font-size:14px;color:${C.body};">Kindly review the application at your earliest convenience. Please feel free to reach out to us should you require any additional information or clarification.</p>
    <p style="margin:8px 0 0;font-family:${FONT};font-size:14px;color:${C.body};">We look forward to a positive response.</p>
    <p style="margin:20px 0 0;font-family:${FONT};font-size:14px;color:${C.body};">Warm regards,</p>
    <p style="margin:10px 0 0;font-family:${FONT};font-size:14px;font-weight:700;color:${C.ink};">${esc(sender.name)}</p>
    ${sender.designation ? `<p style="margin:0;font-family:${FONT};font-size:13px;color:${C.muted};">${esc(sender.designation)}</p>` : ''}
    <p style="margin:0;font-family:${FONT};font-size:13px;color:${C.muted};">${esc(dsaName)}</p>
    <p style="margin:0;font-family:${FONT};font-size:13px;color:${C.muted};">${esc(sender.mobile || '—')} | ${esc(sender.email)}</p>`;

  const disclaimer = `
    <p style="margin:20px 0 0;padding-top:14px;border-top:1px solid ${C.line};font-family:${FONT};font-size:11px;line-height:1.6;color:${C.faint};text-align:justify;">
      Disclaimer: This application is being submitted by ${esc(dsaName)} on behalf of the applicant. All credit assessment, KYC verification, and sanction decisions rest solely with your institution. The financial figures above are indicative, based on data provided by the applicant and retrieved through consent-based data APIs.
    </p>`;

  const customBody = `
    ${dsaPanel}
    ${sectionHeading('Customer & Loan Details')}
    ${infoTable(customerLoanRows)}
    ${sectionHeading('Financial Summary')}
    ${infoTable(financialRows)}
    ${sectionHeading('Documents Enclosed')}
    <p style="margin:0;font-family:${FONT};font-size:12px;color:${C.muted};">The following supporting documents are attached to this email:</p>
    ${docListHtml}
    ${signOff}
    ${disclaimer}
  `;

  // Rendered through the same branded wrapper used by scheme.cred2tech.com
  // (see utils/emailTemplate.js) — indigo/emerald palette, sharp corners —
  // so this email matches every other Cred2Tech email, not its own one-off theme.
  const { html: bodyHtml } = renderBrandedEmail({
    title: 'New Loan Application',
    preheader: `${customerName} — ${productType} — ₹${amountLakhs} Lakhs`,
    heading: 'New Loan Application for Your Review',
    intro: `Dear ${contactName},`,
    paragraphs: [
      'I hope this message finds you well. I am writing to introduce a loan application from one of our customers for your consideration. Kindly find the relevant details and supporting documents below.',
    ],
    customBody,
  });

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
- Entity Type: ${customer.entity_type || '—'}
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

// ── Orchestrator: Send by Proposal ID ─────────────────────────────────────────
async function dispatchProposalEmailByProposalId({ proposalId, tenantId, userId, contactId }) {
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
  // JSON files are raw data exports, never required in a lender-facing
  // proposal — excluded here as a safety net regardless of how a document
  // got attached (e.g. a stale attachment predating this exclusion, or any
  // future path that attaches documents without going through the UI's own
  // category filtering).
  const isJsonDoc = (doc) =>
    doc.mime_type === 'application/json' ||
    doc.extension?.toLowerCase() === 'json' ||
    (doc.original_file_name || doc.file_name || '').toLowerCase().endsWith('.json');

  const selectedDocs = proposal.documents.map(pd => pd.document).filter(doc => !isJsonDoc(doc));

  if (selectedDocs.length === 0) {
    throw new Error('Please attach at least one document before sending proposal.');
  }

  // Fallback for proposals auto-created by the Send / Send-to-Other-Lender
  // buttons before those endpoints resolved a platform lender_id — those rows
  // have tenure_months/requested_amount left null because createProposalDraft
  // had nothing to look up an EligibilityReportLender row by. Resolve it now
  // from the case's latest ESR result via tenant_lender_id (always present)
  // or lender_id, so an already-broken proposal's email still shows the
  // lender's actual eligible tenure/amount instead of a permanent "—".
  let effectiveTenureMonths = proposal.tenure_months;
  let effectiveRequestedAmount = proposal.requested_amount;
  if (!effectiveTenureMonths || !effectiveRequestedAmount) {
    const report = await prisma.eligibilityReport.findFirst({
      where: { case_id: caseData.id, is_latest: true },
    });
    if (report && (proposal.lender_id || proposal.tenant_lender_id)) {
      const lenderRow = await prisma.eligibilityReportLender.findFirst({
        where: {
          esr_id: report.id,
          ...(proposal.lender_id
            ? { lender_id: String(proposal.lender_id) }
            : { tenant_lender_id: Number(proposal.tenant_lender_id) }),
        },
      });
      if (lenderRow) {
        effectiveTenureMonths = effectiveTenureMonths || lenderRow.tenure_months;
        effectiveRequestedAmount = effectiveRequestedAmount || lenderRow.eligible_amount;
      }
    }
  }
  const effectiveProposal = { ...proposal, tenure_months: effectiveTenureMonths, requested_amount: effectiveRequestedAmount };

  // 2. Resolve lender contact
  const { resolveContactForLender, resolveContactById } = require('./tenantLender.service');
  const lenderName = proposal.lender?.name || proposal.tenant_lender?.lender_name;

  if (!lenderName) throw new Error('Target lender name not found on proposal.');

  let contact;
  if (contactId) {
    contact = await resolveContactById(contactId, tenantId);
  } else {
    contact = await resolveContactForLender({
      tenantId,
      lenderName,
      productType: proposal.product_type || caseData.product_type
    });
  }

  if (!contact || !contact.contact_email) {
    throw new Error('No email contact configured for this lender/product. Please check Lender Contacts.');
  }

  // 3. Fetch sender (DSA user) and related hierarchy — these 3 are
  // independent of each other (only the manager lookups below depend on
  // their results), so run them in parallel rather than paying 3 sequential
  // round-trips.
  const [sender, caseCreator, dsaAdmins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: Number(userId) },
      select: { id: true, name: true, email: true, mobile: true, designation: true, manager_id: true }
    }),
    caseData.created_by
      ? prisma.user.findUnique({ where: { id: caseData.created_by }, select: { email: true, manager_id: true } })
      : Promise.resolve(null),
    prisma.user.findMany({
      where: { tenant_id: Number(tenantId), role: { name: 'DSA' } },
      select: { email: true }
    }),
  ]);

  // Fetch Managers — also independent of each other, given sender/caseCreator above.
  const [creatorManager, senderManager] = await Promise.all([
    caseCreator?.manager_id
      ? prisma.user.findUnique({ where: { id: caseCreator.manager_id }, select: { email: true } })
      : Promise.resolve(null),
    (sender?.manager_id && sender.manager_id !== caseCreator?.manager_id)
      ? prisma.user.findUnique({ where: { id: sender.manager_id }, select: { email: true } })
      : Promise.resolve(null),
  ]);

  // Consolidate CC list
  const ccEmails = new Set();
  if (sender?.email) ccEmails.add(sender.email);
  if (caseCreator?.email) ccEmails.add(caseCreator.email);
  if (creatorManager?.email) ccEmails.add(creatorManager.email);
  if (senderManager?.email) ccEmails.add(senderManager.email);
  dsaAdmins.forEach(admin => { if (admin.email) ccEmails.add(admin.email); });
  const ccEmailString = Array.from(ccEmails).join(', ');

  // 4. Resolve attachments — every document is written straight to whichever
  // storage provider it was uploaded under (S3 by default, see
  // services/storage/index.js), never to this server's local disk, so the
  // old "check UPLOADS_ROOT + storage_path on local disk" logic never found
  // anything and silently sent zero attachments while the email body still
  // listed every document as "enclosed". downloadToTempFile() knows how to
  // fetch from whichever provider each document actually lives in.
  const { downloadToTempFile } = require('./document.service');
  const fs = require('fs');

  // Downloaded in parallel — these were previously fetched one at a time
  // (await inside a for-loop), so a 4-document proposal paid the sum of all
  // 4 S3 round-trips sequentially instead of the cost of the single slowest
  // one. This was the single biggest contributor to "sending takes time".
  const downloadResults = await Promise.allSettled(
    selectedDocs.map(doc => downloadToTempFile(doc).then(tempPath => ({ doc, tempPath })))
  );

  const attachedDocs = [];
  const tempFilePaths = [];
  downloadResults.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      attachedDocs.push(result.value);
      tempFilePaths.push(result.value.tempPath);
    } else {
      const doc = selectedDocs[i];
      console.error(`[PROPOSAL SEND] Failed to fetch document #${doc.id} (${doc.storage_path}) from storage:`, result.reason?.message);
    }
  });

  const attachments = attachedDocs.map(({ doc, tempPath }) => ({
    filename: doc.original_file_name || doc.file_name || `${doc.document_type}.pdf`,
    path: tempPath,
  }));

  // 5. Build content — the "Documents Enclosed" list must reflect only the
  // documents that were actually pulled from storage above, never the full
  // selectedDocs set, so the email body can never claim something is
  // attached when the storage fetch silently failed.
  const { subject, bodyText, bodyHtml } = buildProposalEmailFromTemplate({
    proposal: effectiveProposal,
    caseData,
    customer,
    applicants,
    esrFinancials,
    lenderContact: contact,
    sender,
    tenant,
    documents: attachedDocs.map(a => a.doc)
  });

  // 6. Mandatory Runtime Logging
  console.log('[PROPOSAL SEND] Using template email builder');
  console.log('[PROPOSAL SEND] proposal_id:', proposal.id);
  console.log('[PROPOSAL SEND] requested_amount:', effectiveProposal.requested_amount);
  console.log('[PROPOSAL SEND] tenure_months:', effectiveProposal.tenure_months);
  console.log('[PROPOSAL SEND] document_count:', selectedDocs.length, '| attached:', attachedDocs.length);
  console.log('[PROPOSAL SEND] email_subject:', subject);

  // 7. Send
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'platform@cred2tech.com';
  const fromName = process.env.SMTP_FROM_NAME || 'Cred2Tech Platform';

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: contact.contact_email,
    cc: ccEmailString,
    replyTo: sender.email,
    subject,
    text: bodyText,
    html: bodyHtml,
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  const transporter = getTransporter();
  let messageId = null;
  let emailSent = false;

  if (transporter) {
    // The caller (proposal.controller.js `send`) already awaits this whole
    // function before responding to the HTTP request, so the old
    // fire-and-forget here bought no real latency win — it just meant a
    // failed send was reported to the client/DB as a success. Await it for real.
    try {
      const info = await transporter.sendMail(mailOptions);
      messageId = info.messageId;
      emailSent = true;
      console.log(`[PROPOSAL SEND] ✅ Email dispatched. MsgId: ${info.messageId}`);
    } catch (err) {
      console.error('[PROPOSAL SEND] ❌ Email send failed:', err.message);
      emailSent = false;
    }
  } else {
    console.log('[PROPOSAL SEND] MOCK SEND (No SMTP):', subject);
    emailSent = true;
  }

  // Clean up the temp files downloadToTempFile() wrote to disk — nodemailer
  // has already read them by this point regardless of send success/failure.
  for (const p of tempFilePaths) {
    fs.unlink(p, () => {});
  }

  // 8. SMS (Optional)
  const dsaCode = contact.dsa_code || `DSA-${String(tenant.id).padStart(4, '0')}`;
  const smsMessage = `Cred2Tech: New proposal from DSA ${sender.name} (${dsaCode}). Customer: ${resolveCustomerName(customer, customer.business_name)}. Amount: ₹${((effectiveProposal.requested_amount || 0) / 100000).toFixed(1)}L. Case: CASE-${caseData.id}.`;

  if (contact.contact_mobile) {
    // Fire and forget SMS
    sendProposalSms({ mobile: contact.contact_mobile, message: smsMessage }).catch(() => { });
  }

  // 9. Child Case Lifecycle Linkage (Standardize Lender Tracking)
  // Fire-and-forget — cloneCaseForLender runs a full transactional case clone
  // (applicants, documents, ESR data, etc.), which was previously awaited
  // here and was the single biggest contributor to "sending takes a long
  // time": the DSA sat waiting on a case-clone transaction that has nothing
  // to do with whether the email actually went out (already sent above) and
  // was already treated as non-fatal on failure. Nothing in the frontend
  // reads `childCaseId` from the send response, so there's no correctness
  // reason to block on it either — it just links up moments later.
  const childCaseId = proposal.child_case_id;
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
  cloneCaseForLender(caseData.id, tenantId, lenderSnapshot, userId)
    .then(cloneResult => prisma.proposal.update({
      where: { id: proposal.id },
      data: { child_case_id: cloneResult.case.id }
    }).then(() => console.log(`[PROPOSAL SEND] Linked to Child Case: CASE-${cloneResult.case.id}`)))
    .catch(err => {
      console.error('[PROPOSAL SEND] Child Case Linkage Error (Non-Fatal):', err.message);
      console.error('[PROPOSAL SEND] Stack:', err.stack);
    });

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
