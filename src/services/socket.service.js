/**
 * Realtime data-pull status (GST / ITR / Bank Statement) over Socket.IO.
 *
 * This replaces the browser-side polling the three step-2 components used to
 * do (each POSTing its own /sync endpoint every 15s, per mounted component,
 * per open tab). Two things were wrong with that:
 *
 *   1. Status only moved while somebody was looking at that exact sub-step.
 *      Navigate to the next step and back and you'd see whatever stale value
 *      the last render captured until the next tick.
 *   2. The vendor calls were fanned out per client. Three components open in
 *      two tabs meant six vendor round-trips every 15 seconds for one case.
 *
 * The model here inverts that:
 *
 *   - Clients join a `case:<id>` room and receive a complete snapshot
 *     (`case_pull_snapshot`) immediately on join, then again on every change.
 *     Because the snapshot is complete, a remount needs no REST call and can
 *     never render stale state — which is what makes leaving and re-entering
 *     the step show the true live status with no manual refresh.
 *   - One "supervisor" loop per *case* (not per client) does the vendor
 *     syncing server-side, so N viewers cost the same as one, and it keeps
 *     running while the user is off on another step of the wizard.
 *   - The supervisor only exists while at least one client is in the room, and
 *     backs off to a slow heartbeat once nothing is in flight, so an idle case
 *     costs a couple of indexed selects a minute.
 *   - `pg_notify('case_status_updates')` — already fired by the background
 *     worker and both Signzy webhooks — is consumed here as an *instant* wake
 *     signal, so a webhook landing on any process reaches the browser in
 *     milliseconds rather than waiting for the next tick.
 *
 * Applies identically to the DSA journey and the MSME self-service journey:
 * both drive the same wizard against the same case rooms, and room access is
 * authorised per role below.
 */
const { Server } = require('socket.io');
const { verifyToken } = require('../utils/jwt');
const prisma = require('../../config/db');
const pgPubSub = require('./pgPubSub.service');
const { isCorsOriginAllowed } = require('../utils/corsOrigins');
const {
    buildCasePullSnapshot,
    snapshotHasLiveWork,
    snapshotFingerprint,
} = require('./casePullSnapshot.service');
const pullSync = require('./pullSync.service');

let io = null;

// How often a case's supervisor re-reads the DB and re-broadcasts if anything
// changed. Cheap (three indexed selects on narrow column sets), so it can be
// aggressive while work is in flight and lazy when it isn't.
const DB_TICK_ACTIVE_MS = 2000;
const DB_TICK_IDLE_MS = 20000;

// How often the supervisor is allowed to actually call the vendor for a given
// case. Deliberately much slower than the DB tick — the DB tick is what makes
// the UI feel instant, this is just what advances vendor-side state when no
// webhook arrives. Matched to the 15s cadence the browser used to poll at, so
// moving this server-side does not increase paid vendor load for a case; it
// only stops multiplying it by the number of open components and tabs.
const VENDOR_SYNC_INTERVAL_MS = 15000;

// A vendor endpoint that keeps erroring gets exponentially backed off rather
// than retried every interval forever.
const VENDOR_BACKOFF_BASE_MS = 15000;
const VENDOR_BACKOFF_MAX_MS = 5 * 60 * 1000;

// A request that keeps syncing cleanly but never actually moves (a vendor that
// accepted the job and silently stalled) is throttled to a slow retry, so a
// permanently stuck record can't burn a vendor call every 15s for as long as
// somebody happens to have the page open.
const NO_PROGRESS_LIMIT = 20;                 // ~5 minutes at the interval above
const NO_PROGRESS_RETRY_MS = 2 * 60 * 1000;

/** caseId -> supervisor state */
const supervisors = new Map();

function roomName(caseId) {
    return `case:${caseId}`;
}

function roomSize(caseId) {
    return io?.sockets?.adapter?.rooms?.get(roomName(caseId))?.size || 0;
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

/**
 * Same rule the REST layer uses: an MSME self-service borrower may only see
 * their own case; everyone else is scoped to their tenant. Checked on join —
 * never trust a caseId off the wire.
 */
async function canAccessCase(user, caseId) {
    const where = user.role === 'MSME_CUSTOMER'
        ? { id: caseId, msme_customer_user_id: user.id }
        : { id: caseId, tenant_id: user.tenant_id };
    const caseRecord = await prisma.case.findFirst({ where, select: { id: true } });
    return !!caseRecord;
}

// ---------------------------------------------------------------------------
// Per-case supervisor
// ---------------------------------------------------------------------------

function getSupervisor(caseId) {
    let sup = supervisors.get(caseId);
    if (!sup) {
        sup = {
            caseId,
            timer: null,
            running: false,       // a tick is in flight
            stopped: false,
            fingerprint: null,    // last broadcast state
            snapshot: null,       // last built snapshot (served to late joiners)
            lastVendorSyncAt: 0,
            vendorSyncing: false,
            failures: new Map(),  // `${type}:${id}` -> { count, nextAttemptAt }
        };
        supervisors.set(caseId, sup);
    }
    return sup;
}

function stopSupervisor(caseId) {
    const sup = supervisors.get(caseId);
    if (!sup) return;
    sup.stopped = true;
    if (sup.timer) clearTimeout(sup.timer);
    supervisors.delete(caseId);
}

function scheduleNextTick(sup, delayMs) {
    if (sup.stopped) return;
    if (sup.timer) clearTimeout(sup.timer);
    sup.timer = setTimeout(() => runTick(sup).catch(err => {
        console.error(`[socket] tick failed for case ${sup.caseId}:`, err.message);
        scheduleNextTick(sup, DB_TICK_IDLE_MS);
    }), delayMs);
}

/**
 * One supervisor pass: read → broadcast if changed → maybe advance vendor state.
 */
async function runTick(sup) {
    if (sup.stopped) return;

    // Nobody left watching — shut down rather than poll for an empty room.
    if (roomSize(sup.caseId) === 0) {
        stopSupervisor(sup.caseId);
        return;
    }

    if (sup.running) return;
    sup.running = true;

    let hasLiveWork = false;
    try {
        const snapshot = await buildCasePullSnapshot(sup.caseId);
        const fingerprint = snapshotFingerprint(snapshot);
        hasLiveWork = snapshotHasLiveWork(snapshot);

        sup.snapshot = snapshot;
        if (fingerprint !== sup.fingerprint) {
            sup.fingerprint = fingerprint;
            io.to(roomName(sup.caseId)).emit('case_pull_snapshot', snapshot);
        }

        // Advance vendor-side state, but never inside the broadcast path — a
        // slow vendor must not delay the next DB tick.
        if (hasLiveWork
            && !sup.vendorSyncing
            && Date.now() - sup.lastVendorSyncAt >= VENDOR_SYNC_INTERVAL_MS) {
            sup.lastVendorSyncAt = Date.now();
            sup.vendorSyncing = true;
            runVendorSync(sup, snapshot)
                .catch(err => console.error(`[socket] vendor sync failed for case ${sup.caseId}:`, err.message))
                .finally(() => { sup.vendorSyncing = false; });
        }
    } finally {
        sup.running = false;
    }

    scheduleNextTick(sup, hasLiveWork ? DB_TICK_ACTIVE_MS : DB_TICK_IDLE_MS);
}

function shouldAttempt(sup, key) {
    const entry = sup.failures.get(key);
    return !entry || Date.now() >= entry.nextAttemptAt;
}

function noteFailure(sup, key, err) {
    const entry = sup.failures.get(key) || { count: 0, stalled: 0 };
    entry.count += 1;
    entry.nextAttemptAt = Date.now() + Math.min(VENDOR_BACKOFF_BASE_MS * 2 ** (entry.count - 1), VENDOR_BACKOFF_MAX_MS);
    sup.failures.set(key, entry);
    console.error(`[socket] vendor sync error (${key}, attempt ${entry.count}):`, err.message);
}

/**
 * A sync that completed without error. `changed` distinguishes "the vendor told
 * us something new" from "we asked and nothing had moved" — the latter, repeated
 * enough times, means the job is stalled rather than progressing.
 */
function noteSuccess(sup, key, changed) {
    if (changed) {
        sup.failures.delete(key);
        return;
    }
    const entry = sup.failures.get(key) || { count: 0, stalled: 0 };
    entry.count = 0;
    entry.stalled = (entry.stalled || 0) + 1;
    entry.nextAttemptAt = entry.stalled >= NO_PROGRESS_LIMIT ? Date.now() + NO_PROGRESS_RETRY_MS : 0;
    sup.failures.set(key, entry);
}

/** Run one vendor sync, funnelling both outcomes through the backoff bookkeeping. */
function runOne(sup, key, jobs, fn) {
    if (!shouldAttempt(sup, key)) return;
    jobs.push(
        Promise.resolve()
            .then(fn)
            .then(result => noteSuccess(sup, key, result?.changed !== false))
            .catch(err => noteFailure(sup, key, err))
    );
}

/**
 * Do the vendor round-trips that used to happen from the browser, once per
 * case regardless of how many clients are attached. Each branch mirrors the
 * status guard the corresponding /sync endpoint applies.
 */
async function runVendorSync(sup, snapshot) {
    const jobs = [];

    for (const req of snapshot.gst.requests) {
        // OTP_PENDING / AUTH_LINK_CREATED are waiting on a human, not the vendor.
        const pollable = ['PROCESSING', 'DATA_READY', 'CALLBACK_RECEIVED', 'OTP_VERIFIED'].includes(req.status)
            // REPORT_READY but nothing stored and no vendor URL either: the
            // report exists upstream but we never got it, and only a re-fetch
            // can resolve it.
            || (req.status === 'REPORT_READY' && req.phase === 'FINALIZING');
        if (!pollable) continue;

        runOne(sup, `gst:${req.id}`, jobs, () =>
            prisma.gstrAnalyticsRequest.findUnique({ where: { id: req.id } })
                .then(row => pullSync.syncGstRequest(row)));
    }

    for (const req of snapshot.itr.requests) {
        if (req.status !== 'PROCESSING') continue;
        runOne(sup, `itr:${req.id}`, jobs, () =>
            prisma.itrAnalyticsRequest.findUnique({ where: { id: req.id } })
                .then(row => pullSync.syncItrRequest(row)));
    }

    for (const req of snapshot.bank.requests) {
        if (['ANALYZING', 'PRE_ANALYZING'].includes(req.status)) {
            runOne(sup, `bank:${req.id}`, jobs, () =>
                prisma.bankStatementAnalysisRequest.findUnique({ where: { id: req.id } })
                    .then(row => pullSync.syncBankRequest(row)));
        } else if (req.status === 'COMPLETED' && req.phase === 'GENERATING_REPORT') {
            // Analysis is done but the vendor is still generating the files —
            // this is what the old client-side "AWAITING_LINKS" retry loop did.
            runOne(sup, `bank:${req.id}`, jobs, () =>
                prisma.bankStatementAnalysisRequest.findUnique({ where: { id: req.id } })
                    .then(row => pullSync.fetchBankReportLinks(row)));
        }
    }

    if (jobs.length > 0) await Promise.allSettled(jobs);
}

/** Wake a case's supervisor immediately (webhook landed, user acted, etc). */
function poke(caseId) {
    const sup = supervisors.get(caseId);
    if (!sup || sup.stopped) return;
    scheduleNextTick(sup, 0);
}

/**
 * Called from outside the socket layer (controllers, webhooks) after anything
 * that changes a case's pull state, to push it to whoever is watching without
 * waiting for the next tick.
 *
 * Wakes this process's supervisor directly and announces on the shared
 * `case_status_updates` channel so sibling processes — which hold the sockets
 * for their own clients — wake too. Fire-and-forget: a failed announcement
 * only costs latency, since every supervisor is polling the DB anyway.
 */
function notifyCasePullUpdate(caseId) {
    const id = parseInt(caseId, 10);
    if (!id) return;

    poke(id);

    const payload = JSON.stringify({ case_id: id, source: 'app' });
    prisma.$executeRawUnsafe(`SELECT pg_notify('case_status_updates', $1)`, payload)
        .catch(err => console.error('[socket] pg_notify announce failed:', err.message));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function initSocket(httpServer) {
    io = new Server(httpServer, {
        // Mirror the REST allow-list exactly — the realtime channel exposes the
        // same case data, so it must not be reachable from origins the API
        // itself rejects.
        cors: {
            origin: (origin, callback) => callback(null, isCorsOriginAllowed(origin)),
            credentials: true,
        },
        // Mounted under /api deliberately: that is the only prefix the
        // production nginx proxies through to this process (everything else
        // falls through to the static SPA's try_files), so keeping the socket
        // inside it means no extra location block and no path that can be
        // swallowed by the frontend's index.html fallback.
        path: '/api/socket.io',
        // Drop dead connections reasonably fast so an abandoned tab's room
        // membership (and therefore its case supervisor) is released.
        pingInterval: 20000,
        pingTimeout: 20000,
    });

    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) return next(new Error('No token provided'));
            const decoded = verifyToken(token);
            const userId = decoded.id || decoded.userId;
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: { role: true, tenant: true }
            });
            if (!user || user.status !== 'ACTIVE') return next(new Error('Invalid session'));
            socket.user = {
                id: user.id,
                role: user.role.name,
                tenant_id: user.tenant_id,
            };
            next();
        } catch (err) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        socket.on('join_case', async (payload, ack) => {
            try {
                const caseId = parseInt(payload?.caseId, 10);
                if (!caseId) return ack?.({ ok: false, error: 'caseId is required' });

                const allowed = await canAccessCase(socket.user, caseId);
                if (!allowed) return ack?.({ ok: false, error: 'Access denied' });

                socket.join(roomName(caseId));

                // Hand back the current snapshot in the ack so the component
                // paints correct state on its very first render — this is what
                // removes the "stale until the next poll" window when a user
                // returns to the step.
                const sup = getSupervisor(caseId);
                const snapshot = await buildCasePullSnapshot(caseId);
                sup.snapshot = snapshot;
                sup.fingerprint = snapshotFingerprint(snapshot);

                ack?.({ ok: true, snapshot });

                // Start (or re-arm) the supervisor for this case.
                scheduleNextTick(sup, snapshotHasLiveWork(snapshot) ? DB_TICK_ACTIVE_MS : DB_TICK_IDLE_MS);
            } catch (err) {
                console.error('[socket] join_case failed:', err.message);
                ack?.({ ok: false, error: 'Failed to join case room' });
            }
        });

        // Client just did something that changes state (submitted a pull,
        // cancelled, deleted) — collapse the wait for the next tick.
        socket.on('refresh_case', (payload) => {
            const caseId = parseInt(payload?.caseId, 10);
            if (!caseId) return;
            if (!socket.rooms.has(roomName(caseId))) return; // must already be authorised in the room
            poke(caseId);
        });

        socket.on('leave_case', (payload) => {
            const caseId = parseInt(payload?.caseId, 10);
            if (!caseId) return;
            socket.leave(roomName(caseId));
            if (roomSize(caseId) === 0) stopSupervisor(caseId);
        });

        socket.on('disconnecting', () => {
            for (const room of socket.rooms) {
                if (!room.startsWith('case:')) continue;
                const caseId = parseInt(room.slice('case:'.length), 10);
                // socket.rooms still includes this socket at this point, so a
                // size of 1 means it was the last one in.
                if (caseId && roomSize(caseId) <= 1) stopSupervisor(caseId);
            }
        });
    });

    // The background worker and both Signzy webhooks already announce terminal
    // transitions on this channel. Consuming it turns a webhook arriving on any
    // process into an immediate push, instead of waiting out a tick.
    pgPubSub.connect().then(() => {
        pgPubSub.listen('case_status_updates', (payload) => {
            const caseId = parseInt(payload?.case_id, 10);
            if (caseId) poke(caseId);
        });
    }).catch((err) => {
        console.error('[socket] Failed to attach to pg_notify channel:', err.message);
    });

    console.log('[socket] Socket.IO initialized (realtime data-pull status)');
    return io;
}

function getIo() {
    return io;
}

module.exports = { initSocket, getIo, notifyCasePullUpdate };
