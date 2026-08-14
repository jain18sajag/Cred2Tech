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

/**
 * For `catch (error)` blocks that don't already know the failure mode.
 * A deliberately-thrown `new Error('some safe message')` from this codebase's
 * own services always has `.name === 'Error'` — its message is authored by us
 * and safe to expose. Anything else (PrismaClientValidationError,
 * PrismaClientKnownRequestError, TypeError, etc.) is an unexpected internal
 * failure whose `.message` can contain file paths, query values, or stack
 * fragments, so it's logged server-side and replaced with a generic message.
 * An explicit `error.status`/`error.statusCode` (set via
 * `Object.assign(new Error(...), {status})` or `{statusCode}` — both
 * conventions exist in this codebase) always wins, since that's an explicit
 * app-level signal of a safe, classified error.
 */
function sendCaughtError(res, error, fallbackMessage, fallbackStatus = 400) {
  const explicitStatus = error?.status || error?.statusCode;
  if (explicitStatus) {
    return res.status(explicitStatus).json({ error: error.message });
  }
  if (error?.name === 'Error') {
    return res.status(fallbackStatus).json({ error: error.message });
  }
  console.error(`[${fallbackMessage || 'unexpected error'}]`, error);
  return res.status(500).json({ error: fallbackMessage || 'Internal server error' });
}

module.exports = { sendError, sendCaughtError };
