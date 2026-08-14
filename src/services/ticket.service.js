const prisma = require('../../config/db');
const { notifyAdminsOfNewTicket, sendSubmitterAck, sendSubmitterUpdate, notifyAdminsOfSubmitterReply } = require('./ticket.email');

const ADMIN_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER'];
const SUBMITTER_ROLES = ['MSME_CUSTOMER', 'DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

// MSME self-service users are provisioned with a synthetic, unusable login
// email (see direct.customer.auth.service.js#findOrCreateUser) — never a
// real inbox. Prefer whatever real address this customer has actually given
// us (their own Case's business_email, or the cross-app synced_email cache)
// before falling back to a plain User.email, which is only real for
// DSA/staff accounts.
async function resolveSubmitterEmail(user) {
  const isSynthetic = user.email && user.email.endsWith('@direct.cred2tech.local');
  if (!isSynthetic) return user.email || null;

  const latestCase = await prisma.case.findFirst({
    where: { msme_customer_user_id: user.id },
    orderBy: { created_at: 'desc' },
    include: { customer: true },
  });
  return latestCase?.customer?.business_email || user.synced_email || null;
}

async function assignTicketNumber(ticketId) {
  const ticket_number = `TCK-${String(ticketId).padStart(6, '0')}`;
  return prisma.ticket.update({ where: { id: ticketId }, data: { ticket_number } });
}

const ticketService = {
  /**
   * Creates a ticket/feedback row, logs the CREATED timeline entry, saves any
   * attachments already uploaded to storage (see ticket.controller.js), and
   * fires both notification emails. Email failures never fail the request —
   * ticket.email.js's sendMail is itself best-effort.
   */
  create: async (user, { type, subject, description }, attachments = []) => {
    if (!subject || !subject.trim()) throw new Error('Subject is required.');
    if (!description || !description.trim()) throw new Error('Description is required.');
    if (!['FEEDBACK', 'ISSUE'].includes(type)) throw new Error('Type must be FEEDBACK or ISSUE.');

    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticket_number: 'PENDING', // overwritten right below once we have the id
          type,
          subject: subject.trim(),
          description: description.trim(),
          tenant_id: user.tenant_id,
          created_by_user_id: user.id,
          created_by_role: user.role,
        },
      });

      const withNumber = await tx.ticket.update({
        where: { id: created.id },
        data: { ticket_number: `TCK-${String(created.id).padStart(6, '0')}` },
      });

      if (attachments.length > 0) {
        await tx.ticketAttachment.createMany({
          data: attachments.map((a) => ({
            ticket_id: withNumber.id,
            storage_key: a.storageKey,
            file_name: a.fileName,
            mime_type: a.mimeType,
            size_bytes: a.sizeBytes,
          })),
        });
      }

      await tx.ticketTimelineEntry.create({
        data: {
          ticket_id: withNumber.id,
          action: 'CREATED',
          to_status: 'OPEN',
          visible_to_submitter: true,
          performed_by_user_id: user.id,
        },
      });

      return withNumber;
    });

    const full = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: { created_by: { select: { id: true, name: true, email: true, synced_email: true } } },
    });

    // Best-effort, never blocks the response the caller sends back.
    notifyAdminsOfNewTicket(full).catch((err) => console.error('[ticket] admin notify failed:', err.message));
    resolveSubmitterEmail(full.created_by)
      .then((email) => sendSubmitterAck(full, email))
      .catch((err) => console.error('[ticket] submitter ack failed:', err.message));

    return full;
  },

  /** Admin list — filters + sort + pagination, most recent first by default. */
  listForAdmin: async ({ type, status, role, unreadOnly, search, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 20 }) => {
    const where = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (role) where.created_by_role = role;
    if (unreadOnly === true || unreadOnly === 'true') where.read_at = null;
    if (search) {
      where.OR = [
        { ticket_number: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSort = new Set(['created_at', 'updated_at', 'status', 'type']);
    const orderBy = { [allowedSort.has(sortBy) ? sortBy : 'created_at']: sortDir === 'asc' ? 'asc' : 'desc' };

    const take = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          created_by: { select: { id: true, name: true, email: true, mobile: true } },
          _count: { select: { attachments: true } },
        },
      }),
      prisma.ticket.count({ where }),
    ]);

    return { data: rows, total, page: Math.max(parseInt(page, 10) || 1, 1), pageSize: take };
  },

  listMine: async (userId) => {
    return prisma.ticket.findMany({
      where: { created_by_user_id: userId },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { attachments: true } } },
    });
  },

  getUnreadCount: async () => {
    return prisma.ticket.count({ where: { read_at: null } });
  },

  /** requester is req.user — admins see everything (incl. internal notes); a
   *  submitter may only fetch their own ticket, and never sees internal notes. */
  getById: async (id, requester) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        created_by: { select: { id: true, name: true, email: true, mobile: true } },
        read_by: { select: { id: true, name: true } },
        attachments: true,
        timeline: {
          orderBy: { created_at: 'asc' },
          include: { performed_by: { select: { id: true, name: true } } },
        },
      },
    });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });

    const admin = isAdminRole(requester.role);
    if (!admin && ticket.created_by_user_id !== requester.id) {
      throw Object.assign(new Error('Forbidden.'), { status: 403 });
    }
    if (!admin) {
      ticket.timeline = ticket.timeline.filter((t) => t.visible_to_submitter);
    }
    return ticket;
  },

  /** Admin-only. Changes status, logs the timeline entry, optionally notifies the submitter. */
  changeStatus: async (id, { toStatus, note }, actor) => {
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(toStatus)) {
      throw new Error('Invalid status.');
    }
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { created_by: { select: { id: true, name: true, email: true, synced_email: true } } },
    });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id },
        data: {
          status: toStatus,
          resolved_at: toStatus === 'RESOLVED' ? now : ticket.resolved_at,
          closed_at: toStatus === 'CLOSED' ? now : ticket.closed_at,
        },
      });
      await tx.ticketTimelineEntry.create({
        data: {
          ticket_id: id,
          action: 'STATUS_CHANGED',
          from_status: ticket.status,
          to_status: toStatus,
          note: note || null,
          visible_to_submitter: true,
          performed_by_user_id: actor.id,
        },
      });
      return u;
    });

    resolveSubmitterEmail(ticket.created_by)
      .then((email) => sendSubmitterUpdate({ ...ticket, status: toStatus }, email, { note, statusChangedTo: toStatus }))
      .catch((err) => console.error('[ticket] status-update email failed:', err.message));

    return updated;
  },

  /** Admin-only. Internal note — never emailed, never shown to the submitter. */
  addInternalNote: async (id, note, actor) => {
    if (!note || !note.trim()) throw new Error('Note text is required.');
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });

    return prisma.ticketTimelineEntry.create({
      data: {
        ticket_id: id,
        action: 'INTERNAL_NOTE',
        note: note.trim(),
        visible_to_submitter: false,
        performed_by_user_id: actor.id,
      },
    });
  },

  /** Admin-only. A reply that IS emailed to, and shown to, the submitter. */
  replyToSubmitter: async (id, note, actor) => {
    if (!note || !note.trim()) throw new Error('Reply text is required.');
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { created_by: { select: { id: true, name: true, email: true, synced_email: true } } },
    });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });

    const entry = await prisma.ticketTimelineEntry.create({
      data: {
        ticket_id: id,
        action: 'REPLIED_TO_SUBMITTER',
        note: note.trim(),
        visible_to_submitter: true,
        performed_by_user_id: actor.id,
      },
    });

    resolveSubmitterEmail(ticket.created_by)
      .then((email) => sendSubmitterUpdate(ticket, email, { note: note.trim() }))
      .catch((err) => console.error('[ticket] reply email failed:', err.message));

    return entry;
  },

  /**
   * The submitter's own follow-up reply — the other half of the thread
   * REPLIED_TO_SUBMITTER started. Two side effects beyond logging the
   * timeline entry: (1) flips the ticket back to unread for admins, so a
   * customer following up doesn't silently sit unnoticed once the original
   * submission was already read; (2) auto-reopens a RESOLVED/CLOSED ticket
   * to OPEN, since a reply after "resolved" almost always means it wasn't.
   */
  addSubmitterMessage: async (id, note, actor) => {
    if (!note || !note.trim()) throw new Error('Message text is required.');
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { created_by: { select: { id: true, name: true } } },
    });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });
    if (ticket.created_by_user_id !== actor.id) {
      throw Object.assign(new Error('Forbidden.'), { status: 403 });
    }

    const trimmed = note.trim();
    const shouldReopen = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';

    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          read_at: null,
          read_by_user_id: null,
          ...(shouldReopen ? { status: 'OPEN', resolved_at: null, closed_at: null } : {}),
        },
      });

      await tx.ticketTimelineEntry.create({
        data: {
          ticket_id: id,
          action: 'SUBMITTER_REPLIED',
          note: trimmed,
          visible_to_submitter: true,
          performed_by_user_id: actor.id,
        },
      });

      if (shouldReopen) {
        await tx.ticketTimelineEntry.create({
          data: {
            ticket_id: id,
            action: 'STATUS_CHANGED',
            from_status: ticket.status,
            to_status: 'OPEN',
            note: 'Automatically reopened — the submitter replied after this was resolved/closed.',
            visible_to_submitter: true,
            performed_by_user_id: actor.id,
          },
        });
      }
    });

    notifyAdminsOfSubmitterReply(ticket, trimmed).catch((err) => console.error('[ticket] submitter-reply notify failed:', err.message));

    return ticketService.getById(id, actor);
  },

  /** Admin-only, explicit action — never triggered implicitly by opening the detail page. */
  markAsRead: async (id, actor) => {
    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw Object.assign(new Error('Ticket not found.'), { status: 404 });
    if (ticket.read_at) return ticket; // already read — no-op, no duplicate timeline noise

    return prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id },
        data: { read_at: new Date(), read_by_user_id: actor.id },
      });
      await tx.ticketTimelineEntry.create({
        data: { ticket_id: id, action: 'MARKED_READ', performed_by_user_id: actor.id },
      });
      return updated;
    });
  },
};

module.exports = { ticketService, isAdminRole, ADMIN_ROLES, SUBMITTER_ROLES };
