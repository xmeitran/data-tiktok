// Ô CSV: chặn formula injection. Chạy: node test-csv.mjs   (không cần DB, không cần mạng)
//
// product_name / shop_name đến từ TikTok. Excel & Sheets chạy ô bắt đầu bằng = + - @
// như công thức, nên file xuất ra là một đường chạy biểu thức của người ngoài trên máy
// người dùng. Dấu ' phía trước làm bảng tính đọc nó là chữ.
import assert from 'node:assert/strict';
import { csvCell } from './public/csv.js';

// --- Ký tự mở đầu nguy hiểm phải được vô hiệu hoá -------------------------
for (const payload of [
  '=1+1',
  '=HYPERLINK("http://evil.example","nhan vao day")',
  '+1+1',
  '-1+1',
  '@SUM(A1:A9)',
  '\tcmd',
  '\rcmd',
  '=cmd|\' /C calc\'!A0',                 // payload DDE kinh dien
]) {
  const out = csvCell(payload);
  assert.ok(out.startsWith('"\''), `KHONG chan: ${JSON.stringify(payload)} -> ${out}`);
  // Nội dung gốc phải còn nguyên sau dấu ' — chặn không được làm hỏng dữ liệu.
  assert.ok(out.includes(payload.replace(/"/g, '""')), `lam mat noi dung: ${payload}`);
}

// --- Chuỗi bình thường KHÔNG được thêm gì ---------------------------------
for (const ok of [
  '[UB] Make P:rem Kem chống nắng SPF 50+',
  'SammiShop Offical',
  'creator_01',
  'Giảm 50% - mua ngay',                  // dấu - ở GIỮA không phải mở đầu
  '',
]) {
  assert.equal(csvCell(ok), `"${ok}"`, `khong duoc doi chuoi binh thuong: ${ok}`);
}

// --- Dấu " phải được nhân đôi (đúng chuẩn CSV) ---------------------------
assert.equal(csvCell('Kem "chống nắng"'), '"Kem ""chống nắng"""');
// Cả hai việc cùng lúc: vừa chặn mở đầu, vừa escape dấu ".
assert.equal(csvCell('="a"'), `"'=""a"""`);

// --- Số giữ nguyên là số: không bọc ngoặc, không để Excel đọc thành chữ --
assert.equal(csvCell(1234), 1234);
assert.equal(csvCell(0), 0);
assert.equal(csvCell(-5.5), -5.5, 'so AM la so, khong phai chuoi mo dau bang -');
assert.equal(csvCell(1e21), 1e21);

// --- null/undefined thành ô rỗng, không phải chữ "null" -----------------
assert.equal(csvCell(null), '""');
assert.equal(csvCell(undefined), '""');

// --- Không được nổ với giá trị lạ --------------------------------------
assert.equal(csvCell(false), '"false"');
assert.ok(typeof csvCell({}) === 'string');

console.log('test-csv OK — 26 phep kiem o CSV (chan formula injection, giu nguyen noi dung)');
