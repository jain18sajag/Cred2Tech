const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listDocuments, viewDocument, downloadDocument, uploadDocument } = require('../controllers/document.controller');

// ── Multer: store to uploads/ with path pattern matching document.service.js ──
const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const tenantId = req.user?.tenant_id || 'unknown';
    const dir = path.join(UPLOADS_ROOT, 'documents', String(tenantId), 'uploads', String(yyyy), mm);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const { v4: uuidv4 } = require('uuid');
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls', '.csv', '.zip', '.jpg', '.jpeg', '.png', '.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed: ${ext}`));
  },
});

// All document routes require authentication
router.use(authenticate);

// GET /api/documents?case_id=&customer_id=&document_type=
router.get('/', listDocuments);

// POST /api/documents/upload  (multipart/form-data: file, case_id, document_type)
router.post('/upload', upload.single('file'), uploadDocument);

// GET /api/documents/:id/view   — inline preview (PDF renders in browser, Excel prompts)
router.get('/:id/view', viewDocument);

// GET /api/documents/:id/download — always triggers Save As dialog
router.get('/:id/download', downloadDocument);

module.exports = router;
