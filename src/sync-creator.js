// Sync nhung thu CHI token creator lay duoc. Token partner (cap_order/search) da co moi
// thu DA phat sinh don; day la phan CHUA ra don: hang mau dang xin, san pham treo
// showcase, chien dich dang tham gia. Doc ky: notes creator-scopes-va-product-data.md
//
// Khac sync.js o mot diem co ban: cap_order co create_time nen chia theo NGAY duoc,
// con 3 endpoint duoi KHONG co thoi diem tao -> moi lan chay la mot ANH CHUP (snapshot_day).
// Vi vay dung goi runCreatorSync nhieu lan trong ngay roi coi la chuoi thoi gian.
import { q, beat, reapStale } from './db.js';
import { call, refreshToken } from './tiktok.js';
import { CREATOR_API } from './tiktok-fields.js';

const P = Object.fromEntries(Object.entries(CREATOR_API).map(([k, v]) => [k, v.path]));

// Tran page_size KHAC NHAU tung endpoint, doc tung cai mot chu dung lay 100 cho tat ca:
// sample_applications toi da 50, showcases/products toi da 20, target_collaborations 100.
const PAGE = { sample_applications: 50, showcase_products: 20, target_collaborations: 100 };

const day = (d) => d.toISOString().slice(0, 10);
const ts = (s) => (Number(s) ? new Date(Number(s) * 1000) : null);
const num = (v) => (Number(v ?? 0) || 0);

// ponytail: lap lai logic refresh cua partnerToken() trong sync.js (~8 dong). Khong goi
// chung vi sync.js dang chay backfill dai, khong muon sua file do. Gop lai khi sua sync.js.
async function fresh(row) {
  if (row.access_expire_at && new Date(row.access_expire_at) > new Date(Date.now() + 5 * 60e3)) {
    return row.access_token;
  }
  const t = await refreshToken(row.refresh_token);
  await q(
    `update authorizations set access_token=$2, refresh_token=$3,
       access_expire_at=to_timestamp($4), refresh_expire_at=to_timestamp($5), updated_at=now()
     where open_id=$1`,
    [row.open_id, t.access_token, t.refresh_token, t.access_token_expire_in, t.refresh_token_expire_in]);
  return t.access_token;
}

export async function creatorAuths() {
  const { rows } = await q(
    `select * from authorizations where role='creator' and status='active' order by updated_at`);
  return rows;
}

// --- Goi API ---------------------------------------------------------------

// next_page_token cua nhom creator KHONG giong cap_order: o day trang cuoi tra ve
// CHUOI RONG chu khong phai bo han truong di -- nen phai coi ca hai la het trang.
async function pages(path, { accessToken, key, query = {}, body }) {
  const out = [];
  let page_token = '';
  do {
    const data = await call(path, {
      method: body === undefined ? 'GET' : 'POST',
      accessToken,
      query: { ...query, ...(page_token ? { page_token } : {}) },
      body,
    });
    out.push(...(data[key] ?? []));
    page_token = data.next_page_token || '';
  } while (page_token);
  return out;
}

export const fetchProfile = (accessToken) => call(P.creator_profile, { accessToken });

export const fetchSamples = (accessToken) =>
  pages(P.sample_applications, {
    accessToken, key: 'sample_applications',
    query: { page_size: PAGE.sample_applications },
    // body rong = moi trang thai. Loc theo application_statuses thi phai gui lai y nguyen
    // o moi trang, de sai la trang sau tra ve tap khac.
    body: {},
  });

// `origin` BAT BUOC. SHOWCASE = san pham trong showcase; LIVE chi co nghia khi creator
// dang live, nen chi chup SHOWCASE.
export const fetchShowcase = (accessToken, origin = 'SHOWCASE') =>
  pages(P.showcase_products, {
    accessToken, key: 'products',
    query: { page_size: PAGE.showcase_products, origin },
  });

// shop_id BAT BUOC ma khong endpoint nao dang dung tra ve shop_id -> nap tu env.
export const shopIds = () =>
  (process.env.TTS_SHOP_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

export const fetchCollaborations = (accessToken, shop_id) =>
  pages(P.target_collaborations, {
    accessToken, key: 'target_collaborations',
    query: { page_size: PAGE.target_collaborations },
    body: { shop_id },
  });

// --- Gop -> metric ---------------------------------------------------------

// Pure function: test duoc khong can DB lan mang. Nhan dung cac mang tho API tra ve.
export function aggregateCreator({ samples = [], showcase = [], collaborations = [] } = {}) {
  const collabIds = new Set();
  for (const c of collaborations) if (c?.id) collabIds.add(c.id);
  return {
    sample_requests: samples.length,
    // "Da xong" = creator da dang noi dung va yeu cau dong lai. Cac trang thai huy
    // (REJECT_CANCELLED, OVERDUE_CANCELLED, ...) khong tinh.
    samples_completed: samples.filter(s => String(s?.status ?? '').toUpperCase() === 'COMPLETED').length,
    showcase_products: new Set(showcase.map(p => p?.id).filter(Boolean)).size,
    target_collaborations: collabIds.size,
  };
}

// --- Ghi DB ----------------------------------------------------------------

async function writeProfile(openId, p) {
  await q(
    `insert into creator_profiles (creator_open_id, username, selection_region, register_region,
       seller_type, user_type, permissions, avatar_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (creator_open_id) do update set
       username=excluded.username, selection_region=excluded.selection_region,
       register_region=excluded.register_region, seller_type=excluded.seller_type,
       user_type=excluded.user_type, permissions=excluded.permissions,
       avatar_url=excluded.avatar_url, collected_at=now()`,
    [p.creator_user_open_id ?? openId, p.username ?? null, p.selection_region ?? null,
     p.register_region ?? null, p.seller_type ?? null, p.user_type ?? null,
     p.permissions ?? null, p.avatar?.url ?? null]);
  return p.username ?? null;
}

async function writeSamples(openId, username, dayStr, rows) {
  for (const s of rows) {
    if (!s?.id) continue;
    await q(
      `insert into sample_applications (application_id, snapshot_day, creator_open_id,
         creator_username, status, product_id, sku_id, main_order_id, activity_id,
         fulfillment_status, fulfillment_expire_at, bound_product_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (application_id, snapshot_day) do update set
         status=excluded.status, fulfillment_status=excluded.fulfillment_status,
         bound_product_status=excluded.bound_product_status,
         main_order_id=excluded.main_order_id, collected_at=now()`,
      [s.id, dayStr, openId, username, s.status ?? null,
       s.sample_product?.id ?? null, s.sample_product?.sku_id ?? null,
       s.main_order_id ?? null, s.activity_id ?? null,
       s.creator_fulfillment?.status ?? null, ts(s.creator_fulfillment?.expiration_time),
       s.creator_fulfillment?.bound_product_status ?? null]);
  }
  return rows.length;
}

async function writeShowcase(openId, username, dayStr, origin, rows) {
  for (const p of rows) {
    if (!p?.id) continue;
    await q(
      `insert into showcase_products (creator_open_id, product_id, origin, snapshot_day,
         creator_username, title, shop_name, inventory_status, review_status, is_hidden,
         added_status, source, commission_rate, reward_rate, collaboration_id, collab_type)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (creator_open_id, product_id, origin, snapshot_day) do update set
         inventory_status=excluded.inventory_status, review_status=excluded.review_status,
         is_hidden=excluded.is_hidden, added_status=excluded.added_status,
         commission_rate=excluded.commission_rate, reward_rate=excluded.reward_rate,
         collected_at=now()`,
      [openId, p.id, origin, dayStr, username, p.title ?? null, p.shop?.name ?? null,
       p.status?.inventory_status ?? null, p.status?.review_status ?? null,
       p.status?.is_hidden ?? null, p.status?.added_status ?? null, p.source ?? null,
       num(p.commission?.rate), num(p.commission?.reward_rate),
       p.collaboration?.id ?? null, p.collaboration?.type ?? null]);
  }
  return rows.length;
}

async function writeCollaborations(openId, username, dayStr, shopId, rows) {
  let n = 0;
  for (const c of rows) {
    if (!c?.id) continue;
    // Chien dich khong co san pham van phai luu 1 dong, neu khong target_collaborations
    // dem thieu dung nhung chien dich chua gan san pham.
    for (const p of c.products?.length ? c.products : [{}]) {
      await q(
        `insert into target_collaborations (creator_open_id, collaboration_id, product_id,
           snapshot_day, creator_username, shop_id, name, status, product_title,
           commission_rate, est_amount, currency)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (creator_open_id, collaboration_id, product_id, snapshot_day) do update set
           status=excluded.status, name=excluded.name,
           commission_rate=excluded.commission_rate, est_amount=excluded.est_amount,
           collected_at=now()`,
        [openId, c.id, p.id ?? '', dayStr, username, shopId, c.name ?? null, c.status ?? null,
         p.title ?? null, num(p.commission?.rate), num(p.commission?.amount) || null,
         p.commission?.currency ?? null]);
      n++;
    }
  }
  return n;
}

// metric_values.creator_username tro ve creators(username) nen phai co dong creators truoc.
// Luu y: cho tay vao day co nghia bang creators khong con chi la "creator CO DON" -- creator
// uy quyen ma chua ban duoc gi cung xuat hien. Dung the vi khong co bang nao khac noi
// metric theo creator vao.
async function writeMetrics(username, dayStr, metrics) {
  await q(
    `insert into creators (username, first_seen, last_seen) values ($1,$2,$2)
     on conflict (username) do update set
       first_seen = least(creators.first_seen, excluded.first_seen),
       last_seen  = greatest(creators.last_seen, excluded.last_seen),
       updated_at = now()`,
    [username, dayStr]);
  let n = 0;
  for (const [metric_key, value] of Object.entries(metrics)) {
    await q(
      `insert into metric_values (creator_username, metric_key, period_start, period_end, value)
       values ($1,$2,$3,$3,$4)
       on conflict (creator_username, metric_key, period_start, period_end)
       do update set value = excluded.value, collected_at = now()`,
      [username, metric_key, dayStr, value]);
    n++;
  }
  return n;
}

// --- Chay ------------------------------------------------------------------

// Mot creator loi thi khong duoc lam chet ca luot: ghi vao errors roi di tiep.
// Profile la BAT BUOC: khong co username thi khong noi duoc vao metric_values
// (cap_order chi tra ve creator_username, khong co open_id), nen bo qua creator do.
export async function runCreatorSync({ onDay = new Date() } = {}) {
  const dayStr = day(onDay);
  await reapStale();
  const run = await q(
    `insert into sync_runs (note, heartbeat_at) values ('creator sync', now()) returning id`);
  const runId = run.rows[0].id;
  const errors = [];
  const warnings = [];
  let written = 0;
  let creators = 0;

  const auths = await creatorAuths();
  if (!auths.length) {
    await q(`update sync_runs set finished_at=now(), status='ok', note=$2 where id=$1`,
      [runId, 'creator sync: chua co creator nao uy quyen']);
    return { runId, creators: 0, written: 0, errors, warnings: ['chua co creator nao uy quyen'] };
  }

  const shops = shopIds();
  if (!shops.length) {
    warnings.push('thieu TTS_SHOP_IDS -> bo qua target_collaborations (endpoint BAT BUOC shop_id, khong API nao dang dung tra ve shop_id)');
  }

  for (const row of auths) {
    try {
      const token = await fresh(row);
      const profile = await fetchProfile(token);
      const username = await writeProfile(row.open_id, profile);
      if (!username) { errors.push(`${row.open_id}: profile khong co username`); continue; }

      const samples = await fetchSamples(token);
      const showcase = await fetchShowcase(token);
      const collaborations = [];
      for (const shop_id of shops) {
        try {
          const got = await fetchCollaborations(token, shop_id);
          collaborations.push(...got);
          await writeCollaborations(row.open_id, username, dayStr, shop_id, got);
        } catch (e) { errors.push(`${username} shop ${shop_id}: ${e.message}`); }
      }

      await writeSamples(row.open_id, username, dayStr, samples);
      await writeShowcase(row.open_id, username, dayStr, 'SHOWCASE', showcase);
      written += await writeMetrics(username, dayStr,
        aggregateCreator({ samples, showcase, collaborations }));
      creators++;
    } catch (e) { errors.push(`${row.open_id}: ${e.message}`); }
    await beat(runId);
  }

  const note = ['creator sync', ...errors, ...warnings].join(' | ');
  await q(`update sync_runs set finished_at=now(), status=$2, rows_written=$3, note=$4 where id=$1`,
    [runId, errors.length ? 'error' : 'ok', written, note]);
  return { runId, creators, written, errors, warnings };
}
