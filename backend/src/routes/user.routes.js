const express = require('express');
const { createUser, getUsers, getUserById, updateUser, deleteUser, getMe, getTeam } = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

// DSA_MEMBER allowed routes
router.get('/me', authenticate, getMe);
router.get('/team', authenticate, requireRole('DSA_MEMBER', 'DSA_ADMIN', 'SUPER_ADMIN', 'CRED2TECH_MEMBER'), getTeam);

// Admin/creation routes
// tenant_id is force-overridden to currentUser.tenant_id inside user.service.js (cross-tenant safe)
router.post('/', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER'), createUser);

router.get('/', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER'), getUsers);
router.get('/:id', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER'), getUserById);
router.patch('/:id', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER'), updateUser);
router.delete('/:id', authenticate, requireRole('SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER'), deleteUser);

module.exports = router;
