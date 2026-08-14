const { PrismaClient } = require('@prisma/client');
const { encryptionExtension } = require('../src/utils/prismaEncryptionExtension');

// The DB host is remote (not localhost) in every environment this app runs
// in, and neither the database nor the app previously enforced any timeout
// on a stalled connection (statement_timeout=0, idle_in_transaction_session_
// timeout=0 server-side; no connect/pool/socket timeout client-side either).
// A connection that goes stale mid-query (a transient network blip — proven
// to happen against this host) would hang forever with no error, holding
// its locks and a pool slot indefinitely. Under concurrent production
// traffic, enough of those silently exhaust the whole connection pool and
// freeze the app for every user, not just the one whose request stalled.
//
// This is enforced here in code — not via a DATABASE_URL query-string
// convention — so every environment gets it automatically, without needing
// a matching deployment/secrets change. Existing params on the configured
// DATABASE_URL are respected; only params the deployer hasn't already set
// are filled in, so an intentional override in any environment still wins.
const DB_CONNECTION_DEFAULTS = {
    connect_timeout: '10', // seconds to wait when establishing a new connection
    pool_timeout: '15',    // seconds to wait for a free connection from the pool
    socket_timeout: '30',  // seconds to wait for a query response on an open connection — the critical guard against a silently-stalled connection hanging forever
    connection_limit: '15' // bounded pool size (this DB's max_connections is 100 and is shared)
};

function buildSafeDatabaseUrl(rawUrl) {
    if (!rawUrl) return rawUrl;
    let url;
    try {
        url = new URL(rawUrl);
    } catch (err) {
        // Not a parseable URL (shouldn't happen for a real DATABASE_URL) —
        // fall back to whatever was configured rather than fail startup.
        return rawUrl;
    }
    for (const [key, value] of Object.entries(DB_CONNECTION_DEFAULTS)) {
        if (!url.searchParams.has(key)) {
            url.searchParams.set(key, value);
        }
    }
    return url.toString();
}

const prisma = new PrismaClient({
    datasources: {
        db: { url: buildSafeDatabaseUrl(process.env.DATABASE_URL) }
    }
}).$extends(encryptionExtension);

module.exports = prisma;
