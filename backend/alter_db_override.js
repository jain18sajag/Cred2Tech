const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "manual_eligible_loan_amount" DOUBLE PRECISION;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "manual_proposed_emi" DOUBLE PRECISION;`);
        console.log('ALTER TABLE manual overrides executed successfully.');
    } catch (e) {
        console.error('Error executing queries:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
