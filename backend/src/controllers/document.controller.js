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
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/db');
const { streamDocument } = require('../services/document.service');
const { getStorageProvider } = require('../services/storage/index');
const { logSensitiveAccess } = require('../utils/auditLog');
const { sendCaughtError } = require('../utils/sendError');
const { assertCaseNotPurged } = require('../utils/casePurgeGuard');

// Mirrors document.service.js#buildStorageKey — year/month/uuid layout, kept
// as the one thing recorded in the DB (never an absolute path), consistent
// regardless of which provider (LOCAL/S3/CLOUDFLARE_R2) actually stores it.
function buildStorageKey(extension) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return path.posix.join(String(yyyy), mm, `${uuidv4()}${extension}`);
}

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

        const where = { status: 'ACTIVE' };
        if (case_id) where.case_id = parseInt(case_id, 10);
        if (customer_id) where.customer_id = parseInt(customer_id, 10);
        if (document_type) where.document_type = document_type;

        // Direct MSME customers share one tenant, so tenant_id alone doesn't isolate
        // them from each other — restrict to cases/customers they themselves own.
        // Not tenant-scoped for them: allocating a case to a DSA moves it (and
        // anything uploaded to it afterwards) into that DSA's own tenant (see
        // admin.direct.customer.controller.js#allocateDirectCase), so a
        // hardcoded tenant_id filter would hide every document added post-
        // allocation — msme_customer_user_id / created_by_user_id below are
        // the ownership signals that survive that reassignment.
        if (req.user.role === 'MSME_CUSTOMER') {
            where.OR = [
                { case_entity: { msme_customer_user_id: req.user.id } },
                { customer: { created_by_user_id: req.user.id } },
            ];
        } else {
            where.tenant_id = tenantId; // Tenant isolation — enforced for everyone else
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

        if (req.user.role === 'MSME_CUSTOMER') {
            if (doc.case_id) {
                const caseObj = await prisma.case.findFirst({ where: { id: doc.case_id } });
                if (!caseObj || caseObj.msme_customer_user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden. MSME does not own this document.' });
            } else if (doc.customer_id) {
                const caseObj = await prisma.case.findFirst({ where: { customer_id: doc.customer_id, msme_customer_user_id: req.user.id } });
                if (!caseObj) return res.status(403).json({ error: 'Forbidden. MSME does not own this customer document.' });
            } else {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

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
        // Free-text name for a document that doesn't fit any fixed category
        // (document_type OTHER) — e.g. "Udyam Registration Certificate".
        const label = req.body.label ? String(req.body.label).trim().slice(0, 200) : null;
        // Which KYC category an OTHER-typed upload belongs to — document_type
        // OTHER alone is ambiguous (shared by several categories' "Others"
        // option plus the freeform "Other Documents" bucket on the proposal
        // page), so the frontend tags it explicitly.
        const category = req.body.category ? String(req.body.category).trim().slice(0, 50) : null;
        // Display name for a user-created custom category (e.g. "Vehicle
        // Documents") — stored so the category still shows up, correctly
        // labeled, after a reload even though it isn't in the fixed list.
        const categoryLabel = req.body.category_label ? String(req.body.category_label).trim().slice(0, 100) : null;

        if (!case_id) return res.status(400).json({ error: 'case_id is required' });

        const tenantId = req.user.tenant_id;
        const userId = req.user.id;

        // Verify case belongs to this tenant (and, for MSME customers, to them
        // specifically). Allocating a case to a DSA moves it into that DSA's
        // own tenant (see admin.direct.customer.controller.js
        // #allocateDirectCase), so it no longer matches the MSME customer's
        // own signup tenant_id — scope by ownership instead of tenant for
        // them, same as getDashboard/getCases/getCaseById already do.
        const caseWhere = req.user.role === 'MSME_CUSTOMER'
            ? { id: parseInt(case_id, 10), msme_customer_user_id: userId }
            : { id: parseInt(case_id, 10), tenant_id: tenantId };
        const caseRecord = await prisma.case.findFirst({
            where: caseWhere,
            select: { id: true, customer_id: true, data_purged_at: true }
        });
        if (!caseRecord) return res.status(404).json({ error: 'Case not found' });
        assertCaseNotPurged(caseRecord);

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

        const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '') || 'bin';
        const mimeType = req.file.mimetype || 'application/octet-stream';

        // Uploaded straight from memory to S3 — every document this app
        // stores goes to S3 unconditionally, no .env toggle involved, and the
        // file never touches this server's own disk. Same as vendor-
        // downloaded documents already do via document.service.js#ingestFromUrl.
        const storageProviderName = 'S3';
        const storageKey = buildStorageKey(`.${ext}`);
        const storage = getStorageProvider(storageProviderName);
        await storage.save(req.file.buffer, storageKey, mimeType);
        const checksum = crypto.createHash('md5').update(req.file.buffer).digest('hex');
        const systemFileName = path.basename(storageKey);

        const doc = await prisma.document.create({
            data: {
                tenant_id: tenantId,
                case_id: parseInt(case_id, 10),
                customer_id: caseRecord.customer_id,
                applicant_id: applicant_id ? parseInt(applicant_id, 10) : null,
                document_type: docType,
                source_type: 'DIRECT_UPLOAD',
                storage_provider: storageProviderName,
                storage_path: storageKey,
                file_name: systemFileName,
                original_file_name: req.file.originalname,
                mime_type: mimeType,
                extension: ext,
                file_size_bytes: req.file.size,
                checksum_md5: checksum,
                status: 'ACTIVE',
                uploaded_by_user_id: userId,
                metadata: (label || category) ? { custom_label: label, category, category_label: categoryLabel } : undefined,
            },
            select: {
                id: true, document_type: true, original_file_name: true,
                file_name: true, mime_type: true, extension: true,
                file_size_bytes: true, status: true, case_id: true, applicant_id: true, created_at: true,
                metadata: true,
            }
        });

        // NOTE: the variable is storageKey (line ~229). This log previously read
        // `storagePath`, which does not exist — and because it runs AFTER the
        // document row is created, the ReferenceError was thrown past the point
        // of success: the file was stored and the row written, but the request
        // still returned "Failed to upload document".
        console.log(`[document.controller] Upload: doc #${doc.id} (${docType}) for case=${case_id}, applicant=${applicant_id || 'none'}, path=${storageKey}`);
        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to upload document');
    }
}

/**
 * DELETE /api/documents/:id
 *
 * Soft delete: flips status to DELETED rather than removing the row. Three
 * reasons this is not a hard delete:
 *   - proposal_documents has ON DELETE CASCADE on document_id, so dropping the
 *     row would silently pull the file out of any proposal it is attached to.
 *   - listDocuments already filters on status: 'ACTIVE', so a soft delete
 *     disappears from every UI without touching the read path.
 *   - it keeps the audit trail, matching how bank statement deletion already
 *     behaves (external.bank.controller#deleteRequest).
 *
 * The stored object is intentionally left in place — reversing a mistaken
 * delete is a status flip, and orphaned blobs are cheaper than lost KYC.
 */
async function deleteDocument(req, res) {
    try {
        const documentId = parseInt(req.params.id, 10);
        if (!documentId || isNaN(documentId)) {
            return res.status(400).json({ error: 'Invalid document ID' });
        }

        const tenantId = req.user.tenant_id;

        // Tenant scoping is the primary gate — never trust the id off the wire.
        const doc = await prisma.document.findFirst({
            where: { id: documentId, tenant_id: tenantId },
            select: { id: true, case_id: true, customer_id: true, status: true, document_type: true },
        });
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        // Same ownership rule serveDocument applies: an MSME borrower may only
        // touch documents belonging to their own case/customer.
        if (req.user.role === 'MSME_CUSTOMER') {
            if (doc.case_id) {
                const caseObj = await prisma.case.findFirst({ where: { id: doc.case_id }, select: { msme_customer_user_id: true, data_purged_at: true } });
                if (!caseObj || caseObj.msme_customer_user_id !== req.user.id) {
                    return res.status(403).json({ error: 'Forbidden. MSME does not own this document.' });
                }
                assertCaseNotPurged(caseObj);
            } else if (doc.customer_id) {
                const caseObj = await prisma.case.findFirst({ where: { customer_id: doc.customer_id, msme_customer_user_id: req.user.id }, select: { id: true, data_purged_at: true } });
                if (!caseObj) return res.status(403).json({ error: 'Forbidden. MSME does not own this customer document.' });
                assertCaseNotPurged(caseObj);
            } else {
                return res.status(403).json({ error: 'Forbidden' });
            }
        } else if (doc.case_id) {
            // Non-MSME roles (DSA/admin) previously had no purge check on delete
            // at all — only the MSME-ownership branch above did a case lookup.
            const caseObj = await prisma.case.findFirst({ where: { id: doc.case_id }, select: { data_purged_at: true } });
            assertCaseNotPurged(caseObj);
        }

        if (doc.status === 'DELETED') {
            return res.status(200).json({ success: true, alreadyDeleted: true });
        }

        await prisma.document.update({
            where: { id: documentId },
            data: { status: 'DELETED' },
        });

        await logSensitiveAccess({
            tenantId, userId: req.user.id, resourceType: 'DOCUMENT', resourceId: documentId,
            action: 'DELETE', ip: req.ip,
        });

        console.log(`[document.controller] Delete: doc #${documentId} (${doc.document_type}) by user ${req.user.id}`);
        res.status(200).json({ success: true });
    } catch (error) {
        sendCaughtError(res, error, 'Failed to delete document');
    }
}

module.exports = { listDocuments, viewDocument, downloadDocument, uploadDocument, deleteDocument };
