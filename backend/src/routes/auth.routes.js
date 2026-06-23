const express = require('express');
const { login, getMe, forgotPassword, resetPassword, revokeSession, getSessions } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);
router.get('/sessions', authenticate, getSessions);
router.post('/sessions/:id/revoke', authenticate, revokeSession);

module.exports = router;
