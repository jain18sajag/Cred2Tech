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

const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/db');
const { getStorageProvider } = require('./storage/index');

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

// Known Signzy domains we trust for VENDOR_DOWNLOAD origin
const ALLOWED_VENDOR_DOMAINS = [
    'signzy.tech',
    'signzy.app',
    'signzy.com',
    's3.amazonaws.com',         // Signzy may use S3-backed CDNs
    's3.ap-south-1.amazonaws.com',
    'amazonaws.com',
];

// Private/loopback IP prefixes to block (SSRF prevention)
const PRIVATE_IP_PREFIXES = [
    '10.', '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
    '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
    '172.30.', '172.31.', '192.168.', '127.', '0.', '169.254.',
    '::1', 'fc00:', 'fe80:'
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate a vendor URL before we attempt to download it (SSRF prevention).
 * Throws with a descriptive message if invalid.
 */
function validateVendorUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid vendor URL format: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`Vendor URL must use HTTPS. Got: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and numeric private ranges
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
        throw new Error(`Blocked: vendor URL targets localhost`);
    }
    if (PRIVATE_IP_PREFIXES.some(prefix => hostname.startsWith(prefix))) {
        throw new Error(`Blocked: vendor URL targets private/internal IP range: ${hostname}`);
    }

    // Soft-check against known vendor domains (log warning if unknown, but don't hard-block
    // because Signzy CDN hostnames may vary; hard block only for obvious private ranges above)
    const isKnownVendor = ALLOWED_VENDOR_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!isKnownVendor) {
        console.warn(`[document.service] ingestFromUrl: URL from unknown domain "${hostname}" — proceeding but verify vendor config`);
    }

    return parsed;
}

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
    return path.posix.join('documents', String(tenantId), customerSlug, String(yyyy), mm, uniqueName);
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
}) {
    // 1. SSRF / URL validation
    validateVendorUrl(vendorUrl);

    let buffer;
    let detectedMime;

    // 2. Download with strict limits
    try {
        const response = await axios.get(vendorUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,                          // 30s timeout
            maxRedirects: 3,
            maxContentLength: MAX_FILE_SIZE_BYTES,
            maxBodyLength: MAX_FILE_SIZE_BYTES,
        });

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
async function streamDocument(documentId, requestingTenantId) {
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

    if (doc.status === 'DELETED') {
        const err = new Error('Document has been deleted');
        err.statusCode = 410;
        throw err;
    }

    const storage = getStorageProvider();
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
        const storage = getStorageProvider();
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

module.exports = { ingestFromUrl, streamDocument, deleteDocument };
