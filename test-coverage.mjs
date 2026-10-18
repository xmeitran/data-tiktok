// Tu kiem phan loai ngay rong + ETA. Chay: node test-coverage.mjs
import assert from 'node:assert/strict';
import { classify, eta } from './public/coverage.js';

const d = (day, rows = 0) => ({ day, rows });
const days = (list) => list.map(x => Array.isArray(x) ? d(...x) : d(x));
const RUN = { id: '89' };

// 1. Khong co job: gap truoc ngay raw moi nhat la missing, ngay sau do la unpulled.
{
  const cal = days([['2026-01-01', 10], '2026-01-02', ['2026-01-03', 5], '2026-01-04']);
  const r = classify(cal, { dang_keo: null, latest_day: '2026-01-03', running: null });
  assert.equal(r.has.length, 2);
  assert.deepEqual(r.miss.map(x => x.day), ['2026-01-02']);
  assert.deepEqual(r.unpulled.map(x => x.day), ['2026-01-04']);
  assert.equal(r.pending.size, 0);
}

// 2. Dang chay: sau con tro la "chua keo toi", truoc con tro ma rong la bi bo lai.
{
  const cal = days([['2026-01-01', 9], '2026-01-02', ['2026-01-03', 9], '2026-01-04', '2026-01-05']);
  const r = classify(cal, { dang_keo: '2026-01-03', latest_day: '2026-01-03', running: RUN });
  assert.deepEqual(r.miss.map(x => x.day), ['2026-01-02'], 'ngay truoc con tro = thieu');
  assert.deepEqual([...r.pending], ['2026-01-04', '2026-01-05'], 'ngay sau con tro = chua toi');
  assert.equal(r.unpulled.length, 0);
}

// 3. Dang chay nhung chua ghi dong nao (dang_keo null): khong duoc doan bua thanh "chua toi",
//    vi khong biet job dang o dau. Bao thieu con hon bao yen gia.
{
  const cal = days(['2026-01-01', '2026-01-02']);
  const r = classify(cal, { dang_keo: null, latest_day: null, running: RUN });
  assert.equal(r.miss.length, 2);
  assert.equal(r.unpulled.length, 0);
  assert.equal(r.pending.size, 0);
}

// 4. Lo nam giua vung da keo va vung chua keo: dung mot moc chia nen khong lan nhau.
{
  const cal = days([['2026-01-01', 1], '2026-01-02', ['2026-01-03', 1], '2026-01-04',
                    ['2026-01-05', 1]]);   // 05 co data san tu lan keo 7 ngay truoc do
  const r = classify(cal, { dang_keo: '2026-01-03', latest_day: '2026-01-05', running: RUN });
  assert.deepEqual(r.miss.map(x => x.day), ['2026-01-02']);
  assert.deepEqual([...r.pending], ['2026-01-04']);
  assert.equal(r.unpulled.length, 0);
  assert.equal(r.has.length, 3, 'ngay da co data van tinh la co, du nam sau con tro');
}

// 5. ETA: chi noi khi co job chay VA co nhip do that.
assert.equal(eta(60, 10, RUN), 'còn ~1h00');
assert.equal(eta(30, 10, RUN), 'còn ~30 phút');
assert.equal(eta(75, 10, RUN), 'còn ~1h15');
assert.equal(eta(60, 0, RUN), '', 'khong co nhip do thi khong doan');
assert.equal(eta(60, 10, null), '', 'khong chay thi khong co ETA');
assert.equal(eta(0, 10, RUN), '', 'khong con ngay nao thi khong hien ETA');

console.log('test-coverage OK — 4 phep kiem phan loai ngay rong + 6 phep kiem ETA');
