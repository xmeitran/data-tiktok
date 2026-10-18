import { q, beat, reapStale, upsertMany } from './db.js';
import { ratios } from './metrics.js';
import { call, refreshToken } from './tiktok.js';

// "Search CAP Affiliate Orders" v202603 -- dong duy nhat cua package "Read CAP earnings order"
// (2849348). Mot lan goi ra don cua TOAN BO creator thuoc MCN, moi dong co creator_username.
const ORDERS_PATH = '/affiliate_partner/202603/cap_order/search';
const PAGE_SIZE = 100;                       // tran API
// Tran 92 ngay cua TikTok la cho MOI REQUEST; ta goi tung ngay mot nen khong bao gio
// cham tran do. Cai can chan la so NGAY bi yeu cau: `days` di thang tu body HTTP vao
// vong lap, moi vong la nhieu lan goi API -- days=100000 se chay mai khong dung.
// ~13 thang du cho moi backfill that (lan dai nhat da chay: 287 ngay).
export const MAX_SYNC_DAYS = 400;

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

// Khoa chinh cua mot dong SKU-order. MOT ham dung cho ca aggregate() va writeRaw():
// truoc day hai ben tu ghep chuoi va lech nhau o dong thieu sku_id (`undefined` vs `''`),
// nen cung mot du lieu bi dedup khac nhau o hai ben.
export const rowKey = (r) => `${r.id}|${r.sku_id ?? ''}|${r.content_id ?? ''}`;

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
    const key = rowKey(r);
    if (seen.has(key)) continue;
    seen.add(key);

    let a = acc.get(user);
    if (!a) {
      a = { gmv: 0, refund: 0, items: 0, netItems: 0, refundedItems: 0,
            commission: 0, netCommission: 0, base: 0, netBase: 0,
            allOrderIds: new Set(), orderIds: new Set(), refundOrderIds: new Set(),
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
    a.allOrderIds.add(r.id);                            // Affiliate Orders = ca don da hoan/huy
    a.items += qty;                                     // TikTok quantity bao gom hang hoan

    // Estimated commission/base cua cap_order la metric gross: docs TikTok van hien
    // estimated commission cho ca refunded orders. Ban net duoc giu rieng ben duoi.
    const base = money(r.estimated_commission_base);
    bad += base.bad;
    a.base += base.value;
    for (const k of EST_COMMISSION_PARTS) {
      const c = money(r[k]);
      bad += c.bad;
      if (c.currency) currencies.add(c.currency);
      a.commission += c.value;
    }

    // cap_order khong co returned_quantity/refunded_quantity -> chi bat duoc hoan TOAN PHAN.
    const ineligible = String(r.settle_status ?? '').toUpperCase() === INELIGIBLE;
    const fullyReturned = String(r.fully_return ?? '').toUpperCase() === 'YES';
    const refunded = fullyReturned || ineligible;
    if (refunded) {
      a.refund += gross;
      a.refundedItems += qty;
      // settle_status la trang thai cua CA DON, nen INELIGIBLE = ca don bi huy/hoan.
      // fully_return chi la cua mot dong SKU -> khong suy ra ca don bi huy.
      if (ineligible) a.refundOrderIds.add(r.id);
      continue;
    }

    a.orderIds.add(r.id);
    a.netItems += qty;

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

    a.netBase += base.value;

    for (const k of EST_COMMISSION_PARTS) {
      const c = money(r[k]);
      a.netCommission += c.value;
    }
  }

  const byCreator = new Map();
  for (const [user, a] of acc) {
    const orders = a.orderIds.size;
    const ordersAll = a.allOrderIds.size;
    // Metric goc. Ba ty le (aov, commission_rate, refund_rate) tinh bang ratios() trong
    // metrics.js -- cung ham ma /api/summary, /api/daily va /api/creators dung, nen
    // khong con duong nao de bon cho lech cong thuc nhau nua.
    const t = {
      gmv: a.gmv,
      orders,
      orders_all: ordersAll,
      items_sold: a.items,
      items_sold_net: a.netItems ?? 0,
      refunded_items: a.refundedItems,
      est_commission: a.commission,
      est_commission_net: a.netCommission,
      commission_base: a.base,
      commission_base_net: a.netBase,
      refund_amount: a.refund,
      refund_orders: a.refundOrderIds.size,
      net_gmv: a.gmv - a.refund,
    };
    byCreator.set(user, {
      ...t,
      ...ratios(t),
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

  // refund_orders va orders co the overlap neu API tra status theo SKU thay vi ca don.
  // AOV da dung orders_all nen khong con dem doi, nhung van phai canh bao vi cac metric
  // order/refund tach rieng se khong con la hai tap roi nhau.
  const overlap = [...acc.values()].reduce(
    (n, a) => n + [...a.refundOrderIds].filter(id => a.orderIds.has(id)).length, 0);
  if (overlap) {
    warnings.push(`${overlap} don co ca dong INELIGIBLE va dong hop le -- settle_status khong con la trang thai cua ca don, orders/refund_orders co overlap`);
  }

  return { byCreator, warnings };
}

const RAW_COLUMNS = [
  'order_id', 'sku_id', 'content_id', 'day', 'creator_username',
  'product_id', 'product_name', 'shop_name', 'content_type', 'settle_status',
  'fully_return', 'quantity', 'price_amount', 'currency', 'commission_base',
  'est_commission', 'std_rate',
];
// Cap nhat MOI truong doi duoc, khong chi mot nua. Truoc day chi dap lai commission_base
// va est_commission ma de nguyen quantity/price_amount/std_rate: don hoan mot phan thanh
// "hoa hong moi + GMV cu" trong cung mot dong, va /api/products lech han /api/creators.
// 3 cot khoa chinh khong nam trong day (dap lai chinh no la vo nghia).
const RAW_UPDATE = RAW_COLUMNS.slice(3);

// Luu dong tho.
async function writeRaw(dayStr, rows) {
  const dedup = new Map();
  for (const r of rows ?? []) {
    if (!r?.id || !r.creator_username) continue;
    // Cung khoa chinh nhu bang: dong trung giua cac trang chi giu ban cuoi.
    dedup.set(rowKey(r), r);
  }
  const values = [...dedup.values()].map(r => [
    r.id, r.sku_id ?? '', r.content_id ?? '', dayStr, r.creator_username,
    r.product_id ?? null, r.product_name ?? null, r.shop_name ?? null,
    r.content_type ?? null, r.settle_status ?? null, r.fully_return ?? null,
    num(r.quantity), money(r.price).value, money(r.price).currency,
    money(r.estimated_commission_base).value,
    EST_COMMISSION_PARTS.reduce((t, k) => t + money(r[k]).value, 0),
    // std_rate: diem co ban, khoang hop le [100, 8000]. Truong VANG MAT phai la null,
    // KHONG phai 0: avg(std_rate) o /api/products gop ca so 0 vao mau so va keo cot
    // "% hoa hong" cua san pham xuong duoi gia tri that.
    r.standard_commission_rate == null ? null : num(r.standard_commission_rate),
  ]);
  return upsertMany('sku_orders', RAW_COLUMNS,
    ['order_id', 'sku_id', 'content_id'], RAW_UPDATE, values);
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
  // Nhung `days` den tu body HTTP: khong chan thi days=100000 chay 100.000 vong goi API.
  const asked = Math.floor(Number(days));
  if (!Number.isFinite(asked) || asked < 1) throw new Error(`days khong hop le: ${days}`);
  days = Math.min(asked, MAX_SYNC_DAYS);

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

    if (asked > days) warnings.unshift(`yeu cau ${asked} ngay, da ha xuong tran ${MAX_SYNC_DAYS}`);
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
