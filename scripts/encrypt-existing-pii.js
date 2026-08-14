/**
 * One-off backfill: encrypt PII columns that predate the field-encryption
 * rollout (config/db.js's Prisma extension, src/utils/fieldEncryption.js).
 *
 * Safe to re-run: reading a row through the extended client transparently
 * decrypts already-encrypted values and passes plaintext values through
 * unchanged, so writing that same value back always re-encrypts to an
 * equivalent (or, for random-IV fields, a fresh but equally valid) ciphertext.
 * Nothing is ever double-encrypted or corrupted by running this twice.
 *
 * Usage: node scripts/encrypt-existing-pii.js [--dry-run]
 */
require('dotenv').config();
const prisma = require('../config/db');

const BATCH_SIZE = 200;

const TARGETS = [
    { model: 'applicant', fields: ['pan_number', 'dob', 'pan_verified_dob', 'pan_verification_response'] },
    { model: 'customer', fields: ['dob'] },
    { model: 'customerPanProfile', fields: ['pan', 'raw_response'] },
    { model: 'itrAnalyticsRequest', fields: ['pan', 'analytics_payload'] },
    { model: 'bankStatementAnalysisRequest', fields: ['auth_token', 'raw_analyze_response', 'raw_retrieve_response', 'raw_download_response'] },
];

async function backfillModel(modelName, fields, isDryRun) {
    const client = prisma[modelName];
    let cursor = undefined;
    let scanned = 0;
    let updated = 0;

    for (;;) {
        const rows = await client.findMany({
            take: BATCH_SIZE,
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { id: 'asc' },
            select: Object.fromEntries(['id', ...fields].map((f) => [f, true])),
        });
        if (rows.length === 0) break;

        for (const row of rows) {
            scanned++;
            const data = {};
            for (const field of fields) {
                if (row[field] !== null && row[field] !== undefined) {
                    data[field] = row[field]; // already decrypted-or-passthrough by the extension's read hook
                }
            }
            if (Object.keys(data).length === 0) continue;

            if (isDryRun) {
                updated++;
            } else {
                // The write hook re-encrypts every field present in `data`.
                await client.update({ where: { id: row.id }, data });
                updated++;
            }
        }

        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH_SIZE) break;
    }

    console.log(`[${modelName}] scanned=${scanned} ${isDryRun ? 'would update' : 'updated'}=${updated}`);
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    console.log(`Starting PII encryption backfill... ${isDryRun ? '(DRY RUN)' : ''}`);

    for (const { model, fields } of TARGETS) {
        await backfillModel(model, fields, isDryRun);
    }

    console.log('Backfill complete.');
}

main()
    .catch((err) => {
        console.error('Backfill failed:', err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
