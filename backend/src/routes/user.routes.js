const express = require('express');
const { createUser, getUsers, getUserById, updateUser, deleteUser } = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/role.middleware');

const router = express.Router();

router.post('/', authenticate, requireRoles(['ADMIN', 'DSA', 'EMPLOYEE']), createUser);
router.get('/', authenticate, getUsers);
router.get('/:id', authenticate, getUserById);
router.put('/:id', authenticate, requireRoles(['ADMIN', 'DSA']), updateUser);
router.delete('/:id', authenticate, requireRoles(['ADMIN']), deleteUser);

module.exports = router;
