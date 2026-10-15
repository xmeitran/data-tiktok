// Doi chieu aggregate() cua pipeline voi mot CAI DAT DOC LAP viet lai tu tai lieu TikTok,
// tren DU LIEU THAT (1 trang = 100 dong SKU-order, ~1 luot goi API).
//
// Vi sao can: test-aggregate.mjs chay tren payload tu che, nen no chi chung minh code lam
// dung cai no duoc viet de lam. Bai nay bat loai loi khac: hieu SAI tai lieu TikTok.
// Dung no da bat duoc 2 cong thuc tron co so (aov, commission_rate).
//
// CAN MANG + .env + da uy quyen partner. Chay: npm run test:live
import 'dotenv/config';
import assert from 'node:assert/strict';
import { q, pool } from './src/db.js';
import { call } from './src/tiktok.js';
import { aggregate } from './src/sync.js';

const { rows: [a] } = await q(
  "select access_token from authorizations where role='partner' and status='active' order by updated_at desc limit 1");
const { rows: [c] } = await q("select cipher from category_assets where category_name='Creator Management'");
const from = Math.floor(Date.UTC(2026, 9, 13) / 1000), to = Math.floor(Date.UTC(2026, 9, 14) / 1000);
const d = await call('/affiliate_partner/202603/cap_order/search', {
  method: 'POST', accessToken: a.access_token,
  query: { page_size: 100, category_asset_cipher: c.cipher },
  body: { create_time_ge: from, create_time_lt: to },
});
const rows = d.sku_orders ?? [];
console.log(`lay ${rows.length} dong SKU-order that (ngay 2026-10-13)\n`);

// --- cai dat doc lap ---
const money = (m) => Number(String(m?.amount ?? '').replace(/[^0-9.-]/g, '')) || 0;
const PARTS = ['estimated_standard_commission', 'estimated_bonus_commission',
               'estimated_shop_ads_commission', 'estimated_tap_bonus_commission'];
const ind = new Map();
for (const r of rows) {
  const u = r.creator_username;
  if (!ind.has(u)) ind.set(u, { gmv: 0, refund: 0, items: 0, hh: 0, base: 0, ok: new Set(), bad: new Set() });
  const x = ind.get(u);
  const gross = money(r.price) * (r.quantity || 0);
  x.gmv += gross;
  const ineligible = r.settle_status === 'INELIGIBLE';
  if (ineligible || r.fully_return === 'Yes') {
    x.refund += gross;
    if (ineligible) x.bad.add(r.id);
    continue;
  }
  x.ok.add(r.id);
  x.items += (r.quantity || 0);
  x.base += money(r.estimated_commission_base);
  for (const k of PARTS) x.hh += money(r[k]);
}

const { byCreator } = aggregate(rows);
let checked = 0;
const near = (x, y) => Math.abs(x - y) < 0.5;
for (const [u, x] of ind) {
  const p = byCreator.get(u);
  assert.ok(p, `${u}: pipeline bo sot creator`);
  assert.ok(near(p.gmv, x.gmv), `${u}: gmv ${p.gmv} vs ${x.gmv}`);
  assert.ok(near(p.refund_amount, x.refund), `${u}: refund_amount`);
  assert.ok(near(p.net_gmv, x.gmv - x.refund), `${u}: net_gmv`);
  assert.equal(p.orders, x.ok.size, `${u}: orders`);
  assert.equal(p.refund_orders, x.bad.size, `${u}: refund_orders`);
  assert.equal(p.items_sold, x.items, `${u}: items_sold`);
  assert.ok(near(p.est_commission, x.hh), `${u}: est_commission`);
  assert.ok(near(p.commission_base, x.base), `${u}: commission_base`);
  const tong = x.ok.size + x.bad.size;
  assert.ok(near(p.aov, tong ? x.gmv / tong : 0), `${u}: aov`);
  assert.ok(near(p.commission_rate, x.base ? x.hh / x.base * 100 : 0), `${u}: commission_rate`);
  assert.ok(near(p.refund_rate, x.gmv ? x.refund / x.gmv * 100 : 0), `${u}: refund_rate`);
  checked++;
}
assert.equal(byCreator.size, ind.size, 'so creator khop');
console.log(`OK — ${checked} creator, 11 metric moi creator khop voi cai dat doc lap`);
await pool.end();
