const prisma = require('../../config/db');
const { assertCaseNotPurged } = require('../utils/casePurgeGuard');

const VALID_TYPES = ['PARTIAL', 'FULL'];

const caseFeedbackService = {
  /**
   * Submitted by the DSA right after their disbursement action actually
   * transitions the case into PARTLY_DISBURSED/DISBURSED (see
   * disbursement.service.js's `stage_changed` flag — the frontend only
   * shows the prompt on that transition, not on every tranche or page
   * visit). Upsert on (case_id, type): a DSA revising their own answer
   * before anyone's looked at it is fine — there's no admin workflow
   * built on top of a specific past value yet, unlike ticket status.
   */
  submit: async ({ case_id, type, rating, comment }, actor) => {
    const caseId = parseInt(case_id, 10);
    if (!caseId) throw new Error('A valid case_id is required.');
    if (!VALID_TYPES.includes(type)) throw new Error('Type must be PARTIAL or FULL.');
    const ratingNum = parseInt(rating, 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new Error('Rating must be a whole number from 1 to 5.');
    }

    const caseRecord = await prisma.case.findFirst({
      where: { id: caseId, tenant_id: actor.tenant_id },
      select: { id: true, data_purged_at: true },
    });
    if (!caseRecord) throw Object.assign(new Error('Case not found.'), { status: 404 });
    assertCaseNotPurged(caseRecord);

    return prisma.caseFeedback.upsert({
      where: { case_id_type: { case_id: caseId, type } },
      create: {
        case_id: caseId,
        tenant_id: actor.tenant_id,
        type,
        rating: ratingNum,
        comment: comment?.trim() || null,
        submitted_by_user_id: actor.id,
      },
      update: {
        rating: ratingNum,
        comment: comment?.trim() || null,
      },
    });
  },

  /** Admin list — filters + sort + pagination, most recent first by default. */
  listForAdmin: async ({ type, rating, search, sortBy = 'created_at', sortDir = 'desc', page = 1, pageSize = 20 }) => {
    const where = {};
    if (type) where.type = type;
    if (rating) where.rating = parseInt(rating, 10);
    if (search) {
      where.case = {
        customer: {
          OR: [
            { business_name: { contains: search, mode: 'insensitive' } },
            { proprietor_name: { contains: search, mode: 'insensitive' } },
            { legal_business_name: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    const allowedSort = new Set(['created_at', 'rating']);
    const orderBy = { [allowedSort.has(sortBy) ? sortBy : 'created_at']: sortDir === 'asc' ? 'asc' : 'desc' };

    const take = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [rows, total, avgResult] = await Promise.all([
      prisma.caseFeedback.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          case: {
            select: {
              id: true,
              product_type: true,
              stage: true,
              customer: { select: { business_name: true, proprietor_name: true, legal_business_name: true, business_pan: true } },
            },
          },
          submitted_by: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.caseFeedback.count({ where }),
      prisma.caseFeedback.aggregate({ where, _avg: { rating: true } }),
    ]);

    return { data: rows, total, page: Math.max(parseInt(page, 10) || 1, 1), pageSize: take, averageRating: avgResult._avg.rating };
  },
};

module.exports = caseFeedbackService;
