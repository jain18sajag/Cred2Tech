/**
 * Shared origin allow-list, used by both the Express CORS middleware (app.js)
 * and the Socket.IO handshake (socket.service.js) so the realtime channel can
 * never be looser than the REST API it mirrors.
 */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowAnyOrigin = allowedOrigins.includes('*');

// Matches ONLY a genuine http(s)://localhost[:port] or http(s)://127.0.0.1[:port]
// origin — not any string that merely contains the substring "localhost"
// (a naive check would wrongly allow e.g. http://localhost.attacker.io).
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowsAnyLocalhostPort = allowedOrigins.some(o => LOCALHOST_ORIGIN_RE.test(o));

function isCorsOriginAllowed(origin) {
  if (!origin) return true;
  if (allowAnyOrigin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Dev convenience: any localhost port is allowed once at least one
  // localhost origin is configured, so new local frontend ports don't need
  // an .env change — but exact-match only, never substring.
  if (allowsAnyLocalhostPort && LOCALHOST_ORIGIN_RE.test(origin)) return true;
  return false;
}

module.exports = { allowedOrigins, isCorsOriginAllowed };
