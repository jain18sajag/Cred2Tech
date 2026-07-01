const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const StorageProvider = require('./storageProvider');

class S3StorageProvider extends StorageProvider {
    constructor() {
        super();
        this.bucketName = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
        if (!this.bucketName) {
            console.warn('[storage] S3_BUCKET_NAME or AWS_S3_BUCKET not found in environment.');
        }

        this.s3Client = new S3Client({
            region: process.env.AWS_REGION || 'ap-south-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            }
        });
    }

    async save(buffer, key, mimeType) {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
        });

        await this.s3Client.send(command);

        return {
            key,
            sizeBytes: buffer.length
        };
    }

    async getStream(key) {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });

        const response = await this.s3Client.send(command);
        return response.Body; // response.Body is a readable stream in Node.js
    }

    async exists(key) {
        try {
            const command = new HeadObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            });
            await this.s3Client.send(command);
            return true;
        } catch (error) {
            if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
                return false;
            }
            throw error;
        }
    }

    async delete(key) {
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });
        await this.s3Client.send(command);
    }
}

module.exports = S3StorageProvider;
