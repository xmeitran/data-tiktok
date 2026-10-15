import crypto from 'node:crypto';

const KEY  = () => process.env.TTS_APP_KEY;
const SEC  = () => process.env.TTS_APP_SECRET;
const API  = () => process.env.TTS_API_HOST  || 'https://open-api.tiktokglobalshop.com';
const AUTH = () => process.env.TTS_AUTH_HOST || 'https://auth.tiktok-shops.com';

// Partner: can .info de lay category asset cipher, .cap_orders.read de goi cap_order/search.
export const PARTNER_INFO_SCOPE = 'partner.authorization.info';
export const PARTNER_ORDERS_SCOPE = 'partner.cap_orders.read';

// Chu ky TikTok Shop OpenAPI v2:
// secret + path + (key+value cac query da sort, bo sign/access_token) + body + secret -> HMAC-SHA256 hex
export function sign(path, query, body, secret) {
  const base = Object.keys(query)
    .filter(k => k !== 'sign' && k !== 'access_token')
    .sort()
    .map(k => k + query[k])
    .join('');
  const payload = secret + path + base + (body ?? '') + secret;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function call(path, { method = 'GET', query = {}, body, accessToken, shopCipher } = {}) {
  const q = { app_key: KEY(), timestamp: Math.floor(Date.now() / 1000), ...query };
  if (shopCipher) q.shop_cipher = shopCipher;
  const payload = body ? JSON.stringify(body) : undefined;
  q.sign = sign(path, q, payload, SEC());

  const res = await fetch(`${API()}${path}?${new URLSearchParams(q)}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken },
    body: payload,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code) {
    // 105005 = thieu scope: kiem tra ca scope cua app lan granted_scopes cua token.
    throw new Error(`TikTok ${path} -> ${json.code ?? res.status}: ${json.message ?? res.statusText}`);
  }
  return json.data ?? json;
}

async function tokenCall(path, params) {
  const res = await fetch(`${AUTH()}/api/v2/token/${path}?${new URLSearchParams(params)}`);
  const json = await res.json();
  if (json.code) throw new Error(`token ${path} -> ${json.code}: ${json.message}`);
  return json.data;
}

export const exchangeCode = (auth_code) => tokenCall('get', {
  app_key: KEY(), app_secret: SEC(), auth_code, grant_type: 'authorized_code',
});

export const refreshToken = (refresh_token) => tokenCall('refresh', {
  app_key: KEY(), app_secret: SEC(), refresh_token, grant_type: 'refresh_token',
});

// Token partner. Docs KHONG noi user_type cua partner la gi nen khong kiem user_type.
// Khong hard-fail khi thieu cap_orders: van cho uy quyen xong de con lay duoc cipher,
// roi bao chinh xac scope nao da duoc cap -- do moi la thu can nhin thay.
export function assertPartnerToken(t) {
  const granted = t.granted_scopes ?? [];
  if (granted.length && !granted.some(s => s.startsWith('partner.'))) {
    throw new Error(`token khong co scope partner nao (da cap: ${granted.join(', ')})`);
  }
  return t;
}

// Lay category asset cipher -- tham so bat buoc cua moi Affiliate Partner API.
export const getCategoryAssets = (accessToken) =>
  call('/authorization/202405/category_assets', { accessToken });

// Link uy quyen PARTNER (MCN/CAP/TAP). Ba luong dung ba host khac han nhau:
//   partner: partner.tiktokshop.com/open/authorize?service_id=   (US: partner.us.)
//   creator: shop.tiktok.com/alliance/creator/auth?app_key=      (state BAT BUOC)
//   seller : services.tiktokshop.com/open/authorize?service_id=
// Voi partner, docs noi `state` duoc khuyen khich chu khong bat buoc -- nen link
// copy tu Partner Center (khong co state) van dung duoc.
export function authorizeUrl(state = '') {
  const host = process.env.TTS_PARTNER_AUTH_HOST || 'https://partner.tiktokshop.com';
  const id = process.env.TTS_SERVICE_ID;
  if (!id) throw new Error('thieu TTS_SERVICE_ID');
  const q = new URLSearchParams({ service_id: id, ...(state ? { state } : {}) });
  return `${host}/open/authorize?${q}`;
}

// Link uy quyen CREATOR. Host + ten tham so khac han luong partner, va `state` la BAT BUOC
// (partner thi tuy chon) -- bo state di thi TikTok tra loi ngay o trang authorize.
// Da xac minh thuc nghiem: khong the dung link partner cho creator hay nguoc lai.
export function creatorAuthorizeUrl(state) {
  if (!state) throw new Error('luong creator BAT BUOC co state');
  if (!KEY()) throw new Error('thieu TTS_APP_KEY');
  const host = process.env.TTS_CREATOR_AUTH_HOST || 'https://shop.tiktok.com';
  return `${host}/alliance/creator/auth?${new URLSearchParams({ app_key: KEY(), state })}`;
}

// Token tra ve user_type: 1 = creator, 3 = partner (do thuc nghiem, docs khong ghi).
// Dung de biet callback nao la creator ma khong phai doan theo state.
export const CREATOR_USER_TYPE = '1';
export const isCreatorToken = (t) => String(t?.user_type ?? '') === CREATOR_USER_TYPE;
