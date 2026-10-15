// Nap .env ngay tai day: moi entry point (server, npm run sync, dump-orders) deu di qua
// module nay, nen dat o day thi khong entry point nao chay thieu DATABASE_URL.
import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const q = (text, params) => pool.query(text, params);

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
