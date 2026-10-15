// Log nguyen 1 response mau tu cap_order/search. Chay: node dump-orders.mjs [so_ngay] > sample.json
import 'dotenv/config';
import { pool, q } from './src/db.js';
import { call } from './src/tiktok.js';

const days = Number(process.argv[2]) || 1;
const to = Math.floor(Date.now() / 1000);
const from = to - days * 86400;

const { rows: [a] } = await q(
  `select access_token from authorizations where role='partner' and status='active'
   order by updated_at desc limit 1`);
if (!a) { console.error('Chua co uy quyen partner.'); process.exit(1); }

// Chi cipher cua "Creator Management" goi duoc endpoint nay.
const cipher = process.env.TTS_CAP_CIPHER ?? (await q(
  `select cipher from category_assets where category_name='Creator Management' limit 1`)).rows[0]?.cipher;
if (!cipher) { console.error("Khong thay cipher 'Creator Management'."); process.exit(1); }

const data = await call('/affiliate_partner/202603/cap_order/search', {
  method: 'POST',
  accessToken: a.access_token,
  query: { page_size: 10, category_asset_cipher: cipher },
  body: { create_time_ge: from, create_time_lt: to },
});

console.error(`${data.sku_orders?.length ?? 0} dong tra ve, total_count=${data.total_count}`);
console.log(JSON.stringify(data, null, 2));
await pool.end();
