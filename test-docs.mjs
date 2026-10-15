// Doi chieu mo ta trong src/tiktok-fields.js voi tai lieu TikTok dang LIVE.
// Bat duoc ca hai huong: ta go lech, hoac TikTok sua doc.
// CAN MANG. Chay: node test-docs.mjs
import assert from 'node:assert/strict';
import { FIELDS, REQUEST, API, CREATOR_API, CREATOR_FIELDS } from './src/tiktok-fields.js';

const clean = (s) => String(s ?? '').replace(/​/g, '').trim();
const meta = async (id) => {
  const r = await fetch(
    `https://partner.tiktokshop.com/api/v1/document/api_meta?src_document_id=${id}&aid=359713&locale=en-US`
  ).then(x => x.json());
  const m = r?.data?.document_api_meta;
  assert.ok(m, `khong lay duoc api_meta cua ${id}`);
  return m;
};

const cap = await meta('search-cap-affiliate-orders-202603');
const live = new Map();
for (const p of cap.response_param ?? []) live.set(p.name.replace(/\^/g, ''), clean(p.desc));
for (const p of cap.request_query_param ?? []) live.set(`q:${p.name}`, clean(p.desc));
for (const p of cap.request_body_param ?? []) live.set(`b:${p.name}`, clean(p.desc));

let checked = 0;
const same = (label, mine, theirs) => {
  assert.ok(theirs !== undefined, `${label}: khong con trong docs TikTok`);
  assert.equal(clean(mine), theirs, `${label}: LECH so voi docs TikTok`);
  checked++;
};

for (const [key, v] of Object.entries(FIELDS)) {
  const leaf = key.includes('.') ? key.split('.').pop() : key;
  // `amount` lap lai o hang chuc truong tien voi noi dung khac nhau -> khong doi chieu theo ten la duoc
  if (leaf === 'amount') continue;
  same(`FIELDS.${key}`, v.en, live.get(leaf));
  assert.ok(v.vi?.length > 10, `FIELDS.${key}: thieu ban dich tieng Viet`);
}
same('REQUEST.page_size', REQUEST.page_size.en, live.get('q:page_size'));
same('REQUEST.page_token', REQUEST.page_token.en, live.get('q:page_token'));
same('REQUEST.create_time_ge', REQUEST.create_time_ge.en, live.get('b:create_time_ge'));
same('REQUEST.create_time_lt', REQUEST.create_time_lt.en, live.get('b:create_time_lt'));
same('API.cap_order_search', API.cap_order_search.en, clean(cap.env_desc));

assert.equal(API.cap_order_search.path, cap.interface_path, 'duong dan endpoint da doi');
assert.equal(API.cap_order_search.scope.key, (cap.scope_list ?? [])[0]?.scope_key, 'scope da doi');

const ca = await meta('get-authorized-category-assets-202405');
assert.equal(API.category_assets.path, ca.interface_path, 'duong dan category_assets da doi');

// --- Nhom Affiliate CREATOR. Trong cung mot doc co hang loat truong trung ten la
// (`id`, `status`, `rate`, `currency`) nen KHONG the doi chieu theo ten la nhu cap_order:
// phai dung duong dan day du. Do sau nam o so dau `^` trong ten truong cua api_meta.
function paths(params, drop = 1) {
  const out = new Map();
  const stack = [];
  for (const p of params ?? []) {
    const d = (p.name.match(/^\^*/)[0] || '').length;
    stack.length = d;
    stack[d] = p.name.replace(/^\^*/, '');
    const path = stack.slice(drop, d + 1).join('.');   // response: bo lop `data`; body: lay tu goc
    if (path) out.set(path, clean(p.desc));
  }
  return out;
}

for (const [key, api] of Object.entries(CREATOR_API)) {
  const m = await meta(api.docId);
  assert.equal(api.path, m.interface_path, `${key}: duong dan endpoint da doi`);
  assert.equal(api.scope.key, (m.scope_list ?? [])[0]?.scope_key, `${key}: scope da doi`);
  // api_meta ma hoa method bang so: 1 = POST, 2 = GET. Goi sai method thi ky bi lech
  // (chu ky tinh ca body) nen phai bat o day.
  assert.equal(api.method, m.method === 1 ? 'POST' : 'GET', `${key}: HTTP method da doi`);
  same(`CREATOR_API.${key}`, api.en, clean(m.env_desc));
  same(`CREATOR_API.${key}.scope`, api.scope.en, clean((m.scope_list ?? [])[0]?.package_description));

  const live = new Map([
    ...paths(m.response_param),
    ...(m.request_query_param ?? []).map(p => [`q:${p.name.replace(/^\^*/, '')}`, clean(p.desc)]),
    ...[...paths(m.request_body_param, 0)].map(([k, v]) => [`b:${k}`, v]),
  ]);
  for (const [f, v] of Object.entries(CREATOR_FIELDS[key])) {
    same(`CREATOR_FIELDS.${key}.${f}`, v.en, live.get(f));
    assert.ok(v.vi?.length > 10, `CREATOR_FIELDS.${key}.${f}: thieu ban dich tieng Viet`);
  }
}

console.log(`docs OK — ${checked} mo ta khop NGUYEN VAN voi tai lieu TikTok dang live`);
