/**
 * Builds the realtime snapshot of a case's GST / ITR / Bank data pulls.
 *
 * This is the single payload pushed over the socket, and it is deliberately
 * *complete*: everything the wizard's three step-2 components render (status,
 * document ids, download URLs, provider messages) is in here, so a client that
 * receives it never has to follow up with a REST call. That's what makes
 * "leave the step, come back, and see the true current state instantly" work —
 * the component's first paint comes from the snapshot handed back on join.
 *
 * `phase` / `label` / `progress` are derived, not stored: they translate the
 * raw per-vendor status enums into one vocabulary the UI can animate against.
 * Every one of them is grounded in real record state (status + whether the
 * report files have actually been ingested yet) — nothing is inferred from
 * elapsed time, so the UI never claims progress that hasn't happened.
 */
const prisma = require('../../config/db');

// Ordered weakest → strongest; used to roll per-request phases up into one
// overall phase per pull type.
const PHASE_RANK = {
    NOT_STARTED: 0,
    FAILED: 1,
    QUEUED: 2,
    AWAITING_CUSTOMER: 3,
    PROCESSING: 4,
    GENERATING_REPORT: 5,
    FINALIZING: 6,
    COMPLETED: 7,
};

const TERMINAL_PHASES = new Set(['COMPLETED', 'FAILED', 'NOT_STARTED']);

function isLivePhase(phase) {
    return !TERMINAL_PHASES.has(phase);
}

// --- GST -------------------------------------------------------------------

function describeGst(req) {
    const hasDocs = !!(req.gst_pdf_document_id || req.gst_excel_document_id || req.gst_json_document_id
        || req.report_pdf_url || req.report_excel_url || req.report_json_url);

    switch (req.status) {
        case 'INITIATED':
            return { phase: 'QUEUED', label: 'Request queued', progress: 8 };
        case 'AUTH_LINK_CREATED':
            return { phase: 'AWAITING_CUSTOMER', label: 'Waiting for the customer to authorise on the GST portal', progress: 12 };
        case 'OTP_PENDING':
            return { phase: 'AWAITING_CUSTOMER', label: 'Waiting for the GST portal OTP', progress: 15 };
        case 'OTP_VERIFIED':
            return { phase: 'PROCESSING', label: 'OTP verified — signing in to the GST portal', progress: 30 };
        case 'PROCESSING':
            return { phase: 'PROCESSING', label: 'Fetching GST returns', progress: 45 };
        case 'CALLBACK_RECEIVED':
            return { phase: 'PROCESSING', label: 'Provider finished — collecting results', progress: 60 };
        case 'DATA_READY':
            return { phase: 'GENERATING_REPORT', label: 'Returns received — generating report', progress: 75 };
        case 'REPORT_READY':
        case 'COMPLETED':
            return hasDocs
                ? { phase: 'COMPLETED', label: 'GST data pulled successfully', progress: 100 }
                : { phase: 'FINALIZING', label: 'Saving your GST report', progress: 92 };
        case 'FAILED':
        case 'EXPIRED':
            return {
                phase: 'FAILED',
                label: req.provider_message?.toLowerCase().includes('cancel')
                    ? 'Request cancelled'
                    : 'GST request failed',
                progress: 100
            };
        default:
            return { phase: 'QUEUED', label: 'Request queued', progress: 8 };
    }
}

function serializeGst(req) {
    const derived = describeGst(req);
    return {
        id: req.id,
        applicant_id: req.applicant_id,
        gstin: req.gstin,
        mode: req.mode,
        auth_type: req.auth_type,
        status: req.status,
        provider_message: req.provider_message,
        auth_link: req.auth_link,
        gst_pdf_document_id: req.gst_pdf_document_id,
        gst_excel_document_id: req.gst_excel_document_id,
        gst_json_document_id: req.gst_json_document_id,
        report_pdf_url: req.report_pdf_url,
        report_excel_url: req.report_excel_url,
        report_json_url: req.report_json_url,
        created_at: req.created_at,
        updated_at: req.updated_at,
        ...derived,
    };
}

// --- ITR -------------------------------------------------------------------

function describeItr(req) {
    switch (req.status) {
        case 'INITIATED':
            return { phase: 'QUEUED', label: 'Request queued', progress: 10 };
        case 'PROCESSING':
            return { phase: 'PROCESSING', label: 'Fetching ITR filings from the income-tax portal', progress: 50 };
        case 'COMPLETED':
            // COMPLETED is terminal — always. This used to report FINALIZING
            // ("Saving your ITR report") whenever no file was present, which
            // could never resolve: syncItrRequest persists `excel_url`
            // unconditionally, so a missing one means the provider returned no
            // file at all, and the realtime supervisor only re-syncs ITR while
            // the status is PROCESSING. The result was a permanent fake
            // in-progress state that also kept the per-case tick running at its
            // fast interval forever. Say what is actually true instead, and let
            // the UI offer a manual re-fetch for the recoverable case (the
            // background worker can mark a job COMPLETED before analytics were
            // ever pulled).
            return (req.itr_document_id || req.excel_url)
                ? { phase: 'COMPLETED', label: 'ITR analytics ready', progress: 100 }
                : { phase: 'COMPLETED', label: 'ITR analytics complete — no report file returned', progress: 100 };
        case 'FAILED':
            return {
                phase: 'FAILED',
                label: req.provider_message?.toLowerCase().includes('cancel')
                    ? 'Request cancelled'
                    : 'ITR analytics failed',
                progress: 100
            };
        default:
            return { phase: 'QUEUED', label: 'Request queued', progress: 10 };
    }
}

function serializeItr(req) {
    const derived = describeItr(req);
    return {
        id: req.id,
        applicant_id: req.applicant_id,
        pan: req.pan,
        reference_id: req.reference_id,
        auth_mode: req.auth_mode,
        status: req.status,
        provider_message: req.provider_message,
        itr_document_id: req.itr_document_id,
        excel_url: req.excel_url,
        created_at: req.created_at,
        updated_at: req.updated_at,
        ...derived,
    };
}

// --- BANK ------------------------------------------------------------------

function describeBank(req) {
    const hasDocs = !!(req.bank_excel_document_id || req.bank_json_document_id
        || req.report_excel_url || req.report_json_url);

    switch (req.status) {
        case 'INITIATED':
            return { phase: 'NOT_STARTED', label: 'No statement uploaded yet', progress: 0 };
        case 'PRE_ANALYZING':
            return { phase: 'PROCESSING', label: 'Validating the uploaded statement', progress: 25 };
        case 'ANALYZING':
            return { phase: 'PROCESSING', label: 'Analysing transactions', progress: 55 };
        case 'COMPLETED':
            return hasDocs
                ? { phase: 'COMPLETED', label: 'Bank statement analysed', progress: 100 }
                // The vendor keeps returning "in progress" on the download
                // endpoint for a while after analysis itself finishes.
                : { phase: 'GENERATING_REPORT', label: 'Generating your report files', progress: 85 };
        case 'FAILED':
            return {
                phase: 'FAILED',
                label: req.provider_message?.toLowerCase().includes('cancel')
                    ? 'Request cancelled'
                    : 'Bank statement analysis failed',
                progress: 100
            };
        default:
            return { phase: 'NOT_STARTED', label: 'No statement uploaded yet', progress: 0 };
    }
}

function serializeBank(req) {
    const derived = describeBank(req);
    return {
        id: req.id,
        applicant_id: req.applicant_id,
        report_id: req.report_id,
        status: req.status,
        provider_message: req.provider_message,
        bank_excel_document_id: req.bank_excel_document_id,
        bank_json_document_id: req.bank_json_document_id,
        report_excel_url: req.report_excel_url,
        report_json_url: req.report_json_url,
        created_at: req.created_at,
        updated_at: req.updated_at,
        ...derived,
    };
}

// --- roll-up ---------------------------------------------------------------

function rollUp(items, emptyLabel) {
    if (items.length === 0) {
        return { phase: 'NOT_STARTED', label: emptyLabel, progress: 0, live: false, total: 0, completed: 0 };
    }
    // The "worst" still-live phase wins so the header reflects outstanding work;
    // if nothing is live, the strongest terminal phase wins.
    const live = items.filter(i => isLivePhase(i.phase));
    const winner = live.length > 0
        ? live.reduce((a, b) => (PHASE_RANK[a.phase] <= PHASE_RANK[b.phase] ? a : b))
        : items.reduce((a, b) => (PHASE_RANK[a.phase] >= PHASE_RANK[b.phase] ? a : b));

    return {
        phase: winner.phase,
        label: winner.label,
        progress: winner.progress,
        live: live.length > 0,
        total: items.length,
        completed: items.filter(i => i.phase === 'COMPLETED').length,
    };
}

// Only the columns the snapshot actually serializes — the raw_* JSON blobs on
// these tables are large enough that selecting them on every tick would be the
// dominant cost of the whole realtime layer.
const GST_SELECT = {
    id: true, applicant_id: true, gstin: true, mode: true, auth_type: true, status: true,
    provider_message: true, auth_link: true, gst_pdf_document_id: true, gst_excel_document_id: true,
    gst_json_document_id: true, report_pdf_url: true, report_excel_url: true, report_json_url: true,
    created_at: true, updated_at: true,
};

const ITR_SELECT = {
    id: true, applicant_id: true, pan: true, reference_id: true, auth_mode: true, status: true,
    provider_message: true, itr_document_id: true, excel_url: true, created_at: true, updated_at: true,
};

const BANK_SELECT = {
    id: true, applicant_id: true, report_id: true, status: true, provider_message: true,
    bank_excel_document_id: true, bank_json_document_id: true, report_excel_url: true,
    report_json_url: true, created_at: true, updated_at: true,
};

/**
 * @param {number} caseId
 * @returns {Promise<object>} the full realtime snapshot for the case
 */
async function buildCasePullSnapshot(caseId) {
    const caseIdInt = parseInt(caseId, 10);

    const [gstRows, itrRows, bankRows] = await Promise.all([
        prisma.gstrAnalyticsRequest.findMany({
            where: { case_id: caseIdInt },
            orderBy: { created_at: 'desc' },
            select: GST_SELECT,
        }),
        prisma.itrAnalyticsRequest.findMany({
            where: { case_id: caseIdInt },
            orderBy: { created_at: 'desc' },
            select: ITR_SELECT,
        }),
        prisma.bankStatementAnalysisRequest.findMany({
            where: { case_id: caseIdInt },
            orderBy: { created_at: 'desc' },
            select: BANK_SELECT,
        }),
    ]);

    const gst = gstRows.map(serializeGst);
    const itr = itrRows.map(serializeItr);
    const bank = bankRows.map(serializeBank);

    return {
        caseId: caseIdInt,
        generatedAt: new Date().toISOString(),
        gst: { requests: gst, overall: rollUp(gst, 'GST pull not started') },
        itr: { requests: itr, overall: rollUp(itr, 'ITR pull not started') },
        bank: { requests: bank, overall: rollUp(bank, 'No statement uploaded yet') },
    };
}

/**
 * True when anything in the snapshot is still moving — drives how aggressively
 * the realtime layer ticks, and whether it bothers calling the vendor at all.
 */
function snapshotHasLiveWork(snapshot) {
    return ['gst', 'itr', 'bank'].some(k => snapshot[k].overall.live);
}

/**
 * Stable fingerprint of everything a client would render, so the socket layer
 * can skip broadcasting when a tick produced no user-visible change.
 * `generatedAt` is deliberately excluded — it changes every tick by design.
 */
function snapshotFingerprint(snapshot) {
    const part = (items) => items.map(i =>
        [i.id, i.status, i.phase, i.progress, i.label, i.provider_message,
        i.gst_pdf_document_id, i.gst_excel_document_id, i.gst_json_document_id,
        i.itr_document_id, i.bank_excel_document_id, i.bank_json_document_id,
        i.report_pdf_url, i.report_excel_url, i.report_json_url, i.excel_url, i.auth_link
        ].join('|')
    ).join(';');

    return [part(snapshot.gst.requests), part(snapshot.itr.requests), part(snapshot.bank.requests)].join('#');
}

module.exports = {
    buildCasePullSnapshot,
    snapshotHasLiveWork,
    snapshotFingerprint,
    isLivePhase,
    // Pure status→phase mappers, exported so they can be exercised without a DB.
    describeGst,
    describeItr,
    describeBank,
};
