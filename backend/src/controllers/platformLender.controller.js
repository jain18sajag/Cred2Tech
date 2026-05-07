// platformLender.controller.js
// Handlers for platform-wide lender master data.

const svc = require('../services/platformLender.service');

// GET /api/platform-lenders
async function list(req, res) {
    try {
        // DSA_ADMIN and higher can access
        // If SUPER_ADMIN, maybe show all, else show only active
        let data;
        if (req.user.role === 'SUPER_ADMIN') {
            data = await svc.listAllPlatformLenders();
        } else {
            data = await svc.listActivePlatformLenders();
        }
        res.json(data);
    } catch (e) {
        console.error('[PlatformLender] list error:', e.message);
        res.status(500).json({ error: e.message });
    }
}

module.exports = { list };
