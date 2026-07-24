const { PrismaClient } = require('@prisma/client');
const { encryptionExtension } = require('../src/utils/prismaEncryptionExtension');

const prisma = new PrismaClient().$extends(encryptionExtension);

module.exports = prisma;
