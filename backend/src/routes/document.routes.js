const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listDocuments, viewDocument, downloadDocument, uploadDocument } = require('../controllers/document.controller');

// Buffer in memory rather than writing to local disk first — the controller
// hands the buffer straight to the configured storage provider (S3/R2/local
// via STORAGE_PROVIDER), so an upload never touches the VPS filesystem when
// that's set to a cloud provider. 15MB cap keeps this safe to hold in memory.
const upload = multer({
  storage: multer.memoryStorage(),
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
