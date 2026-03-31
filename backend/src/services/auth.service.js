const prisma = require('../../config/db');
const { comparePassword } = require('../utils/hash');
const { generateToken } = require('../utils/jwt');

async function loginUser(email, password) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true, tenant: true },
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  const isPasswordValid = await comparePassword(password, user.password_hash);

  if (!isPasswordValid) {
    throw new Error('Invalid email or password');
  }

  if (user.status !== 'ACTIVE') {
    throw new Error('User account is not active');
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
