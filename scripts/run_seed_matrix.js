const seedDataMatrix = require('../src/utils/seed_matrix');
const seedLendersIfMissing = require('../src/utils/seed_lenders');

async function main() {
    console.log("Verifying lender, product, and scheme configuration...");
    await seedLendersIfMissing({
        lenderCodes: ['INDIA_SHELTERS', 'PIRAMAL', 'TATA_HOUSING']
    });
    console.log("Starting seedDataMatrix runner...");
    await seedDataMatrix();
    console.log("seedDataMatrix runner complete.");
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
