const prisma = require('../../../config/db');
const { calculateCommission } = require('./commissionCalculator.service');
// const subDsaPayoutService = require('../subDsaPayout.service');

/**
 * Triggered synchronously when a disbursement is successfully recorded.
 * Finds the applicable rule and writes the BASE_COMMISSION ledger entry.
 */
async function processDisbursementCommission(tenantId, caseId, disbursement, sanction, userId, tx) {
    if (!sanction.tenant_lender_id) {
        console.warn(`[COMMISSION] Sanction (Case ${caseId}) is missing tenant_lender_id. Skipping automatic ledger generation.`);
        return null;
    }

    // 1. Look up the active commission rule for this lender & product
    const rule = await tx.lenderCommissionRule.findFirst({
        where: {
            tenant_id: tenantId,
            tenant_lender_id: sanction.tenant_lender_id,
            product_type: sanction.product_type,
            is_active: true
        },
        include: {
            volume_slabs: { orderBy: { from_amount: 'asc' } },
            case_count_slabs: { orderBy: { from_cases: 'asc' } },
            special_schemes: { orderBy: { valid_from: 'asc' } }
        }
    });

    if (!rule) {
        console.warn(`[COMMISSION] No active commission rule found for tenant ${tenantId}, lender ${sanction.tenant_lender_id}, product ${sanction.product_type}. Skipping automatic ledger generation.`);
        return null;
    }

    // 2. Calculate Commission and create Snapshots
    const calculationResult = calculateCommission(disbursement, sanction, rule);

    // 3. Insert Commission Ledger Entry (Append-only BASE_COMMISSION)
    const ledgerEntry = await tx.commissionLedger.create({
        data: {
            tenant_id: tenantId,
            case_id: caseId,
            disbursement_id: disbursement.id,
            tenant_lender_id: sanction.tenant_lender_id,
            lender_name: sanction.lender_name,
            product_type: sanction.product_type,

            entry_type: 'BASE_COMMISSION',
            payout_basis: rule.payout_basis,
            commission_type: rule.commission_type,

            disbursed_amount: calculationResult.disbursed_amount,
            calculated_commission: calculationResult.calculated_commission,

            slab_snapshot: calculationResult.slab_snapshot,
            calculation_snapshot: calculationResult.calculation_snapshot,

            status: 'PENDING',
            created_by_user_id: userId
        }
    });

    console.log(`[COMMISSION] BASE_COMMISSION created for disbursement ${disbursement.id} (Case ${caseId}) - Amount: ${calculationResult.calculated_commission.toNumber()}`);

    // 4. Trigger SubDSA payout atomically when the partner's rule is configured for disbursement-time payout.
    const subDsaPayoutService = require('../subDsaPayout.service');
    const caseRecord = await tx.case.findUnique({
        where: { id: caseId },
        include: { created_by: { include: { role: true } } }
    });

    if (caseRecord && caseRecord.created_by && caseRecord.created_by.role?.name === 'SUB_DSA') {
        const payoutRule = await tx.subDsaPayoutRule.findUnique({
            where: { sub_dsa_user_id: caseRecord.created_by.id },
            select: { payout_trigger: true }
        });

        if (payoutRule?.payout_trigger === 'ON_DISBURSEMENT') {
            await subDsaPayoutService.createPayoutEntry(tenantId, caseRecord.created_by.id, ledgerEntry.id, tx, { mode: 'AUTO' });
            console.log(`[COMMISSION] SubDSA Payout Ledger created for Case ${caseId}`);
        } else {
            console.log(`[COMMISSION] SubDSA payout not created for Case ${caseId}; trigger is ${payoutRule?.payout_trigger || 'not configured'}.`);
        }
    }

    return ledgerEntry;
}

/**
 * Triggered when a disbursement is reverted/cancelled.
 * Creates an append-only REVERSAL entry and marks the original as reversed.
 */
async function revertDisbursementCommission(tenantId, caseId, disbursementId, userId, tx) {
    // 1. Find the original base commission entry
    const originalEntry = await tx.commissionLedger.findFirst({
        where: {
            tenant_id: tenantId,
            case_id: caseId,
            disbursement_id: disbursementId,
            entry_type: 'BASE_COMMISSION'
        }
    });

    if (!originalEntry) {
        console.warn(`[COMMISSION] No original commission entry found for disbursement ${disbursementId}. Nothing to revert.`);
        return null;
    }

    if (originalEntry.is_reversed) {
        console.warn(`[COMMISSION] Original commission entry ${originalEntry.id} is already reversed.`);
        return null;
    }

    // 2. Protect Accounting Integrity
    if (['INVOICED', 'PAID'].includes(originalEntry.status)) {
        throw new Error(`Cannot automatically revert commission entry ${originalEntry.id} because its status is ${originalEntry.status}. Manual credit note required.`);
    }

    // 3. Mark original entry as reversed (keep original status)
    await tx.commissionLedger.updateMany({
        where: {
            id: originalEntry.id,
            tenant_id: tenantId
        },
        data: {
            is_reversed: true,
            reversed_at: new Date(),
            reversed_by: userId
        }
    });

    // 4. Create REVERSAL entry (negative amount)
    const reversalEntry = await tx.commissionLedger.create({
        data: {
            tenant_id: originalEntry.tenant_id,
            case_id: originalEntry.case_id,
            disbursement_id: originalEntry.disbursement_id,
            tenant_lender_id: originalEntry.tenant_lender_id,
            lender_name: originalEntry.lender_name,
            product_type: originalEntry.product_type,

            entry_type: 'REVERSAL',
            reversal_of_id: originalEntry.id,
            payout_basis: originalEntry.payout_basis,
            commission_type: originalEntry.commission_type,

            // Negative amounts to cancel out the base
            disbursed_amount: originalEntry.disbursed_amount.mul(-1),
            calculated_commission: originalEntry.calculated_commission.mul(-1),

            slab_snapshot: originalEntry.slab_snapshot,
            calculation_snapshot: {
                logic: "REVERSAL",
                reverses_ledger_id: originalEntry.id
            },

            status: 'CANCELLED',
            remarks: `Automatic reversal of ledger entry ${originalEntry.id}`,
            created_by_user_id: userId
        }
    });

    console.log(`[COMMISSION] REVERSAL created for ledger entry ${originalEntry.id} (Case ${caseId})`);
    return reversalEntry;
}

/**
 * Retroactively sync missing commissions for disbursements that have no ledger entry.
 */
async function syncMissingLenderCommissions(tenantId, userId) {
    const disbursements = await prisma.disbursement.findMany({
        where: { tenant_id: tenantId },
        include: { sanction: true, case_entity: true }
    });

    const ledgers = await prisma.commissionLedger.findMany({
        where: { tenant_id: tenantId, entry_type: 'BASE_COMMISSION' },
        select: { disbursement_id: true }
    });
    
    const existingDisbursementIds = new Set(ledgers.map(l => l.disbursement_id).filter(id => id));

    let processedCount = 0;
    
    for (const disbursement of disbursements) {
        if (existingDisbursementIds.has(disbursement.id)) continue;
        if (!disbursement.sanction) continue;
        
        try {
            await prisma.$transaction(async (tx) => {
                const entry = await processDisbursementCommission(tenantId, disbursement.case_id, disbursement, disbursement.sanction, userId, tx);
                if (entry) processedCount++;
            });
        } catch (e) {
            console.error(`[COMMISSION] Failed to sync retroactive commission for disbursement ${disbursement.id}:`, e);
        }
    }

    return processedCount;
}

module.exports = {
    processDisbursementCommission,
    revertDisbursementCommission,
    syncMissingLenderCommissions
};
