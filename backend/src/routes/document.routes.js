const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listDocuments, viewDocument, downloadDocument } = require('../controllers/document.controller');

// All document routes require authentication
router.use(authenticate);

// GET /api/documents?case_id=&customer_id=&document_type=
router.get('/', listDocuments);

// GET /api/documents/:id/view   — inline preview (PDF renders in browser, Excel prompts)
router.get('/:id/view', viewDocument);

// GET /api/documents/:id/download — always triggers Save As dialog
router.get('/:id/download', downloadDocument);

module.exports = router;
