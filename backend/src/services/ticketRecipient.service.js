// Admin-editable To/Cc list for new-ticket notification emails (see
// ticket.email.js#getRecipientAddresses). Deliberately DB-backed, not env
// vars, so it can be changed from the admin panel without a redeploy.
const prisma = require('../../config/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ticketRecipientService = {
  list: async () => {
    return prisma.ticketNotificationRecipient.findMany({
      orderBy: [{ type: 'asc' }, { created_at: 'asc' }],
    });
  },

  add: async ({ email, type, label }, actorUserId) => {
    const trimmedEmail = (email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(trimmedEmail)) throw new Error('A valid email address is required.');
    if (!['TO', 'CC'].includes(type)) throw new Error('Type must be TO or CC.');

    try {
      return await prisma.ticketNotificationRecipient.create({
        data: { email: trimmedEmail, type, label: label?.trim() || null, created_by_user_id: actorUserId },
      });
    } catch (err) {
      if (err.code === 'P2002') throw new Error('That email is already in the list for this type.');
      throw err;
    }
  },

  update: async (id, { email, label }) => {
    const data = {};
    if (email !== undefined) {
      const trimmedEmail = (email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(trimmedEmail)) throw new Error('A valid email address is required.');
      data.email = trimmedEmail;
    }
    if (label !== undefined) data.label = label?.trim() || null;

    try {
      return await prisma.ticketNotificationRecipient.update({ where: { id }, data });
    } catch (err) {
      if (err.code === 'P2025') throw Object.assign(new Error('Recipient not found.'), { status: 404 });
      if (err.code === 'P2002') throw new Error('That email is already in the list for this type.');
      throw err;
    }
  },

  remove: async (id) => {
    try {
      await prisma.ticketNotificationRecipient.delete({ where: { id } });
    } catch (err) {
      if (err.code === 'P2025') throw Object.assign(new Error('Recipient not found.'), { status: 404 });
      throw err;
    }
    return { success: true };
  },
};

module.exports = ticketRecipientService;
