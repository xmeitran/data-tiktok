// Kiem luong CREATOR: phan gop (pure, luon chay) + phan DB (chi khi da co creator uy quyen).
// Chua co creator nao uy quyen la chuyen BINH THUONG, khong phai loi -> bo qua sach, exit 0.
// CAN DB cho phan sau. Chay: node test-creator.mjs
import assert from 'node:assert/strict';
import { pool, q } from './src/db.js';
import { aggregateCreator } from './src/sync-creator.js';
import { creatorAuthorizeUrl, isCreatorToken } from './src/tiktok.js';
import { CREATOR_API, CREATOR_FIELDS } from './src/tiktok-fields.js';
import { BY_KEY } from './src/metrics.js';

// --- 1. Link uy quyen: state BAT BUOC, va phai la host creator chu khong phai host partner.
process.env.TTS_APP_KEY ||= 'test_key';
assert.throws(() => creatorAuthorizeUrl(''), /state/, 'thieu state phai nem loi, khong duoc sinh link cut');
const url = new URL(creatorAuthorizeUrl('abc123'));
assert.equal(url.pathname, '/alliance/creator/auth', 'sai duong dan authorize creator');
assert.equal(url.searchParams.get('state'), 'abc123');
assert.ok(url.searchParams.get('app_key'), 'thieu app_key');
assert.ok(!url.searchParams.has('service_id'), 'service_id la cua luong PARTNER, khong duoc lot vao link creator');

// --- 2. Nhan dang token creator. Sai cho nay thi uy quyen creator bi luu thanh partner.
assert.ok(isCreatorToken({ user_type: 1 }), 'user_type so 1 phai nhan ra');
assert.ok(isCreatorToken({ user_type: '1' }), 'user_type chuoi "1" phai nhan ra');
assert.ok(!isCreatorToken({ user_type: 3 }), 'user_type 3 la partner');
assert.ok(!isCreatorToken({}), 'khong co user_type thi khong duoc coi la creator');

// --- 3. Gop: dem DISTINCT, khong dem dong. API tra ve san pham long trong chien dich nen
// mot chien dich co 5 san pham ra 5 dong tho ma van chi la 1 chien dich.
const agg = aggregateCreator({
  samples: [
    { id: 's1', status: 'COMPLETED' },
    { id: 's2', status: 'PENDING' },
    { id: 's3', status: 'completed' },            // API tra hoa, khong duoc phan biet chu
    { id: 's4', status: 'REJECT_CANCELLED' },
    { id: 's5', status: 'OPS_COMPLETED' },        // ops danh dau tay -> KHONG tinh la COMPLETED
  ],
  showcase: [{ id: 'p1' }, { id: 'p2' }, { id: 'p1' }, {}],
  collaborations: [{ id: 'c1' }, { id: 'c1' }, { id: 'c2' }],
});
assert.deepEqual(agg, {
  sample_requests: 5,
  samples_completed: 2,
  showcase_products: 2,
  target_collaborations: 2,
});
assert.deepEqual(aggregateCreator(), { sample_requests: 0, samples_completed: 0, showcase_products: 0, target_collaborations: 0 },
  'khong co du lieu phai ra 0, khong duoc nem loi');

// --- 4. Moi metric gop ra phai co trong registry va dang available -- neu khong UI se
// nhan gia tri cho mot metric nao do khong he ton tai.
for (const key of Object.keys(agg)) {
  assert.ok(BY_KEY[key], `metric "${key}" khong co trong src/metrics.js`);
  assert.equal(BY_KEY[key].available, true, `metric "${key}" da co pipeline ma van available: false`);
}

// --- 5. Moi API creator phai co scope + mo ta truong. Khong co scope thi khong biet
// phai bat quyen nao tren Partner Center.
for (const [key, api] of Object.entries(CREATOR_API)) {
  assert.ok(api.scope?.key?.startsWith('creator.'), `${key}: scope khong phai scope creator`);
  assert.ok(api.path.startsWith('/affiliate_creator/'), `${key}: path khong thuoc nhom affiliate_creator`);
  assert.ok(Object.keys(CREATOR_FIELDS[key] ?? {}).length, `${key}: khong co mo ta truong nao`);
  for (const [f, v] of Object.entries(CREATOR_FIELDS[key])) {
    assert.ok(v.en?.length > 3, `${key}.${f}: thieu mo ta goc`);
    assert.ok(v.vi?.length > 10, `${key}.${f}: thieu ban dich tieng Viet`);
  }
}

// --- 6. `state` phai song qua restart VA dung dung mot lan. Day la dieu kien de gui
// link cho creator roi ho bam sau vai gio -- ban RAM cu TTL 15 phut khong lam duoc.
// Kiem dung cau SQL ma /api/tiktok/callback dung, nen sua server.js lech la test do.
const take = (st) => q(`delete from auth_states where state=$1 and expires_at > now() returning role`, [st]);
await q(`insert into auth_states (state, role, expires_at) values
           ('t_valid','creator', now() + interval '1 day'),
           ('t_expired','creator', now() - interval '1 second')
         on conflict (state) do update set expires_at = excluded.expires_at`);
assert.equal((await take('t_expired')).rowCount, 0, 'state het han van doi duoc -> mat han han');
assert.equal((await take('t_valid')).rows[0]?.role, 'creator', 'state con han phai doi duoc');
assert.equal((await take('t_valid')).rowCount, 0, 'state dung lan hai van duoc -> khong con la one-time');

// --- 7. Phan can DB cua creator. Chua co creator uy quyen thi dung o day.
const { rows: [a] } = await q(`select count(*)::int n from authorizations where role='creator'`);
if (!a.n) {
  console.log('test-creator OK — 5 phep kiem offline + state one-time; BO QUA phan metric vi chua co creator nao uy quyen');
  await pool.end();
  process.exit(0);
}

// Bang tho va metric_values phai ke cung mot cau chuyen, giong test-raw.mjs:
// doc lai tu bang tho phai ra dung con so da gop, theo tung creator tung ngay chup.
for (const [metric, sql] of [
  ['sample_requests',       `select creator_username u, snapshot_day d, count(*)::numeric v
                             from sample_applications where creator_username is not null group by 1,2`],
  ['samples_completed',     `select creator_username u, snapshot_day d,
                             count(*) filter (where upper(status)='COMPLETED')::numeric v
                             from sample_applications where creator_username is not null group by 1,2`],
  ['showcase_products',     `select creator_username u, snapshot_day d, count(distinct product_id)::numeric v
                             from showcase_products where origin='SHOWCASE' and creator_username is not null group by 1,2`],
  ['target_collaborations', `select creator_username u, snapshot_day d, count(distinct collaboration_id)::numeric v
                             from target_collaborations where creator_username is not null group by 1,2`],
]) {
  const { rows } = await q(
    `select count(*)::int lech from (${sql}) t
     join metric_values m on m.creator_username = t.u and m.period_start = t.d and m.metric_key = $1
     where t.v is distinct from m.value`, [metric]);
  assert.equal(rows[0].lech, 0, `${metric}: ${rows[0].lech} cap (creator, ngay chup) lech giua bang tho va metric_values`);
}

// Profile la cay cau duy nhat tu open_id sang username. Thieu username thi metric creator
// khong noi vao dau duoc, nen sync phai bo qua creator do chu khong duoc ghi nua voi.
const { rows: [orphan] } = await q(
  `select count(*)::int n from metric_values m
   where m.metric_key in ('sample_requests','samples_completed','showcase_products','target_collaborations')
     and not exists (select 1 from creator_profiles p where p.username = m.creator_username)`);
assert.equal(orphan.n, 0, `${orphan.n} dong metric creator khong truy duoc ve creator_profiles`);

console.log(`test-creator OK — 5 phep kiem offline + state one-time + ${a.n} creator doi chieu duoc bang tho voi metric_values`);
await pool.end();
