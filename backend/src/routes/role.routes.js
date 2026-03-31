const express = require('express');
const { getRoles } = require('../controllers/role.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// All authenticated users can fetch roles (needed for user creation dropdown)
router.get('/', authenticate, getRoles);

module.exports = router;
