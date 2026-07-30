/**
 * Storage Provider Factory
 *
 * Callers writing a NEW document must always pass 'S3' explicitly — every
 * document this app stores belongs in S3, unconditionally, with no .env
 * toggle involved. The only reason to ever pass a different provider name is
 * reading back a document that was stored under a different provider in the
 * past (doc.storage_provider) — never for deciding where new writes go.
 * Business logic never imports a specific provider directly — always use this factory.
 */
const LocalStorageProvider = require('./local.storage');

const instances = {};

function getStorageProvider(providerName) {
    const provider = (providerName || 'S3').toUpperCase();

    if (instances[provider]) return instances[provider];

    switch (provider) {
        case 'LOCAL':
            instances[provider] = new LocalStorageProvider();
            break;
        case 'CLOUDFLARE_R2':
        {
            const CloudflareR2StorageProvider = require('./cloudflare.storage');
            instances[provider] = new CloudflareR2StorageProvider();
            break;
        }
        case 'S3':
        {
            const S3StorageProvider = require('./s3.storage');
            instances[provider] = new S3StorageProvider();
            break;
        }
        default:
            throw new Error(`Unknown STORAGE_PROVIDER: "${provider}". Valid options: LOCAL, CLOUDFLARE_R2, S3`);
    }

    console.log(`[storage] Provider initialized: ${provider}`);
    return instances[provider];
}

module.exports = { getStorageProvider };
