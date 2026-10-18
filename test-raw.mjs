// Bang tho sku_orders va metric_values phai ke duoc CUNG MOT cau chuyen.
// Bo loc don huy bi VIET HAI LAN: aggregate() trong src/sync.js va VALID_ROW trong
// src/server.js. Test nay la thu duy nhat bat duoc khi mot ben bi sua ma ben kia khong.
// CAN DB. Chay: node test-raw.mjs
import assert from 'node:assert/strict';
import { pool, q } from './src/db.js';

const { rows: [d] } = await q(`select count(distinct "day")::int n from sku_orders`);
if (!d.n) { console.log('test-raw BO QUA — chua co dong tho nao'); await pool.end(); process.exit(0); }

// Các metric gross/net phải đọc lại được từ bảng raw. Đây là phép kiểm chống việc
// đổi công thức aggregate nhưng quên rebuild hoặc để server dùng bộ lọc khác.
const { rows: [c] } = await q(`
  select (select sum(price_amount * quantity) from sku_orders
          where coalesce(upper(settle_status), '') <> 'INELIGIBLE'
            and coalesce(upper(fully_return), '') <> 'YES')::numeric raw_net,
         (select sum(value) from metric_values
          where metric_key = 'net_gmv'
            and period_start in (select distinct "day" from sku_orders))::numeric mv_net`);
assert.equal(Number(c.raw_net), Number(c.mv_net),
  `net_gmv lech: bang tho ${c.raw_net} vs metric_values ${c.mv_net} -- bo loc don huy o sync.js va server.js da khac nhau`);

for (const [metric, sql] of [
  ['orders_all',       `count(distinct order_id)`],
  ['items_sold',       `coalesce(sum(quantity), 0)`],
  ['items_sold_net',   `coalesce(sum(quantity) filter (where coalesce(upper(settle_status), '') <> 'INELIGIBLE' and coalesce(upper(fully_return), '') <> 'YES'), 0)`],
  ['refunded_items',   `coalesce(sum(quantity) filter (where upper(settle_status) = 'INELIGIBLE' or upper(fully_return) = 'YES'), 0)`],
  ['est_commission',   `coalesce(sum(est_commission), 0)`],
  ['est_commission_net', `coalesce(sum(est_commission) filter (where coalesce(upper(settle_status), '') <> 'INELIGIBLE' and coalesce(upper(fully_return), '') <> 'YES'), 0)`],
  ['commission_base',  `coalesce(sum(commission_base), 0)`],
  ['commission_base_net', `coalesce(sum(commission_base) filter (where coalesce(upper(settle_status), '') <> 'INELIGIBLE' and coalesce(upper(fully_return), '') <> 'YES'), 0)`],
]) {
  const { rows } = await q(`
    select count(*)::int lech from (
      select r.creator_username, r."day", ${sql}::numeric tho, max(v.value) gop
      from sku_orders r
      join metric_values v on v.creator_username = r.creator_username
       and v.period_start = r."day" and v.metric_key = $1
      group by 1, 2
    ) t where tho is distinct from gop`, [metric]);
  assert.equal(rows[0].lech, 0, `${metric}: ${rows[0].lech} cap (creator, ngay) lech giua bang tho va metric_values`);
}

// Cac chieu trong metric_values phai dem lai duoc tu bang tho, theo tung creator tung ngay.
for (const [metric, sql] of [
  ['products_sold',      `count(distinct product_id)`],
  ['shops_sold',         `count(distinct shop_name)`],
  ['videos_with_orders', `count(distinct content_id) filter (where content_type = 'VIDEO')`],
  ['lives_with_orders',  `count(distinct content_id) filter (where content_type = 'LIVE')`],
]) {
  const { rows } = await q(`
    select count(*)::int lech from (
      select r.creator_username, r."day", ${sql}::numeric tho, max(v.value) gop
      from sku_orders r
      join metric_values v on v.creator_username = r.creator_username
       and v.period_start = r."day" and v.metric_key = $1
      where r.settle_status is distinct from 'INELIGIBLE' and r.fully_return is distinct from 'Yes'
      group by 1, 2
    ) t where tho is distinct from gop`, [metric]);
  assert.equal(rows[0].lech, 0, `${metric}: ${rows[0].lech} cap (creator, ngay) lech giua bang tho va metric_values`);
}

// Khoa chinh phai that su duy nhat -- neu khong writeRaw se am tham lam mat dong.
const { rows: [k] } = await q(`
  select count(*)::int n from (
    select order_id, sku_id, content_id from sku_orders
    group by 1,2,3 having count(*) > 1) t`);
assert.equal(k.n, 0, 'co dong tho trung khoa (order_id, sku_id, content_id)');

console.log(`test-raw OK — ${d.n} ngay tho khop metric_values tren nhom metric gross/net + dimensions`);
await pool.end();
