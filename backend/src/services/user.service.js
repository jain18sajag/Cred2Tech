const prisma = require('../../config/db');
const { hashPassword } = require('../utils/hash');
const { isValidManager } = require('../utils/hierarchy');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

// Fields a caller may set directly on another user's record via PATCH /users/:id.
// Anything not in this list (password_hash, tenant_id, failed_login_attempts,
// locked_until, id, created_by, hierarchy_path, ...) is never client-settable —
// role_id and status are handled separately below with their own validation.
const ALLOWED_USER_UPDATE_FIELDS = ['name', 'email', 'mobile', 'hierarchy_level', 'manager_id', 'designation'];
const VALID_USER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

// Mirrors the RBAC matrix documented below in createUser — which target role names
// a given currentUser is allowed to assign to someone else.
function assertRoleAssignable(currentUser, targetRoleName) {
  if (currentUser.role === 'SUPER_ADMIN') {
    const SUPER_ADMIN_ALLOWED_ROLES = ['SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN'];
    if (!SUPER_ADMIN_ALLOWED_ROLES.includes(targetRoleName)) {
      throw Object.assign(
        new Error(`SUPER_ADMIN cannot assign role "${targetRoleName}". Only SUPER_ADMIN, CRED2TECH_MEMBER, and DSA_ADMIN are permitted.`),
        { status: 403 }
      );
    }
  } else if (currentUser.role === 'DSA_ADMIN' || currentUser.role === 'CRED2TECH_MEMBER') {
    const DSA_ADMIN_ALLOWED_ROLES = ['DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'];
    if (currentUser.role === 'DSA_ADMIN' && !DSA_ADMIN_ALLOWED_ROLES.includes(targetRoleName)) {
      throw Object.assign(new Error(`DSA_ADMIN cannot assign role "${targetRoleName}"`), { status: 403 });
    }
  } else {
    throw Object.assign(new Error('You do not have permission to assign roles'), { status: 403 });
  }
}

async function createUser(data, currentUser) {
  let { name, email, mobile, password, role_id, tenant_id, hierarchy_level, manager_id, designation } = data;
  // Match auth.service.js's lowercased login lookup — otherwise a user
  // created with any uppercase character in their email can never log in.
  email = email?.toLowerCase().trim();
  console.log('CREATE USER PAYLOAD:', JSON.stringify({ name, email, mobile, role_id, tenant_id, hierarchy_level, manager_id, designation }));

  if (!role_id) throw Object.assign(new Error('role_id is required'), { status: 400 });
  validatePasswordPolicy(password);

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
  //   • DSA_ADMIN, DSA_MEMBER, SUB_DSA → only within own DSA tenant
  //
  // ──────────────────────────────────────────────────────────────────────────

  let parsedTenantId;

  assertRoleAssignable(currentUser, roleExists.name);

  if (currentUser.role === 'SUPER_ADMIN') {
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
    // Always locked to own tenant
    parsedTenantId = currentUser.tenant_id;
  }

  // Manager/tenant validation

  if (parsedManagerId) {
    const manager = await prisma.user.findUnique({ where: { id: parsedManagerId } });
    if (!manager || manager.tenant_id !== parsedTenantId) {
      const error = new Error('Manager and subordinate must belong to the same tenant');
      error.status = 400;
      throw error;
    }
    if (!isValidManager(hierarchy_level, manager.hierarchy_level)) {
      throw Object.assign(new Error('Invalid hierarchy: manager must be senior to employee'), { status: 400 });
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
      designation: designation || null,
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
  let whereClause = {};

  if (currentUser.role === 'SUPER_ADMIN') {
    // SUPER_ADMIN can see everyone across all tenants
    whereClause = {};
  } else if (currentUser.role === 'DSA_ADMIN' || currentUser.role === 'CRED2TECH_MEMBER') {
    // Admin for a specific tenant sees everyone in that tenant.
    // ('TENANT_ADMIN' was referenced here previously but is not a seeded role —
    // it could never match, silently forcing every non-SUPER_ADMIN/DSA_ADMIN caller
    // into the narrower hierarchy-only branch below.)
    whereClause = { tenant_id: currentUser.tenant_id };
  } else {
    // Sub-roles (DSA_MEMBER, SUB_DSA) only see themselves and their subordinates
    whereClause = {
      tenant_id: currentUser.tenant_id,
      hierarchy_path: { startsWith: currentUser.hierarchy_path }
    };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
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
      designation: true,
      last_login_at: true,
      created_at: true,
      role: { select: { name: true } },
      tenant: { select: { name: true, type: true } }
    },
  });

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
      designation: true,
      last_login_at: true,
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

  const parsedManagerId = data.manager_id !== undefined ? (data.manager_id ? parseInt(data.manager_id, 10) : null) : user.manager_id;
  const newHierarchyLevel = data.hierarchy_level !== undefined ? data.hierarchy_level : user.hierarchy_level;

  let manager = null;
  if (parsedManagerId) {
    manager = await prisma.user.findUnique({ where: { id: parsedManagerId } });
    if (!manager || manager.tenant_id !== user.tenant_id) {
      throw Object.assign(new Error('Manager and subordinate must belong to the same tenant'), { status: 400 });
    }

    if (!isValidManager(newHierarchyLevel, manager.hierarchy_level)) {
      throw Object.assign(new Error('Invalid hierarchy: manager must be senior to employee'), { status: 400 });
    }

    // Prevent cycles
    if (parsedManagerId === Number(id)) {
      throw Object.assign(new Error('Invalid hierarchy: user cannot be their own manager'), { status: 400 });
    }
    if (manager.hierarchy_path && manager.hierarchy_path.includes(`/${id}/`)) {
      throw Object.assign(new Error('Invalid hierarchy: user cannot be moved under one of their descendants'), { status: 400 });
    }
  }

  // Explicit allow-list — never spread raw client input into Prisma (mass-assignment guard).
  const updateData = {};
  for (const field of ALLOWED_USER_UPDATE_FIELDS) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }
  if (updateData.manager_id !== undefined) updateData.manager_id = parsedManagerId;
  // Match auth.service.js's lowercased login lookup — otherwise changing a
  // user's email to include an uppercase character locks them out.
  if (updateData.email !== undefined) updateData.email = updateData.email?.toLowerCase().trim();

  if (data.status !== undefined) {
    if (!VALID_USER_STATUSES.includes(data.status)) {
      throw Object.assign(new Error(`Invalid status "${data.status}"`), { status: 400 });
    }
    updateData.status = data.status;
  }

  if (data.role_id !== undefined) {
    if (Number(id) === currentUser.id) {
      throw Object.assign(new Error('You cannot change your own role'), { status: 403 });
    }
    const parsedRoleId = parseInt(data.role_id, 10);
    const roleExists = await prisma.role.findUnique({ where: { id: parsedRoleId } });
    if (!roleExists) {
      throw Object.assign(new Error(`Role with id ${parsedRoleId} does not exist`), { status: 400 });
    }
    assertRoleAssignable(currentUser, roleExists.name);
    updateData.role_id = parsedRoleId;
  }

  updateData.updated_by = currentUser.id;

  return await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: Number(id) },
      data: updateData
    });

    if (data.manager_id !== undefined && data.manager_id !== user.manager_id) {
      const oldPath = user.hierarchy_path;
      let newPath = `/${updatedUser.id}/`;

      if (parsedManagerId && manager) {
        newPath = `${manager.hierarchy_path}${updatedUser.id}/`;
      }

      await tx.user.update({
        where: { id: updatedUser.id },
        data: { hierarchy_path: newPath }
      });

      if (oldPath) {
        // Find all descendants and update their paths
        const descendants = await tx.user.findMany({
          where: {
            tenant_id: user.tenant_id,
            hierarchy_path: { startsWith: oldPath },
            id: { not: updatedUser.id }
          }
        });

        for (const desc of descendants) {
          const descNewPath = desc.hierarchy_path.replace(oldPath, newPath);
          await tx.user.update({
            where: { id: desc.id },
            data: { hierarchy_path: descNewPath }
          });
        }
      }
      updatedUser.hierarchy_path = newPath;
    }
    return updatedUser;
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
