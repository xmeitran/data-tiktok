// Quy tac thu lai. Lan backfill 287 ngay dau tien mat 255 ngay lien tiep chi vi mot loi
// mang tam thoi khong duoc thu lai -- test nay giu cho quy tac do khong bi noi long.
// Khong can DB/mang. Chay: node test-retry.mjs
import assert from 'node:assert/strict';
import { retryable, RETRY_MS } from './src/tiktok.js';

// Loi mang: fetch NEM, nen khong co httpStatus -> phai thu lai.
const netErr = new TypeError('fetch failed');
netErr.cause = { code: 'ECONNRESET' };
assert.equal(retryable(netErr), true, 'loi mang phai duoc thu lai');
assert.equal(retryable(new Error('fetch failed')), true, 'loi khong ro nguon cung thu lai');

const http = (status, apiCode = null) => Object.assign(new Error('x'), { httpStatus: status, apiCode });
assert.equal(retryable(http(500)), true, '5xx la loi tam thoi ben TikTok');
assert.equal(retryable(http(503)), true);
assert.equal(retryable(http(429)), true, 'bi bop toc do thi cho roi thu lai');

// Nhung loi do MINH sai: thu lai bao nhieu lan cung v, chi lam cham them.
assert.equal(retryable(http(400)), false);
assert.equal(retryable(http(401)), false, 'token hong thi phai refresh, khong phai thu lai');
assert.equal(retryable(http(403)), false);
assert.equal(retryable(http(404)), false);
assert.equal(retryable(http(200, 105005)), false, 'thieu scope: phai di cap scope, khong phai thu lai');

// Backoff phai TANG DAN, neu khong thi dap lien tiep vao dung luc TikTok dang qua tai.
assert.ok(RETRY_MS.length >= 3, 'it nhat 3 lan thu lai');
for (let i = 1; i < RETRY_MS.length; i++) {
  assert.ok(RETRY_MS[i] > RETRY_MS[i - 1], `RETRY_MS phai tang dan, thay ${RETRY_MS.join(',')}`);
}

console.log(`test-retry OK — ${RETRY_MS.length} lan thu lai (${RETRY_MS.join('ms, ')}ms)`);
