const crypto = require('crypto');

/**
 * Signzy webhooks carry no signature scheme of their own — the vendor just
 * POSTs to whatever callbackUrl we registered. Since we fully control that
 * URL, we embed a random per-request token in it at creation time and verify
 * it on receipt, so an attacker who learns/guesses a provider requestId still
 * can't forge a callback without also knowing this token.
 */
function generateWebhookToken() {
  return crypto.randomBytes(24).toString('hex');
}

function appendWebhookToken(url, token) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}wt=${token}`;
}

/** Constant-time comparison; false (not a throw) on any shape mismatch. */
function verifyWebhookToken(expectedToken, providedToken) {
  if (!expectedToken || !providedToken) return false;
  const expectedBuf = Buffer.from(String(expectedToken));
  const providedBuf = Buffer.from(String(providedToken));
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = { generateWebhookToken, appendWebhookToken, verifyWebhookToken };
