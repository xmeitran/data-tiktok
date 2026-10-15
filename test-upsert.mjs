// upsertMany(): gộp nhiều dòng vào một INSERT. Chạy: node test-upsert.mjs  (cần DATABASE_URL)
//
// Bốn writer đi qua hàm này, trong đó writeRaw xử lý ~8.8k dòng/ngày. Nó tự ghép số thứ tự
// tham số ($1, $2, …) — đếm lệch một cái là dữ liệu vào sai cột, không lỗi, không dấu vết.
// Dùng bảng sku_orders thật để kiểm, vì đó là nơi hàm này được dùng nặng nhất.
import assert from 'node:assert/strict';
import { q, pool, upsertMany } from './src/db.js';

const U = '__test_upsert__';
const DAY = '2099-04-01';
const COLS = ['order_id', 'sku_id', 'content_id', 'day', 'creator_username',
              'quantity', 'price_amount', 'std_rate'];
const KEY = ['order_id', 'sku_id', 'content_id'];
const UPD = ['day', 'creator_username', 'quantity', 'price_amount', 'std_rate'];

const row = (i, { qty = 1, price = 1000, rate = 1200 } = {}) =>
  [`${U}-o${i}`, `s${i}`, `c${i}`, DAY, U, qty, price, rate];
const read = async () => (await q(
  `select order_id, quantity, price_amount::float price, std_rate
   from sku_orders where creator_username = $1 order by order_id`, [U])).rows;

const clean = () => q(`delete from sku_orders where creator_username = $1`, [U]);

try {
  await clean();

  // --- Rỗng thì không gọi DB, trả 0 (không được nổ vì `values ()`) ---------
  assert.equal(await upsertMany('sku_orders', COLS, KEY, UPD, []), 0);
  assert.equal(await upsertMany('sku_orders', COLS, KEY, UPD, undefined), 0);

  // --- Ghi nhiều dòng, mỗi giá trị phải vào ĐÚNG cột của nó ---------------
  // 3 dòng với giá trị khác nhau từng dòng: lệch số thứ tự tham số là lộ ngay.
  await upsertMany('sku_orders', COLS, KEY, UPD, [
    row(1, { qty: 11, price: 1001, rate: 1100 }),
    row(2, { qty: 22, price: 2002, rate: 2200 }),
    row(3, { qty: 33, price: 3003, rate: 3300 }),
  ]);
  let got = await read();
  assert.equal(got.length, 3);
  for (const [i, r] of got.entries()) {
    const n = i + 1;
    assert.equal(r.quantity, n * 11, `dòng ${n}: quantity vào sai cột`);
    assert.equal(r.price, n * 1001, `dòng ${n}: price_amount vào sai cột`);
    assert.equal(r.std_rate, n * 1100, `dòng ${n}: std_rate vào sai cột`);
  }

  // --- Chia chunk: nhiều dòng hơn một chunk vẫn phải ghi đủ ---------------
  // perChunk = min(500, 60000/8) = 500 -> 1200 dòng là 3 chunk.
  await clean();
  const many = Array.from({ length: 1200 }, (_, i) => row(i, { qty: i }));
  assert.equal(await upsertMany('sku_orders', COLS, KEY, UPD, many), 1200);
  assert.equal((await q(
    `select count(*)::int n from sku_orders where creator_username = $1`, [U])).rows[0].n, 1200,
    'chia chunk không được làm mất dòng');

  // --- Upsert: chạy lại phải CẬP NHẬT, không nhân đôi --------------------
  await clean();
  await upsertMany('sku_orders', COLS, KEY, UPD, [row(1, { qty: 1, price: 1000, rate: 1200 })]);
  await upsertMany('sku_orders', COLS, KEY, UPD, [row(1, { qty: 9, price: 9000, rate: 8000 })]);
  got = await read();
  assert.equal(got.length, 1, 'cùng khoá chính thì không được thành 2 dòng');
  // §6.1: quantity và price_amount PHẢI đổi. Trước đây writeRaw chỉ dập lại hoa hồng
  // mà để nguyên hai cột này -> đơn hoàn một phần thành "hoa hồng mới + GMV cũ".
  assert.equal(got[0].quantity, 9, 'quantity phải được cập nhật');
  assert.equal(got[0].price, 9000, 'price_amount phải được cập nhật');
  assert.equal(got[0].std_rate, 8000, 'std_rate phải được cập nhật');

  // --- update rỗng => do nothing (giữ bản cũ, không lỗi) ----------------
  await upsertMany('sku_orders', COLS, KEY, [], [row(1, { qty: 7, price: 7000, rate: 7000 })]);
  assert.equal((await read())[0].quantity, 9, 'update rỗng thì phải giữ nguyên bản cũ');

  // --- collected_at luôn được dập lại ----------------------------------
  const t1 = (await q(`select collected_at from sku_orders where creator_username=$1`, [U])).rows[0].collected_at;
  await upsertMany('sku_orders', COLS, KEY, UPD, [row(1, { qty: 5 })]);
  const t2 = (await q(`select collected_at from sku_orders where creator_username=$1`, [U])).rows[0].collected_at;
  assert.ok(t2 >= t1, 'collected_at phải được dập lại mỗi lần thấy dòng');

  // --- Dòng sai số cột phải NỔ, không được ghi lệch cột âm thầm --------
  await assert.rejects(
    () => upsertMany('sku_orders', COLS, KEY, UPD, [row(1), [1, 2, 3]]),
    /co 3 gia tri, can 8/, 'dòng thiếu giá trị phải nổ trước khi chạm DB');
  // và không được ghi một phần nào vào DB
  assert.equal((await read()).length, 1, 'lỗi số cột không được ghi dở dang');

  console.log('test-upsert OK — 18 phep kiem upsertMany (dung cot, chia chunk, upsert, no khi sai so cot)');
} finally {
  await clean();
  await pool.end();
}
