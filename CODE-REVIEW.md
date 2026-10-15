# Review toàn bộ source — tiktok-metrics

> **Trạng thái:** TẤT CẢ phát hiện trong tài liệu này **đã sửa** (§1.1, §1.2, §1.3, §2.1,
> §3, §4, §5, §6.1–§6.12). `npm test` **12/12 pass**. 13 fix có test riêng, và mỗi test đã
> được xác nhận bắt được lỗi (revert fix ⇒ test đỏ). §2.2 **chưa sửa** — nó là một quyết
> định về định nghĩa, không phải lỗi (xem dưới).
>
> Hai chỗ sửa khác đề xuất ban đầu trong tài liệu:
> - **§2.1**: thay vì đẩy `onDay` của creator sync về hôm qua (sẽ nói sai ngày chụp), neo
>   mốc "ngày dữ liệu mới nhất" vào **ngày có đơn** (`ORDER_DAY` trong `src/db.js`). Ảnh
>   chụp giữ đúng ngày thật của nó.
> - **§6.4**: không đổi số liệu. Giả định "settle_status là trạng thái của cả đơn" giờ được
>   **kiểm tại runtime** — vỡ giả định thì `aggregate()` đẩy warning vào `sync_runs.note`,
>   thay vì âm thầm đếm đôi đơn ở mẫu số AOV.
>
> **§6.12 cố ý không sửa code**, chỉ ghi rõ: đổi sang offset VN sẽ diễn giải lại toàn bộ
> dữ liệu đã kéo, muốn đổi thì phải backfill lại từ đầu. Đã ghi vào README (Giới hạn đã
> biết) và `pitfalls` của metric `gmv` — tức là hiện ngay trên tab Chỉ số.

Phạm vi: `src/` (8 file), `public/app.js`, `db/schema.sql`, 13 file / ~4.000 dòng.
Đã chạy `npm test` — **6/6 pass** (lúc review; nay 12/12). Mọi phát hiện dưới đây đều trỏ `file:line`; 3 cái nặng nhất
đã tái tạo được bằng số (xem §Tái tạo).

Nhận xét chung trước: codebase này **trên trung bình rõ rệt**. Comment giải thích *tại sao*
chứ không mô tả lại code, mọi quyết định khó (GMV gross, mẫu số AOV, nhịp tim `sync_runs`,
heuristic `money()`) đều có lý do viết ngay cạnh. Bug tìm được gần như toàn bộ là **cùng một
công thức được viết lại ở nhiều chỗ rồi lệch nhau**, chứ không phải logic sai từ gốc.

---

## 1. Lỗi công thức (nghiêm trọng)

### 1.1 `/api/summary` tính AOV và %hoa hồng sai — `src/server.js:221-222`

Hai công thức này lệch khỏi *mọi* chỗ khác trong hệ thống:

| Metric | sync.js / /api/daily / /api/creators / app.js | `/api/summary` |
|---|---|---|
| `aov` | `gmv / (orders + refund_orders)` | `gmv / orders` ❌ |
| `commission_rate` | `est_commission / commission_base` | `est_commission / gmv` ❌ |

Cả hai đều đi ngược chính comment của repo:

- `src/sync.js:189` — *"AOV phải cùng MỘT CƠ SỞ ở tử và mẫu: gmv gồm cả đơn huỷ, nên mẫu số
  cũng phải là TỔNG đơn (hợp lệ + huỷ). Lấy gmv/orders sẽ thổi AOV lên ~30%."*
- `src/sync.js:192` / `src/metrics.js:163` — *"mẫu số là commission_base, không phải gmv"*

Đo trên dữ liệu mẫu (2 đơn hợp lệ + 1 đơn INELIGIBLE): `/api/summary` **thổi AOV lên 50%**
và **báo %hoa hồng chỉ bằng 53% giá trị thật**.

Giảm nhẹ: `public/app.js` **không hề đọc `s.latest`** — `loadSummary()` chỉ dùng
`s.freshness` và `s.lastSync`. Nên dashboard không hiển thị sai; nhưng `/api/summary` là
endpoint công khai và đang trả hai con số sai cho bất kỳ consumer nào khác (cron, script,
Looker…). Hoặc sửa công thức, hoặc bỏ hẳn `latest` khỏi response.

**Sửa:**
```js
aov: (t.orders + t.refund_orders) ? t.gmv / (t.orders + t.refund_orders) : 0,
commission_rate: t.commission_base ? (t.est_commission / t.commission_base) * 100 : 0,
```

### 1.2 `delta()` so kỳ 7 ngày với kỳ trước chỉ 3 ngày — `public/app.js:104`

```js
const prev = prevPeriod();              // DAILY.slice(-PERIOD*2, -PERIOD)
if (!prev.length) return '…—…';         // chỉ kiểm RỖNG, không kiểm ĐỦ DÀI
```

Khi `DAILY.length = 10` và `PERIOD = 7`: kỳ này 7 ngày, kỳ trước **3 ngày**. Tổng 7 ngày
chia tổng 3 ngày → KPI hiện **"▲ +133.3%"** trong khi GMV/ngày **không đổi một đồng**.
Xảy ra với mọi lịch sử < 2×PERIOD, tức là suốt 2 tuần đầu sau khi deploy — đúng lúc người
ta tin con số nhất.

**Sửa:** `if (prev.length < (PERIOD ?? prev.length)) return '<span class="delta flat">—</span>';`

### 1.3 `avg_rate` của sản phẩm bị các dòng thiếu `std_rate` kéo xuống — `src/server.js:334`

`src/sync.js:239` ghi `num(r.standard_commission_rate)` → trường thiếu thành **0**, không
phải `NULL`. `round(avg(std_rate)/100.0, 2)` rồi gộp cả những số 0 đó vào mẫu số. Cột
"% hoa hồng" ở tab Sản phẩm thấp hơn thực tế đúng theo tỉ lệ dòng thiếu trường.
`tiktok-fields.js:472` ghi khoảng hợp lệ là `[100, 8000]` — 0 nằm ngoài khoảng, nên đây
là giá trị không hợp lệ đang được tính như dữ liệu thật.

**Sửa:** ghi `r.standard_commission_rate ?? null` (schema đã cho phép null), hoặc
`avg(nullif(std_rate, 0))`.

---

## 2. Lệch kỳ dữ liệu (nghiêm trọng, ảnh hưởng hiển thị)

### 2.1 Creator sync ghi vào HÔM NAY, order sync chỉ tới HÔM QUA

- `src/sync.js:300-303` — vòng lặp `i = days … 1`, ngày mới nhất là `midnight - 1 ngày` = **hôm qua**.
- `src/sync-creator.js:225-226` — `onDay = new Date()` → `dayStr` = **hôm nay**.

Hai pipeline ghi vào cùng bảng `metric_values` nhưng lệch nhau một ngày. Hậu quả dây chuyền:

| Nơi | Biểu hiện |
|---|---|
| `server.js:212` `/api/summary` | `where period_start = max(period_start)` → **chỉ còn ngày hôm nay**, mà hôm nay không có đơn ⇒ `latest` mất sạch `gmv`/`orders`; `t.gmv` là `undefined` ⇒ aov = 0, commission_rate = 0 |
| `server.js:227` `freshness` | `newest = max(period_start)` = hôm nay ⇒ `lag = 0` ⇒ banner báo *"dữ liệu đến \<hôm nay\> · hôm nay chưa chốt nên không kéo"* — tự mâu thuẫn, và che mất việc dữ liệu đơn đang trễ thật |
| `server.js:285` `/api/creators?days=7` | cửa sổ `period_start > max - 7` neo vào hôm nay ⇒ chỉ còn **6 ngày** có đơn |
| `app.js:51` `inPeriod()` | `DAILY.slice(-7)` nuốt 1 slot cho ngày hôm nay gần như rỗng ⇒ nhãn "7 ngày" nhưng chỉ 6 ngày GMV; bảng Theo ngày và biểu đồ có thêm **1 dòng/1 cột toàn số 0** |

Hiện chưa lộ ra vì chưa creator nào uỷ quyền (`test-creator.mjs` nói đúng vậy). Sẽ lộ
ngay ở lần `POST /api/sync-creator` đầu tiên có dữ liệu.

**Sửa (ít code nhất):** cho creator snapshot dùng cùng mốc như order sync —
`onDay = new Date(Date.now() - 86400e3)`. Hoặc tách biến thời gian: `/api/summary` và
`freshness` neo vào `max(period_start)` **của metric đơn** chứ không phải của cả bảng.

### 2.2 `creators_seen` đếm cả creator chưa từng có đơn — `public/app.js:138`

```js
const seen = CREATORS.filter(c => Number(c.days) > 0).length;
```
`days` = `count(distinct period_start)` trên `metric_values`. `sync-creator.js:199` *có
chèn* `creators` + `metric_values` cho creator chưa bán được gì (comment ở dòng 196 thừa
nhận: *"bảng creators không còn chỉ là 'creator CÓ ĐƠN'"*). Nên `days > 0` tính cả họ,
trái định nghĩa trong registry (`metrics.js:234` *"COUNT(DISTINCT creator_username)"* từ
đơn). Dùng `c.orders > 0 || c.gmv > 0` thì khớp định nghĩa; hoặc sửa định nghĩa trong
registry cho khớp code — nhưng phải chọn một.

---

## 3. Hai định nghĩa "GMV" trên cùng một dashboard

- KPI / bảng Creator / biểu đồ: `gmv` là **GROSS** — `sync.js:138` cộng `gross` *trước*
  nhánh `if (refunded)`, nên gồm cả đơn huỷ.
- Tab Sản phẩm / Shop: `server.js:328` `sum(price_amount * quantity)` **có** `VALID_ROW`
  ⇒ đã loại đơn huỷ ⇒ **bằng đúng `net_gmv`**, không phải `gmv`.

Hai con số khác nhau, cùng một nhãn `"GMV"` (`app.js:227` và `app.js:300`/`:309`). `app.js:290-292`
có comment thừa nhận chuyện này, nhưng **người xem dashboard không đọc comment** — họ
thấy GMV ở tab Tổng quan không khớp tổng GMV ở tab Sản phẩm và kết luận là số liệu hỏng.

**Sửa:** đổi nhãn cột trong `PCOLS`/`SCOLS` thành `'GMV thực'` cho khớp `net_gmv` ở
bảng Creator. Một chữ, hết lệch.

---

## 4. `VALID_ROW`: refactor dở dang (đúng cái bug mà comment nói đã sửa)

`src/db.js:8-14` có comment:

> *"Trước đây viết trong server.js (VALID_ROW) và một bản JS trong aggregate() của sync.js;
> đến khi sync-creator.js cũng cần hỏi… thì thành ba bản. Đặt ở đây… để sửa một chỗ là các
> chỗ đọc DB đổi theo."*

Nhưng:
- `src/server.js:6` chỉ import `{ q, reapStale }` từ `db.js`.
- `src/server.js:318` **khai báo lại một bản copy** của `VALID_ROW`.
- `export const VALID_ROW` ở `db.js:13` vì vậy là **dead code — không ai import**.

Nghĩa là hai bản vẫn đứng đó, chỉ là giờ có thêm comment nói rằng chúng đã được gộp.
Ngoài ra bản JS trong `aggregate()` còn **lệch về case**: `sync.js:141` dùng
`String(r.settle_status).toUpperCase() === 'INELIGIBLE'`, còn SQL dùng
`is distinct from 'INELIGIBLE'` — phân biệt chữ hoa/thường. Nếu API trả `"Ineligible"`,
JS loại, SQL giữ.

**Sửa:** `import { q, reapStale, VALID_ROW } from './db.js'` và xoá dòng 318. Thêm
`upper(settle_status)` vào `VALID_ROW` để khớp bản JS.

---

## 5. Metric khai báo "Đã kéo" nhưng không nơi nào tính

`showcase_products_unsold` — `src/metrics.js:390`, `available: true`, có công thức đầy đủ.
Grep toàn repo: **chỉ xuất hiện đúng 1 lần, ở chính dòng khai báo đó**.
`aggregateCreator()` (`sync-creator.js:96-107`) trả về 4 key, không có key này.

Hậu quả hiển thị:
- `app.js:799` — dropdown biểu đồ lọc `m.available && !m.key.startsWith('creators_')`
  ⇒ metric này **có trong danh sách chọn**, chọn vào thì biểu đồ toàn cột 0.
- `app.js:575` — tab Chỉ số gắn nhãn **`<span class="tag ok">Đã kéo</span>`** cho một
  metric chưa có pipeline. Chính xác là lời nói dối mà cột `available` sinh ra để tránh.

**Sửa:** `available: false` (1 ký tự, nó sẽ tự rơi vào khối "chưa kéo" ở `#kpis-na`),
hoặc implement công thức — SQL đã viết sẵn trong `formula` của chính nó.

---

## 6. Vấn đề vừa & nhỏ

| # | Chỗ | Vấn đề |
|---|---|---|
| 6.1 | `sync.js:246-249` | Upsert `sku_orders` cập nhật `commission_base`/`est_commission` nhưng **không** cập nhật `quantity`/`price_amount`/`std_rate`. Đơn hoàn một phần ⇒ hoa hồng mới + GMV cũ trong cùng một dòng ⇒ `/api/products` lệch so với `/api/creators`. Hoặc cập nhật hết, hoặc không cập nhật gì. |
| 6.2 | `server.js:110-115` | `takeState()` xoá state **trước** `exchangeCode()`. Lỗi mạng ở bước đổi token ⇒ state cháy, link creator (đã gửi cho người khác) chết luôn, phải sinh lại. Đổi thứ tự: exchange trước, take sau — vẫn dùng-một-lần, nhưng không mất link vì lỗi tạm thời. |
| 6.3 | `sync.js:119` vs `:221` | Khoá dedup lệch nhau: `${r.id}\|${r.sku_id}\|${r.content_id}` (aggregate, `undefined` khi thiếu) vs `${r.id}\|${r.sku_id ?? ''}\|…` (writeRaw, `''`). Dòng thiếu `sku_id` ⇒ hai bên dedup khác nhau. |
| 6.4 | `sync.js:191` | Mẫu số AOV = `orders + refundOrderIds.size`. Nếu một `order_id` có dòng INELIGIBLE *và* dòng hợp lệ, id vào **cả hai** Set ⇒ đếm đôi ở mẫu số. Comment dòng 145 nói `settle_status` là của cả đơn nên không thể xảy ra — nhưng không có gì kiểm chứng điều đó. |
| 6.5 | `sync-creator.js:149-166` | `writeShowcase` ghi **từng dòng một** — tới 2.000 sản phẩm/creator = 2.000 round-trip. `sync.js:214` đã batch 500/INSERT vì đúng lý do này. Cùng vấn đề, hai cách xử lý. |
| 6.6 | `sync.js:8` | `MAX_WINDOW_DAYS = 92` khai báo, **không dùng ở đâu**. `runSync` không chặn `days` ⇒ `POST /api/sync {days: 100000}` chạy 100.000 vòng gọi API. Dùng hằng số đó làm trần đi. |
| 6.7 | `server.js:323,336` | `limit` nội suy thẳng vào SQL (chỗ duy nhất không tham số hoá). An toàn hiện tại (`Number()\|\|50` → luôn là số), nhưng `?limit=-1` ⇒ `limit -1` ⇒ lỗi SQL 500 thay vì 400. |
| 6.8 | `app.js:348` | `aria-label="…${r.content_type}…"` — chỗ **duy nhất** nhúng dữ liệu DB vào attribute mà không qua `esc()`. Rủi ro thực tế gần 0 (`LIVE\|VIDEO\|SHOP`), nhưng lệch khỏi quy tắc của chính file. |
| 6.9 | `app.js:277,410` | CSV export không chặn ký tự dẫn `=`/`+`/`-`/`@`. `product_name` đến từ TikTok, mở bằng Excel ⇒ formula injection. Prefix `'` cho ô bắt đầu bằng các ký tự đó. |
| 6.10 | `server.js:378`, `app.js:443` | `Math.round` cho "còn N ngày" ⇒ token hết hạn rồi hiện **"còn -3 ngày"**. Dùng `Math.floor` + nhánh riêng cho số âm ("đã hết hạn"). |
| 6.11 | `server.js:298-299` | Comment *"Trạng thái hệ thống: uỷ quyền, cipher, lịch sử sync"* đứng trên `/api/creator-daily` nhưng mô tả `/api/system`. Comment lạc chỗ. |
| 6.12 | `sync.js:298`, `server.js:228` | Toàn hệ thống chia ngày theo **UTC**, thị trường là VN (UTC+7). Một "ngày" = 07:00 VN → 07:00 VN hôm sau; đơn 00:00–07:00 giờ VN bị gán vào ngày trước. Nội bộ thì nhất quán, nhưng **không khớp báo cáo của TikTok Seller Center** khi đối soát. Nên ghi rõ trong wiki, hoặc cho cấu hình offset. |

---

## 7. Những chỗ làm đúng (đừng "sửa")

- `src/auth.js:9-10,29` — hash trước rồi `timingSafeEqual`, và `&` thay vì `&&` để không
  short-circuit. Đúng cả hai mặt: độ dài không lộ, timing không lộ. Fail-closed khi thiếu
  config (dòng 22) thay vì mở toang.
- `src/tiktok.js:25-30` — tính lại `timestamp` **và** `sign` ở mỗi lần retry. Đây là lỗi
  rất dễ mắc (dùng lại chữ ký cũ ⇒ lệch giờ ⇒ bị từ chối), và comment giải thích đúng lý do.
- `src/tiktok.js:51-53` — `retryable()` phân biệt "lỗi tự hết" (mạng/5xx/429) với "lỗi do
  mình sai" (4xx). Thử lại sai scope bao nhiêu lần cũng vô nghĩa — bắt đúng ranh giới.
- `src/db.js:27-43` — `reapStale()` chỉ thu dọn run **có nhịp**. Nhận ra rằng lấy
  `started_at` làm mốc sẽ giết nhầm một backfill 7 tiếng đang chạy thật là một nhận xét
  tinh, và chọn "thà để một dòng cũ kẹt `running`" là đánh đổi đúng.
- `src/sync.js:31-53` — `money()` phòng thủ đúng mức, và `bad` được đếm rồi **báo lên
  `warnings`** chứ không im lặng thành 0. Heuristic thập phân có ghi rõ trần áp dụng.
- `sync.js:191-195`, `server.js:258-260`, `server.js:291-293`, `app.js:60-61` — tỉ lệ được **tính lại từ metric gốc** ở cả 4 nơi
  (`totals()`, `/api/daily`, `/api/creators`, `SUMMABLE`). Cộng `aov` của 7 ngày lại là vô
  nghĩa, và cả 4 chỗ đều biết điều đó. Chỉ `/api/summary` lọt sổ (§1.1).
- `app.js:167-170` — chọn bar chart bằng div/CSS thay vì SVG, có lý do viết rõ. Đúng.
- `metrics.js` làm registry nguồn-sự-thật-duy-nhất cho cả bảng lẫn wiki: thêm metric = thêm
  1 object. Đây là lý do duy nhất khiến §5 trở thành bug 1-ký-tự thay vì bug 3-file.

---

## 8. Tái tạo

`node repro.mjs` với `src/sync.js`, 1 creator / 2 đơn hợp lệ / 1 đơn INELIGIBLE:

```
AOV  sync/daily/creators = 100000  | /api/summary = 150000
  -> /api/summary thổi AOV lên 50%
%HH  sync/daily/creators = 15.00   | /api/summary = 8.00
  -> /api/summary báo %hoa hồng chỉ bằng 53% so thật
delta: kỳ này 7 ngày = 700 | kỳ trước 3 ngày = 300
  -> hiện "+133.3%" trong khi GMV/ngày KHÔNG ĐỔI
```

---

## 9. Thứ tự nên sửa

1. §1.1 — 2 dòng, `server.js:221-222`. Đang trả số sai ra API.
2. §2.1 — 1 dòng, `sync-creator.js:225`. Sẽ hỏng KPI ngay lần creator sync đầu tiên có dữ liệu.
3. §5 — 1 ký tự, `metrics.js:401` (`available`). Dashboard đang nói "Đã kéo" cho thứ chưa kéo.
4. §1.2 — 1 dòng, `app.js:104`. % tăng trưởng giả trong 2 tuần đầu.
5. §3 — 1 chữ, nhãn cột `PCOLS`/`SCOLS`.
6. §4 — 2 dòng, dọn `VALID_ROW` cho khớp đúng comment đã viết.
7. §1.3, §6.1, §6.2 — mỗi cái vài dòng.
8. Phần còn lại ở §6: tuỳ mức độ quan tâm.

5 việc đầu tổng cộng **dưới 10 dòng** và dọn sạch mọi lỗi lệch-công-thức đang hiển thị.
