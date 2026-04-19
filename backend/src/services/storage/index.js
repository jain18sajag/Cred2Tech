/**
 * Storage Provider Factory
 *
 * Reads STORAGE_PROVIDER env var and returns the appropriate singleton.
 * Business logic never imports a specific provider directly — always use this factory.
 *
 * To switch to Cloudflare R2 in future:
 *   1. Set STORAGE_PROVIDER=CLOUDFLARE_R2 in .env
 *   2. Configure R2 credentials (see cloudflare.storage.js)
 *   3. No other code changes required
 */
const LocalStorageProvider = require('./local.storage');
const CloudflareR2StorageProvider = require('./cloudflare.storage');

let _instance = null;

function getStorageProvider() {
    if (_instance) return _instance;

    const provider = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();

    switch (provider) {
        case 'LOCAL':
            _instance = new LocalStorageProvider();
            break;
        case 'CLOUDFLARE_R2':
            _instance = new CloudflareR2StorageProvider();
            break;
        default:
            throw new Error(`Unknown STORAGE_PROVIDER: "${provider}". Valid options: LOCAL, CLOUDFLARE_R2`);
    }

    console.log(`[storage] Provider initialized: ${provider}`);
    return _instance;
}

module.exports = { getStorageProvider };
