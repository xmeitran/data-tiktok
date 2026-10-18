-- Postgres schema. Chay: psql "$DATABASE_URL" -f db/schema.sql

create table if not exists authorizations (
  open_id          text primary key,
  role             text not null default 'creator',   -- creator | seller
  display_name     text,
  avatar_url       text,
  shop_id          text,
  shop_cipher      text,
  region           text,
  access_token     text not null,
  refresh_token    text,
  access_expire_at timestamptz,
  refresh_expire_at timestamptz,
  status           text not null default 'active',    -- active | expired | revoked
  authorized_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  raw              jsonb
);

-- Creator thuoc MCN. cap_order/search chi tra ve `creator_username`, KHONG co creator_open_id,
-- nen username la khoa chinh. Chi thay creator CO DON trong ky -- khong liet ke duoc
-- toan bo creator dang bind (con so 728 tren UI Partner Center lay bang API nay khong duoc).
create table if not exists creators (
  username   text primary key,
  first_seen date not null,
  last_seen  date not null,
  updated_at timestamptz not null default now()
);

-- 1 dong = 1 metric cua 1 creator trong 1 NGAY. Sync theo ngay de con backfill lai tung ngay
-- ma khong keo lai ca ky (263k SKU-order/30 ngay, page_size toi da 100).
create table if not exists metric_values (
  creator_username text not null references creators(username) on delete cascade,
  metric_key       text not null,
  period_start     date not null,
  period_end       date not null,
  value            numeric,
  collected_at     timestamptz not null default now(),
  primary key (creator_username, metric_key, period_start, period_end)
);
create index if not exists metric_values_key_period on metric_values (metric_key, period_start desc);

create table if not exists sync_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running',       -- running | ok | error
  rows_written int not null default 0,
  note         text
);

-- Category asset cipher: tham so bat buoc cua moi Affiliate Partner API.
-- 1 partner co the uy quyen NHIEU category asset (anh Partner Center: 21 cai),
-- moi cai 1 cipher rieng -> sync phai lap qua tung cipher.
create table if not exists category_assets (
  cipher          text primary key,
  partner_open_id text not null references authorizations(open_id) on delete cascade,
  category_id     bigint,
  category_name   text,
  target_market   text,
  updated_at      timestamptz not null default now()
);

-- 1 dong = 1 SKU-order tho tu cap_order/search. Truoc day sync chi gop roi vut raw di, nen
-- moi so lieu theo SAN PHAM / SHOP / VIDEO / LIVE deu mat -- du API van tra ve day du.
-- Chi giu cac truong KHONG the dien ta bang metric_values (cac chieu) + do do can de gop
-- theo chieu do. Cac truong luon rong tren du lieu that (attribution_type, tags) khong luu.
-- ponytail: ~8.8k dong/ngay => ~2.5M dong cho 287 ngay (~400MB). Du lieu cu hon 1 nam thi
-- partition theo thang hoac ha xuong bang gop san neu bang phinh.
create table if not exists sku_orders (
  order_id         text not null,
  sku_id           text not null,
  content_id       text not null default '',
  day              date not null,
  creator_username text not null,
  product_id       text,
  product_name     text,
  shop_name        text,
  content_type     text,                               -- LIVE | VIDEO | SHOP
  settle_status    text,                               -- CUSTOMER UNPAID|PENDING|SETTLED|INELIGIBLE|FROZEN
  fully_return     text,                               -- 'Yes' khi dong SKU bi hoan toan phan
  quantity         int,
  price_amount     numeric(18,4),
  currency         text,
  commission_base  numeric(18,4),
  est_commission   numeric(18,4),
  std_rate         int,                                -- diem co ban: 1200 = 12.00%
  collected_at     timestamptz not null default now(),
  primary key (order_id, sku_id, content_id)
);
create index if not exists sku_orders_day        on sku_orders (day desc);
create index if not exists sku_orders_product    on sku_orders (product_id, day desc);
create index if not exists sku_orders_creator    on sku_orders (creator_username, day desc);
create index if not exists sku_orders_content    on sku_orders (content_type, day desc);

-- ===== Du lieu chi token CREATOR lay duoc =====
-- Token partner da co moi thu DA phat sinh don; 4 bang duoi la nhung thu CHUA ra don
-- (hang mau dang xin, san pham treo showcase, chien dich dang tham gia).

-- Profile creator. 1 dong = 1 creator, la trang thai HIEN TAI chu khong luu theo ngay:
-- profile hau nhu khong doi nen chup moi ngay chi lam phinh bang.
-- Khoa chinh la creator_open_id, KHONG phai username: username doi duoc, open_id thi khong.
-- `username` la cay cau DUY NHAT sang bang creators -- cap_order/search chi tra ve
-- creator_username chu khong co open_id, nen khong co profile thi khong noi duoc hai ben.
create table if not exists creator_profiles (
  creator_open_id  text primary key,
  username         text,
  selection_region text,
  register_region  text,
  seller_type      text,                               -- CROSS_BORDER | LOCAL
  user_type        text,                               -- TIKTOK_SHOP_CREATOR | ...
  permissions      text[],
  avatar_url       text,
  collected_at     timestamptz not null default now()
);
create index if not exists creator_profiles_username on creator_profiles (username);

-- Yeu cau hang mau. API KHONG tra ve thoi diem TAO yeu cau (chi co expiration_time cua
-- nghia vu lam noi dung), nen khong cach nao chia theo ngay phat sinh nhu sku_orders.
-- Moi lan sync vi the la mot ANH CHUP; snapshot_day nam trong khoa chinh de giu lai
-- lich su anh chup, nho do metric theo ngay van kiem tra lai duoc tu bang tho.
create table if not exists sample_applications (
  application_id        text not null,
  snapshot_day          date not null,
  creator_open_id       text not null,
  creator_username      text,
  status                text,                          -- PENDING | SHIPPED | COMPLETED | ...
  product_id            text,
  sku_id                text,
  main_order_id         text,                           -- chi co SAU KHI seller duyet
  activity_id           text,
  fulfillment_status    text,                          -- PENDING | ONGOING | SUCCEED | ...
  fulfillment_expire_at timestamptz,
  bound_product_status  text,
  collected_at          timestamptz not null default now(),
  primary key (application_id, snapshot_day)
);
create index if not exists sample_applications_creator on sample_applications (creator_username, snapshot_day desc);

-- San pham trong showcase. Cung la ANH CHUP (showcase la trang thai hien tai, khong co
-- lich su) nen snapshot_day vao khoa chinh. `origin` cung phai o trong khoa: cung mot
-- san pham tra ve ca o origin=SHOWCASE va origin=LIVE voi added_status khac nghia.
-- ponytail: toi da 2000 san pham/creator/ngay. Nhieu creator thi doi sang chup tuan,
-- hoac chi chup lai khi total_count doi.
create table if not exists showcase_products (
  creator_open_id  text not null,
  product_id       text not null,
  origin           text not null,                      -- SHOWCASE | LIVE
  snapshot_day     date not null,
  creator_username text,
  title            text,
  shop_name        text,                               -- giong cap_order: chi co ten, khong co shop_id
  inventory_status text,                               -- IN_STOCK | SOLD_OUT
  review_status    text,                               -- APPROVED | UNDER_REVIEW | ...
  is_hidden        boolean,
  added_status     text,
  source           text,                               -- THIRD_PARTY | AFFILIATE | TIKTOK_STORE
  commission_rate  int,                                -- diem co ban: 3587 = 35.87%
  reward_rate      int,
  collaboration_id text,
  collab_type      text,
  collected_at     timestamptz not null default now(),
  primary key (creator_open_id, product_id, origin, snapshot_day)
);
create index if not exists showcase_products_product on showcase_products (product_id, snapshot_day desc);

-- Chien dich hop tac chi dinh. 1 dong = 1 (chien dich x san pham) vi API tra ve san pham
-- long trong chien dich. product_id mac dinh '' thay vi null: null trong khoa chinh
-- Postgres coi la khac nhau nen chien dich khong co san pham se bi nhan dong moi lan sync.
-- CHU Y: endpoint nay BAT BUOC shop_id, ma khong API nao dang dung tra ve shop_id
-- (cap_order chi co shop_name) -> phai nap shop_id tu ngoai vao (env TTS_SHOP_IDS).
create table if not exists target_collaborations (
  creator_open_id  text not null,
  collaboration_id text not null,
  product_id       text not null default '',
  snapshot_day     date not null,
  creator_username text,
  shop_id          text,
  name             text,
  status           text,                               -- LIVE | EXPIRED | DELETED | ENDED
  product_title    text,
  commission_rate  int,                                -- diem co ban: 3587 = 35.87%
  est_amount       numeric(18,4),                      -- tinh tu GIA THAP NHAT, khong phai gia ban that
  currency         text,
  collected_at     timestamptz not null default now(),
  primary key (creator_open_id, collaboration_id, product_id, snapshot_day)
);
create index if not exists target_collaborations_creator on target_collaborations (creator_username, snapshot_day desc);

-- `state` cua link uy quyen. Truoc day nam trong RAM voi TTL 15 phut -- dung duoc cho
-- partner (tu bam ngay) nhung KHONG dung duoc cho creator: link phai gui cho nguoi khac,
-- ho bam sau vai gio, va restart server la mat sach. Dung bang de state song qua restart
-- va qua nhieu process. Xoa sau khi dung => dung duoc DUNG MOT LAN.
create table if not exists auth_states (
  state      text primary key,
  role       text not null,                          -- partner | creator
  label      text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Nhip tim: job con song thi dap nhip, qua STALE_MINUTES khong co nhip thi reapStale()
-- danh dau 'error'. Them sau nen de nullable; run cu khong co nhip thi tinh theo started_at.
alter table sync_runs add column if not exists heartbeat_at timestamptz;

-- Giao dien phu song can biet job DANG keo ngay nao: "dong moi ghi gan nhat" chi re khi
-- co index tren collected_at. Khong co no thi moi lan hoi phai quet ca bang (3.3M dong).
create index if not exists sku_orders_collected on sku_orders (collected_at desc);
