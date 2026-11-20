'use strict';
const fs = require('node:fs');
const {createHash} = require('node:crypto');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// The caller records the user's intended book and scans before selecting any entry.
function readRequestedScope(file) {
  if (!file) fail('WORK_REQUEST_REQUIRED');
  const bytes = fs.readFileSync(file);
  let request;
  try {
    request = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('INVALID_WORK_REQUEST_JSON');
  }
  if (request?.schema !== 'reader-work-request-v1' ||
      typeof request.bookId !== 'string' || !/^[a-z0-9-]{3,150}$/.test(request.bookId)) {
    fail('INVALID_WORK_REQUEST');
  }
  const scans = request.scanRange;
  if (!Array.isArray(scans) || scans.length !== 2 ||
      !scans.every(Number.isSafeInteger) || scans[0] < 1 || scans[1] < scans[0]) {
    fail('INVALID_REQUESTED_SCAN_RANGE');
  }
  return {bookId: request.bookId, scanRange: scans, sha256: createHash('sha256').update(bytes).digest('hex')};
}

function matchRequestedScope(request, bookId, range) {
  if (request.bookId !== bookId) fail('REQUESTED_BOOK_MISMATCH');
  if (!Array.isArray(range) || range.length !== 2 ||
      range[0] !== request.scanRange[0] || range[1] !== request.scanRange[1]) {
    fail('REQUESTED_SCAN_RANGE_MISMATCH');
  }
}
module.exports = {readRequestedScope, matchRequestedScope};
