// Luật cảnh báo cho bảng creator. Tách riêng để test được, và để NGƯỠNG nằm một chỗ —
// ngưỡng rải trong code render là thứ không ai chỉnh lại được sau ba tháng.
//
// Vì sao có file này: dashboard trước đây hiển thị đúng số nhưng không trả lời câu hỏi
// người ta thật sự mở nó lên để hỏi — "ai đang tụt?", "ai đang đốt tiền seller?".
// Bắt người dùng tự so 111 dòng với kỳ trước bằng mắt thì không ai làm, nên không ai biết.

export const RULES = {
  // Giảm ≥30% GMV so với kỳ trước. Dưới mức đó là dao động bình thường của một creator.
  dropPct: 30,
  // Tỷ lệ hoàn ≥20% tiền. Ngưỡng này là để BẮT ĐẦU hỏi, không phải kết luận.
  refundPct: 20,
  // Tăng ≥50% thì đáng khen ngang với đáng lo — agency cần biết để nhân rộng.
  risePct: 50,
  // Sàn chống nhiễu: creator bán vài trăm nghìn thì ±100% là vô nghĩa. Mọi luật so sánh
  // chỉ chạy khi KỲ TRƯỚC đủ lớn, để một creator mới bắt đầu không bị gắn cờ "tụt dốc".
  minGmv: 1_000_000,
  // Hoàn cao chỉ đáng nói khi đã có đủ đơn; 1/1 đơn hoàn là 100% nhưng không nói lên gì.
  minOrders: 5,
};

const n = (v) => Number(v) || 0;

// % thay đổi so với kỳ trước. null = không so được (không có kỳ trước, hoặc kỳ trước = 0),
// KHÁC hẳn 0 = không đổi. Trả 0 ở đây là nói dối người đọc.
export function change(cur, prev) {
  const a = n(cur), b = n(prev);
  if (!b) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

// Trả về các cờ của MỘT creator, nặng nhất trước. Mỗi cờ tự nói ra con số làm nó bật,
// để người đọc kiểm lại được chứ không phải tin suông.
export function alertsFor(c = {}, rules = RULES) {
  const out = [];
  const prev = c.prev ?? {};
  const gmv = n(c.gmv), pg = n(prev.gmv);
  const big = pg >= rules.minGmv;              // kỳ trước đủ lớn để so

  // Ngừng hẳn: nặng hơn tụt dốc, và phải nói riêng — "giảm 100%" đọc không ra việc gì.
  if (big && gmv === 0) {
    out.push({ level: 'bad', code: 'stopped', text: 'Không có đơn nào kỳ này' });
  } else if (big) {
    const d = change(gmv, pg);
    if (d !== null && d <= -rules.dropPct) {
      out.push({ level: 'bad', code: 'drop', text: `GMV giảm ${Math.abs(d).toFixed(0)}%` });
    } else if (d !== null && d >= rules.risePct) {
      out.push({ level: 'good', code: 'rise', text: `GMV tăng ${d.toFixed(0)}%` });
    }
  }

  // Hoàn cao: độc lập với tụt dốc. Một creator vừa bán tốt vừa hoàn 40% vẫn phải bị hỏi.
  const allOrders = n(c.orders_all) || n(c.orders) + n(c.refund_orders);
  if (allOrders >= rules.minOrders && n(c.refund_rate) >= rules.refundPct) {
    out.push({ level: 'warn', code: 'refund', text: `Hoàn ${n(c.refund_rate).toFixed(0)}% tiền` });
  }

  return out;
}

// Thứ tự nặng -> nhẹ, để sắp xếp và để chọn màu một dòng.
const WEIGHT = { bad: 3, warn: 2, good: 1 };
export const worst = (list = []) =>
  list.reduce((w, a) => (WEIGHT[a.level] ?? 0) > (WEIGHT[w?.level] ?? 0) ? a : w, null);

// Gắn cờ cho cả danh sách + tổng hợp để hiện lên đầu bảng. Một lần duyệt, vì bảng này
// render lại mỗi lần gõ phím vào ô tìm kiếm.
export function summarize(creators = [], rules = RULES) {
  const rows = creators.map(c => ({ ...c, alerts: alertsFor(c, rules) }));
  const count = (code) => rows.filter(r => r.alerts.some(a => a.code === code)).length;
  return {
    rows,
    counts: { stopped: count('stopped'), drop: count('drop'),
              refund: count('refund'), rise: count('rise') },
  };
}
