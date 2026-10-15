// Một ô CSV. Tách khỏi app.js để test được: app.js chạm DOM ngay ở top level nên không
// import vào node, mà đây là một guard ở ranh giới tin cậy — không được để không kiểm.
//
// `product_name` và `shop_name` đến từ TikTok, tức là dữ liệu người ngoài. Excel và Google
// Sheets coi ô bắt đầu bằng = + - @ (hoặc tab/CR) là CÔNG THỨC, nên mở file xuất ra là chạy
// biểu thức của người khác (=HYPERLINK(...), =cmd|...). Chèn một dấu ' phía trước: bảng tính
// hiểu "đây là chữ", còn nội dung đọc ra vẫn nguyên văn.
const CSV_RISK = /^[=+\-@\t\r]/;

export const csvCell = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '');
  return `"${(CSV_RISK.test(t) ? "'" + t : t).replace(/"/g, '""')}"`;
};
