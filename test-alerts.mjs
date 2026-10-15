// Luật cảnh báo creator. Chạy: node test-alerts.mjs   (không cần DB, không cần mạng)
//
// Cảnh báo sai còn tệ hơn không có cảnh báo: gắn cờ đỏ cho creator mới bắt đầu, hoặc cho
// người bán 2 đơn hoàn 1, thì sau một tuần không ai nhìn cờ nữa. Phần lớn phép kiểm dưới
// đây là về chuyện KHÔNG được báo.
import assert from 'node:assert/strict';
import { alertsFor, change, worst, summarize, RULES } from './public/alerts.js';

const c = (gmv, prevGmv, extra = {}) => ({
  gmv, orders: 10, refund_orders: 0, refund_rate: 0,
  prev: { gmv: prevGmv }, ...extra,
});
const codes = (x) => alertsFor(x).map(a => a.code);

// --- change(): không so được KHÁC không đổi ------------------------------
assert.equal(change(150, 100), 50);
assert.equal(change(50, 100), -50);
assert.equal(change(100, 100), 0);
assert.equal(change(100, 0), null, 'ky truoc = 0 thi KHONG so duoc, khong phai +100%');
assert.equal(change(5, undefined), null, 'khong co ky truoc thi phai la null');
assert.equal(change(0, 100), -100);
assert.notEqual(change(100, 0), 0, 'null va 0 la hai chuyen khac nhau');

// --- Tụt dốc -------------------------------------------------------------
assert.deepEqual(codes(c(5e6, 10e6)), ['drop'], 'giam 50% phai bao');
// 7.5/10 = -25%, DƯỚI ngưỡng 30 -> không được báo.
assert.deepEqual(codes(c(7.5e6, 10e6)), [], 'giam 25% la dao dong binh thuong, khong duoc bao');
assert.deepEqual(codes(c(7e6, 10e6)), ['drop'], 'giam 30% (dung nguong) phai bao');
assert.match(alertsFor(c(5e6, 10e6))[0].text, /50%/, 'co phai tu noi ra con so');

// --- Ngừng hẳn: nói riêng, không gộp vào "giảm 100%" --------------------
assert.deepEqual(codes(c(0, 10e6)), ['stopped']);
assert.match(alertsFor(c(0, 10e6))[0].text, /Không có đơn/);
assert.equal(alertsFor(c(0, 10e6))[0].level, 'bad');

// --- Sàn chống nhiễu: creator nhỏ KHÔNG được gắn cờ --------------------
assert.deepEqual(codes(c(0, 500_000)), [],
  'ky truoc duoi 1 trieu -> khong du de ket luan tut doc');
assert.deepEqual(codes(c(100, 900_000)), [], 'giam 99.9% nhung ky truoc qua nho');
assert.deepEqual(codes(c(0, 0)), [], 'creator chua ban gi khong duoc bao gi');
assert.deepEqual(codes({ gmv: 5e6 }), [], 'khong co ky truoc (chon "tat ca") thi khong bao');
assert.deepEqual(codes({ gmv: 5e6, prev: {} }), []);

// --- Tăng mạnh cũng đáng biết ------------------------------------------
assert.deepEqual(codes(c(20e6, 10e6)), ['rise']);
assert.equal(alertsFor(c(20e6, 10e6))[0].level, 'good');
assert.deepEqual(codes(c(14e6, 10e6)), [], 'tang 40% chua toi nguong 50%');

// --- Hoàn cao: độc lập với tụt dốc -------------------------------------
const hoan = { orders: 10, refund_orders: 5, refund_rate: 35 };
assert.deepEqual(codes(c(10e6, 10e6, hoan)), ['refund']);
// Vừa tụt vừa hoàn cao -> phải ra CẢ HAI, nặng trước.
const both = alertsFor(c(3e6, 10e6, hoan));
assert.deepEqual(both.map(a => a.code), ['drop', 'refund']);
// Bán tốt mà hoàn cao vẫn phải bị hỏi.
assert.deepEqual(codes(c(30e6, 10e6, hoan)), ['rise', 'refund']);

// --- Hoàn cao: không báo khi quá ít đơn --------------------------------
assert.deepEqual(codes(c(10e6, 10e6, { orders: 1, refund_orders: 1, refund_rate: 50 })), [],
  '2 don hoan 1 la 50% nhung khong noi len dieu gi');
assert.deepEqual(codes(c(10e6, 10e6, { orders: 4, refund_orders: 0, refund_rate: 99 })), [],
  'duoi 5 don thi chua ket luan');
assert.deepEqual(codes(c(10e6, 10e6, { orders: 5, refund_orders: 0, refund_rate: 20 })), ['refund'],
  'dung nguong ca hai phia thi bao');
assert.deepEqual(codes(c(10e6, 10e6, { orders: 10, refund_orders: 0, refund_rate: 19.9 })), [],
  'duoi nguong hoan thi thoi');

// --- worst(): chọn cờ nặng nhất ----------------------------------------
assert.equal(worst([])?.code, undefined);
assert.equal(worst(alertsFor(c(3e6, 10e6, hoan))).code, 'drop', 'bad nang hon warn');
assert.equal(worst(alertsFor(c(30e6, 10e6, hoan))).code, 'refund', 'warn nang hon good');

// --- summarize(): đếm cho dải tổng hợp đầu bảng ------------------------
const s = summarize([
  c(0, 10e6),                       // stopped
  c(3e6, 10e6),                     // drop
  c(10e6, 10e6, hoan),              // refund
  c(30e6, 10e6),                    // rise
  c(10e6, 10e6),                    // sạch
]);
assert.deepEqual(s.counts, { stopped: 1, drop: 1, refund: 1, rise: 1 });
assert.equal(s.rows.length, 5);
assert.equal(s.rows[4].alerts.length, 0, 'creator binh thuong khong duoc dinh co nao');
assert.ok(s.rows.every(r => Array.isArray(r.alerts)), 'moi dong deu phai co mang alerts');
// Không được làm hỏng dữ liệu gốc.
assert.equal(s.rows[0].gmv, 0);
assert.deepEqual(summarize([]).counts, { stopped: 0, drop: 0, refund: 0, rise: 0 });
assert.deepEqual(summarize().rows, []);

// --- Ngưỡng chỉnh được từ một chỗ --------------------------------------
assert.deepEqual(alertsFor(c(9e6, 10e6), { ...RULES, dropPct: 5 }).map(a => a.code), ['drop'],
  'ha nguong xuong 5% thi giam 10% phai bao');

console.log('test-alerts OK — 38 phep kiem luat canh bao (phan lon la ve KHONG duoc bao)');
