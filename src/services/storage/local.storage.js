const fs = require('fs');
const path = require('path');
const StorageProvider = require('./storageProvider');

const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');

class LocalStorageProvider extends StorageProvider {
    /**
     * Resolve absolute disk path from a relative storage key.
     * The key is the only thing stored in DB — never the absolute path.
     */
    _absPath(key) {
        // Security: normalise and ensure the key stays inside UPLOADS_ROOT
        const resolved = path.resolve(UPLOADS_ROOT, key);
        if (!resolved.startsWith(UPLOADS_ROOT + path.sep) && resolved !== UPLOADS_ROOT) {
            throw new Error('Path traversal attempt detected');
        }
        return resolved;
    }

    async save(buffer, key, _mimeType) {
        const absPath = this._absPath(key);
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, buffer);
        return { key, sizeBytes: buffer.length };
    }

    async getStream(key) {
        const absPath = this._absPath(key);
        if (!fs.existsSync(absPath)) {
            throw new Error(`File not found on local storage: ${key}`);
        }
        return fs.createReadStream(absPath);
    }

    async exists(key) {
        try {
            const absPath = this._absPath(key);
            await fs.promises.access(absPath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    async delete(key) {
        try {
            const absPath = this._absPath(key);
            await fs.promises.unlink(absPath);
        } catch (err) {
            // Ignore if already gone
            if (err.code !== 'ENOENT') throw err;
        }
    }
}

module.exports = LocalStorageProvider;
