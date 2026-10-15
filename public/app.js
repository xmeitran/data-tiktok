const $ = (s) => document.querySelector(s);
const get = (u) => fetch(u).then(r => r.json());
const vnd = new Intl.NumberFormat('vi-VN');
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (v, unit) =>
  unit === '%' ? `${Number(v).toFixed(1)}%` : vnd.format(Math.round(Number(v) || 0));
// KPI dung ban rut gon de khong tran the; so day du nam o thuoc tinh title.
const fmtKpi = (v, unit) => {
  const n = Number(v) || 0;
  if (unit === '%') return `${n.toFixed(1)}%`;
  return Math.abs(n) >= 1e6 ? compact.format(n) : vnd.format(Math.round(n));
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- tabs ---
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#nav').children)
    x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current');
  for (const x of document.querySelectorAll('main section'))
    x.classList.toggle('hide', x.id !== `tab-${b.dataset.tab}`);
});

let METRICS = [];

const KPI = ['creators_seen', 'net_gmv', 'orders', 'aov', 'est_commission', 'refund_rate'];

let DAILY = [];   // chuoi theo ngay, dung cho ca KPI delta lan bieu do

// So sanh ngay moi nhat voi ngay lien truoc. Khong co ngay truoc thi khong hien gi,
// hon la hien "+0%" gia.
function delta(key) {
  if (DAILY.length < 2) return '';
  const cur = DAILY.at(-1)?.[key], prev = DAILY.at(-2)?.[key];
  if (!prev || cur == null) return '';
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return '';
  const cls = pct >= 0 ? 'up' : 'down';
  return `<span class="delta ${cls}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

async function loadSummary() {
  const [s, daily] = await Promise.all([get('/api/summary'), get('/api/daily')]);
  DAILY = daily;
  const m = Object.fromEntries(METRICS.map(x => [x.key, x]));
  const last = DAILY.at(-1) ?? {};
  const value = (k) => k === 'creators_seen'
    ? (s.creatorsKnown ?? last.creators_seen ?? 0)
    : (last[k] ?? s.latest?.[k] ?? 0);

  $('#kpis').innerHTML = KPI.map(k => `
    <div class="card kpi">
      <div class="n" title="${fmt(value(k), m[k]?.unit)}">${fmtKpi(value(k), m[k]?.unit)}</div>
      <div class="l">${esc(m[k]?.label ?? k)}${m[k]?.unit && m[k].unit !== '%' ? ` · ${esc(m[k].unit)}` : ''}</div>
      ${k === 'creators_seen' ? '' : delta(k)}
    </div>`).join('');

  const r = s.lastSync;
  $('#sync-note').textContent = r
    ? `Lần kéo gần nhất: ${new Date(r.started_at).toLocaleString('vi-VN')} · ${r.status} · ${r.rows_written} dòng${r.note ? ` · ${r.note}` : ''}`
    : 'Chưa kéo dữ liệu lần nào.';

  renderChart();
}

// Bieu do cot bang SVG noi tuyen - khong can thu vien. viewBox + preserveAspectRatio
// de no tu co gian theo be ngang the.
function renderChart() {
  const key = $('#c-metric').value || 'gmv';
  const m = METRICS.find(x => x.key === key);
  if (!DAILY.length) { $('#chart').innerHTML = '<p class="empty">Chưa có dữ liệu ngày nào.</p>'; return; }

  const W = 720, H = 220, PAD_B = 28, PAD_T = 18;
  const vals = DAILY.map(d => Number(d[key]) || 0);
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const slot = W / n, bw = Math.min(slot * 0.55, 72);

  const bars = DAILY.map((d, i) => {
    const v = Number(d[key]) || 0;
    const h = ((H - PAD_B - PAD_T) * v) / max;
    const x = i * slot + (slot - bw) / 2;
    const y = H - PAD_B - h;
    const dd = d.day.slice(8) + '/' + d.day.slice(5, 7);
    return `<g>
      <title>${esc(d.day)}: ${fmt(v, m?.unit)}</title>
      <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="6"/>
      <text class="bar-v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}">${fmtKpi(v, m?.unit)}</text>
      <text class="bar-x" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}">${dd}</text>
    </g>`;
  }).join('');

  $('#chart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
          aria-label="Biểu đồ ${esc(m?.label ?? key)} theo ngày">${bars}</svg>`;
}

function renderTop() {
  const rows = CREATORS.slice(0, 5);
  $('#t-top').innerHTML = `
    <thead><tr><th>Creator</th><th class="num">GMV thực</th><th class="num">Đơn</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>
      <td>@${esc(r.username)}</td>
      <td class="num">${fmt(r.net_gmv)}</td>
      <td class="num">${fmt(r.orders)}</td></tr>`).join('')
      : '<tr><td colspan="3">Chưa có dữ liệu.</td></tr>'}</tbody>`;
}

let CREATORS = [];
let SORT = { key: 'net_gmv', dir: -1 };

const CREATOR_COLS = [
  { key: 'username',       label: 'Creator',           num: false },
  { key: 'first_seen',     label: 'Thấy lần đầu',      num: false },
  { key: 'last_seen',      label: 'Thấy gần nhất',     num: false },
  { key: 'net_gmv',        label: 'GMV thực',          num: true },
  { key: 'orders',         label: 'Đơn',               num: true },
  { key: 'est_commission', label: 'Hoa hồng ước tính', num: true },
];

async function loadCreators() {
  CREATORS = await get('/api/creators');
  renderCreators();
  renderTop();
}

function renderCreators() {
  const kw = $('#c-q').value.trim().toLowerCase();
  const rows = CREATORS
    .filter(r => !kw || r.username.toLowerCase().includes(kw))
    .sort((a, b) => {
      const { key, dir } = SORT;
      const col = CREATOR_COLS.find(c => c.key === key);
      if (col?.num) return (Number(a[key]) - Number(b[key])) * dir;
      return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir;
    });

  $('#c-count').textContent = `${rows.length}/${CREATORS.length} creator`;

  const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
  const head = CREATOR_COLS.map(c => {
    const on = SORT.key === c.key;
    return `<th class="${c.num ? 'num ' : ''}sortable" data-sort="${c.key}"
      aria-sort="${on ? (SORT.dir === 1 ? 'ascending' : 'descending') : 'none'}">
      ${esc(c.label)}<span class="arrow">${on ? (SORT.dir === 1 ? '▲' : '▼') : ''}</span></th>`;
  }).join('');

  $('#t-creators').innerHTML = `
    <thead><tr>${head}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>
      <td>@${esc(r.username)}</td>
      <td>${esc(r.first_seen) || '—'}</td>
      <td>${esc(r.last_seen) || '—'}</td>
      <td class="num">${fmt(r.net_gmv)}</td>
      <td class="num">${fmt(r.orders)}</td>
      <td class="num">${fmt(r.est_commission)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">Không có creator nào khớp “${esc(kw)}”.</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr><td>Tổng ${rows.length} creator</td><td></td><td></td>
      <td class="num">${fmt(sum('net_gmv'))}</td>
      <td class="num">${fmt(sum('orders'))}</td>
      <td class="num">${fmt(sum('est_commission'))}</td></tr></tfoot>` : ''}`;
}

// --- Wiki: tim kiem + 2 kieu hien thi -------------------------------------
// Tim tren toan bo noi dung cua metric, khong chi tren nhan.
const wikiHaystack = (m) =>
  [m.label, m.key, m.group, m.unit, m.level, m.definition, m.formula, m.source, m.pitfalls]
    .join(' ').toLowerCase();

// Danh dau tu khoa. Escape truoc roi moi khop, va escape ca tu khoa de khop dung tren
// chuoi da escape (vi du go "&" van an khop).
const hl = (text, kw) => {
  const e = esc(text);
  if (!kw) return e;
  const needle = esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.replace(new RegExp(needle, 'gi'), (x) => `<mark>${x}</mark>`);
};

const status = (m) => m.available
  ? '<span class="tag ok">Đã kéo</span>'
  : '<span class="tag warn">Chưa kéo</span>';

function wikiCard(m, kw) {
  return `<article class="card w-card">
    <div class="head">
      <h3>${hl(m.label, kw)}</h3>
      <code>${hl(m.key, kw)}</code>
      ${status(m)}
    </div>
    <p class="def">${hl(m.definition, kw)}</p>
    <dl class="meta">
      <dt>Công thức</dt><dd><code>${hl(m.formula, kw)}</code></dd>
      <dt>Đơn vị</dt><dd>${esc(m.unit)} · cấp ${esc(m.level)}</dd>
    </dl>
    <details>
      <summary>Nguồn và lưu ý</summary>
      <dl class="meta">
        <dt>Nguồn</dt><dd>${hl(m.source, kw)}</dd>
        <dt>Cần lưu ý</dt><dd class="pit">${hl(m.pitfalls, kw)}</dd>
      </dl>
    </details>
  </article>`;
}

function wikiTable(rows, kw) {
  return `<div class="card table-card"><table>
    <thead><tr><th>Metric</th><th>Mã</th><th>Nhóm</th><th>Đơn vị</th><th>Cấp</th>
      <th>Pipeline</th><th>Định nghĩa</th></tr></thead>
    <tbody>${rows.map(m => `<tr>
      <td>${hl(m.label, kw)}</td>
      <td><code>${hl(m.key, kw)}</code></td>
      <td><span class="tag grp">${esc(m.group)}</span></td>
      <td>${esc(m.unit)}</td><td>${esc(m.level)}</td>
      <td>${status(m)}</td>
      <td>${hl(m.definition, kw)}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderWiki() {
  const kw = $('#w-q').value.trim();
  const g = $('#w-group').value;
  const st = $('#w-status').value;
  const needle = kw.toLowerCase();

  const rows = METRICS.filter(m =>
    (!g || m.group === g) &&
    (st === '' || String(Number(m.available)) === st) &&
    (!needle || wikiHaystack(m).includes(needle)));

  $('#w-count').textContent = `${rows.length}/${METRICS.length} metric`;

  if (!rows.length) {
    $('#wiki').innerHTML = `<p class="empty">Không có metric nào khớp “${esc(kw)}”.</p>`;
    return;
  }

  const view = $('#w-view').querySelector('[aria-pressed="true"]').dataset.view;
  if (view === 'table') { $('#wiki').innerHTML = wikiTable(rows, kw); return; }

  // Kieu the: nhom theo `group` de quet mat de hon mot luoi phang 18 the.
  const groups = [...new Set(rows.map(m => m.group))];
  $('#wiki').innerHTML = groups.map(gr => {
    const items = rows.filter(m => m.group === gr);
    return `<div class="w-group-h">${esc(gr)}<span class="n">${items.length} metric</span></div>
      <div class="grid">${items.map(m => wikiCard(m, kw)).join('')}</div>`;
  }).join('');
}

$('#btn-sync').addEventListener('click', async (e) => {
  const days = Number($('#sync-days').value) || 3;
  e.target.disabled = true; e.target.textContent = 'Đang kéo…';
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days }) }).then(x => x.json());
    alert(r.error ? `Lỗi: ${r.error}` : `Xong: ${r.written} dòng${r.errors?.length ? `\n${r.errors.join('\n')}` : ''}`);
    await Promise.all([loadSummary(), loadCreators()]);
  } finally { e.target.disabled = false; e.target.textContent = 'Kéo dữ liệu'; }
});

$('#btn-link').addEventListener('click', async () => {
  const { url } = await get('/api/authorize-url');
  $('#link-out').innerHTML = `<code class="link-out">${esc(url)}</code>`;
});

$('#c-metric').addEventListener('change', renderChart);

$('#c-q').addEventListener('input', renderCreators);
$('#t-creators').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const k = th.dataset.sort;
  // Bam lai cung cot thi dao chieu; doi cot thi so giam dan, chu tang dan.
  SORT = SORT.key === k
    ? { key: k, dir: -SORT.dir }
    : { key: k, dir: CREATOR_COLS.find(c => c.key === k)?.num ? -1 : 1 };
  renderCreators();
});

$('#w-q').addEventListener('input', renderWiki);
$('#w-group').addEventListener('change', renderWiki);
$('#w-status').addEventListener('change', renderWiki);
$('#w-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#w-view').children) x.setAttribute('aria-pressed', String(x === b));
  renderWiki();
});

// "/" nhay vao o tim cua tab dang mo, tru khi dang go trong mot o khac.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const box = !$('#tab-metric').classList.contains('hide') ? $('#w-q')
            : !$('#tab-creator').classList.contains('hide') ? $('#c-q') : null;
  if (!box) return;
  e.preventDefault(); box.focus();
});

(async () => {
  METRICS = await get('/api/metrics');
  $('#w-group').insertAdjacentHTML('beforeend',
    [...new Set(METRICS.map(m => m.group))].map(g => `<option>${esc(g)}</option>`).join(''));
  // Bieu do chi chon duoc metric da noi API va khong phai dan xuat ty le kieu creators_*.
  $('#c-metric').insertAdjacentHTML('beforeend', METRICS
    .filter(m => m.available && !m.key.startsWith('creators_'))
    .map(m => `<option value="${esc(m.key)}"${m.key === 'gmv' ? ' selected' : ''}>${esc(m.label)}</option>`).join(''));
  renderWiki();
  await Promise.all([loadSummary(), loadCreators()]);
})();
