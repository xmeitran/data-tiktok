import crypto from 'node:crypto';

// TikTok gọi callback bằng server-to-server, không gửi được header Authorization.
// Đường dẫn này BẮT BUỘC để công khai, nếu không creator không uỷ quyền được.
export const PUBLIC_PATHS = new Set(['/api/tiktok/callback']);

// Hash trước rồi mới so: timingSafeEqual đòi hai buffer dài bằng nhau,
// và hash giấu luôn độ dài của giá trị thật.
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function parseBasic(header = '') {
  const [scheme, b64] = String(header).split(' ');
  if (scheme !== 'Basic' || !b64) return null;
  const raw = Buffer.from(b64, 'base64').toString('utf8');
  const i = raw.indexOf(':');                       // mật khẩu được phép chứa ':'
  return i < 0 ? null : { user: raw.slice(0, i), pass: raw.slice(i + 1) };
}

export function basicAuth({ user, pass, publicPaths = PUBLIC_PATHS } = {}) {
  // Fail closed: thiếu cấu hình thì không chạy, thay vì lặng lẽ mở toang dashboard.
  if (!user || !pass) {
    throw new Error('Thiếu DASHBOARD_USER / DASHBOARD_PASSWORD — xem .env.example');
  }
  return (req, res, next) => {
    if (publicPaths.has(req.path)) return next();
    const got = parseBasic(req.headers.authorization);
    // So cả hai vế rồi mới AND: không short-circuit để khỏi lộ "sai user hay sai pass" qua timing.
    if (got && (same(got.user, user) & same(got.pass, pass))) return next();
    res.set('WWW-Authenticate', 'Basic realm="TikTok Partner Metrics", charset="UTF-8"');
    res.status(401).send('Cần đăng nhập.');
  };
}
