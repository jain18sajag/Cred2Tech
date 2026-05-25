const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "itr_remuneration" DOUBLE PRECISION;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "double_whammy_flag" BOOLEAN NOT NULL DEFAULT false;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "net_worth" DOUBLE PRECISION;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "salaried_incentive_income" DOUBLE PRECISION;`);
        await prisma.$executeRawUnsafe(`ALTER TABLE "case_esr_financials" ADD COLUMN IF NOT EXISTS "salaried_other_income" DOUBLE PRECISION;`);
        console.log('ALTER TABLE queries executed successfully.');
    } catch (e) {
        console.error('Error executing queries:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
