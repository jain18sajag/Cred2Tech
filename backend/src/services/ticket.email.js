// Email notifications for the feedback/ticket system. Built on the shared
// utils/mailer.js transporter — never throws, sendMail() itself is
// already best-effort (returns false on failure), so a mail outage never
// blocks ticket creation/updates for the caller. HTML is rendered through
// the branded template shared with scheme.cred2tech.com (see
// utils/emailTemplate.js) so every email looks like it's from the same app.
const prisma = require('../../config/db');
const { sendMail } = require('../utils/mailer');
const { renderBrandedEmail } = require('../utils/emailTemplate');

// Deliberately hardcoded, not FRONTEND_URL — that env var defaults to the
// internal testing frontend's port (localhost:3000) and isn't reliably set
// to the real production WebApp domain. Ticket links always point at the
// actual production app, not wherever FRONTEND_URL happens to be configured.
const APP_URL = 'https://app.cred2tech.com';

function fromAddress() {
  const name = process.env.SMTP_FROM_NAME || 'Cred2Tech';
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return email ? `"${name}" <${email}>` : undefined;
}

function ticketLabel(ticket) {
  return ticket.type === 'FEEDBACK' ? 'Feedback' : 'Ticket';
}

function adminTicketUrl(ticket) {
  return `${APP_URL}/admin/tickets/${ticket.id}`;
}

function myTicketUrl(ticket) {
  return `${APP_URL}/tickets/${ticket.id}`;
}

/** Admin-panel-managed To/Cc addresses (see ticketRecipient.service.js) — never hardcoded. */
async function getRecipientAddresses() {
  const rows = await prisma.ticketNotificationRecipient.findMany();
  return {
    to: rows.filter((r) => r.type === 'TO').map((r) => r.email),
    cc: rows.filter((r) => r.type === 'CC').map((r) => r.email),
  };
}

/** Sent once, right after a ticket/feedback row is created — tells the internal team. */
async function notifyAdminsOfNewTicket(ticket) {
  const { to, cc } = await getRecipientAddresses();
  if (to.length === 0) return; // nothing configured — nothing to send

  const label = ticketLabel(ticket);
  const submittedBy = `${ticket.created_by?.name || 'Unknown'} (${ticket.created_by_role})`;
  const { html, text } = renderBrandedEmail({
    title: `New ${label.toLowerCase()} submitted`,
    preheader: `${submittedBy} — ${ticket.subject}`,
    heading: `New ${label} Submitted`,
    paragraphs: [
      `${submittedBy} submitted a new ${label.toLowerCase()} via the Cred2Tech portal.`,
      `Subject: ${ticket.subject}`,
      ticket.description,
    ],
    highlight: { label: 'Reference No.', value: ticket.ticket_number },
    button: { label: 'Open in Admin Panel', url: adminTicketUrl(ticket) },
  });

  await sendMail({
    from: fromAddress(),
    to,
    cc: cc.length ? cc : undefined,
    subject: `[${label}${ticket.type === 'ISSUE' ? ` #${ticket.ticket_number}` : ''}] ${ticket.subject}`,
    html,
    text,
  });
}

/** Sent once, right after creation, to the person who submitted it. */
async function sendSubmitterAck(ticket, submitterEmail) {
  if (!submitterEmail) return;
  const isFeedback = ticket.type === 'FEEDBACK';

  const { html, text } = renderBrandedEmail(
    isFeedback
      ? {
          title: 'We received your feedback',
          heading: 'Thanks for your feedback!',
          paragraphs: [
            "We've received your feedback and our team will review it shortly.",
            ticket.description,
          ],
          note: 'This is a copy of what you submitted, for your records.',
        }
      : {
          title: 'Your ticket has been created',
          heading: 'Your Issue Has Been Logged',
          paragraphs: ['Our team will get back to you soon.'],
          highlight: { label: 'Ticket No.', value: ticket.ticket_number },
          button: { label: 'Track Its Status', url: myTicketUrl(ticket) },
        },
  );

  await sendMail({
    from: fromAddress(),
    to: submitterEmail,
    subject: isFeedback
      ? 'We received your feedback — Cred2Tech'
      : `Your ticket ${ticket.ticket_number} has been created — Cred2Tech`,
    html,
    text,
  });
}

/** Sent when an admin replies or changes status — keeps the submitter in the loop. */
async function sendSubmitterUpdate(ticket, submitterEmail, { note, statusChangedTo } = {}) {
  if (!submitterEmail) return;
  const label = ticketLabel(ticket);

  const { html, text } = renderBrandedEmail({
    title: `Update on your ${label.toLowerCase()}`,
    heading: `Update on Your ${label}`,
    paragraphs: note ? [note] : [],
    highlight: statusChangedTo
      ? { label: 'Status', value: statusChangedTo.replace(/_/g, ' ') }
      : undefined,
    button: { label: 'View Details', url: myTicketUrl(ticket) },
  });

  await sendMail({
    from: fromAddress(),
    to: submitterEmail,
    subject: `Update on your ${label.toLowerCase()} ${ticket.ticket_number} — Cred2Tech`,
    html,
    text,
  });
}

/** Sent when the submitter posts a follow-up reply — tells the internal team, same list as a brand-new ticket. */
async function notifyAdminsOfSubmitterReply(ticket, note) {
  const { to, cc } = await getRecipientAddresses();
  if (to.length === 0) return;

  const label = ticketLabel(ticket);
  const submitterName = ticket.created_by?.name || 'The submitter';
  const { html, text } = renderBrandedEmail({
    title: `New reply on ${ticket.ticket_number}`,
    preheader: `${submitterName} replied on ${ticket.ticket_number}`,
    heading: 'New Reply From Submitter',
    paragraphs: [`${submitterName} replied on ${ticket.ticket_number}.`, note],
    button: { label: 'Open in Admin Panel', url: adminTicketUrl(ticket) },
  });

  await sendMail({
    from: fromAddress(),
    to,
    cc: cc.length ? cc : undefined,
    subject: `[${label}${ticket.type === 'ISSUE' ? ` #${ticket.ticket_number}` : ''}] New reply from ${submitterName}`,
    html,
    text,
  });
}

module.exports = { notifyAdminsOfNewTicket, sendSubmitterAck, sendSubmitterUpdate, notifyAdminsOfSubmitterReply };
