const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // No hardcoded fallback — a guessable default secret makes every issued
  // token forgeable. Fail startup instead of silently running insecurely.
  throw new Error('JWT_SECRET is not set — required to sign/verify auth tokens');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
const JWT_ALGORITHM = 'HS256';

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
}

module.exports = {
  generateToken,
  verifyToken,
};
