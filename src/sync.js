import { q } from './db.js';
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
      a = { gmv: 0, refund: 0, items: 0, commission: 0, base: 0, orderIds: new Set() };
      acc.set(user, a);
    }

    const price = money(r.price);
    bad += price.bad;
    if (price.currency) currencies.add(price.currency);

    const qty = num(r.quantity);                       // da gom ca hang tra
    const gross = price.value * qty;
    a.gmv += gross;                                    // GMV la GROSS: gom ca don hoan

    // cap_order khong co returned_quantity/refunded_quantity -> chi bat duoc hoan TOAN PHAN.
    const refunded = r.fully_return === 'Yes' || String(r.settle_status ?? '').toUpperCase() === INELIGIBLE;
    if (refunded) { a.refund += gross; continue; }

    a.orderIds.add(r.id);
    a.items += qty;

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
      net_gmv: a.gmv - a.refund,
      aov: orders ? a.gmv / orders : 0,
      commission_rate: a.gmv ? (a.commission / a.gmv) * 100 : 0,
      refund_rate: a.gmv ? (a.refund / a.gmv) * 100 : 0,
      creators_seen: 1,
      creators_active: orders > 0 ? 1 : 0,
    });
  }

  const warnings = [];
  if (bad) warnings.push(`${bad} field tien khong parse duoc (da tinh la 0)`);
  if (currencies.size > 1) warnings.push(`tron nhieu currency: ${[...currencies].join(', ')} -- tong tien khong co y nghia`);

  return { byCreator, warnings };
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
export async function runSync({ days = 7 } = {}) {
  if (days > MAX_WINDOW_DAYS) throw new Error(`API chi cho toi da ${MAX_WINDOW_DAYS} ngay`);

  const run = await q(`insert into sync_runs default values returning id`);
  const runId = run.rows[0].id;
  const errors = [];
  const warnings = [];
  let written = 0;

  try {
    const token = await partnerToken();
    const cipher = await capCipher();
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);

    for (let i = days; i >= 1; i--) {
      const from = new Date(midnight.getTime() - i * 86400e3);
      const to = new Date(midnight.getTime() - (i - 1) * 86400e3);
      const dayStr = day(from);
      try {
        const rows = await fetchDay(token, cipher, Math.floor(from / 1000), Math.floor(to / 1000));
        const { byCreator, warnings: w } = aggregate(rows);
        for (const wi of w) warnings.push(`${dayStr}: ${wi}`);
        written += await writeDay(dayStr, byCreator);
      } catch (e) { errors.push(`${dayStr}: ${e.message}`); }
    }

    const note = [...errors, ...warnings].join(' | ') || null;
    await q(`update sync_runs set finished_at=now(), status=$2, rows_written=$3, note=$4 where id=$1`,
      [runId, errors.length ? 'error' : 'ok', written, note]);
  } catch (e) {
    await q(`update sync_runs set finished_at=now(), status='error', note=$2 where id=$1`, [runId, e.message]);
    throw e;
  }
  return { runId, written, errors, warnings };
}
