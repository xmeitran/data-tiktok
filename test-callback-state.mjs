// `state` chỉ được TIÊU khi uỷ quyền thật sự hoàn tất.
// Chạy: node test-callback-state.mjs   (cần DATABASE_URL; không cần mạng ra ngoài)
//
// Đây là lỗi THỨ TỰ, không phải lỗi SQL — nên không kiểm được bằng cách chép lại câu SQL
// như test-creator.mjs làm. Phải chạy server thật và cho bước đổi token thất bại:
// trước đây callback xoá state TRƯỚC khi gọi TikTok, nên một lỗi mạng nhất thời ở
// /token/get là link creator (đã gửi cho người khác) chết hẳn, phải sinh lại và gửi lại.
//
// Stub thay cho auth.tiktok-shops.com: lần gọi đầu TRẢ LỖI, lần sau trả token creator.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { q, pool } from './src/db.js';

const OPEN_ID = '__test_callback_state__';
const PORT = 3987;
const STUB_PORT = 3988;
let calls = 0;

const stub = http.createServer((req, res) => {
  calls++;
  res.setHeader('content-type', 'application/json');
  // Lần 1: lỗi tạm thời. tokenCall() throw khi json.code khác 0.
  if (calls === 1) return res.end(JSON.stringify({ code: 50002, message: 'stub: loi tam thoi' }));
  res.end(JSON.stringify({ code: 0, data: {
    open_id: OPEN_ID,
    user_type: '1',                       // 1 = creator
    seller_name: 'stub-creator',
    seller_base_region: 'VN',
    access_token: 'stub-access',
    refresh_token: 'stub-refresh',
    access_token_expire_in: Math.floor(Date.now() / 1000) + 86400,
    refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400 * 30,
    granted_scopes: ['creator.affiliate_sample.read'],
  } }));
});

const srv = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), TTS_AUTH_HOST: `http://127.0.0.1:${STUB_PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });

const base = `http://127.0.0.1:${PORT}`;
const auth = 'Basic ' + Buffer.from(
  `${process.env.DASHBOARD_USER}:${process.env.DASHBOARD_PASSWORD}`).toString('base64');
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(base + '/api/tiktok/callback'); return true; } catch { }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
};
const stateRows = (st) => q(`select state from auth_states where state = $1`, [st]);

try {
  await new Promise(r => stub.listen(STUB_PORT, '127.0.0.1', r));
  assert.ok(await up(), `server khong khoi dong duoc:\n${srvLog}`);

  // Lấy link uỷ quyền creator -> sinh state thật, lưu vào auth_states.
  const link = await fetch(`${base}/api/authorize-url?role=creator&label=test`,
    { headers: { authorization: auth } }).then(r => r.json());
  assert.ok(link.state, `khong lay duoc state: ${JSON.stringify(link)}`);
  const st = link.state;
  assert.equal((await stateRows(st)).rowCount, 1, 'state phai duoc luu xuong DB');

  // --- Lần 1: đổi token THẤT BẠI -----------------------------------------
  const r1 = await fetch(`${base}/api/tiktok/callback?code=stub-code&state=${st}`);
  assert.equal(r1.status, 502, 'doi token that bai phai tra 502');
  assert.equal(calls, 1, 'phai da goi den auth host');
  // Đây là cả bài test: state còn nguyên, link vẫn dùng được.
  assert.equal((await stateRows(st)).rowCount, 1,
    'LOI CU: state bi xoa truoc khi doi token -> link creator chet vi mot loi tam thoi');

  // --- Lần 2: thử lại cùng link đó -> phải thành công --------------------
  const r2 = await fetch(`${base}/api/tiktok/callback?code=stub-code&state=${st}`);
  const body2 = await r2.text();
  assert.equal(r2.status, 200, `thu lai phai thanh cong, nhan: ${body2}`);
  assert.match(body2, /Uy quyen CREATOR thanh cong/);
  assert.equal((await q(
    `select count(*)::int n from authorizations where open_id = $1 and role = 'creator'`,
    [OPEN_ID])).rows[0].n, 1, 'phai luu uy quyen creator');

  // --- Và chỉ sau khi thành công, state mới bị tiêu ----------------------
  assert.equal((await stateRows(st)).rowCount, 0, 'uy quyen xong thi state phai bi tieu');

  // --- Lần 3: dùng lại state đã tiêu -> từ chối (vẫn là one-time) -------
  const r3 = await fetch(`${base}/api/tiktok/callback?code=stub-code&state=${st}`);
  assert.equal(r3.status, 400, 'state da dung roi phai bi tu choi');
  assert.match(await r3.text(), /state khong hop le/);

  // --- Callback creator KHÔNG kèm state vẫn phải bị từ chối ------------
  const r4 = await fetch(`${base}/api/tiktok/callback?code=stub-code`);
  assert.equal(r4.status, 400, 'luong creator bat buoc co state');

  console.log('test-callback-state OK — 11 phep kiem: state chi chay khi uy quyen xong, va chi mot lan');
} finally {
  await q(`delete from authorizations where open_id = $1`, [OPEN_ID]);
  await q(`delete from auth_states where label = 'test'`);
  await pool.end();
  srv.kill('SIGKILL');
  await new Promise(r => stub.close(r));
}
