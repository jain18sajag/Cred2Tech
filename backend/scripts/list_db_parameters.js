const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("=== FETCHING DATABASE PARAMETER MASTER ===");
    const params = await prisma.parameterMaster.findMany({
        orderBy: { display_order: 'asc' }
    });
    console.log(`Total parameters in database: ${params.length}`);
    params.forEach(p => {
        console.log(`- key: '${p.parameter_key}', label: '${p.parameter_label}', category: '${p.category}', data_type: '${p.data_type}'`);
    });
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
