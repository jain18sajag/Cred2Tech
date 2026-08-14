/**
 * Parses `value` as JSON if it's a string, passing objects through
 * unchanged (matches the `typeof x === 'string' ? JSON.parse(x) : x`
 * pattern used throughout this codebase for DB-stored raw vendor JSON that
 * may already be deserialized by Prisma or still be a raw string). Malformed
 * JSON returns `fallback` instead of throwing and crashing the caller.
 */
function safeJsonParse(value, fallback = null) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error('[safeJsonParse] Failed to parse JSON, using fallback:', err.message);
    return fallback;
  }
}

module.exports = { safeJsonParse };
