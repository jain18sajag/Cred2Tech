const prisma = require('../../config/db');
const { comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');

async function loginUser(email, password) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true, tenant: true },
  });

  // Safe placeholder hash to reduce timing differences for non-existing users
  const placeholderHash = "$2b$10$abcdefghijklmnopqrstuvwxyzaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const hashToCompare = user ? user.password_hash : placeholderHash;
  const isPasswordValid = await comparePassword(password, hashToCompare);

  // Return generic error for wrong email, wrong password, or inactive/deactivated user
  if (!user || !isPasswordValid || user.status !== 'ACTIVE') {
    throw new Error('Invalid email or password');
  }

  const loginTime = new Date();

  // ── Record last login timestamp ──────────────────────────────────────────
  await prisma.user.update({
    where: { id: user.id },
    data: { last_login_at: loginTime },
  });

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: user.role.name,
    tenantId: user.tenant_id,
    hierarchyLevel: user.hierarchy_level,
    hierarchyPath: user.hierarchy_path,
  };

  const token = generateToken(tokenPayload);

  // Omit password hash in the returned user object
  const { password_hash, ...userWithoutPassword } = user;

  return { user: { ...userWithoutPassword, last_login_at: loginTime }, token };
}

module.exports = {
  loginUser,
};
