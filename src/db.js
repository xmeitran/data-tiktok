// Nap .env ngay tai day: moi entry point (server, npm run sync, dump-orders) deu di qua
// module nay, nen dat o day thi khong entry point nao chay thieu DATABASE_URL.
import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);

// Bo loc dong SKU-order HOP LE. Truoc day viet trong server.js (VALID_ROW) va mot ban JS
// trong aggregate() cua sync.js; den khi sync-creator.js cung can hoi "san pham nay co don
// chua" thi thanh ba ban. Dat o day -- module la duong di chung cua moi entry point --
// de sua mot cho la cac cho doc DB doi theo. Ban JS trong sync.js van rieng, test-raw.mjs
// la thu bat duoc khi hai ben lech nhau.
export const VALID_ROW =
  `settle_status is distinct from 'INELIGIBLE' and fully_return is distinct from 'Yes'`;

// Mốc "ngày dữ liệu mới nhất". PHẢI tính trên metric ĐƠN, không phải trên cả bảng
// metric_values: sync-creator ghi metric ảnh chụp vào HÔM NAY (trạng thái hiện tại,
// không backfill được) còn sync đơn chỉ ghi tới HÔM QUA. Lấy max(period_start) của cả
// bảng sẽ neo vào một ngày KHÔNG CÓ ĐƠN NÀO -- KPI mất sạch gmv/orders, banner freshness
// báo "dữ liệu đến hôm nay" trong khi đơn đang trễ thật, và cửa sổ ?days=7 chỉ còn 6 ngày.
// `gmv` là đại diện: aggregate() luôn ghi key này cho mọi creator thấy trong ngày.
export const ORDER_DAY =
  `(select max(period_start) from metric_values where metric_key = 'gmv')`;

// --- Upsert nhieu dong trong MOT cau lenh ---
// sync.js da lam viec nay bang tay (ghep `$${base+1}`..`$${base+17}`) vi 1 ngay ~8.8k dong,
// insert tung dong la ~8.8k round-trip. sync-creator.js thi KHONG, nen mot creator co 2000
// san pham showcase la 2000 round-trip. Gop lai o day: mot cho dung, bon cho goi -- va
// khong con ai phai dem tay so thu tu tham so (dem lech mot cai la du lieu vao sai cot,
// khong loi, khong dau vet).
//
// `update` rong => `do nothing`. `collected_at` luon duoc dap lai: ca 4 bang deu co cot nay
// va y nghia cua no la "lan cuoi thay dong nay tu API".
const PARAM_CAP = 60000;      // tran that cua Postgres la 65535 tham so/cau lenh

export async function upsertMany(table, columns, conflict, update, rows) {
  if (!rows?.length) return 0;
  const width = columns.length;
  for (const [i, row] of rows.entries()) {
    // Loi lap trinh, nhung neu de lot thi du lieu vao sai cot ma khong bao gi.
    if (row.length !== width) {
      throw new Error(`upsertMany(${table}): dong ${i} co ${row.length} gia tri, can ${width}`);
    }
  }
  const set = update.length
    ? `do update set ${update.map(c => `${c} = excluded.${c}`).join(', ')}, collected_at = now()`
    : 'do nothing';
  // Chia theo SO THAM SO, khong theo so dong: bang rong cot thi 500 dong da vuot tran.
  const perChunk = Math.max(1, Math.min(500, Math.floor(PARAM_CAP / width)));
  let n = 0;
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const vals = chunk
      .map((row, j) => `(${row.map((_, k) => '$' + (j * width + k + 1)).join(',')})`)
      .join(',');
    await q(
      `insert into ${table} (${columns.join(', ')}) values ${vals}
       on conflict (${conflict.join(', ')}) ${set}`,
      chunk.flat());
    n += chunk.length;
  }
  return n;
}

// --- Nhip tim cho sync_runs ---
// Tien trinh bi kill (SIGKILL, mat dien, dong may) khong chay duoc handler nao, nen khong
// the tu danh dau la hong. Hau qua: dong sync_runs ket 'running' vinh vien va dashboard
// hien y het luc dang chay ngon. Cach duy nhat dung cho MOI kieu chet la de DB phan xu
// theo thoi gian: job con song thi dap nhip, qua lau khong co nhip thi coi nhu chet.
export const STALE_MINUTES = Number(process.env.SYNC_STALE_MINUTES) || 15;

export const beat = (runId) =>
  q(`update sync_runs set heartbeat_at = now() where id = $1`, [runId]);

// Goi truoc MOI lan doc trang thai va truoc moi lan chay moi. Tra ve cac run vua thu don.
export async function reapStale(minutes = STALE_MINUTES) {
  const { rows } = await q(
    `update sync_runs
        set status = 'error',
            finished_at = now(),
            note = concat_ws(' | ', nullif(note, ''),
                   'tien trinh chet: khong co nhip trong ' || $1 || ' phut')
      where status = 'running'
        -- CHI thu don run co nhip. Run cu (heartbeat_at null) khong phan biet duoc
        -- "code cu, dang chay" voi "code cu, da chet" -- lay started_at lam moc se
        -- giet nham mot backfill 7 tieng dang chay that. Tha de mot dong cu ket
        -- 'running' con hon bao sai la hong mot job con song.
        and heartbeat_at is not null
        and heartbeat_at < now() - make_interval(mins => $1::int)
      returning id`,
    [minutes]
  );
  return rows.map(r => Number(r.id));
}
