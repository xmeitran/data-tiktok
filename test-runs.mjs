// Kiểm tra thu dọn run chết. Chạy: node test-runs.mjs   (cần DATABASE_URL)
import assert from 'node:assert/strict';
import { q, pool, beat, reapStale } from './src/db.js';

const mine = [];
// phut = bao lâu trước đây; hb = có nhịp hay không (run cũ trước khi có cột thì không)
async function mkRun(phut, { hb = true } = {}) {
  const { rows } = await q(
    `insert into sync_runs (started_at, heartbeat_at, status, note)
     values (now() - make_interval(mins => $1::int),
             case when $2 then now() - make_interval(mins => $1::int) else null end,
             'running', 'test-runs')
     returning id`, [phut, hb]);
  // pg trả bigint dưới dạng chuỗi; reapStale trả số -> ép cùng kiểu để so sánh.
  mine.push(rows[0].id);
  return Number(rows[0].id);
}
const get = async (id) =>
  (await q(`select status, note, finished_at from sync_runs where id=$1`, [id])).rows[0];

try {
  const chet    = await mkRun(60);                 // im lặng 60 phút
  const song    = await mkRun(1);                  // vừa đập nhịp 1 phút trước
  const cu      = await mkRun(60, { hb: false });  // run cũ, chưa từng đập nhịp

  const reaped = await reapStale(15);

  assert.ok(reaped.includes(chet), 'run im lặng quá ngưỡng phải bị thu dọn');
  assert.ok(!reaped.includes(song), 'run còn đập nhịp KHÔNG được đụng vào');
  // Quan trọng nhất: run do code cũ sinh ra có thể đang chạy thật (backfill 7 tiếng
  // không đập nhịp vì code nạp trước khi có tính năng này). Giết nhầm nó tệ hơn nhiều
  // so với để một dòng kẹt 'running'.
  assert.ok(!reaped.includes(cu), 'run không có nhịp KHÔNG được thu dọn, dù cũ tới đâu');
  assert.equal((await get(cu)).status, 'running');

  const a = await get(chet);
  assert.equal(a.status, 'error');
  assert.ok(a.finished_at, 'phải đóng finished_at, nếu không nó vẫn trông như đang chạy');
  assert.match(a.note, /tien trinh chet/, 'phải nói rõ vì sao chết');
  assert.match(a.note, /test-runs/, 'ghi chú cũ phải được giữ, không ghi đè');

  assert.equal((await get(song)).status, 'running', 'run sống phải vẫn là running');

  // Đập nhịp phải cứu được một run sắp bị coi là chết.
  await beat(song);
  const sapChet = await mkRun(60);
  await beat(sapChet);
  assert.ok(!(await reapStale(15)).includes(sapChet), 'đập nhịp xong thì không bị thu dọn nữa');

  // Thu dọn hai lần không được nhân đôi ghi chú.
  const truoc = (await get(chet)).note;
  await reapStale(15);
  assert.equal((await get(chet)).note, truoc, 'run đã đóng không được thu dọn lại');

  console.log('test-runs OK — 10 phep kiem thu don run chet');
} finally {
  if (mine.length) await q(`delete from sync_runs where id = any($1::bigint[])`, [mine]);
  await pool.end();
}
