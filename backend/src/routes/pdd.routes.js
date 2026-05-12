const express = require('express');
const router = express.Router();
const pddController = require('../controllers/pdd.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkRole } = require('../middleware/role.middleware');

router.use(authenticate);

// List PDD tasks
router.get('/', pddController.getPddTasks);

// Update PDD status
router.patch('/:id/status', pddController.updateStatus);

module.exports = router;
