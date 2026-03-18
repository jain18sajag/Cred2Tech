const prisma = require('../../config/db');
const { hashPassword } = require('../utils/hash');

async function createUser(data, currentUser) {
  const { name, email, mobile, password, role_id, dsa_id, hierarchy_level, manager_id } = data;

  const role = await prisma.role.findUnique({ where: { id: role_id } });
  if (!role) {
    throw new Error('Role not found');
  }

  // Permission Checks based on current user (simplified logic)
  if (currentUser.roleName === 'DSA' && dsa_id !== currentUser.dsaId) {
    throw new Error('You can only create users within your DSA');
  }

  const hashedPassword = await hashPassword(password);

  // Use a transaction since we need to insert the user, then get their id, and update their path
  return await prisma.$transaction(async (tx) => {
    let newUserData = {
      name,
      email,
      mobile,
      password_hash: hashedPassword,
      role_id,
      dsa_id,
      hierarchy_level,
      manager_id,
    };

    const newUser = await tx.user.create({ data: newUserData });

    // Hierarchy Logic Calculation
    let hierarchyPath = `/${newUser.id}/`;

    if (manager_id) {
      const manager = await tx.user.findUnique({ where: { id: manager_id } });
      if (!manager) {
        throw new Error('Manager not found');
      }
      hierarchyPath = `${manager.hierarchy_path}${newUser.id}/`;
    }

    // Update new user with computed path
    return await tx.user.update({
      where: { id: newUser.id },
      data: { hierarchy_path: hierarchyPath },
    });
  });
}

async function getUsers(currentUser) {
  let whereClause = {};

  if (currentUser.roleName === 'ADMIN') {
    // Admin can see all users
    whereClause = {};
  } else if (currentUser.roleName === 'DSA') {
    // DSA can only see users in their own DSA account
    whereClause = { dsa_id: currentUser.dsaId };
  } else if (currentUser.roleName === 'EMPLOYEE') {
    // Employee can see hierarchy subtree, meaning any user whose path starts with their path
    whereClause = {
      hierarchy_path: {
        startsWith: currentUser.hierarchyPath,
      },
    };
  } else {
    // Other roles might have different rules, restricting for now
    whereClause = { id: currentUser.userId }; 
  }

  return await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role_id: true,
      dsa_id: true,
      hierarchy_level: true,
      manager_id: true,
      hierarchy_path: true,
      status: true,
      created_at: true,
      role: { select: { name: true } }
    },
  });
}

async function getUserById(id, currentUser) {
  // Assuming a similar filtering method to getUsers can be applied
  const user = await prisma.user.findUnique({
    where: { id: Number(id) },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      role_id: true,
      dsa_id: true,
      hierarchy_level: true,
      manager_id: true,
      hierarchy_path: true,
      status: true,
    }
  });

  if (!user) throw new Error('User not found');

  // Verify permissions (simplified checks)
  if (currentUser.roleName === 'DSA' && user.dsa_id !== currentUser.dsaId) {
    throw new Error('Access denied');
  }

  if (currentUser.roleName === 'EMPLOYEE' && !user.hierarchy_path.startsWith(currentUser.hierarchyPath)) {
    throw new Error('Access denied');
  }

  return user;
}

module.exports = {
  createUser,
  getUsers,
  getUserById,
};
