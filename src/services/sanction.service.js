const prisma = require('../../config/db');
const caseService = require('./case.service');
const { Decimal } = require('@prisma/client');

/**
 * Sanction a case or update existing sanction details.
 * Sanction details are immutable once the first disbursement is recorded.
 */
async function sanctionCase(caseId, tenantId, payload, userId) {
    const {
        loan_account_number,
        sanction_date,
        sanctioned_amount,
        confirmed_roi,
        processing_fee,
        remarks,
        tenant_lender_id,
        lender_name,
        product_type
    } = payload;

    return await prisma.$transaction(async (tx) => {
        // 1. Validate Case and Ownership
        const existingCase = await tx.case.findFirst({
            where: { id: caseId, tenant_id: tenantId },
            include: { 
                sanction: true,
                disbursements: { where: { status: 'RECORDED' }, take: 1 }
            }
        });

        if (!existingCase) {
            throw new Error('Case not found or unauthorized.');
        }

        const hasDisbursements = existingCase.disbursements.length > 0;

        // 2. Validate Stage Transition
        const allowedStages = ['ESR_GENERATED', 'APPROVED'];
        if (!allowedStages.includes(existingCase.stage)) {
            throw new Error(`Sanctioning is not allowed from current stage: ${existingCase.stage}`);
        }

        // 3. Immutability Check: Block critical changes if disbursements exist
        if (hasDisbursements) {
            const s = existingCase.sanction;
            if (
                new Decimal(sanctioned_amount).toNumber() !== new Decimal(s.sanctioned_amount).toNumber() ||
                new Decimal(confirmed_roi).toNumber() !== new Decimal(s.confirmed_roi).toNumber() ||
                loan_account_number !== s.loan_account_number ||
                lender_name !== s.lender_name
            ) {
                throw new Error('Sanction terms cannot be modified after disbursement has started.');
            }
        }

        // 4. Create or Update CaseSanction
        const sanctionData = {
            tenant_id: tenantId,
            case_id: caseId,
            loan_account_number: loan_account_number || null,
            sanction_date: new Date(sanction_date),
            sanctioned_amount: new Decimal(sanctioned_amount),
            confirmed_roi: new Decimal(confirmed_roi),
            processing_fee: new Decimal(processing_fee),
            remarks,
            tenant_lender_id: tenant_lender_id ? parseInt(tenant_lender_id, 10) : null,
            lender_name,
            product_type,
            created_by_user_id: userId
        };

        const sanction = await tx.caseSanction.upsert({
            where: { case_id: caseId },
            create: sanctionData,
            update: sanctionData
        });

        // 5. Update Case Summary
        // If no disbursements, remaining = sanctioned
        // If disbursements exist, remaining should stay as is (already handled by disbursement service)
        const totalDisbursed = existingCase.total_disbursed_amount || new Decimal(0);
        const remaining = new Decimal(sanctioned_amount).minus(totalDisbursed);

        await tx.case.update({
            where: { id: caseId },
            data: {
                sanctioned_amount: new Decimal(sanctioned_amount),
                remaining_disbursement_amount: remaining,
                lender_name: lender_name,
                product_type: product_type
            }
        });

        // 6. Transition Stage to APPROVED
        await caseService.updateStage(caseId, tenantId, 'APPROVED', userId, tx);

        // 7. Activity Log
        await tx.activityLog.create({
            data: {
                case_id: caseId,
                customer_id: existingCase.customer_id,
                activity_type: 'CASE_SANCTIONED',
                description: `Case sanctioned for ${sanctioned_amount} by ${lender_name}. LAN: ${loan_account_number}`,
                performed_by_user_id: userId
            }
        });

        return sanction;
    });
}

module.exports = {
    sanctionCase
};
