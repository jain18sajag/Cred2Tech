'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { createLogger } = require('../src/logger');

function makeCapture() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

test('createLogger redacts authorization/cookie headers', () => {
  const { lines, stream } = makeCapture();
  const logger = createLogger(stream);

  logger.info(
    { req: { headers: { authorization: 'Bearer secret', cookie: 'sid=1' } } },
    'request received',
  );

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.msg, 'request received');
  assert.equal(typeof entry.time, 'number');
  assert.equal(typeof entry.level, 'number');
  assert.equal(entry.req.headers.authorization, undefined);
  assert.equal(entry.req.headers.cookie, undefined);
});

test('createLogger respects LOG_LEVEL and defaults to info', () => {
  const { lines, stream } = makeCapture();
  const logger = createLogger(stream);

  logger.debug({}, 'should not appear at default info level');
  logger.info({}, 'should appear');

  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).msg, 'should appear');
});

test('createLogger serializes Error objects with message and stack', () => {
  const { lines, stream } = makeCapture();
  const logger = createLogger(stream);

  logger.error({ err: new Error('boom') }, 'something failed');

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.err.message, 'boom');
  assert.equal(typeof entry.err.stack, 'string');
});
