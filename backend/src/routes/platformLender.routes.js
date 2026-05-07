// platformLender.routes.js
// Platform-wide lender master data (Lender matrix).

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/platformLender.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

// GET /api/platform-lenders
// Returns all active lenders for DSA link dropdown.
// Returns all lenders for SUPER_ADMIN.
router.get('/', ctrl.list);

module.exports = router;
