import { q, beat, reapStale } from './db.js';
import { call, refreshToken } from './tiktok.js';

// "Search CAP Affiliate Orders" v202603 -- dong duy nhat cua package "Read CAP earnings order"
// (2849348). Mot lan goi ra don cua TOAN BO creator thuoc MCN, moi dong co creator_username.
const ORDERS_PATH = '/affiliate_partner/202603/cap_order/search';
const PAGE_SIZE = 100;                       // tran API
const MAX_WINDOW_DAYS = 92;                  // tran API cho khoang create_time

// settle_status: CUSTOMER UNPAID | PENDING | SETTLED | INELIGIBLE | FROZEN
// INELIGIBLE = da tra/hoan/huy, khong co hoa hong.
const INELIGIBLE = 'INELIGIBLE';

// Cac thanh phan hoa hong uoc tinh. cap_order KHONG co truong tong, phai tu cong.
const EST_COMMISSION_PARTS = [
  'estimated_standard_commission',
  'estimated_bonus_commission',
  'estimated_shop_ads_commission',
  'estimated_tap_bonus_commission',
];

const num = (v) => Number(v ?? 0) || 0;
const day = (d) => d.toISOString().slice(0, 10);

// Moi truong tien la {amount: string, currency: string}. Da xac nhan bang du lieu that:
// amount la chuoi so thuan ("91992"), khong ky hieu tien te, khong phan cach nghin.
// Van giu parser phong thu vi: (a) amount VANG MAT o cac truong actual_* khi don chua
// SETTLED/INELIGIBLE, (b) docs cua endpoint creator tung vi du "Rp9.900".
// ponytail: doan dau thap phan bang heuristic "separator cuoi + 1-2 chu so"; market nao dung
// 3 chu so thap phan thi phai doi sang bang currency -> so le chuan.
export function money(m) {
  const obj = m !== null && typeof m === 'object';
  const currency = obj ? m.currency ?? null : null;
  const raw = String((obj ? m.amount : m) ?? '').trim();
  if (!raw) return { value: 0, currency, bad: 0 };   // amount vang mat != loi

  const neg = raw.startsWith('-') || /^\(.*\)$/.test(raw);
  const s = raw.replace(/[^\d.,]/g, '');
  if (!s) return { value: 0, currency, bad: 1 };

  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let intPart = s, frac = '';
  if (last > -1 && /^\d{1,2}$/.test(s.slice(last + 1))) {
    intPart = s.slice(0, last);
    frac = s.slice(last + 1);
  }
  const digits = intPart.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return { value: 0, currency, bad: 1 };

  const value = Number(frac ? `${digits}.${frac}` : digits);
  if (!Number.isFinite(value)) return { value: 0, currency, bad: 1 };
  return { value: neg ? -value : value, currency, bad: 0 };
}

async function partnerToken() {
  const { rows } = await q(
    `select * from authorizations where role='partner' and status='active'
     order by updated_at desc limit 1`);
  const row = rows[0];
  if (!row) throw new Error('chua co uy quyen partner nao');
  if (row.access_expire_at && new Date(row.access_expire_at) > new Date(Date.now() + 5 * 60e3)) {
    return row.access_token;
  }
  // Luu y: refresh chi gia han, KHONG them scope moi duoc duyet sau do -- muon co scope moi
  // thi phai chay lai luong authorize.
  const t = await refreshToken(row.refresh_token);
  await q(
    `update authorizations set access_token=$2, refresh_token=$3,
       access_expire_at=to_timestamp($4), refresh_expire_at=to_timestamp($5), updated_at=now()
     where open_id=$1`,
    [row.open_id, t.access_token, t.refresh_token, t.access_token_expire_in, t.refresh_token_expire_in]);
  return t.access_token;
}

// Trong 21 category asset cua MCN chi DUY NHAT "Creator Management" goi duoc endpoint nay;
// 20 cai con lai tra 16032001 (invalid main_account) hoac 16032015 (permission denied).
// Docs canh bao ten category "may change" nen cho phep ghi de bang env.
async function capCipher() {
  if (process.env.TTS_CAP_CIPHER) return process.env.TTS_CAP_CIPHER;
  const { rows } = await q(
    `select cipher from category_assets where category_name = 'Creator Management' limit 1`);
  if (!rows[0]) {
    throw new Error("khong thay category asset 'Creator Management' -- uy quyen lai, hoac dat TTS_CAP_CIPHER");
  }
  return rows[0].cipher;
}

// Keo het dong SKU-order cua MOT ngay. page_token chi giu vi tri sort, KHONG giu filter,
// nen phai gui lai create_time_ge/lt va page_size o moi trang.
async function fetchDay(accessToken, cipher, from, to) {
  const out = [];
  let page_token = '';
  do {
    const data = await call(ORDERS_PATH, {
      method: 'POST',
      accessToken,
      query: { page_size: PAGE_SIZE, category_asset_cipher: cipher, ...(page_token ? { page_token } : {}) },
      body: { create_time_ge: from, create_time_lt: to },
    });
    out.push(...(data.sku_orders ?? []));
    page_token = data.next_page_token ?? '';
  } while (page_token);
  return out;
}

// Gop dong SKU-order -> metric theo tung creator.
// Tra ve { byCreator: Map<username, metrics>, warnings }.
export function aggregate(rows) {
  const acc = new Map();
  const seen = new Set();
  const currencies = new Set();
  let bad = 0;

  for (const r of rows ?? []) {
    const user = r.creator_username;
    if (!user) continue;

    // Chong lap giua cac trang. page_token la search-after nen hiem khi lap, day chi la luoi an toan.
    const rowKey = `${r.id}|${r.sku_id}|${r.content_id}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);

    let a = acc.get(user);
    if (!a) {
      a = { gmv: 0, refund: 0, items: 0, commission: 0, base: 0,
            orderIds: new Set(), refundOrderIds: new Set(),
            products: new Set(), shops: new Set(),
            videos: new Set(), lives: new Set() };
      acc.set(user, a);
    }

    const price = money(r.price);
    bad += price.bad;
    if (price.currency) currencies.add(price.currency);

    const qty = num(r.quantity);                       // da gom ca hang tra
    const gross = price.value * qty;
    a.gmv += gross;                                    // GMV la GROSS: gom ca don hoan

    // cap_order khong co returned_quantity/refunded_quantity -> chi bat duoc hoan TOAN PHAN.
    const ineligible = String(r.settle_status ?? '').toUpperCase() === INELIGIBLE;
    const refunded = r.fully_return === 'Yes' || ineligible;
    if (refunded) {
      a.refund += gross;
      // settle_status la trang thai cua CA DON, nen INELIGIBLE = ca don bi huy/hoan.
      // fully_return chi la cua mot dong SKU -> khong suy ra ca don bi huy.
      if (ineligible) a.refundOrderIds.add(r.id);
      continue;
    }

    a.orderIds.add(r.id);
    a.items += qty;

    // Cac chieu nay API van tra ve day du (da do: 100% dong co product_id/product_name/
    // shop_name/content_type). content_type = LIVE | VIDEO | SHOP, nen dem duoc so video va
    // so buoi live CO DON ma khong can creator uy quyen.
    if (r.product_id) a.products.add(r.product_id);
    if (r.shop_name) a.shops.add(r.shop_name);
    if (r.content_id) {
      const t = String(r.content_type ?? '').toUpperCase();
      if (t === 'VIDEO') a.videos.add(r.content_id);
      else if (t === 'LIVE') a.lives.add(r.content_id);
    }

    const base = money(r.estimated_commission_base);
    bad += base.bad;
    a.base += base.value;

    for (const k of EST_COMMISSION_PARTS) {
      const c = money(r[k]);
      bad += c.bad;
      if (c.currency) currencies.add(c.currency);
      a.commission += c.value;
    }
  }

  const byCreator = new Map();
  for (const [user, a] of acc) {
    const orders = a.orderIds.size;
    byCreator.set(user, {
      gmv: a.gmv,
      orders,
      items_sold: a.items,
      est_commission: a.commission,
      commission_base: a.base,
      refund_amount: a.refund,
      refund_orders: a.refundOrderIds.size,
      net_gmv: a.gmv - a.refund,
      // AOV phai cung MOT CO SO o tu va mau: gmv gom ca don huy, nen mau so cung
      // phai la TONG don (hop le + huy). Lay gmv/orders se thoi AOV len ~30%.
      aov: (orders + a.refundOrderIds.size) ? a.gmv / (orders + a.refundOrderIds.size) : 0,
      // TikTok dinh nghia: hoa hong = GOC HOA HONG x ty le. Nen mau so la commission_base,
      // khong phai gmv (gmv con gom don huy va ca phan khong tinh hoa hong).
      commission_rate: a.base ? (a.commission / a.base) * 100 : 0,
      refund_rate: a.gmv ? (a.refund / a.gmv) * 100 : 0,
      products_sold: a.products.size,
      shops_sold: a.shops.size,
      videos_with_orders: a.videos.size,
      lives_with_orders: a.lives.size,
      creators_seen: 1,
      creators_active: orders > 0 ? 1 : 0,
    });
  }

  const warnings = [];
  if (bad) warnings.push(`${bad} field tien khong parse duoc (da tinh la 0)`);
  if (currencies.size > 1) warnings.push(`tron nhieu currency: ${[...currencies].join(', ')} -- tong tien khong co y nghia`);

  return { byCreator, warnings };
}

// Luu dong tho. Gop thanh INSERT nhieu VALUES: 1 ngay ~8.8k dong, insert tung dong se
// them 8.8k round-trip/ngay va lam backfill cham gap nhieu lan.
const RAW_CHUNK = 500;

async function writeRaw(dayStr, rows) {
  const dedup = new Map();
  for (const r of rows ?? []) {
    if (!r?.id || !r.creator_username) continue;
    // Cung khoa chinh nhu bang: dong trung giua cac trang chi giu ban cuoi.
    dedup.set(`${r.id}|${r.sku_id ?? ''}|${r.content_id ?? ''}`, r);
  }
  const all = [...dedup.values()];
  let n = 0;

  for (let i = 0; i < all.length; i += RAW_CHUNK) {
    const chunk = all.slice(i, i + RAW_CHUNK);
    const vals = [];
    const params = [];
    for (const r of chunk) {
      const est = EST_COMMISSION_PARTS.reduce((t, k) => t + money(r[k]).value, 0);
      const base = params.length;
      vals.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`);
      params.push(
        r.id, r.sku_id ?? '', r.content_id ?? '', dayStr, r.creator_username,
        r.product_id ?? null, r.product_name ?? null, r.shop_name ?? null,
        r.content_type ?? null, r.settle_status ?? null, r.fully_return ?? null,
        num(r.quantity), money(r.price).value, money(r.price).currency,
        money(r.estimated_commission_base).value, est, num(r.standard_commission_rate));
    }
    await q(
      `insert into sku_orders (order_id, sku_id, content_id, day, creator_username,
         product_id, product_name, shop_name, content_type, settle_status, fully_return,
         quantity, price_amount, currency, commission_base, est_commission, std_rate)
       values ${vals.join(',')}
       on conflict (order_id, sku_id, content_id) do update set
         day = excluded.day, settle_status = excluded.settle_status,
         fully_return = excluded.fully_return, commission_base = excluded.commission_base,
         est_commission = excluded.est_commission, collected_at = now()`,
      params);
    n += chunk.length;
  }
  return n;
}

async function writeDay(dayStr, byCreator) {
  let written = 0;
  for (const [username, metrics] of byCreator) {
    await q(
      `insert into creators (username, first_seen, last_seen) values ($1,$2,$2)
       on conflict (username) do update set
         first_seen = least(creators.first_seen, excluded.first_seen),
         last_seen  = greatest(creators.last_seen, excluded.last_seen),
         updated_at = now()`,
      [username, dayStr]);
    for (const [metric_key, value] of Object.entries(metrics)) {
      await q(
        `insert into metric_values (creator_username, metric_key, period_start, period_end, value)
         values ($1,$2,$3,$3,$4)
         on conflict (creator_username, metric_key, period_start, period_end)
         do update set value = excluded.value, collected_at = now()`,
        [username, metric_key, dayStr, value]);
      written++;
    }
  }
  return written;
}

// Keo tung NGAY mot. Mot ngay ~8.8k dong = ~88 trang; keo ca ky trong 1 lan goi vua cham tran
// 92 ngay vua khong backfill lai duoc tung ngay.
export async function runSync({ days = 7, skipExisting = false } = {}) {
  // Tran 92 ngay cua TikTok la cho MOI REQUEST. Ta goi tung ngay mot (1 ngay/request)
  // nen keo bao nhieu ngay cung duoc; chi can moi request nam trong 1 ngay.

  // Thu don xac cua lan chay truoc truoc khi mo run moi, neu khong dashboard van
  // thay dong 'running' cu va tuong job kia con song.
  await reapStale();
  const run = await q(`insert into sync_runs (heartbeat_at) values (now()) returning id`);
  const runId = run.rows[0].id;
  const errors = [];
  const warnings = [];
  let written = 0;
  let skipped = 0;

  try {
    const token = await partnerToken();
    const cipher = await capCipher();
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);

    for (let i = days; i >= 1; i--) {
      const from = new Date(midnight.getTime() - i * 86400e3);
      const to = new Date(midnight.getTime() - (i - 1) * 86400e3);
      const dayStr = day(from);
      // Backfill dai (vai tram ngay) ma dut giua chung thi chay lai se lam lai tu dau.
      // Bo qua ngay da co du lieu de lan chay sau tiep tuc duoc tu cho dang do.
      if (skipExisting) {
        // Kiem tra bang RAW, khong phai metric_values: ngay da gop nhung chua luu raw
        // van phai keo lai, neu khong thi so lieu theo san pham/video/live bi khuyet ngay do.
        const have = await q(
          `select 1 from sku_orders where day = $1 limit 1`, [dayStr]);
        if (have.rowCount) { skipped++; continue; }
      }
      try {
        const rows = await fetchDay(token, cipher, Math.floor(from / 1000), Math.floor(to / 1000));
        const { byCreator, warnings: w } = aggregate(rows);
        for (const wi of w) warnings.push(`${dayStr}: ${wi}`);
        await writeRaw(dayStr, rows);
        written += await writeDay(dayStr, byCreator);
      } catch (e) {
        // "fetch failed" tran trui khong noi len dieu gi. Loi mang that su nam o e.cause
        // (ECONNRESET, ENOTFOUND...) -- thieu no thi lan sau lai phai doan.
        const why = e.cause?.code ?? e.cause?.message;
        errors.push(`${dayStr}: ${e.message}${why ? ` (${why})` : ''}`);
      }
      // Dap nhip sau MOI ngay, ke ca ngay loi: job van song, chi la ngay do hong.
      await beat(runId);
    }

    if (skipped) warnings.unshift(`bo qua ${skipped} ngay da co du lieu`);
    const note = [...errors, ...warnings].join(' | ') || null;
    await q(`update sync_runs set finished_at=now(), status=$2, rows_written=$3, note=$4 where id=$1`,
      [runId, errors.length ? 'error' : 'ok', written, note]);
  } catch (e) {
    await q(`update sync_runs set finished_at=now(), status='error', note=$2 where id=$1`, [runId, e.message]);
    throw e;
  }
  return { runId, written, skipped, errors, warnings };
}
