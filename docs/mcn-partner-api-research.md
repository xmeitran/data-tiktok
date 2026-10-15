# MCN / partner-level API cho bảng Creator Analytics (728 creator) — 2026-10-15
Nguồn: docv2 qua `/api/v1/document/api_meta` + `/api/v1/document/detail`. KHÔNG sửa code.

## 1. CÓ API batch cấp partner cho MCN — nhưng trả ĐƠN, không trả bảng analytics

**ĐỌC ĐƯỢC** — `API Reference / Affiliate partner`:
- `POST /affiliate_partner/202603/cap_order/search` ("Search CAP Affiliate Orders")
  desc nguyên văn: *"Search affiliate orders for an **MCN (Creator Agency Partner)**"*
  scope: `partner.cap_orders.read`
- `POST /affiliate_partner/202603/tap_order/search` ("Search TAP Affiliate Orders") — bản cho TAP

Một lần gọi ra đơn của TOÀN BỘ creator thuộc MCN, mỗi dòng có `creator_username`.
Uỷ quyền ở cấp partner, KHÔNG cần OAuth từng creator. Đây là thứ thay được kiến trúc hiện tại.

Query: `app_key`, `sign`, `timestamp`, `page_size` (REQ, 1-100), `page_token`,
`category_asset_cipher` (**REQ**).
Body: `order_id`, `product_id`, `settle_status`, `create_time_ge` + `create_time_lt`
(phải đi cùng nhau, AND semantics).
Response: `data.sku_orders[]` (SKU-order level), `next_page_token`, `total_count`.

## 2. ⚠ MÂU THUẪN TRONG TÀI LIỆU về quyền của MCN

**ĐỌC ĐƯỢC** — `Developer Guide / Get started / Authorization / Partner authorization guide`,
nói hai lần:
> "Currently, TikTok Shop Partner Center supports this flow only for the **Seller and Scalable
> Creator Match-Up (TAP)** partner category."
> "The partner must have successfully enrolled in **Seller and Scalable Creator Match-Up (TAP)**."

Nhưng endpoint CAP ở trên tồn tại, scope riêng `partner.cap_orders.read`, desc ghi rõ MCN.

**SUY RA (không đọc được):** guide authorization chưa cập nhật theo nhóm endpoint 202603
(mới nhất trong group). **Không thể khẳng định từ tài liệu** là tài khoản "Vietnam : MCN"
uỷ quyền partner được NGAY HÔM NAY. Đây là điểm duy nhất phải thử thật hoặc hỏi App Store Manager.

## 3. Luồng uỷ quyền partner (ĐỌC ĐƯỢC, khác cả seller lẫn creator)

```
ROW:  https://partner.tiktokshop.com/open/authorize?service_id={service_id}
US :  https://partner.us.tiktokshop.com/open/authorize?service_id={service_id}
```
- Dùng `service_id` → `TTS_SERVICE_ID=7602529679438432021` của project CÓ việc ở hướng này.
  (Ghi chú tôi vừa thêm vào `.env.example` nói service_id "chỉ dùng cho seller" là SAI nếu
  chốt đi hướng partner — cần sửa lại.)
- `state`: "encouraged, but not required" (khác creator: bắt buộc).
- Đổi token: vẫn `GET auth.tiktok-shops.com/api/v2/token/get` → `access_token`,
  `refresh_token`, `granted_scopes`. Header gọi API: `x-tts-access-token`.
- Rồi `GET /authorization/202405/category_assets` (scope `partner.authorization.info`)
  → `category_assets[].cipher` + `target_market`. Cipher này là `category_asset_cipher` bắt buộc.
- "If the app is still in development, the app can only accept authorization from the owner of
  the app." → app đang dev thì user tự uỷ quyền MCN của chính họ được. Không cần creator beta
  account như hướng creator-OAuth.

## 4. Map 6 cột của bảng Creator Analytics

Gộp `sku_orders[]` theo `creator_username`:

| Cột trên UI | Nguồn trong cap_order/search |
|---|---|
| Creator-attributed GMV | tự tính `price.amount × quantity` — **không có field GMV** |
| Creator-attributed items sold | Σ `quantity` (gồm cả hàng hoàn, khớp định nghĩa playbook) |
| Est. commission | Σ `estimated_standard_commission` (+ `_bonus_` / `_shop_ads_` / `_tap_bonus_` — docs KHÔNG nói console cộng những cái nào) |
| Commission base | Σ `estimated_commission_base` (hoặc `actual_commission_base` nếu muốn trừ hoàn) |
| LIVE CTR | **KHÔNG CÓ** |
| Affiliate LIVE CTOR (SKU orders) | **KHÔNG CÓ** |

Thêm: `settle_status` (CUSTOMER UNPAID / PENDING / ...), `fully_return` (Yes/No),
`revenue_sharing_portion_rate`, `estimated_total_agency_earnings` — phần chia agency, hữu ích cho MCN.
Lưu ý: schema cap_order KHÔNG có `creator_open_id`, chỉ có `creator_username`, trong khi
changelog nói Creator Open ID sẽ là primary key từ 202509+. Khoá join cần cân nhắc.

## 5. Export async: CÓ nhưng CHỈ CHO SELLER, MCN không dùng được

**ĐỌC ĐƯỢC** — bộ 3 API nằm trong `API Reference / Affiliate seller`:
- `POST /affiliate_seller/202603/compass/offline_task` (Create Compass Offline Export Task)
- Get Compass Task List / Download Compass Task File (202603)
- scope `seller.affiliate_collaboration.read`, query **`shop_cipher` REQUIRED**
- body có `module_type: CREATOR | BASE`, `plan_type: ALL|TARGET|OPEN|PARTNER`,
  `window_type: PAST_24H|PAST_7_DAYS|PAST_30_DAYS`, `end_day` (vn = UTC+7)

Đúng hình dạng "tạo job → poll → tải file" và có cả `module_type=CREATOR`, NHƯNG bắt buộc
`shop_cipher` + scope seller. MCN không có shop → **không dùng được**.
Cũng loại: `GET /analytics/202511/creators/bestselling` — `shop_cipher` REQ, tối đa 100 creator.

→ Với CTR/CTOR: **không tìm thấy API nào ở cấp partner**. Đường duy nhất là nút Export /
Export custom creator report thủ công. (Cơ sở: đã liệt kê toàn bộ 16 endpoint nhóm Affiliate
partner + 32 endpoint nhóm Analytics; không có cái nào trả CTR/CTOR cho partner.)

## 6. Commission base vs Est. commission

**ĐỌC ĐƯỢC:**
- API `estimated_commission_base`: *"product sale price multiplied by the number of products sold
  when the order is created"*; `actual_commission_base`: trừ returned/refunded.
- `[MCN SEA+UK] Data Compass Playbook`: *"Commission base: This is the base number which we use to
  calculate the estimated commission, and excludes taxes."*
- cùng playbook: *"Est. Commission: The estimated commission a creator can receive, but it may
  differ from the actual commission payment due to factors such as orders refunds."*

→ base là số bị NHÂN, commission = base × rate. Giải thích đúng việc base lớn hơn est. commission
khoảng một bậc (rate ~10%).

⚠ `[CAP Analytics] CAP Data Overview` lại định nghĩa Commission base = *"The amount of order
refunds generated from this creator the selected period"* — trái với hai nguồn trên và trùng
định nghĩa refund ở ngay dưới. Đánh giá: lỗi copy-paste của docs, **đừng dùng câu này**.

## 7. CTOR

**ĐỌC ĐƯỢC:** playbook MCN SEA+UK và TSP SEA+UK đều viết metric là `C_O (click to order)`,
và `[CAP Analytics]` liệt kê `LIVE CTR, LIVE CTOR, Video CTR, Video CTOR`.
Vậy CTOR = **click-to-order rate**.
**SUY RA:** công thức = số đơn / số click sản phẩm. Docs KHÔNG ghi công thức CTOR.
Mốc so sánh đọc được: *"LIVE Avg. CTR: (Number of product clicks / number of livestream views) /
livestreams"*.

## 8. Ảnh hưởng kiến trúc
- 4/6 cột lấy được qua 1 lần uỷ quyền partner + phân trang, bỏ được OAuth 728 creator.
- Vẫn là dữ liệu cấp đơn → lớp `aggregate()` vẫn cần, chỉ đổi nguồn và thêm group-by creator.
- CTR/CTOR không có đường API ở cấp partner → hoặc bỏ khỏi registry, hoặc nhập từ file export.
- `/affiliate_creator/202410/orders/search` không vô ích: còn dùng cho creator ngoài MCN.
- Chặn duy nhất: xác nhận MCN uỷ quyền partner được (mục 2).
