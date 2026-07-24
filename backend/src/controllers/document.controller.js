/**
 * Document Controller
 *
 * Secure endpoints for listing, viewing, and downloading stored documents.
 * All routes are authenticated and tenant-scoped — no raw file paths ever reach the frontend.
 *
 * Routes (mounted under /api/documents via document.routes.js):
 *   GET /api/documents              → list documents (filtered by case_id or customer_id)
 *   GET /api/documents/:id/view     → inline preview (Content-Disposition: inline)
 *   GET /api/documents/:id/download → attachment download (Content-Disposition: attachment)
 */

const path = require('path');
const prisma = require('../../config/db');
const { streamDocument } = require('../services/document.service');
const { logSensitiveAccess } = require('../utils/auditLog');
const { sendCaughtError } = require('../utils/sendError');

/**
 * List documents scoped to the requesting user's tenant.
 * Requires at least one of: case_id or customer_id as query param.
 */
async function listDocuments(req, res) {
    try {
        const { case_id, customer_id, document_type } = req.query;
        const tenantId = req.user.tenant_id;

        if (!case_id && !customer_id) {
            return res.status(400).json({ error: 'At least one of case_id or customer_id is required' });
        }

        const where = {
            tenant_id: tenantId,             // Tenant isolation — always enforced
            status: 'ACTIVE',
        };
        if (case_id) where.case_id = parseInt(case_id, 10);
        if (customer_id) where.customer_id = parseInt(customer_id, 10);
        if (document_type) where.document_type = document_type;

        // Direct MSME customers share one tenant, so tenant_id alone doesn't isolate
        // them from each other — restrict to cases/customers they themselves own.
        if (req.user.role === 'MSME_CUSTOMER') {
            where.OR = [
                { case_entity: { msme_customer_user_id: req.user.id } },
                { customer: { created_by_user_id: req.user.id } },
            ];
        }

        const documents = await prisma.document.findMany({
            where,
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                document_type: true,
                source_type: true,
                storage_provider: true,
                file_name: true,
                original_file_name: true,
                mime_type: true,
                extension: true,
                file_size_bytes: true,
                status: true,
                case_id: true,
                customer_id: true,
                applicant_id: true,
                created_at: true,
                // NOTE: storage_path and source_url are intentionally excluded from API responses
            }
        });

        res.json({ success: true, data: documents });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to list documents');
    }
}

/**
 * Shared handler for view and download — varies only by Content-Disposition header.
 */
async function serveDocument(req, res, disposition) {
    try {
        const documentId = parseInt(req.params.id, 10);
        if (!documentId || isNaN(documentId)) {
            return res.status(400).json({ error: 'Invalid document ID' });
        }

        const tenantId = req.user.tenant_id;
        const { doc, stream } = await streamDocument(documentId, tenantId, req.user);

        await logSensitiveAccess({
            tenantId, userId: req.user.id, resourceType: 'DOCUMENT', resourceId: documentId,
            action: disposition === 'attachment' ? 'DOWNLOAD' : 'VIEW', ip: req.ip
        });

        // Security headers
        res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${encodeURIComponent(doc.original_file_name || doc.file_name)}"`
        );

        if (doc.file_size_bytes) {
            res.setHeader('Content-Length', doc.file_size_bytes);
        }

        stream.on('error', (err) => {
            console.error(`[document.controller] Stream error for doc #${documentId}: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to stream file' });
            }
        });

        stream.pipe(res);
    } catch (error) {
        if (!res.headersSent) {
            sendCaughtError(res, error, 'Failed to retrieve document');
        }
    }
}

async function viewDocument(req, res) {
    return serveDocument(req, res, 'inline');
}

async function downloadDocument(req, res) {
    return serveDocument(req, res, 'attachment');
}

/**
 * Upload a document for a case.
 * POST /api/documents/upload  (multipart/form-data)
 * Body fields: case_id (required), document_type (optional, default OTHER)
 * File field:  file (required)
 */
async function uploadDocument(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        
        // Extract from body, or fallback to params (for the semantic routes)
        const case_id = req.body.case_id || req.params.caseId;
        const applicant_id = req.body.applicant_id || req.params.applicantId;
        const document_type = req.body.document_type || (req.params.applicantId ? 'SALARY_SLIP' : 'OTHER');

        if (!case_id) return res.status(400).json({ error: 'case_id is required' });

        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        // Verify case belongs to this tenant (and, for MSME customers, to them specifically —
        // they share one tenant with every other direct customer, so tenant_id alone isn't isolation).
        const caseWhere = { id: parseInt(case_id, 10), tenant_id: tenantId };
        if (req.user.role === 'MSME_CUSTOMER') caseWhere.msme_customer_user_id = userId;
        const caseRecord = await prisma.case.findFirst({
            where: caseWhere,
            select: { id: true, customer_id: true }
        });
        if (!caseRecord) return res.status(404).json({ error: 'Case not found' });

        // If applicant_id is provided, verify it belongs to this case
        if (applicant_id) {
            const applicantRecord = await prisma.applicant.findFirst({
                where: { id: parseInt(applicant_id, 10), case_id: parseInt(case_id, 10) }
            });
            if (!applicantRecord) return res.status(404).json({ error: 'Applicant not found or does not belong to this case' });
        }

        const docType = (document_type || 'OTHER').toUpperCase();
        if (docType === 'SALARY_SLIP' && !applicant_id) {
            return res.status(400).json({ error: 'applicant_id is required for SALARY_SLIP documents' });
        }

        const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');
        // Store relative key (not absolute) — same as LocalStorageProvider
        const storagePath = path.relative(UPLOADS_ROOT, req.file.path).replace(/\\/g, '/');

        const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || 'bin';
        const mimeType = req.file.mimetype || 'application/octet-stream';

        const doc = await prisma.document.create({
            data: {
                tenant_id: tenantId,
                case_id: parseInt(case_id, 10),
                customer_id: caseRecord.customer_id,
                applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                document_type: docType,
                source_type: 'DIRECT_UPLOAD',
                storage_provider: 'LOCAL',
                storage_path: storagePath,    // relative key
                file_name: req.file.filename,
                original_file_name: req.file.originalname,
                mime_type: mimeType,
                extension: ext,
                file_size_bytes: req.file.size,
                status: 'ACTIVE',
                uploaded_by_user_id: userId,
            },
            select: {
                id: true, document_type: true, original_file_name: true,
                file_name: true, mime_type: true, extension: true,
                file_size_bytes: true, status: true, case_id: true, applicant_id: true, created_at: true,
            }
        });

        console.log(`[document.controller] Upload: doc #${doc.id} (${docType}) for case=${case_id}, applicant=${applicant_id || 'none'}, path=${storagePath}`);
        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to upload document');
    }
}

module.exports = { listDocuments, viewDocument, downloadDocument, uploadDocument };
