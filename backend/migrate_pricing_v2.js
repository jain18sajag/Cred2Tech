// migrate_pricing_v2.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    console.log('[migration] Updating ApiPricing table and creating VolumeDiscount table...');

    try {
        // Add columns to api_pricing
        await prisma.$executeRawUnsafe(`ALTER TABLE api_pricing ADD COLUMN IF NOT EXISTS description TEXT`);
        await prisma.$executeRawUnsafe(`ALTER TABLE api_pricing ADD COLUMN IF NOT EXISTS vendor_cost DOUBLE PRECISION DEFAULT 0`);
        console.log('[migration] ✅ api_pricing table updated');

        // Create volume_discounts table
        await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS volume_discounts (
        id SERIAL PRIMARY KEY,
        min_topup_amount DOUBLE PRECISION NOT NULL,
        bonus_percentage DOUBLE PRECISION NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
        console.log('[migration] ✅ volume_discounts table ensured');

        // Seed some initial data if empty
        const pricingCount = await prisma.apiPricing.count();
        if (pricingCount > 0) {
            // Update existing records with descriptions from prototype using RAW SQL since client is not regenerated
            await prisma.$executeRawUnsafe(`
            UPDATE api_pricing 
            SET api_name = 'GST Verification', 
                description = 'GST registration + filing status check', 
                vendor_cost = 6.5 
            WHERE api_code = 'GST_FETCH'
        `);
            await prisma.$executeRawUnsafe(`
            UPDATE api_pricing 
            SET api_name = 'ITR Analysis', 
                description = 'Income tax return pull + parsing', 
                vendor_cost = 8.0 
            WHERE api_code = 'ITR_FETCH'
        `);
            await prisma.$executeRawUnsafe(`
            UPDATE api_pricing 
            SET api_name = 'Banking Analysis', 
                description = 'Bank statement fetch + ML scoring', 
                vendor_cost = 18.0 
            WHERE api_code = 'BANK_FETCH'
        `);
            await prisma.$executeRawUnsafe(`
            UPDATE api_pricing 
            SET api_name = 'Bureau / Credit', 
                description = 'CIBIL / Experian credit report pull', 
                vendor_cost = 22.0 
            WHERE api_code = 'BUREAU_PULL'
        `);
            console.log('[migration] ✅ api_pricing records updated');
        }

        const discountCheck = await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM volume_discounts`);
        const discountCount = parseInt(discountCheck[0].count, 10);
        if (discountCount === 0) {
            await prisma.$executeRawUnsafe(`
            INSERT INTO volume_discounts (min_topup_amount, bonus_percentage)
            VALUES 
                (5000, 10),
                (15000, 15),
                (30000, 20)
        `);
            console.log('[migration] ✅ volume_discounts seeded');
        }

    } catch (err) {
        console.error('[migration] FAILED:', err.message);
    }

    console.log('[migration] Done.');
    await prisma.$disconnect();
}

run();
