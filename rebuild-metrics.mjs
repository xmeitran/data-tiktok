// Rebuild order-derived metric_values from the immutable-ish sku_orders ledger.
// This is intentionally separate from the network sync: changing a formula must not
// require downloading TikTok data again, and it must not touch raw orders or tokens.
import { q, pool, upsertMany } from './src/db.js';
import { aggregate } from './src/sync.js';

const asMoney = (amount, currency) => ({
  amount: amount == null ? '' : (() => {
    const raw = String(amount);
    return raw.includes('.') ? raw.replace(/0+$/, '').replace(/\.$/, '') : raw;
  })(),
  currency: currency ?? null,
});

const toApiRow = (r) => ({
  id: r.order_id,
  sku_id: r.sku_id,
  content_id: r.content_id,
  creator_username: r.creator_username,
  product_id: r.product_id,
  product_name: r.product_name,
  shop_name: r.shop_name,
  content_type: r.content_type,
  settle_status: r.settle_status,
  fully_return: r.fully_return,
  quantity: r.quantity,
  price: asMoney(r.price_amount, r.currency),
  estimated_commission_base: asMoney(r.commission_base, r.currency),
  // The raw ledger stores the already summed estimate. Feeding it through one
  // component preserves the total without pretending the component split is known.
  estimated_standard_commission: asMoney(r.est_commission, r.currency),
});

async function writeMetrics(dayStr, byCreator) {
  const usernames = [...byCreator.keys()];
  if (!usernames.length) return 0;

  // Existing creator first_seen/last_seen are authoritative; this rebuild must not
  // move them backward or forward just because days are processed chronologically.
  await upsertMany('creators', ['username', 'first_seen', 'last_seen'], ['username'],
    [], usernames.map(username => [username, dayStr, dayStr]));

  const rows = [];
  for (const [username, metrics] of byCreator) {
    for (const [metric_key, value] of Object.entries(metrics)) {
      rows.push([username, metric_key, dayStr, dayStr, value]);
    }
  }
  return upsertMany(
    'metric_values',
    ['creator_username', 'metric_key', 'period_start', 'period_end', 'value'],
    ['creator_username', 'metric_key', 'period_start', 'period_end'],
    ['value'],
    rows,
  );
}

const { rows: days } = await q(`select distinct "day"::text as day_value from sku_orders order by day_value`);
let rowsRead = 0;
let metricRows = 0;
let warnings = 0;

try {
  for (const { day_value: day } of days) {
    const { rows } = await q(
      `select order_id, sku_id, content_id, creator_username, product_id, product_name,
              shop_name, content_type, settle_status, fully_return, quantity,
              price_amount, currency, commission_base, est_commission
         from sku_orders where "day" = $1::date`, [day]);
    const result = aggregate(rows.map(toApiRow));
    rowsRead += rows.length;
    warnings += result.warnings.length;
    metricRows += await writeMetrics(day, result.byCreator);
    console.log(`${day}: ${rows.length} raw -> ${result.byCreator.size} creators, ${metricRows} metric rows total`);
  }
  console.log(`rebuild OK — ${days.length} ngày, ${rowsRead} raw rows, ${metricRows} metric rows, ${warnings} warning batches`);
} finally {
  await pool.end();
}
