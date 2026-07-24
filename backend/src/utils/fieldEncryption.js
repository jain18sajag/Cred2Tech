/**
 * Field-level encryption for PII stored at rest (PAN, DOB, vendor tokens, raw
 * KYC dossiers). AES-256-GCM keyed by FIELD_ENCRYPTION_KEY (distinct from
 * BACKUP_ENCRYPTION_KEY, which only protects DB backup dumps).
 *
 * Two modes:
 *  - "deterministic": IV is HMAC-derived from the plaintext, so the same
 *    plaintext always encrypts to the same ciphertext. Required for any
 *    column the app looks up by exact equality (e.g. `where: { pan_number }`
 *    dedup/idempotency checks) — encryption must not break those queries.
 *    Trade-off: equal values are visibly equal in ciphertext (standard,
 *    accepted cost of searchable encryption).
 *  - "random": a fresh random IV per call. Used for anything never queried
 *    by equality (DOB display fields, vendor auth tokens, raw JSON blobs).
 *
 * Every encrypted value is self-describing (`enc:v1:d:...` / `enc:v1:r:...`)
 * so `decrypt*` can safely pass through legacy/plaintext values untouched —
 * a write path this rollout missed just leaves that field in plaintext
 * (same as before) instead of corrupting or crashing on read.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // GCM standard
const PREFIX = 'enc:v1:';

let _key = null;
function getKey() {
  if (_key) return _key;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set — required to encrypt/decrypt PII fields');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`FIELD_ENCRYPTION_KEY must decode (base64) to 32 bytes for AES-256; got ${key.length}`);
  }
  _key = key;
  return _key;
}

function deriveDeterministicIv(plaintext) {
  return crypto.createHmac('sha256', getKey()).update(plaintext).digest().subarray(0, IV_LENGTH);
}

/**
 * @param {string} plaintext
 * @param {{deterministic?: boolean}} [opts]
 * @returns {string} `enc:v1:d:<iv><tag><ciphertext base64>` or `enc:v1:r:...`
 */
function encryptString(plaintext, opts = {}) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (typeof plaintext !== 'string') return plaintext; // don't touch non-strings (defensive)
  if (plaintext.startsWith(PREFIX)) return plaintext;  // already encrypted — don't double-encrypt
  if (plaintext === '') return plaintext;               // nothing to protect, avoid needless ciphertext

  const deterministic = !!opts.deterministic;
  const iv = deterministic ? deriveDeterministicIv(plaintext) : crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const mode = deterministic ? 'd' : 'r';
  return `${PREFIX}${mode}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

/**
 * @param {string} value
 * @returns {string} original plaintext, or the input unchanged if it wasn't
 *   produced by encryptString (legacy/plaintext passthrough).
 */
function decryptString(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;

  const rest = value.slice(PREFIX.length); // "d:<b64>" or "r:<b64>"
  const sep = rest.indexOf(':');
  if (sep === -1) return value; // malformed — pass through rather than throw
  const b64 = rest.slice(sep + 1);

  try {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = buf.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    // Never let a corrupt/foreign value crash a read path — surface it in logs instead.
    console.error('[fieldEncryption] Failed to decrypt value, returning as-is:', err.message);
    return value;
  }
}

/** JSON columns: envelope the encrypted string inside a small JSON object so it round-trips through a `Json` column. */
function encryptJson(value) {
  if (value === null || value === undefined) return value;
  if (value && typeof value === 'object' && value.__enc === 'v1') return value; // already enveloped
  const ciphertext = encryptString(JSON.stringify(value), { deterministic: false });
  return { __enc: 'v1', data: ciphertext };
}

function decryptJson(value) {
  if (!value || typeof value !== 'object' || value.__enc !== 'v1') return value; // legacy/plaintext passthrough
  try {
    return JSON.parse(decryptString(value.data));
  } catch (err) {
    console.error('[fieldEncryption] Failed to decrypt/parse JSON field, returning envelope as-is:', err.message);
    return value;
  }
}

module.exports = { encryptString, decryptString, encryptJson, decryptJson };
