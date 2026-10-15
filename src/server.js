import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { METRICS } from './metrics.js';
import { exchangeCode, authorizeUrl, assertPartnerToken, getCategoryAssets,
         PARTNER_ORDERS_SCOPE } from './tiktok.js';
import { runSync } from './sync.js';
import { basicAuth } from './auth.js';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json());
// Đăng nhập đứng TRƯỚC static, nếu không dashboard vẫn phục vụ file tĩnh cho người lạ.
app.use(basicAuth({ user: process.env.DASHBOARD_USER, pass: process.env.DASHBOARD_PASSWORD }));
app.use(express.static(path.join(root, '..', 'public')));

// `state` cho link uy quyen creator: bat buoc, random, one-time, phai validate khi callback.
// ponytail: luu trong RAM nen chi dung cho 1 process; chay nhieu instance thi day xuong
// Postgres hoac Redis.
const STATE_TTL = 15 * 60e3;
const pending = new Map();

app.get('/api/authorize-url', (req, res) => {
  for (const [k, v] of pending) if (Date.now() - v.at > STATE_TTL) pending.delete(k);
  const state = crypto.randomBytes(16).toString('base64url');
  pending.set(state, { label: String(req.query.label ?? ''), at: Date.now() });
  res.json({ url: authorizeUrl(state), state });
});

// --- OAuth callback. Day CHINH LA duong dan phai dien vao o Redirect URL cua Partner Center. ---
app.get('/api/tiktok/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Thieu auth code (co the da bam Reject).');

  // Partner: docs noi `state` duoc khuyen khich chu KHONG bat buoc, nen link copy thang
  // tu Partner Center (khong kem state) van phai dung duoc. Co state thi bat buoc khop.
  if (state) {
    const entry = pending.get(String(state));
    if (!entry || Date.now() - entry.at > STATE_TTL) {
      return res.status(400).send('state khong hop le hoac da dung roi.');
    }
    pending.delete(String(state));
  }

  try {
    const t = assertPartnerToken(await exchangeCode(code));
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

app.get('/api/metrics', (_req, res) => res.json(METRICS));

app.get('/api/summary', async (_req, res, next) => {
  try {
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
    res.json({
      authorizations: byStatus,
      partnerAuthorized: Object.values(byStatus).reduce((a, b) => a + b, 0),
      creatorsKnown: creators.rows[0].n,
      lastSync: last.rows[0] ?? null,
      latest: latestOut,
    });
  } catch (e) { next(e); }
});

app.get('/api/creators', async (_req, res, next) => {
  try {
    const { rows } = await q(
      `select c.username, c.first_seen, c.last_seen,
              coalesce(max(v.period_start)::text,'') last_period,
              coalesce(sum(v.value) filter (where v.metric_key='net_gmv'),0) net_gmv,
              coalesce(sum(v.value) filter (where v.metric_key='orders'),0) orders,
              coalesce(sum(v.value) filter (where v.metric_key='est_commission'),0) est_commission
       from creators c left join metric_values v on v.creator_username = c.username
       group by c.username, c.first_seen, c.last_seen
       order by net_gmv desc limit 500`
    );
    res.json(rows);
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

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: err.message }); });
app.listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
