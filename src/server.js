import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, reapStale } from './db.js';
import { METRICS } from './metrics.js';
import { API, REQUEST, FIELDS, CATEGORY_ASSET_FIELDS,
         CREATOR_API, CREATOR_FIELDS } from './tiktok-fields.js';
import { exchangeCode, authorizeUrl, creatorAuthorizeUrl, isCreatorToken,
         assertPartnerToken, getCategoryAssets, PARTNER_ORDERS_SCOPE } from './tiktok.js';
import { runSync } from './sync.js';
import { runCreatorSync } from './sync-creator.js';
import { basicAuth } from './auth.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json());
// Đăng nhập đứng TRƯỚC static, nếu không dashboard vẫn phục vụ file tĩnh cho người lạ.
app.use(basicAuth({ user: process.env.DASHBOARD_USER, pass: process.env.DASHBOARD_PASSWORD }));
// Khong cache file tinh: dang phat trien ma trinh duyet giu app.js cu thi HTML moi + JS cu
// = trang trang, rat kho tim ra. Dashboard noi bo nen khong can toi uu bang thang.
app.use(express.static(path.join(root, '..', 'public'), {
  etag: false, lastModified: false,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

// `state`: bat buoc voi creator, random, DUNG MOT LAN, phai validate khi callback.
// Luu o Postgres chu khong phai RAM: link creator phai GUI CHO NGUOI KHAC bam, nen no
// phai song qua restart server va qua nhieu process.
// Partner tu bam ngay -> 15 phut du. Creator can nhieu ngay.
const STATE_TTL = { partner: 15 * 60e3, creator: 7 * 86400e3 };

async function saveState(state, role, label) {
  await q(`delete from auth_states where expires_at < now()`);
  await q(`insert into auth_states (state, role, label, expires_at)
           values ($1,$2,$3, now() + ($4 || ' ms')::interval)`,
    [state, role, label, STATE_TTL[role]]);
}

// Tra ve dong state va XOA luon: dung mot lan that su, khong phai chi kiem roi de day.
async function takeState(state) {
  const { rows } = await q(
    `delete from auth_states where state = $1 and expires_at > now() returning role, label`, [state]);
  return rows[0] ?? null;
}

app.get('/api/authorize-url', async (req, res) => {
  // Partner va creator la HAI luong khac han: khac host, khac ten tham so, va creator
  // BAT BUOC co state. Mot link dung cho luong kia se bi TikTok tu choi ngay o trang authorize.
  const role = req.query.role === 'creator' ? 'creator' : 'partner';
  try {
    const state = crypto.randomBytes(16).toString('base64url');
    // Sinh link TRUOC khi luu state: thieu TTS_SERVICE_ID / TTS_APP_KEY thi nem loi o day,
    // khong de lai state rac trong bang.
    const url = role === 'creator' ? creatorAuthorizeUrl(state) : authorizeUrl(state);
    await saveState(state, role, String(req.query.label ?? ''));
    res.json({ role, state, url, expiresInDays: STATE_TTL[role] / 86400e3 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Luu uy quyen creator. KHONG dung chung dong voi partner: open_id la khoa chinh nen hai
// role nam canh nhau an toan, nhung role phai dung de sync-creator loc ra duoc.
// Khong goi API creator o day: callback phai tra ve nhanh, con sync chay rieng.
async function saveCreator(t) {
  const openId = t.open_id;
  if (!openId) throw new Error('token creator khong co open_id');
  const granted = t.granted_scopes ?? [];
  await q(
    `insert into authorizations
       (open_id, role, display_name, region, access_token, refresh_token,
        access_expire_at, refresh_expire_at, status, raw)
     values ($1,'creator',$2,$3,$4,$5,to_timestamp($6),to_timestamp($7),'active',$8)
     on conflict (open_id) do update set
       role='creator', display_name=excluded.display_name, region=excluded.region,
       access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       access_expire_at=excluded.access_expire_at, refresh_expire_at=excluded.refresh_expire_at,
       status='active', updated_at=now(), raw=excluded.raw`,
    [openId, t.seller_name ?? null, t.seller_base_region ?? null, t.access_token,
     t.refresh_token, t.access_token_expire_in, t.refresh_token_expire_in, t]);

  // Scope nao thieu thi API nao im lang bi bo qua -> noi thang ra o day.
  const need = Object.entries(CREATOR_API).map(([k, v]) => [k, v.scope.key]);
  return [
    'Uy quyen CREATOR thanh cong.',
    `open_id: ${openId}`,
    `user_type: ${t.user_type ?? '(khong co)'}`,
    '',
    `granted_scopes (${granted.length}):`,
    ...granted.map(s => `  - ${s}`),
    '',
    'API creator se goi duoc:',
    ...need.map(([k, sc]) =>
      `  ${granted.length === 0 || granted.includes(sc) ? 'OK  ' : 'THIEU'} ${k} (${sc})`),
    '',
    'Chay sync: POST /api/sync-creator',
  ].join('\n');
}

// --- OAuth callback. Day CHINH LA duong dan phai dien vao o Redirect URL cua Partner Center. ---
app.get('/api/tiktok/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Thieu auth code (co the da bam Reject).');

  // Partner: docs noi `state` duoc khuyen khich chu KHONG bat buoc, nen link copy thang
  // tu Partner Center (khong kem state) van phai dung duoc. Co state thi bat buoc khop.
  // Creator thi nguoc lai: state BAT BUOC, kiem o duoi sau khi biet day la token creator.
  let entry = null;
  if (state) {
    entry = await takeState(String(state));
    if (!entry) return res.status(400).send('state khong hop le, da het han hoac da dung roi.');
  }

  try {
    const t = await exchangeCode(code);

    // Nhan ra luong creator bang user_type cua chinh token (1 = creator), khong doan theo
    // state -- de callback creator di qua link nao cung vao dung nhanh. `entry.role` chi
    // la luoi an toan cho truong hop TikTok doi/bo user_type.
    if (isCreatorToken(t) || entry?.role === 'creator') {
      if (!state) {
        return res.status(400).send(
          'Callback creator KHONG co state. Luong creator bat buoc co state -- lay link qua ' +
          'GET /api/authorize-url?role=creator chu dung tu ghep link.');
      }
      return res.type('text/plain').send(await saveCreator(t));
    }

    assertPartnerToken(t);
    const openId = t.open_id ?? t.seller_name ?? process.env.TTS_SERVICE_ID;
    const granted = t.granted_scopes ?? [];

    await q(
      `insert into authorizations
         (open_id, role, display_name, access_token, refresh_token,
          access_expire_at, refresh_expire_at, status, raw)
       values ($1,'partner',$2,$3,$4,to_timestamp($5),to_timestamp($6),'active',$7)
       on conflict (open_id) do update set
         role='partner', display_name=excluded.display_name,
         access_token=excluded.access_token, refresh_token=excluded.refresh_token,
         access_expire_at=excluded.access_expire_at, refresh_expire_at=excluded.refresh_expire_at,
         status='active', updated_at=now(), raw=excluded.raw`,
      [openId, t.seller_name ?? openId, t.access_token, t.refresh_token,
       t.access_token_expire_in, t.refresh_token_expire_in, t]
    );

    // Cipher la tham so bat buoc cua cap_order/search -> lay ngay, dung de bao gio sync.
    let assets = [];
    let assetErr = null;
    try {
      assets = (await getCategoryAssets(t.access_token)).category_assets ?? [];
      for (const a of assets) {
        await q(
          `insert into category_assets (cipher, partner_open_id, category_id, category_name, target_market)
           values ($1,$2,$3,$4,$5)
           on conflict (cipher) do update set
             partner_open_id=excluded.partner_open_id,
             category_name=excluded.category_name, target_market=excluded.target_market,
             updated_at=now()`,
          [a.cipher, openId, a.category?.id ?? null, a.category?.name ?? null, a.target_market ?? null]
        );
      }
    } catch (e) { assetErr = e.message; }

    // Tra ve thang ket qua thay vi redirect: can nhin ngay scope nao duoc cap va co cipher chua.
    const hasOrders = granted.includes(PARTNER_ORDERS_SCOPE);
    res.type('text/plain').send([
      'Uy quyen partner THANH CONG.',
      `open_id: ${openId}`,
      '',
      `granted_scopes (${granted.length}):`,
      ...granted.map(s => `  - ${s}`),
      '',
      hasOrders
        ? `OK: co ${PARTNER_ORDERS_SCOPE} -> goi duoc cap_order/search.`
        : `THIEU ${PARTNER_ORDERS_SCOPE} -> CHUA goi duoc cap_order/search.\n` +
          '  Vao Partner Center > App & Service > Manage scope de bat scope nay roi uy quyen lai.',
      '',
      assetErr ? `Loi lay category assets: ${assetErr}`
               : `category assets (${assets.length}):`,
      ...assets.map(a => `  - ${a.category?.name ?? '?'} [${a.target_market ?? '?'}] cipher=${a.cipher}`),
    ].join('\n'));
  } catch (e) {
    res.status(502).send(`Uy quyen that bai: ${e.message}`);
  }
});

// Trinh duyet bao loi ve day. Khong co cai nay thi mot loi JS = trang trang, khong dau vet.
app.post('/api/client-error', (req, res) => {
  console.error('[client]', JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get('/api/metrics', (_req, res) => res.json(METRICS));

// Tai lieu goc cua TikTok: `en` nguyen van, `vi` la ban dich cua dashboard.
app.get('/api/fields', (_req, res) =>
  res.json({ api: API, request: REQUEST, fields: FIELDS, categoryAssetFields: CATEGORY_ASSET_FIELDS,
             creatorApi: CREATOR_API, creatorFields: CREATOR_FIELDS }));

app.get('/api/summary', async (_req, res, next) => {
  try {
    // Doc trang thai = co hoi tot nhat de phat hien job da chet; thu don truoc khi doc.
    await reapStale();
    const [auth, last] = await Promise.all([
      q(`select status, count(*)::int n from authorizations where role='partner' group by status`),
      q(`select * from sync_runs order by id desc limit 1`),
    ]);
    const byStatus = Object.fromEntries(auth.rows.map(r => [r.status, r.n]));
    const latest = await q(
      `select metric_key, sum(value) total from metric_values
       where period_start = (select max(period_start) from metric_values)
       group by metric_key`
    );
    // Ty le khong cong duoc: bo cac metric % ra khoi tong roi tinh lai tu cac metric goc.
    const RATIO = new Set(['aov', 'commission_rate', 'refund_rate']);
    const t = Object.fromEntries(
      latest.rows.filter(r => !RATIO.has(r.metric_key)).map(r => [r.metric_key, Number(r.total)]));
    const latestOut = {
      ...t,
      aov: t.orders ? t.gmv / t.orders : 0,
      commission_rate: t.gmv ? (t.est_commission / t.gmv) * 100 : 0,
      refund_rate: t.gmv ? ((t.gmv - t.net_gmv) / t.gmv) * 100 : 0,
    };
    const creators = await q(`select count(*)::int n from creators`);
    const fresh = await q(
      `select max(period_start)::text newest,
              (now() at time zone 'UTC')::date::text today from metric_values`);
    res.json({
      freshness: fresh.rows[0],
      authorizations: byStatus,
      partnerAuthorized: Object.values(byStatus).reduce((a, b) => a + b, 0),
      creatorsKnown: creators.rows[0].n,
      lastSync: last.rows[0] ?? null,
      latest: latestOut,
    });
  } catch (e) { next(e); }
});

// Chuoi theo NGAY cho bieu do xu huong. metric_values luu moi dong 1 creator/1 ngay,
// nen cong lai theo ngay. Bo cac metric ty le ra: khong cong duoc, phai tinh lai tu goc.
app.get('/api/daily', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `select period_start::text as "day", metric_key, sum(value)::float as total
       from metric_values
       where metric_key not in ('aov','commission_rate','refund_rate')
       group by period_start, metric_key
       order by period_start`
    );
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
      byDay.get(r.day)[r.metric_key] = r.total;
    }
    res.json([...byDay.values()].map(d => ({
      ...d,
      aov: (d.orders + d.refund_orders) ? d.gmv / (d.orders + d.refund_orders) : 0,
      commission_rate: d.commission_base ? (d.est_commission / d.commission_base) * 100 : 0,
      refund_rate: d.gmv ? (d.refund_amount / d.gmv) * 100 : 0,
    })));
  } catch (e) { next(e); }
});

app.get('/api/creators', async (req, res, next) => {
  try {
    // Cung mot bo chon ky voi KPI va bieu do -- truoc day bang nay luon cong TOAN BO
    // lich su trong khi KPI chi lay ngay moi nhat, hai cho noi hai ky khac nhau.
    const days = Number(req.query.days) || null;
    // Pivot toan bo metric ra cot thay vi chi 3 cai. Ty le phai tinh lai tu metric goc:
    // cong aov / commission_rate / refund_rate cua nhieu ngay lai la vo nghia.
    const { rows } = await q(
      `select c.username, c.first_seen::text first_seen, c.last_seen::text last_seen,
              max(v.period_start)::text last_period,
              count(distinct v.period_start)::int days,
              coalesce(sum(v.value) filter (where v.metric_key='gmv'),0)::float gmv,
              coalesce(sum(v.value) filter (where v.metric_key='net_gmv'),0)::float net_gmv,
              coalesce(sum(v.value) filter (where v.metric_key='orders'),0)::float orders,
              coalesce(sum(v.value) filter (where v.metric_key='items_sold'),0)::float items_sold,
              coalesce(sum(v.value) filter (where v.metric_key='est_commission'),0)::float est_commission,
              coalesce(sum(v.value) filter (where v.metric_key='commission_base'),0)::float commission_base,
              coalesce(sum(v.value) filter (where v.metric_key='refund_amount'),0)::float refund_amount,
              coalesce(sum(v.value) filter (where v.metric_key='refund_orders'),0)::float refund_orders
       from creators c left join metric_values v on v.creator_username = c.username
         and ($1::int is null or v.period_start > (select max(period_start) from metric_values) - $1::int)
       group by c.username, c.first_seen, c.last_seen`,
      [days]
    );
    res.json(rows.map(r => ({
      ...r,
      aov: (r.orders + r.refund_orders) ? r.gmv / (r.orders + r.refund_orders) : 0,
      commission_rate: r.commission_base ? (r.est_commission / r.commission_base) * 100 : 0,
      refund_rate: r.gmv ? (r.refund_amount / r.gmv) * 100 : 0,
    })).sort((a, b) => b.net_gmv - a.net_gmv));
  } catch (e) { next(e); }
});

// Trang thai he thong: uy quyen partner, cipher, lich su sync. Nhung thu nay truoc gio
// chi nam trong DB, khong ai nhin thay tu giao dien.
app.get('/api/creator-daily', async (req, res, next) => {
  try {
    const { rows } = await q(
      `select period_start::text as "day", metric_key, value::float
       from metric_values where creator_username = $1
       order by period_start`, [req.query.username]);
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day });
      byDay.get(r.day)[r.metric_key] = r.value;
    }
    res.json([...byDay.values()]);
  } catch (e) { next(e); }
});

// Du lieu theo SAN PHAM / SHOP / loai noi dung. Doc tu bang tho sku_orders -- metric_values
// chi co chieu creator nen khong dien ta duoc nhung chieu nay.
// Loc don huy GIONG HET aggregate() trong sync.js, neu khong hai cho se ra hai con so khac nhau.
const VALID_ROW = `settle_status is distinct from 'INELIGIBLE' and fully_return is distinct from 'Yes'`;

app.get('/api/products', async (req, res, next) => {
  try {
    const days = Number(req.query.days) || null;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const window = `($1::int is null or "day" > (select max("day") from sku_orders) - $1::int)`;

    const [products, shops, content] = await Promise.all([
      q(`select product_id, max(product_name) product_name, max(shop_name) shop_name,
                sum(price_amount * quantity)::float gmv,
                count(distinct order_id)::int orders,
                sum(quantity)::int items,
                sum(est_commission)::float est_commission,
                sum(commission_base)::float commission_base,
                count(distinct creator_username)::int creators,
                round(avg(std_rate) / 100.0, 2)::float avg_rate
         from sku_orders where ${window} and ${VALID_ROW}
         group by product_id order by gmv desc limit ${limit}`, [days]),
      q(`select shop_name,
                sum(price_amount * quantity)::float gmv,
                count(distinct order_id)::int orders,
                count(distinct product_id)::int products,
                count(distinct creator_username)::int creators,
                sum(est_commission)::float est_commission
         from sku_orders where ${window} and ${VALID_ROW} and shop_name is not null
         group by shop_name order by gmv desc limit ${limit}`, [days]),
      q(`select coalesce(content_type,'(trong)') content_type,
                sum(price_amount * quantity)::float gmv,
                count(distinct order_id)::int orders,
                count(distinct content_id)::int contents,
                count(distinct creator_username)::int creators
         from sku_orders where ${window} and ${VALID_ROW}
         group by 1 order by gmv desc`, [days]),
    ]);

    res.json({
      products: products.rows,
      shops: shops.rows,
      byContentType: content.rows,
    });
  } catch (e) { next(e); }
});

app.get('/api/system', async (_req, res, next) => {
  try {
    await reapStale();
    const [auth, assets, runs, span] = await Promise.all([
      q(`select open_id, role, status, authorized_at, access_expire_at, refresh_expire_at,
                raw->'granted_scopes' granted_scopes, raw->>'user_type' user_type
         from authorizations order by role, (status='active') desc, updated_at desc`),
      q(`select cipher, category_name, target_market from category_assets order by category_name`),
      q(`select id, started_at, finished_at, status, rows_written, note
         from sync_runs order by id desc limit 20`),
      q(`select min(period_start)::text from_day, max(period_start)::text to_day,
                count(distinct period_start)::int days, count(*)::int rows
         from metric_values`),
    ]);
    // Metric nhom "Uy quyen": trang thai HIEN TAI, khong luu theo ngay nhu metric_values.
    const act = auth.rows.find(a => a.role === 'partner' && a.status === 'active');
    const daysLeft = (iso) => iso ? Math.round((new Date(iso) - Date.now()) / 86400e3) : null;
    const authMetrics = {
      partner_authorizations: auth.rows.filter(a => a.status === 'active').length,
      granted_scopes_count: (act?.granted_scopes ?? []).length,
      access_token_days_left: daysLeft(act?.access_expire_at),
      refresh_token_days_left: daysLeft(act?.refresh_expire_at),
      category_assets_usable: assets.rows.filter(a => a.category_name === 'Creator Management').length,
      // Creator TU bam uy quyen cho app nay. KHAC con so creator dang bind voi MCN tren
      // UI Partner Center (728) -- cai do khong API nao lay duoc.
      creators_authorized: auth.rows.filter(a => a.role === 'creator' && a.status === 'active').length,
    };
    res.json({
      authMetrics,
      authorizations: auth.rows,
      categoryAssets: assets.rows,
      // Chi cipher cua Creator Management goi duoc cap_order/search; 20 cai con lai tra loi.
      activeCipher: assets.rows.find(a => a.category_name === 'Creator Management')?.cipher ?? null,
      syncRuns: runs.rows,
      coverage: span.rows[0],
    });
  } catch (e) { next(e); }
});

app.get('/api/metric-values', async (req, res, next) => {
  try {
    const { rows } = await q(
      `select * from metric_values
       where ($1::text is null or metric_key = $1)
       order by period_start desc, value desc limit 500`,
      [req.query.metric || null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/sync', async (req, res, next) => {
  try { res.json(await runSync({ days: Number(req.body?.days) || 7 })); } catch (e) { next(e); }
});

// Sync creator: khong nhan `days`. 3/4 endpoint creator khong tra ve thoi diem tao nen
// chi chup duoc trang thai HIEN TAI -- khong backfill lai qua khu duoc.
app.post('/api/sync-creator', async (_req, res, next) => {
  try { res.json(await runCreatorSync()); } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message }); });
app.listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
