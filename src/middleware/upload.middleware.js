const multer = require('multer');
const path = require('path');

// Buffered in memory, never written to this server's local disk. Bulk
// case/disbursement Excel uploads are parsed once from the buffer and
// discarded; the salary-slip route hands its buffer straight to
// documentController.uploadDocument, which stores it in S3.
const ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.zip', '.jpg', '.jpeg', '.png', '.docx', '.doc'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed: ${ext}`));
  },
});

module.exports = upload;
