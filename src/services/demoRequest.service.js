const prisma = require('../../config/db');

const ADMIN_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const demoRequestService = {
  /** Public — no submitter identity, so every field is validated here rather
   *  than trusted from the client. */
  create: async ({ fullName, businessName, mobileNumber, email, product, message }, ipAddress) => {
    if (!fullName || !fullName.trim()) throw new Error('Full name is required.');
    if (!businessName || !businessName.trim()) throw new Error('Business name is required.');
    if (!mobileNumber || !mobileNumber.trim()) throw new Error('Mobile number is required.');
    if (!email || !EMAIL_RE.test(email.trim())) throw new Error('A valid email address is required.');
    if (!product || !product.trim()) throw new Error('Please select which product you want a demo of.');

    return prisma.demoRequest.create({
      data: {
        full_name: fullName.trim().slice(0, 200),
        business_name: businessName.trim().slice(0, 200),
        mobile_number: mobileNumber.trim().slice(0, 30),
        email: email.trim().slice(0, 200),
        product: product.trim().slice(0, 100),
        message: message ? message.trim().slice(0, 2000) : null,
        ip_address: ipAddress || null,
      },
    });
  },

  listForAdmin: async ({ search, unreadOnly, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 20 }) => {
    const where = {};
    if (unreadOnly === true || unreadOnly === 'true') where.is_read = false;
    if (search) {
      where.OR = [
        { full_name: { contains: search, mode: 'insensitive' } },
        { business_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { mobile_number: { contains: search, mode: 'insensitive' } },
        { product: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSort = new Set(['created_at', 'full_name', 'business_name']);
    const orderBy = { [allowedSort.has(sortBy) ? sortBy : 'created_at']: sortDir === 'asc' ? 'asc' : 'desc' };

    const take = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.demoRequest.findMany({ where, orderBy, skip, take }),
      prisma.demoRequest.count({ where }),
    ]);

    return { data: rows, total, page: Math.max(parseInt(page, 10) || 1, 1), pageSize: take };
  },

  getUnreadCount: async () => prisma.demoRequest.count({ where: { is_read: false } }),

  getById: async (id) => {
    const row = await prisma.demoRequest.findUnique({ where: { id } });
    if (!row) throw Object.assign(new Error('Demo request not found.'), { status: 404 });
    return row;
  },

  markAsRead: async (id) => {
    const row = await prisma.demoRequest.findUnique({ where: { id } });
    if (!row) throw Object.assign(new Error('Demo request not found.'), { status: 404 });
    if (row.is_read) return row;
    return prisma.demoRequest.update({
      where: { id },
      data: { is_read: true, read_at: new Date() },
    });
  },
};

module.exports = { demoRequestService, ADMIN_ROLES };
