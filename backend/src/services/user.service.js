const prisma = require('../../config/db');
const { hashPassword } = require('../utils/hash');

async function createUser(data, currentUser) {
  console.log('CREATE USER PAYLOAD:', JSON.stringify(data));

  const { name, email, mobile, password, role_id, tenant_id, hierarchy_level, manager_id } = data;

  if (!role_id) throw Object.assign(new Error('role_id is required'), { status: 400 });

  const parsedRoleId = parseInt(role_id, 10);
  const parsedManagerId = manager_id ? parseInt(manager_id, 10) : null;

  // Validate role exists in DB (prevents FK violation with clean error)
  const roleExists = await prisma.role.findUnique({ where: { id: parsedRoleId } });
  if (!roleExists) {
    throw Object.assign(new Error(`Role with id ${parsedRoleId} does not exist`), { status: 400 });
  }

  // ─── RBAC Role Permission Rules ───────────────────────────────────────────
  //
  // SUPER_ADMIN can create:
  //   • SUPER_ADMIN, CRED2TECH_MEMBER → only in own CRED2TECH tenant
  //   • DSA_ADMIN                     → in any valid DSA tenant (for onboarding)
  //   • DSA_MEMBER                    → NOT ALLOWED (managed by DSA_ADMIN)
  //
  // DSA_ADMIN can create:
  //   • DSA_ADMIN, DSA_MEMBER         → only within own DSA tenant
  //
  // ──────────────────────────────────────────────────────────────────────────

  let parsedTenantId;

  if (currentUser.role === 'SUPER_ADMIN') {
    const SUPER_ADMIN_ALLOWED_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN'];

    if (!SUPER_ADMIN_ALLOWED_ROLES.includes(roleExists.name)) {
      throw Object.assign(
        new Error(`SUPER_ADMIN cannot create users with role "${roleExists.name}". Only SUPER_ADMIN, CRED2TECH_MEMBER, and DSA_ADMIN are permitted.`),
        { status: 403 }
      );
    }

    if (roleExists.name === 'DSA_ADMIN') {
      // Creating initial admin for a DSA tenant — payload tenant_id required and must be DSA type
      if (!tenant_id) {
        throw Object.assign(new Error('tenant_id is required when creating a DSA_ADMIN'), { status: 400 });
      }
      const targetTenant = await prisma.tenant.findUnique({ where: { id: parseInt(tenant_id, 10) } });
      if (!targetTenant) {
        throw Object.assign(new Error(`Tenant with id ${tenant_id} does not exist`), { status: 400 });
      }
      if (targetTenant.type !== 'DSA') {
        throw Object.assign(new Error('DSA_ADMIN must be created in a DSA-type tenant'), { status: 400 });
      }
      parsedTenantId = targetTenant.id;
    } else {
      // SUPER_ADMIN or CRED2TECH_MEMBER → must be in own CRED2TECH tenant
      parsedTenantId = currentUser.tenant_id;
    }

  } else if (currentUser.role === 'DSA_ADMIN' || currentUser.role === 'CRED2TECH_MEMBER') {
    const DSA_ADMIN_ALLOWED_ROLES = ['DSA_ADMIN', 'DSA_MEMBER'];

    if (currentUser.role === 'DSA_ADMIN' && !DSA_ADMIN_ALLOWED_ROLES.includes(roleExists.name)) {
      throw Object.assign(
        new Error(`DSA_ADMIN cannot create users with role "${roleExists.name}"`),
        { status: 403 }
      );
    }
    // Always locked to own tenant
    parsedTenantId = currentUser.tenant_id;

  } else {
    throw Object.assign(new Error('You do not have permission to create users'), { status: 403 });
  }

  // Manager/tenant validation

  if (parsedManagerId) {
    const manager = await prisma.user.findUnique({ where: { id: parsedManagerId } });
    if (!manager || manager.tenant_id !== parsedTenantId) {
      const error = new Error('Manager and subordinate must belong to the same tenant');
      error.status = 400;
      throw error;
    }
  }

  const hashedPassword = await hashPassword(password);

  // Transaction for inserting and updating path
  return await prisma.$transaction(async (tx) => {
    let newUserData = {
      name,
      email,
      mobile,
      password_hash: hashedPassword,
      role_id: parsedRoleId,
      tenant_id: parsedTenantId,
      hierarchy_level,
      manager_id: parsedManagerId,
      created_by: currentUser.id,
      updated_by: currentUser.id
    };

    const newUser = await tx.user.create({ data: newUserData });

    let hierarchyPath = `/${newUser.id}/`;

    if (parsedManagerId) {
      const manager = await tx.user.findUnique({ where: { id: parsedManagerId } });
      hierarchyPath = `${manager.hierarchy_path}${newUser.id}/`;
    }

    return await tx.user.update({
      where: { id: newUser.id },
      data: { hierarchy_path: hierarchyPath },
    });
  });
}

async function getUsers(currentUser) {
  // Replace findMany() with tenant_id filter
  const users = await prisma.user.findMany({
    where: {
      tenant_id: currentUser.tenant_id
    },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role_id: true,
      tenant_id: true,
      hierarchy_level: true,
      manager_id: true,
      hierarchy_path: true,
      status: true,
      created_at: true,
      role: { select: { name: true } }
    },
  });

  if (currentUser.role === 'SUPER_ADMIN') {
    // SUPER_ADMIN blocked from GET /users (DSA users), but the where clause tenant_id limits it to CRED2TECH implicitly
    // because SUPER_ADMIN belongs to CRED2TECH.
  }

  return users;
}

async function getUserById(id, currentUser) {
  const user = await prisma.user.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role_id: true,
      tenant_id: true,
      hierarchy_level: true,
      manager_id: true,
      hierarchy_path: true,
      status: true,
    }
  });

  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (user.tenant_id !== currentUser.tenant_id) {
    const error = new Error('Cross-tenant access denied');
    error.status = 403;
    throw error;
  }

  return user;
}

async function updateUser(id, data, currentUser) {
  const user = await getUserById(id, currentUser); // Will throw 403 if mismatch

  return await prisma.user.update({
    where: { id: Number(id) },
    data: {
      ...data,
      updated_by: currentUser.id
    }
  });
}

async function deleteUser(id, currentUser) {
  const user = await getUserById(id, currentUser); // Will throw 403 if mismatch

  return await prisma.user.delete({
    where: { id: Number(id) }
  });
}

async function getMe(currentUser) {
  return await getUserById(currentUser.id, currentUser);
}

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getMe
};
