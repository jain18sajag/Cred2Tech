/**
 * Minimum password policy — previously unenforced anywhere (VAPT H-2).
 * Intentionally not overly strict (no forced special-character classes)
 * to avoid locking out real users; length + basic composition is the
 * baseline NIST/OWASP recommendation.
 */
function validatePasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters long.'), { status: 400 });
  }
  if (password.length > 128) {
    throw Object.assign(new Error('Password must be at most 128 characters long.'), { status: 400 });
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw Object.assign(new Error('Password must contain at least one letter and one number.'), { status: 400 });
  }
}

module.exports = { validatePasswordPolicy };
