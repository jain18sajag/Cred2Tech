const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    // We expect the UPLOADS_ROOT/YYYY/MM folder structure
    const dir = path.join(UPLOADS_ROOT, String(yyyy), mm);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Previously unbounded — no file-size cap or type filter, unlike the multer
// config in document.routes.js. Shared by bulk case/disbursement Excel
// uploads and salary-slip uploads, so the allowlist covers both.
const ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.zip', '.jpg', '.jpeg', '.png', '.docx', '.doc'];

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed: ${ext}`));
  },
});

module.exports = upload;
