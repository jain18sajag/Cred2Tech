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

const upload = multer({ storage });

module.exports = upload;
