/**
 * esr.service.js
 *
 * PURPOSE:
 *   Orchestrate the ESR generation pipeline:
 *     1. Validate case ownership
 *     2. Ensure CaseEsrFinancials snapshot is FRESH (re-extract if stale/missing/failed)
 *     3. Delegate to generateDynamicESR() which handles its own concurrency
 *        via a case-row level lock inside a single DB transaction
 *
 * CONCURRENCY DESIGN:
 *   Session-level advisory locks (pg_try_advisory_lock) are NOT safe with
 *   Prisma connection pooling — the lock and unlock may land on different
 *   DB connections, leaving the lock permanently stuck.
 *
 *   Instead, concurrency is handled in TWO layers:
 *     Layer 1 (Application): This orchestrator always awaits extraction before
 *                            calling the evaluation engine.
 *     Layer 2 (Database):    generateDynamicESR() uses SELECT ... FOR UPDATE
 *                            on the Case row inside its $transaction, which
 *                            PostgreSQL serializes correctly within a single connection.
 */

'use strict';

const prisma = require('../../config/db');
const { extractEsrFinancials } = require('./esrFinancials.service');
const { generateDynamicESR } = require('./esr/dynamicEligibility.service');

// Snapshot freshness threshold — re-extract if older than this many minutes
const SNAPSHOT_STALE_MINUTES = 30;

/**
 * generateESR — full orchestrated pipeline.
 *
 * @param {number} case_id
 * @param {number} user_id
 * @param {number} tenant_id
 * @returns {Promise<object>} ESR result
 */
async function generateESR(case_id, user_id, tenant_id) {
    // ── Step 1: Validate case exists and belongs to tenant ──────────────────
    const caseRecord = await prisma.case.findFirst({
        where: { id: case_id, tenant_id },
        select: { id: true, product_type: true }
    });
    if (!caseRecord) {
        throw new Error('Case not found or unauthorized.');
    }

    // ── Step 2: Snapshot freshness check ────────────────────────────────────
    // This runs BEFORE attempting ESR generation. If the snapshot is missing,
    // failed, or stale, we synchronously re-extract and verify success before
    // calling the evaluation engine.
    const snapshot = await prisma.caseEsrFinancials.findUnique({
        where: { case_id },
        select: { extraction_status: true, extracted_at: true, selected_income_method: true }
    });

    if (snapshot?.selected_income_method === 'LEGACY_UPLOAD') {
        console.log(`[ESR] Case ${case_id} is a LEGACY_UPLOAD. Bypassing extraction refresh.`);
    } else if (_snapshotNeedsRefresh(snapshot)) {
        console.log(`[ESR] Snapshot for Case ${case_id} is ${snapshot ? snapshot.extraction_status + '/stale' : 'missing'} — re-extracting synchronously...`);
        await extractEsrFinancials(case_id, tenant_id);

        // Verify extraction succeeded before proceeding
        const freshSnapshot = await prisma.caseEsrFinancials.findUnique({
            where: { case_id },
            select: { extraction_status: true, selected_monthly_income: true, selected_income_method: true }
        });

        if (!freshSnapshot || freshSnapshot.extraction_status !== 'COMPLETED') {
            throw new Error(
                'Financial data extraction failed or incomplete. ' +
                'Please ensure vendor pulls (GST / ITR / Bank / Bureau / Salary) are completed before generating ESR.'
            );
        }

        if (!freshSnapshot.selected_monthly_income || freshSnapshot.selected_monthly_income <= 0) {
            throw new Error(
                'No income data found for this case. ' +
                'Please complete salary OCR, GST, ITR, or Bank analysis before generating ESR.'
            );
        }
    }

    // ── Step 3: ESR evaluation ───────────────────────────────────────────────
    // generateDynamicESR() handles its own concurrency internally using
    // a case-row level lock (SELECT FOR UPDATE) inside its DB transaction.
    return await generateDynamicESR(case_id, user_id, tenant_id);
}

/**
 * getESR — fetches the latest ESR for a case.
 * @param {number} case_id
 * @param {number} tenant_id
 * @returns {Promise<object>} EligibilityReport
 */
async function getESR(case_id, tenant_id) {
    const latestESR = await prisma.eligibilityReport.findFirst({
        where:   { case_id, tenant_id, is_latest: true },
        include: { lenders: true },
        orderBy: { version_number: 'desc' }
    });

    if (!latestESR) {
        throw new Error('No ESR generated for this case yet.');
    }

    return latestESR;
}

/**
 * Determine if a snapshot needs to be re-extracted.
 * @param {{ extraction_status: string, extracted_at: Date|null }|null} snapshot
 * @returns {boolean}
 */
function _snapshotNeedsRefresh(snapshot) {
    if (!snapshot)                                  return true;
    if (snapshot.extraction_status !== 'COMPLETED') return true;
    if (!snapshot.extracted_at)                     return true;

    const ageMinutes = (Date.now() - new Date(snapshot.extracted_at).getTime()) / 60000;
    if (ageMinutes > SNAPSHOT_STALE_MINUTES) {
        console.log(`[ESR] Snapshot is ${ageMinutes.toFixed(1)}m old (threshold: ${SNAPSHOT_STALE_MINUTES}m) — will refresh.`);
        return true;
    }

    return false;
}

module.exports = { generateESR, getESR };
