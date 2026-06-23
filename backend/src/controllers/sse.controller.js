const sseService = require('../services/sse.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.getPullStatusStream = async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10);
    const tenantId = req.user.tenant_id; // Assumes standard auth middleware handles req.user

    if (!caseId) {
        return res.status(400).json({ error: 'Valid Case ID required' });
    }

    try {
        // Enforce tenant isolation / case access
        const caseRecord = await prisma.case.findFirst({
            where: { id: caseId, tenant_id: tenantId }
        });

        if (!caseRecord) {
            return res.status(403).json({ error: 'Forbidden or Case not found' });
        }

        // Setup SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Prevent NGINX from buffering SSE
        res.flushHeaders();

        // Register client
        sseService.addClient(caseId, res);

        // Cleanup on disconnect
        req.on('close', () => {
            sseService.removeClient(caseId, res);
        });
    } catch (error) {
        console.error('[SSE Controller] Error initializing stream:', error);
        res.status(500).json({ error: 'Failed to initialize SSE stream' });
    }
};

exports.getPullStatuses = async (req, res) => {
    const caseId = parseInt(req.params.caseId, 10);
    const tenantId = req.user.tenant_id;

    if (!caseId) {
        return res.status(400).json({ error: 'Valid Case ID required' });
    }

    try {
        // Enforce tenant isolation / case access
        const caseRecord = await prisma.case.findFirst({
            where: { id: caseId, tenant_id: tenantId }
        });

        if (!caseRecord) {
            return res.status(403).json({ error: 'Forbidden or Case not found' });
        }

        // Fetch authoritative database states safely WITHOUT vendor calls
        const gst = await prisma.gstrAnalyticsRequest.findFirst({
            where: { case_id: caseId },
            orderBy: { created_at: 'desc' }
        });

        const bank = await prisma.bankStatementAnalysisRequest.findFirst({
            where: { case_id: caseId },
            orderBy: { created_at: 'desc' }
        });

        const itr = await prisma.itrAnalyticsRequest.findFirst({
            where: { case_id: caseId },
            orderBy: { created_at: 'desc' }
        });

        // Add bureau logic if existing model is active
        const bureau = null; // Assuming separate bureau tracking

        res.status(200).json({
            gst: { status: gst ? gst.status : 'NOT_STARTED' },
            bank: { status: bank ? bank.status : 'NOT_STARTED' },
            itr: { status: itr ? itr.status : 'NOT_STARTED' },
            bureau: { status: bureau ? bureau.status : 'NOT_STARTED', completedCount: 0, totalCount: 0 }
        });

    } catch (error) {
        console.error('[SSE Controller] Error fetching fallback statuses:', error);
        res.status(500).json({ error: 'Failed to fetch statuses' });
    }
};
