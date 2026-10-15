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

const KPI = ['creators_seen', 'net_gmv', 'orders', 'est_commission', 'commission_base'];

async function loadSummary() {
  const s = await get('/api/summary');
  const m = Object.fromEntries(METRICS.map(x => [x.key, x]));
  const value = (k) => k === 'creators_seen' ? (s.creatorsKnown ?? s.latest?.creators_seen ?? 0) : (s.latest?.[k] ?? 0);
  $('#kpis').innerHTML = KPI.map(k => `
    <div class="card kpi">
      <div class="n" title="${fmt(value(k), m[k]?.unit)}">${fmtKpi(value(k), m[k]?.unit)}</div>
      <div class="l">${esc(m[k]?.label ?? k)}${m[k]?.unit && m[k].unit !== '%' ? ` · ${esc(m[k].unit)}` : ''}</div>
    </div>`).join('');
  const r = s.lastSync;
  $('#sync-note').textContent = r
    ? `Lần kéo gần nhất: ${new Date(r.started_at).toLocaleString('vi-VN')} · ${r.status} · ${r.rows_written} dòng${r.note ? ` · ${r.note}` : ''}`
    : 'Chưa kéo dữ liệu lần nào.';
}

async function loadCreators() {
  const rows = await get('/api/creators');
  $('#t-creators').innerHTML = `
    <thead><tr><th>Creator</th><th>Thấy lần đầu</th><th>Thấy gần nhất</th>
      <th class="num">GMV thực</th><th class="num">Đơn</th><th class="num">Hoa hồng ước tính</th>
      <th>Kỳ gần nhất</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>
      <td>@${esc(r.username)}</td>
      <td>${esc(r.first_seen) || '—'}</td><td>${esc(r.last_seen) || '—'}</td>
      <td class="num">${fmt(r.net_gmv)}</td><td class="num">${fmt(r.orders)}</td>
      <td class="num">${fmt(r.est_commission)}</td>
      <td>${esc(r.last_period) || '—'}</td></tr>`).join('')
      : '<tr><td colspan="7">Chưa có creator nào uỷ quyền.</td></tr>'}</tbody>`;
}

function renderMetricTable() {
  const g = $('#f-group').value, kw = $('#f-q').value.trim().toLowerCase();
  const rows = METRICS.filter(m =>
    (!g || m.group === g) && (!kw || (m.label + m.key + m.definition).toLowerCase().includes(kw)));
  $('#t-metrics').innerHTML = `
    <thead><tr><th>Metric</th><th>Mã</th><th>Nhóm</th><th>Đơn vị</th><th>Cấp</th>
      <th>Công thức</th><th>Pipeline</th></tr></thead>
    <tbody>${rows.map(m => `<tr>
      <td>${esc(m.label)}</td><td><code>${esc(m.key)}</code></td>
      <td><span class="tag grp">${esc(m.group)}</span></td>
      <td>${esc(m.unit)}</td><td>${esc(m.level)}</td>
      <td><code>${esc(m.formula)}</code></td>
      <td>${m.available ? '<span class="tag ok">Đã kéo</span>' : '<span class="tag warn">Chưa kéo</span>'}</td>
    </tr>`).join('')}</tbody>`;
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
  e.target.disabled = true; e.target.textContent = 'Đang kéo…';
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 7 }) }).then(x => x.json());
    alert(r.error ? `Lỗi: ${r.error}` : `Xong: ${r.written} dòng${r.errors?.length ? `\n${r.errors.join('\n')}` : ''}`);
    await Promise.all([loadSummary(), loadCreators()]);
  } finally { e.target.disabled = false; e.target.textContent = 'Kéo dữ liệu 7 ngày'; }
});

$('#btn-link').addEventListener('click', async () => {
  const { url } = await get('/api/authorize-url');
  $('#link-out').innerHTML = `<code>${esc(url)}</code>`;
});

$('#f-group').addEventListener('change', renderMetricTable);
$('#f-q').addEventListener('input', renderMetricTable);

$('#w-q').addEventListener('input', renderWiki);
$('#w-group').addEventListener('change', renderWiki);
$('#w-status').addEventListener('change', renderWiki);
$('#w-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#w-view').children) x.setAttribute('aria-pressed', String(x === b));
  renderWiki();
});
// "/" nhay vao o tim, tru khi dang go trong mot o khac.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if ($('#tab-wiki').classList.contains('hide')) return;
  e.preventDefault(); $('#w-q').focus();
});

(async () => {
  METRICS = await get('/api/metrics');
  const groupOpts = [...new Set(METRICS.map(m => m.group))].map(g => `<option>${esc(g)}</option>`).join('');
  $('#f-group').insertAdjacentHTML('beforeend', groupOpts);
  $('#w-group').insertAdjacentHTML('beforeend', groupOpts);
  renderMetricTable(); renderWiki();
  await Promise.all([loadSummary(), loadCreators()]);
})();
