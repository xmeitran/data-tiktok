# Market research — hướng expand hệ thống

Khảo sát 2026-10-15. Nguồn chủ yếu là blog của vendor và site review có affiliate link, giá mâu
thuẫn nhau giữa các nguồn — coi là tín hiệu định hướng, phải kiểm lại trên trang giá chính chủ
trước khi dùng để định giá.

## 1. Bối cảnh: bạn đang đứng ở chỗ nào

Thị trường tool TikTok Shop hiện chia hai nhóm, và chúng nó giải bài toán khác nhau:

**Nhóm A — scraped market intelligence.** Kalodata, FastMoss, Shoplus. Cào dữ liệu công khai
của toàn sàn: tìm sản phẩm trending, tìm creator để mời. Bán cho người chưa có creator.
Kalodata quảng cáo database 200M+ profile. Giá được báo quanh $45.90–$49.99/tháng (Starter)
và $99.90–$109.99 (Professional), trial 7 ngày; FastMoss $49/$89/$139. Shoplus có nguồn nói đã
đóng cửa 28/08/2026, nguồn khác tháng 7/2026 vẫn còn — chưa xác nhận được.

**Nhóm B — authorized first-party data.** Chỗ bạn đang đứng. Creator tự bấm uỷ quyền, bạn đọc
dữ liệu thật qua Partner API: đơn thật, hoa hồng thật, hoàn thật. Đây là khác biệt cốt lõi — nhóm
A **không có** số liệu này và không cào được. Nhóm B hiện là Colaba ($59–$249/th), Cruva
($199–$599/th), UpTk, Trendio, DAMI (nhắm SEA, tự nhận 8M+ creator DB, đa ngôn ngữ có tiếng Việt).

Hệ quả: đừng cạnh tranh với Kalodata ở "database to hơn". Bạn thua về quy mô cào. Cạnh tranh ở
"số liệu đúng của creator đã ký với tôi" — chỗ họ không vào được.

## 2. Vì sao wiki metric lại là tài sản, không phải tài liệu phụ

Khác biệt gross/net GMV, hoa hồng ước tính vs settle, độ trễ hoàn đơn là chỗ mọi dashboard
affiliate cãi nhau với kế toán. Đối thủ hiển thị số mà không nói rõ định nghĩa. Bảng
`pitfalls` của bạn (`src/metrics.js`) chính là thứ làm được niềm tin khi đối soát — đẩy nó ra
thành trang public để SEO cho các truy vấn kiểu "GMV affiliate là gì", "hoa hồng ước tính khác
settle thế nào".

## 3. Lộ trình expand, xếp theo tỷ lệ giá trị/công sức

**Nên làm trước (rẻ, dùng đúng hạ tầng đã có):**

1. **Bảng xếp hạng creator + cảnh báo tụt dốc.** Dữ liệu đã có trong `metric_values`. Chỉ cần
   thêm so sánh kỳ. Đây là màn hình agency mở hằng ngày.
2. **Đối soát hoa hồng.** `est_commission` vs số settle thực. Đây là nỗi đau số 1 của MCN ở VN
   và không tool scraped nào chạm tới được. Cần nối thêm endpoint settlement.
3. **Theo dõi tỷ lệ hoàn theo creator.** Đã có `refund_rate`. Thêm ngưỡng cảnh báo — creator
   hoàn cao đang đốt tiền seller trong im lặng.
4. **Multi-tenant.** Thêm `tenant_id` vào 3 bảng ngay bây giờ, lúc còn rẻ. Nếu bán cho agency
   khác thì bắt buộc, mà retrofit sau rất đau.

**Giai đoạn 2 (cần nối thêm API, có giá trị bán được):**

5. **Attribution theo nội dung.** Nối `video_count` / `live_count` rồi quy GMV về từng video/phiên
   live. Trả lời được "video nào ra tiền" — chỗ giá trị nhất và chưa ai làm tốt trên dữ liệu
   first-party.
6. **Vòng đời hàng mẫu.** `sample_requests` → tỷ lệ duyệt → tỷ lệ ra nội dung → GMV. Đo được
   ROI của hàng mẫu, thứ các agency đang đoán bằng cảm tính.
7. **Quản lý chia hoa hồng.** Tháng 5/2026 TikTok ra hướng dẫn xử lý linking MCN và thoả thuận
   chia hoa hồng trong app — tool nào động vào commission split phải khớp workflow đó.

**Giai đoạn 3 (sản phẩm riêng):**

8. **Benchmark ẩn danh.** Khi đã có đủ creator, bán so sánh ngành ("AOV của bạn thấp hơn 30% so
   với nhóm cùng ngành"). Chỉ có với dữ liệu first-party gộp lại. Cần điều khoản xử lý dữ liệu rõ
   ràng với creator trước khi làm.
9. **Lai nhóm A.** Mua/cào thêm dữ liệu công khai để gợi ý creator mới. Làm sau, vì đây là chỗ
   đốt tiền và cạnh tranh đông.

## 4. Rủi ro cần canh

- **Phụ thuộc API.** `/affiliate_creator/202405/` là có version. TikTok đổi gen API là phải sửa.
  Giữ nguyên lớp registry metric để lúc đổi chỉ sửa mapping, không sửa UI.
- **Chính sách.** 03/2026 TikTok siết điều kiện Affiliate (shop có Service-related Negative
  Reviews bị loại). Chính sách đổi có thể xoá sổ một tính năng.
- **Rời bỏ uỷ quyền.** Creator huỷ uỷ quyền là dữ liệu tắt ngay. Giá trị sản phẩm phải đủ lớn để
  họ không huỷ — một dashboard chỉ-đọc rất dễ bị bỏ.
- **Giá tham chiếu.** Nhóm B đang $59–$599/tháng. Nếu định giá theo giá trị đối soát, cạnh dưới
  của khoảng này là hợp lý cho thị trường VN; cần tự xác nhận lại trên trang giá chính chủ.

## Nguồn

- [TikTok Shop Partner Center — Affiliate integration](https://partner.tiktokshop.com/docv2/page/affiliate-integration)
- [Affiliate Seller API overview](https://partner.tiktokshop.com/docv2/page/6697960798b0a502f89e3d00)
- [Partner authorization guide](https://partner.tiktokshop.com/docv2/page/partner-authorization-guide)
- [MCN governance](https://partner.tiktokshop.com/docv2/page/multi-channel-network-mcn)
- [TikTok Shop Affiliate APIs: Creator, Partner, and Seller](https://bemomentiq.com/blog/tiktok-shop-affiliate-apis-explained)
- [Top 8 TikTok Shop Affiliate Management Options (2026)](https://www.hamstergarage.com/article/tiktok-shop-affiliate-management-options-guide)
- [TikTok Shop Affiliate Program Management: 7 Platforms](https://www.tkdami.com/blog/8820/)
- [SEA TikTok Shop Affiliate Scaling 2026](https://www.tkdami.com/blog/8972/)
- [Kalodata pricing 2026](https://tipsonblogging.com/2025/05/kalodata-pricing/)
- [FastMoss review 2026](https://www.spotsaas.com/blog/fastmoss-review-2026-features-pricing-and-tiktok-shop-analytics-guide)
- [Kalodata vs Shoplus (báo Shoplus đóng cửa)](https://tipsonblogging.com/2025/06/kalodata-vs-shoplus/)
- [Ecomobi — TikTok Shop Vietnam Partner Awards H1/2026](https://ecomobi.com/ecomobi-honored-at-the-tiktok-shop-vietnam-partner-awards-h1-2026/)
- [MCN & affiliate networks in SEA 2026](https://digitalinasia.com/mcn-affiliate-networks-southeast-asia/)
