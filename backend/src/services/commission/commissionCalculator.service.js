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
function calculateCommission(disbursement, sanction, rule, existingLedgers = [], mtdVolume = 0) {
    let baseAmount = new Decimal(disbursement.amount);
    
    if (rule.payout_basis === 'GROSS_SANCTIONED') {
        const alreadyPaid = existingLedgers.some(l => l.payout_basis === 'GROSS_SANCTIONED');
        if (alreadyPaid) {
            return null; // Do not generate duplicate commission for subsequent disbursements
        }
        baseAmount = new Decimal(sanction.sanction_amount);
    }
    
    let baseRate = new Decimal(0);
    let matchedSlab = null;
    
    if (rule.volume_slabs && rule.volume_slabs.length > 0) {
        const totalVolume = mtdVolume + baseAmount.toNumber();
        
        // Sort ascending by from_amount to check lowest to highest
        const sortedSlabs = [...rule.volume_slabs].sort((a, b) => a.from_amount - b.from_amount);
        
        // Find the highest slab that applies to the total volume
        for (const slab of sortedSlabs) {
            if (totalVolume >= slab.from_amount && (slab.to_amount === null || totalVolume <= slab.to_amount)) {
                matchedSlab = slab;
                baseRate = new Decimal(slab.percent_rate);
                break;
            } else if (totalVolume > (slab.to_amount || 0)) {
                // Keep evaluating higher slabs
                matchedSlab = slab;
                baseRate = new Decimal(slab.percent_rate);
            }
        }
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
        slab_snapshot: matchedSlab,
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
