const StorageProvider = require('./storageProvider');

/**
 * Cloudflare R2 Storage Provider — SKELETON / FUTURE IMPLEMENTATION
 *
 * To activate:
 * 1. Install: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 * 2. Set env vars:
 *    CLOUDFLARE_R2_ACCOUNT_ID=
 *    CLOUDFLARE_R2_ACCESS_KEY_ID=
 *    CLOUDFLARE_R2_SECRET_ACCESS_KEY=
 *    CLOUDFLARE_R2_BUCKET_NAME=
 * 3. Uncomment the S3Client initialization below
 * 4. Set STORAGE_PROVIDER=CLOUDFLARE_R2 in .env
 *
 * R2 is S3-compatible, so @aws-sdk/client-s3 works as-is with the R2 endpoint.
 */
class CloudflareR2StorageProvider extends StorageProvider {
    constructor() {
        super();
        // TODO: Initialize S3Client when activating R2
        //
        // const { S3Client } = require('@aws-sdk/client-s3');
        // this.client = new S3Client({
        //     region: 'auto',
        //     endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        //     credentials: {
        //         accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        //         secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
        //     },
        // });
        // this.bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
        throw new Error('CloudflareR2StorageProvider is not yet configured. Set STORAGE_PROVIDER=LOCAL for now.');
    }

    async save(buffer, key, mimeType) {
        // TODO: const { PutObjectCommand } = require('@aws-sdk/client-s3');
        // await this.client.send(new PutObjectCommand({
        //     Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType
        // }));
        // return { key, sizeBytes: buffer.length };
        throw new Error('Not implemented');
    }

    async getStream(key) {
        // TODO: const { GetObjectCommand } = require('@aws-sdk/client-s3');
        // const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        // return response.Body; // ReadableStream
        throw new Error('Not implemented');
    }

    async exists(key) {
        // TODO: const { HeadObjectCommand } = require('@aws-sdk/client-s3');
        // try {
        //     await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
        //     return true;
        // } catch { return false; }
        throw new Error('Not implemented');
    }

    async delete(key) {
        // TODO: const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        // await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        throw new Error('Not implemented');
    }
}

module.exports = CloudflareR2StorageProvider;
