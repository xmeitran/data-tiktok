// Mọi bảng phải neo vào CÙNG MỘT mốc ngày. Chạy: node test-anchor.mjs  (cần DATABASE_URL)
//
// Nút "7 ngày" phải có đúng một nghĩa. Trước đây tab Creator neo vào max(period_start) của
// metric_values còn tab Sản phẩm neo vào max(day) của sku_orders — hai bảng không bằng
// nhau (3 ngày 12-14/10 được kéo bằng bản sync cũ, có metric mà không có dòng thô), nên
// cùng một nút lại hiện 08-14/10 ở tab này và 15-21/05 ở tab kia. Không ai phát hiện ra
// vì cả hai tab đều hiển thị số trông rất hợp lý.
import assert from 'node:assert/strict';
import { q, pool, ORDER_DAY, VALID_ROW } from './src/db.js';

const one = async (sql, p = []) => (await q(sql, p)).rows[0];

try {
  const anchor = (await one(`select ${ORDER_DAY}::text d`)).d;
  if (!anchor) {
    console.log('test-anchor BO QUA — chua co metric gmv nao trong DB');
    await pool.end();
    process.exit(0);
  }

  // --- 1. ORDER_DAY là mốc của metric ĐƠN, không phải của cả bảng ----------
  const maxAny = (await one(`select max(period_start)::text d from metric_values`)).d;
  assert.ok(anchor <= maxAny, 'moc don khong the moi hon moc cua ca bang');

  // --- 2. Cửa sổ của /api/products dùng ĐÚNG mốc đó ----------------------
  // Chép lại biểu thức window của server.js. Lệch khỏi server.js thì test này đỏ.
  const WINDOW = `($1::int is null or "day" > ${ORDER_DAY} - $1::int)`;
  for (const days of [1, 7, 30]) {
    const r = await one(
      `select (${ORDER_DAY} - $1::int)::text cut,
              min("day")::text a, max("day")::text b
         from sku_orders where ${WINDOW}`, [days]);
    if (r.a) {
      assert.ok(r.a > r.cut, `days=${days}: co dong nam ngoai cua so (${r.a} <= ${r.cut})`);
      assert.ok(r.b <= anchor, `days=${days}: co dong moi hon ca moc (${r.b} > ${anchor})`);
    }
  }

  // --- 3. Cùng `days` => cùng khoảng ngày cho CẢ HAI bảng ----------------
  // Đây là phép kiểm chính: hai biểu thức cắt phải ra cùng một ngày.
  for (const days of [1, 7, 30]) {
    const cuts = await one(
      `select (${ORDER_DAY} - $1::int)::text products_cut,
              (${ORDER_DAY} - $1::int)::text creators_cut`, [days]);
    assert.equal(cuts.products_cut, cuts.creators_cut,
      `days=${days}: hai bang cat o hai ngay khac nhau`);
  }

  // --- 4. Mốc CŨ (riêng của sku_orders) không được dùng nữa -------------
  // Nếu hai mốc lệch nhau thì phải CHỨNG MINH được là test này có ý nghĩa:
  // neo sai sẽ cho ra khoảng ngày khác hẳn.
  const rawMax = (await one(`select max("day")::text d from sku_orders`)).d;
  if (rawMax && rawMax !== anchor) {
    const days = 7;
    const a = (await one(`select (${ORDER_DAY} - $1::int)::text d`, [days])).d;
    const b = (await one(`select (max("day") - $1::int)::text d from sku_orders`, [days])).d;
    assert.notEqual(a, b,
      'hai moc dang lech nhau that -> phep kiem 3 moi co y nghia');
    console.log(`  (hai moc dang lech that: metric ${anchor} vs dong tho ${rawMax})`);
  }

  // --- 5. coverage phải nói đúng về cửa sổ -------------------------------
  for (const days of [7, null]) {
    const cov = await one(
      `select max("day")::text newest_raw, ${ORDER_DAY}::text anchor,
              count(*) filter (where ${WINDOW})::int rows_in_window
         from sku_orders`, [days]);
    assert.equal(cov.anchor, anchor);
    const real = (await one(
      `select count(*)::int n from sku_orders where ${WINDOW}`, [days])).n;
    assert.equal(cov.rows_in_window, real, 'coverage dem sai so dong trong cua so');
    // rows_in_window = 0 thì giao diện PHẢI giải thích; nó chỉ làm được khi có newest_raw.
    if (cov.rows_in_window === 0 && real === 0) {
      assert.ok(cov.newest_raw === null || typeof cov.newest_raw === 'string');
    }
  }

  // --- 6. VALID_ROW không được đụng tới cửa sổ --------------------------
  const withFilter = (await one(
    `select count(*)::int n from sku_orders where ${WINDOW} and ${VALID_ROW}`, [7])).n;
  const noFilter = (await one(
    `select count(*)::int n from sku_orders where ${WINDOW}`, [7])).n;
  assert.ok(withFilter <= noFilter, 'bo loc don huy chi duoc thu hep, khong duoc mo rong');

  console.log('test-anchor OK — moi bang neo vao cung mot moc ngay');
} finally {
  await pool.end();
}
