// Kiểm tra lớp đăng nhập. Chạy: node test-auth.mjs
import assert from 'node:assert/strict';
import { basicAuth } from './src/auth.js';

const mw = basicAuth({ user: 'upbase', pass: 'mật:khẩu-có-dấu' });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function run(path, authorization) {
  const res = { code: 0, headers: {}, set(k, v) { this.headers[k] = v; return this; },
                status(c) { this.code = c; return this; }, send() { return this; } };
  let passed = false;
  mw({ path, headers: { authorization } }, res, () => { passed = true; });
  return { passed, res };
}

// Đúng mật khẩu thì qua; mật khẩu chứa ':' không bị cắt nhầm.
assert.equal(run('/', `Basic ${b64('upbase:mật:khẩu-có-dấu')}`).passed, true);

// Mọi kiểu sai đều bị chặn, kèm header để trình duyệt bật hộp đăng nhập.
for (const [name, header] of [
  ['không có header', undefined],
  ['sai mật khẩu', `Basic ${b64('upbase:sai')}`],
  ['sai user', `Basic ${b64('khach:mật:khẩu-có-dấu')}`],
  ['thiếu dấu hai chấm', `Basic ${b64('upbase')}`],
  ['sai scheme', `Bearer ${b64('upbase:mật:khẩu-có-dấu')}`],
]) {
  const { passed, res } = run('/', header);
  assert.equal(passed, false, `phải chặn: ${name}`);
  assert.equal(res.code, 401, `phải trả 401: ${name}`);
  assert.match(res.headers['WWW-Authenticate'], /^Basic realm=/, `thiếu WWW-Authenticate: ${name}`);
}

// Callback OAuth phải công khai, TikTok không gửi được Authorization.
assert.equal(run('/api/tiktok/callback', undefined).passed, true, 'callback phải để công khai');
assert.equal(run('/api/summary', undefined).passed, false, 'API số liệu phải được bảo vệ');

// Thiếu cấu hình thì chết ngay lúc khởi động, không chạy ở chế độ mở.
assert.throws(() => basicAuth({ user: 'x' }), /DASHBOARD_USER|DASHBOARD_PASSWORD/);
assert.throws(() => basicAuth({}), /DASHBOARD_USER|DASHBOARD_PASSWORD/);

console.log('auth OK');
