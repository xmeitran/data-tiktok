// Registry metric phải nói thật. Chạy: node test-metrics.mjs   (không cần DB, không cần mạng)
//
// `available: true` là lời hứa với giao diện: tab Chỉ số gắn nhãn "Đã kéo", và dropdown
// biểu đồ cho chọn metric đó. Một metric khai available nhưng không pipeline nào sinh ra
// thì dashboard nói dối — chính xác là thứ cột `available` được tạo ra để tránh.
// (showcase_products_unsold đã khai available: true suốt mà không nơi nào tính.)
import assert from 'node:assert/strict';
import { METRICS, BY_KEY, ratios, RATIO_KEYS } from './src/metrics.js';
import { aggregate } from './src/sync.js';
import { aggregateCreator } from './src/sync-creator.js';

// Chạy thật hai pipeline rồi lấy key chúng sinh ra, thay vì chép tay một danh sách —
// danh sách chép tay sẽ lệch ngay lần sửa aggregate tiếp theo.
const fromOrders = Object.keys(aggregate([{
  id: 'o1', sku_id: 's1', content_id: 'c1', creator_username: 'u', quantity: 1,
  settle_status: 'SETTLED', fully_return: 'No', content_type: 'VIDEO',
  product_id: 'p1', shop_name: 'shop', price: { amount: '1000', currency: 'VND' },
  estimated_commission_base: { amount: '800', currency: 'VND' },
  estimated_standard_commission: { amount: '120', currency: 'VND' },
}]).byCreator.get('u'));

const fromCreator = Object.keys(aggregateCreator({
  samples: [{ id: 'a1', status: 'COMPLETED' }],
  showcase: [{ id: 'p1' }],
  collaborations: [{ id: 'c1' }],
}));

const produced = new Set([...fromOrders, ...fromCreator]);

// --- 1. Khai "đã kéo" thì phải có chỗ sinh ra -------------------------------
for (const m of METRICS) {
  if (!m.available) continue;
  // `live: true` = trạng thái HIỆN TẠI, tính trong /api/system (authMetrics), không đi
  // qua metric_values. Không nằm trong `produced` là đúng.
  if (m.live) continue;
  assert.ok(produced.has(m.key),
    `${m.key}: available=true nhưng KHÔNG pipeline nào sinh ra nó. ` +
    `Đặt available=false, hoặc tính nó trong aggregate()/aggregateCreator().`);
}

// --- 2. Và ngược lại: sinh ra cái gì thì phải khai cái đó -------------------
// metric_values nhận bất cứ key nào writeDay/writeMetrics ghi vào. Key không có trong
// registry sẽ lọt vào DB rồi không bao giờ hiện ra ở đâu.
for (const key of produced) {
  assert.ok(BY_KEY[key], `${key}: pipeline ghi vào metric_values nhưng registry không khai`);
  assert.equal(BY_KEY[key].available, true,
    `${key}: pipeline CÓ sinh ra nhưng registry khai available=false`);
}

// --- 3. Metric chưa kéo phải nói được VÌ SAO -------------------------------
// app.js render chúng ở #kpis-na với `<p class="why">${m.source}</p>` — ô đó là chỗ duy
// nhất người dùng đọc được lý do, nên không được để rỗng.
for (const m of METRICS) {
  if (m.available) continue;
  assert.ok(m.source?.length > 20, `${m.key}: available=false mà source không giải thích gì`);
}

// --- 4. Ba tỷ lệ phải do ratios() tính, và chỉ ba cái đó -------------------
assert.deepEqual([...RATIO_KEYS].sort(), ['aov', 'commission_rate', 'refund_rate']);
for (const k of RATIO_KEYS) {
  assert.ok(BY_KEY[k], `${k}: ratios() tính nhưng registry không khai`);
  // Tỷ lệ là metric DẪN XUẤT: không đọc trường API nào, nên fields phải rỗng.
  assert.deepEqual(BY_KEY[k].fields, [], `${k}: tỷ lệ dẫn xuất không được khai fields`);
}
assert.deepEqual(Object.keys(ratios()).sort(), [...RATIO_KEYS].sort());

// --- 5. Khoá registry không trùng, và mọi metric có đủ phần người đọc cần --
assert.equal(new Set(METRICS.map(m => m.key)).size, METRICS.length, 'key metric bị trùng');
for (const m of METRICS) {
  for (const f of ['label', 'group', 'unit', 'level', 'definition', 'formula', 'source', 'pitfalls']) {
    assert.ok(String(m[f] ?? '').length > 0, `${m.key}: thiếu '${f}'`);
  }
}

const na = METRICS.filter(m => !m.available).map(m => m.key);
console.log(`test-metrics OK — ${METRICS.length} metric, ${produced.size} có pipeline, ` +
            `${na.length} chưa kéo (${na.join(', ')})`);
