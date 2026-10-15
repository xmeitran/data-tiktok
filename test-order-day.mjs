// Mốc "ngày dữ liệu mới nhất" phải là ngày CÓ ĐƠN. Chạy: node test-order-day.mjs (cần DATABASE_URL)
//
// sync-creator ghi metric ảnh chụp vào HÔM NAY (trạng thái hiện tại, không backfill được),
// còn sync đơn chỉ ghi tới HÔM QUA. Lấy max(period_start) của CẢ BẢNG metric_values sẽ neo
// vào một ngày không có đơn nào, và kéo theo ba chỗ cùng sai:
//   /api/summary.latest mất sạch gmv/orders · banner freshness báo "dữ liệu đến hôm nay"
//   trong khi đơn đang trễ thật · cửa sổ /api/creators?days=7 chỉ còn 6 ngày.
import assert from 'node:assert/strict';
import { q, pool, ORDER_DAY } from './src/db.js';

const U = '__test_order_day__';
// ORDER_DAY là max TOÀN BẢNG (đúng như vậy: nó là mốc của cả hệ thống, không theo creator).
// Nên để test rows thắng mọi dữ liệu thật, ngày phải nằm ở TƯƠNG LAI xa, không phải quá khứ.
const D1 = '2099-03-01';   // ngày có đơn, cũ hơn
const D2 = '2099-03-05';   // ngày có đơn, mới nhất
const D3 = '2099-03-06';   // CHỈ có ảnh chụp creator -> không phải ngày dữ liệu

const put = (day, key, value) => q(
  `insert into metric_values (creator_username, metric_key, period_start, period_end, value)
   values ($1,$2,$3,$3,$4)
   on conflict (creator_username, metric_key, period_start, period_end)
   do update set value = excluded.value`, [U, key, day, value]);

// ORDER_DAY là một đoạn SQL con -> bọc vào select để lấy giá trị ra.
const orderDay = async () =>
  (await q(`select ${ORDER_DAY}::text d`)).rows[0].d;

try {
  await q(`insert into creators (username, first_seen, last_seen) values ($1,$2,$3)
           on conflict (username) do nothing`, [U, D1, D3]);
  // Dọn trước: lần chạy trước bị ngắt giữa chừng không được làm lệch lần này.
  await q(`delete from metric_values where creator_username = $1`, [U]);

  await put(D1, 'gmv', 1000);
  await put(D2, 'gmv', 2000);
  assert.equal(await orderDay(), D2, 'phải lấy ngày CÓ ĐƠN mới nhất');

  // Giờ thêm ảnh chụp creator vào một ngày MUỘN HƠN — đúng tình huống chạy
  // POST /api/sync-creator sau khi sync đơn đã xong.
  await put(D3, 'sample_requests', 5);
  await put(D3, 'showcase_products', 12);
  await put(D3, 'target_collaborations', 3);

  const sau = await orderDay();
  assert.equal(sau, D2, 'ảnh chụp creator KHÔNG được đẩy mốc lên — đây là bug cũ');
  assert.notEqual(sau, D3);

  // max(period_start) của cả bảng (công thức cũ) thật sự nhảy lên D3 -> chứng minh
  // test này đang bắt đúng cái bug, chứ không phải tình cờ đúng.
  const cuaCaBang = (await q(
    `select max(period_start)::text d from metric_values`)).rows[0].d;
  assert.equal(cuaCaBang, D3, 'công thức cũ nhảy lên ngày ảnh chụp');

  // Và khối latest của /api/summary, neo vào ORDER_DAY, phải thấy gmv.
  const latest = await q(
    `select metric_key, sum(value)::float total from metric_values
     where period_start = ${ORDER_DAY} and creator_username = $1 group by metric_key`, [U]);
  const keys = latest.rows.map(r => r.metric_key);
  assert.ok(keys.includes('gmv'), 'latest phải còn gmv, không được rỗng');
  assert.ok(!keys.includes('sample_requests'), 'latest không được lấy ngày ảnh chụp');

  // Cửa sổ ?days=N neo vào ORDER_DAY: days=5 phải phủ cả D1 (D2 − 5 < D1 ≤ D2).
  const window = await q(
    `select count(distinct period_start)::int n from metric_values
     where creator_username = $1 and metric_key = 'gmv'
       and period_start > ${ORDER_DAY} - $2::int`, [U, 5]);
  assert.equal(window.rows[0].n, 2, 'cửa sổ 5 ngày tính từ D2 phải phủ cả D1 và D2');

  // Nếu neo vào D3 như cũ thì D1 rơi ra ngoài -> đúng cái "7 ngày hoá 6 ngày".
  const windowCu = await q(
    `select count(distinct period_start)::int n from metric_values
     where creator_username = $1 and metric_key = 'gmv'
       and period_start > $2::date - $3::int`, [U, D3, 5]);
  assert.equal(windowCu.rows[0].n, 1, 'neo vào ngày ảnh chụp làm mất 1 ngày đơn');

  console.log('test-order-day OK — 8 phep kiem moc ngay co don (anh chup creator khong day moc)');
} finally {
  // cascade từ creators xoá luôn metric_values của nó.
  await q(`delete from creators where username = $1`, [U]);
  await pool.end();
}
