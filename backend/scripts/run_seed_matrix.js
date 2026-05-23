const seedDataMatrix = require('../src/utils/seed_matrix');

async function main() {
    console.log("Starting seedDataMatrix runner...");
    await seedDataMatrix();
    console.log("seedDataMatrix runner complete.");
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
