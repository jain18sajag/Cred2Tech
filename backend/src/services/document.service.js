/**
 * Document Service
 *
 * Central orchestration for all document storage operations:
 *  - ingestFromUrl()   → downloads a vendor URL securely, saves to storage, creates DB record
 *  - streamDocument()  → authorises and returns a stream for view/download
 *  - deleteDocument()  → soft-deletes DB record and removes from storage
 *
 * This service is the ONLY code that knows about storage internals.
 * Controllers/callers deal only with document IDs and metadata.
 */

const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/db');
const { getStorageProvider } = require('./storage/index');
const { safeGet } = require('../utils/ssrf');

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB hard cap

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.json', '.csv', '.zip']);

const MIME_EXTENSION_MAP = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'application/json': '.json',
    'text/csv': '.csv',
    'application/zip': '.zip',
    'application/octet-stream': '.bin',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect a safe file extension from mime type or fallback.
 */
function resolveExtension(mimeType, fallback = '.bin') {
    const ext = MIME_EXTENSION_MAP[mimeType?.toLowerCase()?.split(';')[0]?.trim()];
    if (ext && ALLOWED_EXTENSIONS.has(ext)) return ext;
    return fallback;
}

/**
 * Build a structured, collision-safe storage key.
 * Pattern: documents/{tenantId}/{customerId_or_'shared'}/{YYYY}/{MM}/{uuid}{ext}
 */
function buildStorageKey(tenantId, customerId, extension) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const customerSlug = customerId ? String(customerId) : 'shared';
    const uniqueName = `${uuidv4()}${extension}`;
    return path.posix.join(String(yyyy), mm, uniqueName);
}

// ─── Core Service Functions ───────────────────────────────────────────────────

/**
 * Ingest a vendor URL:
 *  1. Validate URL (SSRF prevention)
 *  2. Download file bytes (with timeout + size cap)
 *  3. Validate extension & mime type
 *  4. Generate checksum
 *  5. Save file via storage provider
 *  6. Create Document DB record
 *  7. Return the Document record
 *
 * @param {object} params
 * @param {string} params.vendorUrl           - URL to download from
 * @param {string} params.documentType        - DocumentType enum value
 * @param {number} params.tenantId
 * @param {number|null} params.customerId
 * @param {number|null} params.caseId
 * @param {number|null} params.applicantId
 * @param {number|null} params.uploadedByUserId
 * @param {string|null} params.originalFileName - Display name hint
 * @param {object|null} params.metadata        - Any extra data to store
 * @returns {Promise<object>}  Prisma Document record
 */
async function ingestFromUrl({
    vendorUrl,
    documentType,
    tenantId,
    customerId = null,
    caseId = null,
    applicantId = null,
    uploadedByUserId = null,
    originalFileName = null,
    metadata = null,
    headers = null,
}) {
    let buffer;
    let detectedMime;

    // 1+2. SSRF-validated download (URL shape, allowlist, resolved-IP check on
    // every redirect hop, pinned connection) with strict size/time limits.
    try {
        const axiosConfig = {
            responseType: 'arraybuffer',
            timeout: 30000,                          // 30s timeout
            maxContentLength: MAX_FILE_SIZE_BYTES,
            maxBodyLength: MAX_FILE_SIZE_BYTES,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };
        if (headers) {
            axiosConfig.headers = { ...axiosConfig.headers, ...headers };
        }

        const response = await safeGet(vendorUrl, axiosConfig);

        buffer = Buffer.from(response.data);
        detectedMime = response.headers['content-type'] || 'application/octet-stream';

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
            throw new Error(`File too large: ${buffer.length} bytes (max ${MAX_FILE_SIZE_BYTES})`);
        }
        if (buffer.length === 0) {
            throw new Error('Empty file received from vendor URL');
        }
    } catch (err) {
        if (err.response || err.code) {
            throw new Error(`Failed to download vendor file: ${err.message}`);
        }
        throw err;
    }

    // 3. Validate extension
    const ext = resolveExtension(detectedMime, '.bin');
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new Error(`File type not allowed: ${detectedMime} (extension: ${ext})`);
    }

    // 4. Compute MD5 checksum
    const checksum = crypto.createHash('md5').update(buffer).digest('hex');

    // 5. Build storage key and save
    const storageKey = buildStorageKey(tenantId, customerId, ext);
    const storage = getStorageProvider();
    await storage.save(buffer, storageKey, detectedMime);

    const systemFileName = path.basename(storageKey);

    // 6. Create DB record
    const doc = await prisma.document.create({
        data: {
            tenant_id: tenantId,
            customer_id: customerId,
            case_id: caseId,
            applicant_id: applicantId,
            document_type: documentType,
            source_type: 'VENDOR_DOWNLOAD',
            source_url: vendorUrl,       // Kept for audit — app never uses this to serve
            storage_provider: (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase(),
            storage_path: storageKey,
            file_name: systemFileName,
            original_file_name: originalFileName || systemFileName,
            mime_type: detectedMime.split(';')[0].trim(),
            extension: ext,
            file_size_bytes: buffer.length,
            checksum_md5: checksum,
            status: 'ACTIVE',
            uploaded_by_user_id: uploadedByUserId,
            metadata: metadata || undefined,
        }
    });

    console.log(`[document.service] Ingested document #${doc.id} (${documentType}) for tenant=${tenantId}, customer=${customerId}, key=${storageKey}`);
    return doc;
}

/**
 * Authorise and retrieve a document for streaming.
 * Enforces tenant isolation — a user can only access documents belonging to their DSA.
 *
 * @param {number} documentId
 * @param {number} requestingTenantId - From req.user.tenant_id (JWT)
 * @returns {Promise<{ doc: object, stream: NodeJS.ReadableStream }>}
 */
/**
 * MSME_CUSTOMER users share one tenant with every other direct customer, so
 * tenant_id alone is not isolation for them — they may only reach documents
 * belonging to a case or customer record they themselves own. Mirrors the
 * ownership check in middleware/msmeCaseOwnership.middleware.js.
 */
async function assertMsmeOwnsDocument(doc, userId) {
    let owned = false;
    if (doc.case_id) {
        const caseRecord = await prisma.case.findUnique({
            where: { id: doc.case_id },
            select: { msme_customer_user_id: true }
        });
        owned = caseRecord?.msme_customer_user_id === userId;
    }
    if (!owned && doc.customer_id) {
        const customer = await prisma.customer.findUnique({
            where: { id: doc.customer_id },
            select: { created_by_user_id: true }
        });
        owned = customer?.created_by_user_id === userId;
    }
    if (!owned) {
        const err = new Error('Access denied');
        err.statusCode = 403;
        throw err;
    }
}

async function streamDocument(documentId, requestingTenantId, requestingUser = null) {
    const doc = await prisma.document.findUnique({
        where: { id: documentId }
    });

    if (!doc) {
        const err = new Error('Document not found');
        err.statusCode = 404;
        throw err;
    }

    // Tenant isolation — hard stop
    if (doc.tenant_id !== requestingTenantId) {
        const err = new Error('Access denied');
        err.statusCode = 403;
        throw err;
    }

    if (requestingUser && requestingUser.role === 'MSME_CUSTOMER') {
        await assertMsmeOwnsDocument(doc, requestingUser.id);
    }

    if (doc.status === 'DELETED') {
        const err = new Error('Document has been deleted');
        err.statusCode = 410;
        throw err;
    }

    const storage = getStorageProvider(doc.storage_provider);
    const stream = await storage.getStream(doc.storage_path);

    return { doc, stream };
}

/**
 * Soft-delete a document (marks as DELETED in DB, removes file from storage).
 *
 * @param {number} documentId
 * @param {number} requestingTenantId
 * @returns {Promise<void>}
 */
async function deleteDocument(documentId, requestingTenantId) {
    const doc = await prisma.document.findUnique({ where: { id: documentId } });

    if (!doc) throw Object.assign(new Error('Document not found'), { statusCode: 404 });
    if (doc.tenant_id !== requestingTenantId) throw Object.assign(new Error('Access denied'), { statusCode: 403 });
    if (doc.status === 'DELETED') return; // idempotent

    // Remove from storage first (so we don't leave orphan files)
    try {
        const storage = getStorageProvider(doc.storage_provider);
        await storage.delete(doc.storage_path);
    } catch (err) {
        console.error(`[document.service] Storage delete failed for key=${doc.storage_path}: ${err.message}`);
        // Continue to soft-delete the DB record even if file removal fails
    }

    await prisma.document.update({
        where: { id: documentId },
        data: { status: 'DELETED', deleted_at: new Date() }
    });
}

module.exports = { ingestFromUrl, streamDocument, deleteDocument, assertMsmeOwnsDocument };
