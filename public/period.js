// Chia chuỗi ngày thành kỳ này / kỳ trước. Tách khỏi app.js vì app.js chạm DOM ngay ở
// top level nên không import được vào node để test — mà đây đúng là chỗ đã sai hai lần.

// Ngày CÓ ĐƠN. /api/daily trả về mọi dòng trong metric_values, kể cả metric ảnh chụp mà
// sync-creator ghi vào HÔM NAY (trong khi sync đơn chỉ ghi tới HÔM QUA). Một ngày chỉ có
// ảnh chụp KHÔNG phải một ngày dữ liệu: tính nó vào thì kỳ "7 ngày" chỉ còn 6 ngày GMV,
// còn bảng Theo ngày và biểu đồ mọc thêm một dòng/một cột toàn số 0.
// `gmv` là đại diện: aggregate() luôn ghi key này cho mọi creator thấy trong ngày.
export const orderDays = (daily = []) => daily.filter(d => d?.gmv !== undefined);

// Kỳ trước PHẢI dài bằng kỳ này mới so được. Trước đây chỉ kiểm "kỳ trước có rỗng không",
// nên với 10 ngày lịch sử và kỳ 7 ngày thì nó so tổng 7 ngày với tổng 3 ngày và hiện
// "▲ +133%" trong khi GMV/ngày không đổi một đồng — suốt hai tuần đầu sau khi deploy,
// đúng lúc người ta tin con số nhất. Không đủ thì trả [] để delta() hiện "—".
export function periods(daily = [], period = null) {
  const d = orderDays(daily);
  if (!period) return { cur: d, prev: [] };
  const prev = d.slice(-period * 2, -period);
  return { cur: d.slice(-period), prev: prev.length === period ? prev : [] };
}
