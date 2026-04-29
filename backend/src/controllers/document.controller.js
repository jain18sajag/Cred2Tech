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
        console.error('[document.controller] listDocuments error:', error);
        res.status(500).json({ error: error.message });
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
        const { doc, stream } = await streamDocument(documentId, tenantId);

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
        const status = error.statusCode || 500;
        if (!res.headersSent) {
            res.status(status).json({ error: error.message });
        }
        if (status === 500) {
            console.error('[document.controller] serveDocument error:', error);
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
        const { case_id, document_type } = req.body;
        if (!case_id) return res.status(400).json({ error: 'case_id is required' });

        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        // Verify case belongs to this tenant
        const caseRows = await prisma.$queryRawUnsafe(
            `SELECT id FROM cases WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            parseInt(case_id), tenantId
        );
        if (!caseRows[0]) return res.status(404).json({ error: 'Case not found' });

        const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');
        // Store relative key (not absolute) — same as LocalStorageProvider
        const storagePath = path.relative(UPLOADS_ROOT, req.file.path).replace(/\\/g, '/');

        const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || 'bin';
        const mimeType = req.file.mimetype || 'application/octet-stream';
        const docType = (document_type || 'OTHER').toUpperCase();

        const doc = await prisma.document.create({
            data: {
                tenant_id: tenantId,
                case_id: parseInt(case_id),
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
                file_size_bytes: true, status: true, case_id: true, created_at: true,
            }
        });

        console.log(`[document.controller] Upload: doc #${doc.id} (${docType}) for case=${case_id}, path=${storagePath}`);
        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        console.error('[document.controller] uploadDocument error:', error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = { listDocuments, viewDocument, downloadDocument, uploadDocument };
