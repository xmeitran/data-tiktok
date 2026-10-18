# TikTok Partner Metrics

Dashboard kiểm tra dữ liệu affiliate của các creator do một **MCN (Creator Agency Partner)** quản lý,
kéo từ TikTok Shop Partner Open API. Node + Express + Postgres, không build step.
Giao diện dùng design token UpBase (`public/tokens.css`).

```
src/metrics.js   <- registry metric: NGUỒN SỰ THẬT cho cả bảng metric lẫn wiki
src/tiktok.js    <- ký HMAC + OAuth partner + gọi API
src/sync.js      <- kéo SKU-order theo ngày -> gộp theo creator -> metric_values
src/server.js    <- REST API + callback OAuth
src/auth.js      <- basic auth cho dashboard
db/schema.sql    <- authorizations, category_assets, creators, metric_values, sync_runs
public/coverage.js <- phân loại ngày rỗng: "thiếu thật" hay "job chưa kéo tới"
public/          <- dashboard 4 tab (tĩnh, không framework)
```

Thêm metric mới = thêm 1 object vào `src/metrics.js`. Bảng và wiki tự có thêm dòng/thẻ.

Toàn bộ dữ liệu đến từ một endpoint duy nhất:

```
POST /affiliate_partner/202603/cap_order/search     ("Search CAP Affiliate Orders")
```

Một lần gọi trả về đơn của **toàn bộ creator thuộc MCN**, mỗi dòng có `creator_username` — không
cần từng creator bấm uỷ quyền.

## 1. App và uỷ quyền partner

Endpoint CAP chỉ mở cho app thuộc **đúng một** nhánh category, và **category không đổi được sau
khi tạo** ("it cannot be changed through any channel"). Cấu hình bắt buộc:

| | |
|---|---|
| App type | Custom |
| Category | Customer Engagement / **Creator collaborations** |
| Target market | Vietnam |
| Seller type | Local sellers (L2L) |

App ở category khác (ví dụ *Enterprise Resource Planning*) **không bao giờ** xin được scope này —
nó không xuất hiện trong Manage API, và uỷ quyền partner chỉ trả về nhóm `partner.tap_campaign.*`.

Cần hai permission package trong **App & Service → Manage API**:

- **Read CAP earnings order** (id `2849348`) → `partner.cap_orders.read`
- **Partner Authorized Information** → `partner.authorization.info`, để gọi
  `GET /authorization/202405/category_assets` lấy `category_asset_cipher`

Không cần App Review: *"Beta apps are limited to 25 authorized users"* — MCN chỉ cần uỷ quyền 1 lần.

**Link uỷ quyền partner** — khác hẳn link creator và link seller:

```
partner:  https://partner.tiktokshop.com/open/authorize?service_id={service_id}   (US: partner.us.)
creator:  https://shop.tiktok.com/alliance/creator/auth?app_key={app_key}&state={state}
seller:   https://services.{region}.tiktokshop.com/open/authorize?service_id={service_id}
```

Với partner, `state` được khuyến khích chứ không bắt buộc, nên link copy thẳng từ Partner Center
vẫn dùng được. `GET /api/authorize-url` sinh link kèm `state` random one-time; callback chấp nhận
cả hai dạng nhưng từ chối `state` sai.

Luồng: bấm link → đồng ý → TikTok gọi `GET {Redirect URL}?code=...` → `src/server.js` đổi `code`
lấy token, kiểm `granted_scopes`, gọi `category_assets` lưu cipher → in thẳng ra scope và cipher.

Sau khi được duyệt thêm scope mới thì **phải uỷ quyền lại**: *"Reusing or refreshing the old token
will not add a newly approved scope."*

### Redirect URL

Bắt buộc HTTPS, khớp tuyệt đối (scheme/domain/path, không dấu `/` cuối), mỗi app một cái, sửa xong
phải **Publish changes**, và phải trùng `TTS_REDIRECT_URL` trong `.env`.

Dev local không trỏ vào `localhost` được. Dùng:

```bash
cloudflared --config /dev/null tunnel --url http://localhost:3000
```

`--config /dev/null` là **bắt buộc** nếu máy đã có `~/.cloudflared/config.yml`: ingress catch-all
`http_status:404` trong đó sẽ nuốt mọi hostname lạ và trả 404, request không bao giờ tới server.
Quick tunnel đổi hostname mỗi lần chạy, nên chạy thật thì nên dùng domain cố định.

## 2. Chạy

```bash
cp .env.example .env     # điền APP_KEY / APP_SECRET / SERVICE_ID / DATABASE_URL
npm install
psql "$DATABASE_URL" -f db/schema.sql
npm start                # http://localhost:3000
node test-aggregate.mjs  # self-check logic gộp đơn
node test-auth.mjs       # self-check lớp đăng nhập
```

Kéo dữ liệu: bấm **Kéo dữ liệu 7 ngày** trên dashboard, hoặc `npm run sync`.
Lên lịch bằng cron: `0 * * * * cd /srv/tiktok-metrics && npm run sync`.

## 3. Deploy

1. Postgres managed (Supabase / Neon / RDS) hoặc tự dựng; chạy `db/schema.sql`.
2. Node 20+, `npm ci --omit=dev`, chạy dưới systemd hoặc pm2.
3. Nginx/Caddy đứng trước, TLS bằng Let's Encrypt — Redirect URL bắt buộc HTTPS.
4. `.env` chỉ trên server, chmod 600. **Không commit `.env`** (đã có trong `.gitignore`).

## 4. Đăng nhập

Dashboard dùng HTTP Basic auth, mật khẩu dùng chung trong `.env`:

```
DASHBOARD_USER=upbase
DASHBOARD_PASSWORD=doi-thanh-chuoi-ngau-nhien-dai
```

Sinh mật khẩu: `openssl rand -base64 24`.

- Thiếu một trong hai biến thì **server từ chối khởi động**, không chạy ở chế độ mở.
- Chặn toàn bộ, kể cả file tĩnh trong `public/` — middleware đứng trước `express.static`.
- **Trừ đúng `/api/tiktok/callback`**: TikTok gọi server-to-server, không gửi được header
  Authorization. Đừng chặn đường này, creator sẽ không uỷ quyền được.
- So mật khẩu bằng `crypto.timingSafeEqual` trên bản hash, không short-circuit giữa user và
  password — không lộ qua timing là sai cái nào.

Basic auth gửi credential kèm **mọi** request, nên nó chỉ an toàn sau HTTPS. Đã bắt buộc HTTPS
sẵn ở mục Redirect URL rồi nên không phát sinh thêm ràng buộc.

Đổi mật khẩu: sửa `.env`, restart. Trình duyệt nhớ credential tới khi đóng hẳn — không có nút
đăng xuất.

## Nhịp tim cho job đồng bộ

Tiến trình bị `SIGKILL` / mất điện / đóng máy không chạy được handler nào nên không thể tự
đánh dấu là hỏng. Hậu quả từng gặp thật: dòng `sync_runs` kẹt `running` vĩnh viễn trong khi
job đã chết, và dashboard hiện y hệt lúc đang chạy ngon.

Cách xử: để Postgres phán xử theo thời gian thay vì chờ tiến trình tự khai báo.

- Job còn sống thì đập nhịp (`beat()`) sau **mỗi ngày** kéo xong, kể cả ngày lỗi.
- `reapStale()` đánh dấu `error` cho run im lặng quá `SYNC_STALE_MINUTES` (mặc định 15).
- Gọi trước mỗi lần chạy mới và trước mỗi lần đọc `/api/summary`, `/api/system` — đọc trạng
  thái là lúc dễ phát hiện job chết nhất.

**Run không có nhịp thì KHÔNG bị thu dọn.** Một run do code cũ sinh ra không phân biệt được
"đang chạy" với "đã chết", mà giết nhầm một backfill 7 tiếng đang chạy thật thì tệ hơn nhiều
so với để một dòng kẹt `running`. Đổi lại: run cũ nào chết thật sẽ kẹt `running` mãi, phải dọn
tay một lần. Từ bản này trở đi mọi run đều có nhịp nên không phát sinh thêm.

`node test-runs.mjs` phủ: quá ngưỡng thì dọn, còn nhịp thì tha, không nhịp thì miễn, đập nhịp
cứu được run sắp bị coi là chết, ghi chú cũ không bị ghi đè, dọn hai lần không nhân đôi.

## Phủ sóng dữ liệu

Bảng `sync_runs` nói **run nào** lỗi, không nói **ngày nào** còn khuyết — mà lỗ nằm ở ngày:
một backfill dài gặp lỗi mạng giữa chừng sẽ bỏ lại vài ngày rỗng rồi vẫn chạy tiếp.

`GET /api/coverage` trả về mỗi ngày trong cửa sổ kèm số dòng thô, cộng `dang_keo` (ngày của
dòng ghi gần nhất) và nhịp độ 10 phút qua. Dashboard vẽ thành lịch ô vuông ngay tab Hiệu suất:
xanh = có dữ liệu, cam nháy = đang kéo, xám = chưa kéo tới, **đỏ = thiếu**.

Chia "thiếu" với "chưa kéo tới" bằng mốc `dang_keo`, vì job chạy theo chiều cũ → mới:
ngày rỗng **sau** con trỏ là chưa tới, **trước** con trỏ là bị bỏ lại. Không có job nào chạy
thì mọi ngày rỗng đều là thiếu thật. `node test-coverage.mjs` phủ phần này.

Nút **Vá N ngày thiếu** gọi `POST /api/sync {days, skipExisting:true}` — bỏ qua ngày đã có raw
nên chỉ kéo đúng mấy ngày khuyết. Chạy **nền**, trả về ngay: một lần vá có thể mất vài giờ,
không giữ request HTTP mở lâu như vậy. Đang có job chạy thì trả `409` thay vì kéo song song —
hai job gọi API cùng lúc chính là thứ sinh ra timeout `2000011008` phía TikTok.

`dang_keo` đọc từ dòng ghi **gần nhất**, không phải `max(day)`: 7 ngày gần đây thường đã có sẵn
từ lần kéo trước nên `max(day)` luôn là hôm qua trong khi job còn ở tháng 7. Cần index
`sku_orders_collected`, nếu không mỗi lần hỏi phải quét cả bảng.

## Giới hạn đã biết

- `access_token` đang lưu plaintext trong Postgres. Production nên mã hoá ở tầng cột
  (pgcrypto) hoặc để trong secrets manager.
- **Hoàn một phần không đo được.** `cap_order/search` chỉ có `fully_return` (Yes/No), không có
  `returned_quantity`/`refunded_quantity` như bên creator API. `refund_amount` vì vậy chỉ gồm đơn
  hoàn toàn phần; đơn trả lẻ 1 trong 3 món sẽ không bị trừ.
- **Không lấy được danh sách creator đang bind.** API chỉ thấy creator **có đơn** trong kỳ, nên
  `creators_seen` luôn thấp hơn con số trên tab Creator Analytics của Partner Center.
- **`LIVE CTR` và `Affiliate LIVE CTOR` không có API.** Đã rà toàn bộ 16 endpoint nhóm *Affiliate
  partner* và 32 endpoint nhóm *Analytics* — không endpoint nào trả hai chỉ số này ở cấp partner.
  Muốn có thì phải nhập từ file Export thủ công.
- **Chỉ cipher của `Creator Management` gọi được endpoint.** 20 category asset còn lại trả
  `16032001` (invalid main_account) hoặc `16032015` (permission denied). Docs cảnh báo tên category
  có thể đổi, nên có thể ghi đè bằng `TTS_CAP_CIPHER` trong `.env`.
- **Khối lượng lớn.** ~8.8k SKU-order/ngày, `page_size` tối đa 100 → ~88 request cho mỗi ngày.
  `runSync` kéo theo từng ngày và ghi mốc theo ngày để backfill lại được; đừng kéo cả kỳ một lần
  (API cũng chỉ cho tối đa 92 ngày mỗi lần gọi).
- `est_commission` là tổng 4 thành phần `estimated_*_commission` vì response **không có** trường
  tổng. Chưa đối chiếu được với con số "Est. commission" trên UI Partner Center — nếu lệch thì
  sửa `EST_COMMISSION_PARTS` trong `src/sync.js`.
- Các trường `actual_*` chỉ có `amount` khi `settle_status` là `SETTLED` hoặc `INELIGIBLE`, nên
  không dùng được cho kỳ vừa kết thúc. Hiện pipeline chỉ dùng nhóm `estimated_*`.
- **Ngày chia theo UTC, không theo giờ VN.** `runSync` lấy mốc `setUTCHours(0,0,0,0)` và
  `period_start` là ngày UTC, nên một "ngày" là 07:00 VN → 07:00 VN hôm sau: đơn phát sinh
  00:00–07:00 giờ VN rơi vào ngày hôm trước. Nội bộ nhất quán (KPI, biểu đồ, bảng đều cùng
  mốc), nhưng **đối soát từng ngày với Seller Center theo giờ VN sẽ lệch** — tổng cả kỳ dài
  thì khớp. Chưa đổi sang offset VN vì việc đó diễn giải lại toàn bộ dữ liệu đã kéo; muốn đổi
  thì phải backfill lại từ đầu, không chỉ sửa code.
- 5 metric chưa nối API (`live_ctr`, `live_ctor`, `video_count`, `live_count`,
  `showcase_products_unsold`) — hiện trạng thái "Chưa kéo" trong bảng. `test-metrics.mjs` in
  ra danh sách này mỗi lần chạy, nên nó không lệch với code được.
- Chưa có webhook nhận sự kiện huỷ uỷ quyền; phát hiện gián tiếp khi refresh token thất bại.
- `reapStale()` chỉ chạy khi có người mở dashboard hoặc khởi động lần chạy mới. Không ai mở thì
  không ai dọn — đủ cho nhu cầu hiện tại, nhưng không phải cảnh báo chủ động.
- `creator_username` là khoá chính của creator. TikTok đang chuyển sang Creator Open ID làm khoá
  từ bản 202509, mà `cap_order` chưa trả trường đó — sẽ phải migrate khi TikTok mở.
- Đăng nhập là **một mật khẩu dùng chung**, không phân tài khoản nên không biết ai đã xem gì.
  Khi cần phân quyền theo người (hoặc audit log) thì phải đổi sang tài khoản riêng + session.
- Chưa giới hạn số lần thử sai. Mật khẩu đủ dài thì brute-force qua mạng không thực tế, nhưng
  nếu mở ra internet công khai thì nên thêm rate limit ở reverse proxy.
