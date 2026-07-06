'use strict';

const prisma = require('../../config/db');
const { extractEsrFinancials } = require('./esrFinancials.service');
const { generateDynamicESR } = require('./esr/dynamicEligibility.service');
const {
    listCalculationLogs,
    getCalculationLog,
    getCalculationLogDownload
} = require('./esr/esrCalculationLog.service');

const SNAPSHOT_STALE_MINUTES = 30;
const inFlightGenerations = new Map();

async function generateESR(case_id, user_id, tenant_id) {
    return _runSingleEsrGeneration('generate', case_id, tenant_id, async () => {
        return _generateESR(case_id, user_id, tenant_id);
    });
}

async function _generateESR(case_id, user_id, tenant_id) {
    const caseRecord = await prisma.case.findFirst({
        where: { id: case_id, tenant_id },
        select: { id: true, product_type: true }
    });
    if (!caseRecord) {
        throw new Error('Case not found or unauthorized.');
    }

    const snapshot = await prisma.caseEsrFinancials.findUnique({
        where: { case_id },
        select: {
            extraction_status: true,
            extracted_at: true,
            selected_income_method: true,
            selected_monthly_income: true,
            bank_avg_balance: true,
            banking_income: true,
            gst_avg_monthly_sales: true,
            gst_income: true,
            itr_pat: true,
            net_profit_income: true,
            salaried_income: true,
            product_type: true
        }
    });

    const sourceFreshness = await _getEsrSourceFreshness(case_id);
    const sourceChanged = _sourceChangedAfterSnapshot(snapshot, sourceFreshness);

    if (_isBulkUploadSnapshot(snapshot) && !sourceChanged) {
        console.log(`[ESR] Case ${case_id} has completed bulk-upload/manual financials and no newer mutable ESR source rows. Bypassing vendor extraction refresh.`);
    } else if (snapshot?.selected_income_method === 'LEGACY_UPLOAD' && !sourceChanged) {
        console.log(`[ESR] Case ${case_id} is a LEGACY_UPLOAD and no newer mutable ESR source rows exist. Bypassing extraction refresh.`);
    } else if (_snapshotNeedsRefresh(snapshot, caseRecord) || sourceChanged) {
        if (sourceChanged) {
            console.log(`[ESR] Source data changed after last snapshot for Case ${case_id} - re-extracting before generation. Latest source updated_at: ${sourceFreshness.latestUpdatedAt?.toISOString?.() || 'N/A'}`);
        }
        console.log(`[ESR] Snapshot for Case ${case_id} is ${snapshot ? snapshot.extraction_status + '/stale' : 'missing'} - re-extracting synchronously...`);
        await extractEsrFinancials(case_id, tenant_id);

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

    return await generateDynamicESR(case_id, user_id, tenant_id);
}

async function getESR(case_id, tenant_id) {
    const latestESR = await prisma.eligibilityReport.findFirst({
        where: { case_id, tenant_id, is_latest: true },
        include: { lenders: true },
        orderBy: { version_number: 'desc' }
    });

    if (!latestESR) {
        throw new Error('No ESR generated for this case yet.');
    }

    return latestESR;
}

async function recalculateESR(case_id, user_id, tenant_id) {
    return _runSingleEsrGeneration('recalculate', case_id, tenant_id, async () => {
        return _recalculateESR(case_id, user_id, tenant_id);
    });
}

async function _recalculateESR(case_id, user_id, tenant_id) {
    const caseRecord = await prisma.case.findFirst({
        where: { id: case_id, tenant_id },
        select: { id: true, product_type: true }
    });
    if (!caseRecord) {
        throw new Error('Case not found or unauthorized.');
    }

    const snapshot = await prisma.caseEsrFinancials.findUnique({
        where: { case_id },
        select: {
            extraction_status: true,
            selected_monthly_income: true,
            selected_income_method: true,
            product_type: true
        }
    });

    const hasUsableSnapshot = snapshot
        && snapshot.extraction_status === 'COMPLETED'
        && Number(snapshot.selected_monthly_income || 0) > 0
        && snapshot.product_type === caseRecord.product_type;

    if (hasUsableSnapshot) {
        console.log(`[ESR] Recalculating Case ${case_id} from existing completed financial snapshot.`);
        return await generateDynamicESR(case_id, user_id, tenant_id);
    }

    return await _generateESR(case_id, user_id, tenant_id);
}

async function listESRLogs(case_id, tenant_id) {
    await _assertCaseAccess(case_id, tenant_id);
    return await listCalculationLogs(case_id, tenant_id);
}

async function getESRLog(case_id, tenant_id, calculationRunId) {
    await _assertCaseAccess(case_id, tenant_id);
    return await getCalculationLog(case_id, tenant_id, calculationRunId);
}

async function downloadESRLog(case_id, tenant_id, calculationRunId, format) {
    await _assertCaseAccess(case_id, tenant_id);
    return await getCalculationLogDownload(case_id, tenant_id, calculationRunId, format);
}

function _runSingleEsrGeneration(action, case_id, tenant_id, fn) {
    const key = `${tenant_id || 'tenant'}:${case_id}`;
    const existing = inFlightGenerations.get(key);
    if (existing) {
        console.log(`[ESR] ${action} request for Case ${case_id} joined existing in-flight ESR generation.`);
        return existing;
    }

    const promise = Promise.resolve()
        .then(fn)
        .finally(() => {
            if (inFlightGenerations.get(key) === promise) {
                inFlightGenerations.delete(key);
            }
        });

    inFlightGenerations.set(key, promise);
    return promise;
}

async function _assertCaseAccess(case_id, tenant_id) {
    const found = await prisma.case.findFirst({
        where: { id: case_id, tenant_id },
        select: { id: true }
    });
    if (!found) {
        throw new Error('Case not found or unauthorized.');
    }
}

function _isBulkUploadSnapshot(snapshot) {
    if (!snapshot) return false;
    if (snapshot.extraction_status !== 'COMPLETED') return false;
    return String(snapshot.selected_income_method || '').toUpperCase() === 'ANY';
}

function _snapshotNeedsRefresh(snapshot, caseRecord) {
    if (!snapshot) return true;
    if (snapshot.extraction_status !== 'COMPLETED') return true;
    if (!snapshot.extracted_at) return true;

    if (caseRecord && snapshot.product_type !== caseRecord.product_type) {
        console.log(`[ESR] Product type changed from ${snapshot.product_type} to ${caseRecord.product_type} - forcing refresh.`);
        return true;
    }

    const ageMinutes = (Date.now() - new Date(snapshot.extracted_at).getTime()) / 60000;
    if (ageMinutes > SNAPSHOT_STALE_MINUTES) {
        console.log(`[ESR] Snapshot is ${ageMinutes.toFixed(1)}m old (threshold: ${SNAPSHOT_STALE_MINUTES}m) - will refresh.`);
        return true;
    }

    return false;
}

async function _getEsrSourceFreshness(case_id) {
    const [property, incomeAgg, obligationAgg] = await Promise.all([
        prisma.casePropertyDetails.findUnique({
            where: { case_id },
            select: { updated_at: true }
        }),
        prisma.caseIncomeEntry.aggregate({
            where: { case_id },
            _max: { updated_at: true }
        }),
        prisma.caseCreditObligation.aggregate({
            where: { case_id },
            _max: { updated_at: true }
        })
    ]);

    const dates = [
        property?.updated_at,
        incomeAgg?._max?.updated_at,
        obligationAgg?._max?.updated_at
    ].filter(Boolean).map(d => new Date(d));

    return {
        propertyUpdatedAt: property?.updated_at || null,
        manualIncomeUpdatedAt: incomeAgg?._max?.updated_at || null,
        bureauObligationUpdatedAt: obligationAgg?._max?.updated_at || null,
        latestUpdatedAt: dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
    };
}

function _sourceChangedAfterSnapshot(snapshot, sourceFreshness) {
    if (!snapshot?.extracted_at || !sourceFreshness?.latestUpdatedAt) return false;
    return new Date(sourceFreshness.latestUpdatedAt).getTime() > new Date(snapshot.extracted_at).getTime();
}

module.exports = {
    generateESR,
    getESR,
    recalculateESR,
    listESRLogs,
    getESRLog,
    downloadESRLog
};
