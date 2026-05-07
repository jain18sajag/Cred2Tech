const prisma = require('../../config/db');
const caseService = require('./case.service');
const { Decimal } = require('@prisma/client');

/**
 * Record a disbursement tranche for a case.
 * Transitions stage to PARTLY_DISBURSED or DISBURSED.
 */
async function recordDisbursement(caseId, tenantId, payload, userId, idempotencyKey = null) {
    const {
        amount,
        disbursement_date,
        next_disbursement_due_date,
        remarks,
        pdd_tasks = []
    } = payload;

    return await prisma.$transaction(async (tx) => {
        // 1. Idempotency Check
        if (idempotencyKey) {
            const existing = await tx.disbursement.findFirst({
                where: { 
                    tenant_id: tenantId, 
                    case_id: caseId, 
                    idempotency_key: idempotencyKey 
                }
            });
            if (existing) {
                console.log(`[DISBURSEMENT] Idempotency hit for key: ${idempotencyKey}`);
                return existing;
            }
        }

        // 2. Validate Case, Sanction, and Stage
        const existingCase = await tx.case.findFirst({
            where: { id: caseId, tenant_id: tenantId },
            include: { 
                sanction: true,
                disbursements: { where: { status: 'RECORDED' } }
            }
        });

        if (!existingCase) throw new Error('Case not found or unauthorized.');
        if (!existingCase.sanction) throw new Error('Case must be sanctioned before recording disbursement.');

        const allowedStages = ['APPROVED', 'PARTLY_DISBURSED'];
        if (!allowedStages.includes(existingCase.stage)) {
            throw new Error(`Disbursement not allowed from current stage: ${existingCase.stage}`);
        }

        const sanction = existingCase.sanction;
        const disbursementAmount = new Decimal(amount);

        // 3. Re-calculate totals from DB (Source of Truth)
        const totalDisbursedBefore = existingCase.disbursements.reduce(
            (acc, d) => acc.plus(new Decimal(d.amount)), 
            new Decimal(0)
        );
        const sanctionedAmount = new Decimal(sanction.sanctioned_amount);
        const remainingBefore = sanctionedAmount.minus(totalDisbursedBefore);

        if (disbursementAmount.gt(remainingBefore)) {
            throw new Error(`Disbursement amount (${disbursementAmount}) exceeds remaining sanctioned amount (${remainingBefore}).`);
        }

        const totalDisbursedAfter = totalDisbursedBefore.plus(disbursementAmount);
        const remainingAfter = sanctionedAmount.minus(totalDisbursedAfter);
        const trancheNumber = existingCase.disbursements.length + 1;

        // 4. Create Disbursement Row (Snapshotted from Sanction)
        const disbursement = await tx.disbursement.create({
            data: {
                tenant_id: tenantId,
                case_id: caseId,
                case_sanction_id: sanction.id,
                tenant_lender_id: sanction.tenant_lender_id,
                lender_name: sanction.lender_name,
                product_type: sanction.product_type,
                tranche_number: trancheNumber,
                amount: disbursementAmount,
                disbursement_date: new Date(disbursement_date),
                next_disbursement_due_date: next_disbursement_due_date ? new Date(next_disbursement_due_date) : null,
                remarks,
                idempotency_key: idempotencyKey,
                created_by_user_id: userId
            }
        });

        // 5. Create PDD Tasks if provided
        if (pdd_tasks && pdd_tasks.length > 0) {
            await tx.pddTask.createMany({
                data: pdd_tasks.map(task => ({
                    tenant_id: tenantId,
                    case_id: caseId,
                    disbursement_id: disbursement.id,
                    document_name: task.document_name,
                    due_date: task.due_date ? new Date(task.due_date) : null,
                    source_type: 'DISBURSEMENT',
                    created_by_user_id: userId
                }))
            });
        }

        // 6. Update Case Summary and Locking
        const isFullyDisbursed = remainingAfter.lte(0);
        const newStage = isFullyDisbursed ? 'DISBURSED' : 'PARTLY_DISBURSED';

        await tx.case.update({
            where: { id: caseId },
            data: {
                total_disbursed_amount: totalDisbursedAfter,
                remaining_disbursement_amount: remainingAfter,
                first_disbursement_date: existingCase.first_disbursement_date || new Date(disbursement_date),
                last_disbursement_date: new Date(disbursement_date),
                is_locked: true // Lock on first disbursement
            }
        });

        // 7. Transition Stage
        await caseService.updateStage(caseId, tenantId, newStage, userId, tx);

        // 8. Activity Log
        await tx.activityLog.create({
            data: {
                case_id: caseId,
                customer_id: existingCase.customer_id,
                activity_type: 'DISBURSEMENT_RECORDED',
                description: `Tranche #${trancheNumber} of ${disbursementAmount} recorded. Total disbursed: ${totalDisbursedAfter}. Remaining: ${remainingAfter}.`,
                performed_by_user_id: userId
            }
        });

        // TODO: emit DISBURSEMENT_CREATED for commission engine later
        console.log(`[HOOK] DISBURSEMENT_CREATED event placeholder for case ${caseId}`);

        return disbursement;
    });
}

/**
 * Fetch all disbursement related data for a case.
 */
async function getCaseDisbursementSummary(caseId, tenantId) {
    const summary = await prisma.case.findFirst({
        where: { id: caseId, tenant_id: tenantId },
        include: {
            sanction: true,
            disbursements: {
                orderBy: { tranche_number: 'asc' },
                include: { pdd_tasks: true }
            },
            pdd_tasks: {
                where: { disbursement_id: null }, // Fetch manual ones too
                orderBy: { created_at: 'desc' }
            }
        }
    });

    if (!summary) throw new Error('Case not found or unauthorized.');

    return {
        sanction: summary.sanction,
        disbursements: summary.disbursements,
        manual_pdd_tasks: summary.pdd_tasks,
        summary: {
            sanctioned_amount: summary.sanctioned_amount,
            total_disbursed_amount: summary.total_disbursed_amount,
            remaining_disbursement_amount: summary.remaining_disbursement_amount,
            first_disbursement_date: summary.first_disbursement_date,
            last_disbursement_date: summary.last_disbursement_date,
            stage: summary.stage,
            is_locked: summary.is_locked
        }
    };
}

/**
 * List all cases in PARTLY_DISBURSED stage for a tenant.
 */
async function listPartialDisbursements(tenantId) {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const cases = await prisma.case.findMany({
        where: { 
            tenant_id: tenantId,
            stage: { in: ['APPROVED', 'PARTLY_DISBURSED'] }
        },
        include: {
            sanction: true,
            disbursements: {
                orderBy: { tranche_number: 'desc' },
                take: 1
            }
        },
        orderBy: { last_disbursement_date: 'desc' }
    });

    // Calculate Summary Stats
    const totalPendingVolume = cases.reduce((acc, c) => acc.plus(new Decimal(c.remaining_disbursement_amount || 0)), new Decimal(0));
    
    // Count cases due this month (based on next_disbursement_due_date of last tranche)
    const dueThisMonthCases = cases.filter(c => {
        const lastD = c.disbursements[0];
        if (!lastD?.next_disbursement_due_date) return false;
        const due = new Date(lastD.next_disbursement_due_date);
        return due >= firstDayOfMonth && due <= lastDayOfMonth;
    });

    // Volume disbursed this month (from all tranches recorded this month)
    const monthlyDisbursements = await prisma.disbursement.findMany({
        where: {
            tenant_id: tenantId,
            disbursement_date: {
                gte: firstDayOfMonth,
                lte: lastDayOfMonth
            }
        }
    });
    const volumeDisbursedThisMonth = monthlyDisbursements.reduce((acc, d) => acc.plus(new Decimal(d.amount)), new Decimal(0));

    return {
        cases: cases.map(c => ({
            id: c.id,
            customer_name: c.customer_name || 'N/A',
            lender_name: c.lender_name || 'N/A',
            product_type: c.product_type || 'N/A',
            sanctioned_amount: c.sanctioned_amount,
            total_disbursed_amount: c.total_disbursed_amount,
            remaining_disbursement_amount: c.remaining_disbursement_amount,
            next_disbursement_due_date: c.disbursements[0]?.next_disbursement_due_date || null,
            last_disbursement_date: c.last_disbursement_date
        })),
        stats: {
            totalPendingVolume: totalPendingVolume.toNumber(),
            pendingCount: cases.length,
            dueThisMonthCount: dueThisMonthCases.length,
            dueThisMonthVolume: dueThisMonthCases.reduce((acc, c) => acc.plus(new Decimal(c.remaining_disbursement_amount || 0)), new Decimal(0)).toNumber(),
            volumeDisbursedThisMonth: volumeDisbursedThisMonth.toNumber(),
            tranchesThisMonth: monthlyDisbursements.length
        }
    };
}

module.exports = {
    recordDisbursement,
    getCaseDisbursementSummary,
    listPartialDisbursements
};
