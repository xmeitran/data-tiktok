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
