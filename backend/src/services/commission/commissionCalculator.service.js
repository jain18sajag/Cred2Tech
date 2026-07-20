const { Decimal } = require('@prisma/client');

/**
 * Calculates the baseline commission for a given disbursement against an active rule.
 * 
 * @param {Object} disbursement - The actual disbursement object (with amount, tranche_number, etc.)
 * @param {Object} sanction - The case sanction object
 * @param {Object} rule - The active LenderCommissionRule (must include volume_slabs)
 * @param {Object} existingLedgers - Array of existing ledgers for this case
 * @returns {Object} - The exact data ready to be inserted into CommissionLedger
 */
function calculateCommission(disbursement, sanction, rule, existingLedgers = []) {
    let baseAmount = new Decimal(disbursement.amount);
    
    if (rule.payout_basis === 'GROSS_SANCTIONED') {
        const alreadyPaid = existingLedgers.some(l => l.payout_basis === 'GROSS_SANCTIONED');
        if (alreadyPaid) {
            return null; // Do not generate duplicate commission for subsequent disbursements
        }
        baseAmount = new Decimal(sanction.sanction_amount);
    }
    
    // 1. Identify the base rate.
    // For Phase 1, since volume is evaluated over a month and we are just generating the baseline ledger,
    // we take the first volume slab (the lowest tier) as the baseline rate. 
    // Month-end true-ups will be handled by VOLUME_ADJUSTMENT entries later.
    
    let baseRate = new Decimal(0);
    
    // Fallback to 0 if no slabs configured
    if (rule.volume_slabs && rule.volume_slabs.length > 0) {
        // Find the lowest rate slab, typically the first one
        // Sort ascending by from_amount
        const sortedSlabs = [...rule.volume_slabs].sort((a, b) => a.from_amount - b.from_amount);
        baseRate = new Decimal(sortedSlabs[0].percent_rate);
    }
    
    // 2. Calculate the commission
    // Formula: (baseAmount * baseRate) / 100
    let calculatedCommission = baseAmount.mul(baseRate).div(100);
    let cappedAmount = null;
    
    // Check for upper cap (max_cap_amount)
    if (rule.tenant_lender?.max_cap_amount && calculatedCommission.toNumber() > rule.tenant_lender.max_cap_amount) {
        cappedAmount = calculatedCommission.toNumber();
        calculatedCommission = new Decimal(rule.tenant_lender.max_cap_amount);
    }
    
    // 3. Create Snapshots
    // We freeze the exact rule configuration that existed at this precise moment
    const slabSnapshot = {
        rule_id: rule.id,
        tenant_lender_id: rule.tenant_lender_id,
        product_type: rule.product_type,
        payout_basis: rule.payout_basis,
        commission_type: rule.commission_type,
        volume_slabs: rule.volume_slabs,
        case_count_slabs: rule.case_count_slabs,
        special_schemes: rule.special_schemes,
        snapshotted_at: new Date().toISOString()
    };
    
    const calculationSnapshot = {
        logic: "BASELINE_VOLUME_SLAB",
        base_amount: baseAmount.toNumber(),
        applied_rate: baseRate.toNumber(),
        calculated_amount: calculatedCommission.toNumber(),
        capped_at: cappedAmount !== null ? rule.tenant_lender.max_cap_amount : null,
        slab_used: rule.volume_slabs && rule.volume_slabs.length > 0 ? rule.volume_slabs[0] : null
    };

    return {
        disbursed_amount: baseAmount, // Store the amount used for calculation
        calculated_commission: calculatedCommission,
        slab_snapshot: slabSnapshot,
        calculation_snapshot: calculationSnapshot
    };
}

module.exports = {
    calculateCommission
};
