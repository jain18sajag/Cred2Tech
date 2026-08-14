const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        console.log('Starting manual migration via Prisma...');
        
        await prisma.$executeRawUnsafe('ALTER TABLE "gstr_analytics_requests" ADD COLUMN IF NOT EXISTS "avg_monthly_turnover" DECIMAL(18, 2)');
        console.log('Added avg_monthly_turnover');
        
        await prisma.$executeRawUnsafe('ALTER TABLE "gstr_analytics_requests" ADD COLUMN IF NOT EXISTS "months_filed_12m" INTEGER');
        console.log('Added months_filed_12m');
        
        await prisma.$executeRawUnsafe('ALTER TABLE "gstr_analytics_requests" ADD COLUMN IF NOT EXISTS "nil_return_months" INTEGER');
        console.log('Added nil_return_months');
        
        console.log("Columns added successfully");
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

run();
