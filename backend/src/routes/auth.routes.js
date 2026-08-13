const express = require('express');
const { login, getMe, forgotPassword, resetPassword, revokeSession, getSessions, listTrustedDevices, revokeTrustedDevice } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);
router.get('/sessions', authenticate, getSessions);
router.post('/sessions/:id/revoke', authenticate, revokeSession);
router.get('/trusted-devices', authenticate, listTrustedDevices);
router.post('/trusted-devices/:id/revoke', authenticate, revokeTrustedDevice);

module.exports = router;
