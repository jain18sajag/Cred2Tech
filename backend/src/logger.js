'use strict';
const pino = require('pino');

function createLogger(destination) {
  return pino(
    {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        remove: true,
      },
      serializers: { err: pino.stdSerializers.err },
    },
    destination,
  );
}

const logger = createLogger();

module.exports = { logger, createLogger };
