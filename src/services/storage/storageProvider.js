/**
 * StorageProvider — Abstract interface contract.
 *
 * All storage implementations (Local, Cloudflare R2, S3) must expose these methods.
 * Switch providers by changing the STORAGE_PROVIDER env variable; no business logic changes needed.
 */
class StorageProvider {
    /**
     * Save a file buffer to storage.
     * @param {Buffer} buffer - File content
     * @param {string} key    - Relative storage key/path (e.g. "documents/1/42/2024/04/uuid.pdf")
     * @param {string} mimeType
     * @returns {Promise<{ key: string, sizeBytes: number }>}
     */
    async save(buffer, key, mimeType) {
        throw new Error('StorageProvider.save() must be implemented');
    }

    /**
     * Return a readable stream for the file.
     * @param {string} key
     * @returns {Promise<NodeJS.ReadableStream>}
     */
    async getStream(key) {
        throw new Error('StorageProvider.getStream() must be implemented');
    }

    /**
     * Check whether a file exists.
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        throw new Error('StorageProvider.exists() must be implemented');
    }

    /**
     * Delete a file from storage.
     * @param {string} key
     * @returns {Promise<void>}
     */
    async delete(key) {
        throw new Error('StorageProvider.delete() must be implemented');
    }
}

module.exports = StorageProvider;
