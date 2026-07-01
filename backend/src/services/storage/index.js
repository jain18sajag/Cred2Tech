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
const S3StorageProvider = require('./s3.storage');

const instances = {};

function getStorageProvider(providerName) {
    const provider = (providerName || process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();

    if (instances[provider]) return instances[provider];

    switch (provider) {
        case 'LOCAL':
            instances[provider] = new LocalStorageProvider();
            break;
        case 'CLOUDFLARE_R2':
            instances[provider] = new CloudflareR2StorageProvider();
            break;
        case 'S3':
            instances[provider] = new S3StorageProvider();
            break;
        default:
            throw new Error(`Unknown STORAGE_PROVIDER: "${provider}". Valid options: LOCAL, CLOUDFLARE_R2, S3`);
    }

    console.log(`[storage] Provider initialized: ${provider}`);
    return instances[provider];
}

module.exports = { getStorageProvider };
