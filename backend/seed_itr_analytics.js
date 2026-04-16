const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.apiPricing.upsert({
        where: { api_code: 'ITR_ANALYTICS' },
        update: { api_name: 'ITR Analytics V3', is_active: true },
        create: {
            api_code: 'ITR_ANALYTICS',
            api_name: 'ITR Analytics V3',
            default_credit_cost: 25,
            is_active: true
        }
    });
    console.log('Seeded ITR_ANALYTICS pricing:', result);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
