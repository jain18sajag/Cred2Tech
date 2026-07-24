/**
 * Sends an error response, logging the full error server-side but only
 * exposing raw error.message to the client on 4xx (where it's typically an
 * intentional, safe validation message written by this codebase) — 5xx
 * responses return a generic message instead, since those paths are more
 * likely to leak Prisma error strings, stack fragments, or internal details.
 */
function sendError(res, status, err, publicMessage) {
  const message = err?.message || 'Unexpected error';
  if (status >= 500) {
    console.error(`[${status}]`, err);
    return res.status(status).json({ error: publicMessage || 'Internal server error' });
  }
  return res.status(status).json({ error: publicMessage || message });
}

module.exports = { sendError };
