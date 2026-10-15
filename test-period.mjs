// Chia kỳ cho KPI / biểu đồ / bảng Theo ngày. Chạy: node test-period.mjs  (không cần DB)
//
// Hai lỗi thật đã xảy ra ở đây:
//   1. delta() so tổng 7 ngày với tổng 3 ngày -> hiện "+133%" khi GMV/ngày không đổi.
//   2. Ngày chỉ có metric ảnh chụp creator (sync-creator ghi HÔM NAY, sync đơn chỉ tới
//      HÔM QUA) bị tính là một ngày dữ liệu -> kỳ "7 ngày" chỉ còn 6 ngày GMV.
import assert from 'node:assert/strict';
import { periods, orderDays } from './public/period.js';

// Ngày có đơn: aggregate() luôn ghi `gmv`. Ngày chỉ có ảnh chụp thì không có key đó.
const d = (i) => ({ day: `2026-10-${String(i).padStart(2, '0')}`, gmv: 100, orders: 2 });
const snap = (i) => ({ day: `2026-10-${String(i).padStart(2, '0')}`, sample_requests: 5 });

// --- orderDays(): lọc ngày chỉ có ảnh chụp ---------------------------------
assert.equal(orderDays([d(1), d(2), snap(3)]).length, 2, 'ngày chỉ có ảnh chụp không phải ngày dữ liệu');
assert.equal(orderDays([]).length, 0);
assert.equal(orderDays().length, 0, 'chưa load xong thì không được nổ');
// gmv = 0 VẪN là một ngày có dữ liệu (ngày không ai bán được gì), khác hẳn không có key.
assert.equal(orderDays([{ day: 'x', gmv: 0 }]).length, 1, 'gmv=0 là ngày thật, không phải ngày rỗng');

// --- Lỗi 1: kỳ trước phải DÀI BẰNG kỳ này ---------------------------------
const ten = Array.from({ length: 10 }, (_, i) => d(i + 1));
const p10 = periods(ten, 7);
assert.equal(p10.cur.length, 7);
assert.deepEqual(p10.prev, [],
  'chỉ 10 ngày lịch sử: kỳ trước chỉ được 3 ngày nên KHÔNG so được -> phải rỗng');

// Đủ 14 ngày thì mới so, và hai kỳ không được chồng nhau.
const fourteen = Array.from({ length: 14 }, (_, i) => d(i + 1));
const p14 = periods(fourteen, 7);
assert.equal(p14.cur.length, 7);
assert.equal(p14.prev.length, 7);
assert.equal(p14.cur[0].day, '2026-10-08');
assert.equal(p14.prev.at(-1).day, '2026-10-07', 'kỳ trước phải liền ngay trước kỳ này');
assert.equal(new Set([...p14.cur, ...p14.prev].map(x => x.day)).size, 14, 'hai kỳ không được chồng nhau');

// Biên: đúng 2x thì vừa đủ, thiếu 1 ngày là không so.
assert.equal(periods(Array.from({ length: 6 }, (_, i) => d(i + 1)), 3).prev.length, 3);
assert.deepEqual(periods(Array.from({ length: 5 }, (_, i) => d(i + 1)), 3).prev, []);

// --- Lỗi 2: ngày ảnh chụp không được nuốt một slot của kỳ -----------------
// 7 ngày đơn + 1 ngày chỉ có ảnh chụp (hôm nay). Kỳ 7 ngày phải là 7 ngày CÓ ĐƠN.
const withSnap = [...Array.from({ length: 7 }, (_, i) => d(i + 1)), snap(8)];
const ps = periods(withSnap, 7);
assert.equal(ps.cur.length, 7);
assert.equal(ps.cur.reduce((t, x) => t + x.gmv, 0), 700,
  'kỳ "7 ngày" phải có đủ 7 ngày GMV, không phải 6 ngày + 1 dòng số 0');
assert.ok(!ps.cur.some(x => x.gmv === undefined), 'không được lọt dòng rỗng vào biểu đồ');

// --- period = null (tất cả) ------------------------------------------------
const all = periods(withSnap, null);
assert.equal(all.cur.length, 7, 'kể cả "tất cả" cũng bỏ ngày chỉ có ảnh chụp');
assert.deepEqual(all.prev, [], 'chọn "tất cả" thì không có kỳ trước để so');

// --- Chưa có dữ liệu thì không được nổ ------------------------------------
assert.deepEqual(periods([], 7), { cur: [], prev: [] });
assert.deepEqual(periods(), { cur: [], prev: [] });

console.log('test-period OK — 20 phep kiem chia ky (ky truoc du dai + bo ngay anh chup)');
