import { periods } from './period.js';
import { csvCell } from './csv.js';

// Mot loi JS khong duoc bat = trang trang, khong manh moi nao. Bat o day de:
// (1) hien thang len trang, (2) gui ve server cho vao log.
let reported = 0;
function reportError(where, err) {
  // Chan de quy: chinh fetch ben duoi neu that bai se reject -> unhandledrejection ->
  // goi lai ham nay -> lap vo tan. Da dinh mot lan roi thi thoi.
  if (reported++ > 3) return;
  const msg = String(err?.stack || err?.message || err);
  try {
    const el = document.querySelector('#sync-banner');
    if (el) {
      el.className = 'banner err';
      el.innerHTML = '<span class="dot-err"></span> <b>Giao diện lỗi:</b> ' +
        msg.split('\n')[0].replace(/[&<>]/g, '');
    }
  } catch {}
  // .catch() la BAT BUOC: fetch reject chu khong throw dong bo, try/catch khong do duoc.
  try {
    fetch('/api/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where, msg: msg.slice(0, 800), url: location.href }),
    }).catch(() => {});
  } catch {}
}
addEventListener('error', (e) => reportError('error', e.error ?? e.message));
addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));

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
const d2 = (s) => s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}` : '—';
// "2026-10-14" -> "T4 14/10". Ngay ISO day du bi xuong dong trong o bang chat.
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (s) => s ? `${WD[new Date(s + 'T00:00:00Z').getUTCDay()]} ${d2(s)}` : '—';
const dt = (s) => s ? new Date(s).toLocaleString('vi-VN') : '—';

let METRICS = [], DAILY = [], CREATORS = [], SYSTEM = null, DOCS = null;
// MOT bo chon ky duy nhat, ap cho KPI + bieu do + bang ngay + bang creator.
// Truoc day KPI lay ngay moi nhat con bang cong toan bo lich su -> hai cho noi hai ky khac nhau.
let PERIOD = 7;                       // so ngay, null = tat ca
// periods() o period.js: bo ngay chi co anh chup creator, va chi tra ve ky truoc khi no
// DAI BANG ky nay. Hai dieu kien do tung bi sai ngay tai day nen chuyen sang file rieng
// de test-period.mjs kiem duoc ma khong can DOM.
const inPeriod = () => periods(DAILY, PERIOD).cur;
const prevPeriod = () => periods(DAILY, PERIOD).prev;
const SUM_KEYS = ['gmv','net_gmv','orders','items_sold','est_commission',
                  'commission_base','refund_amount','refund_orders'];
// Cong metric goc roi TINH LAI ty le. Cong aov/ty le cua nhieu ngay lai la vo nghia.
function totals(days) {
  const t = {};
  for (const k of SUM_KEYS) t[k] = days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  // Cung co so: gmv gom don huy -> mau so la TONG don. Hoa hong chia GOC hoa hong.
  t.aov = (t.orders + t.refund_orders) ? t.gmv / (t.orders + t.refund_orders) : 0;
  t.commission_rate = t.commission_base ? (t.est_commission / t.commission_base) * 100 : 0;
  t.refund_rate = t.gmv ? (t.refund_amount / t.gmv) * 100 : 0;
  return t;
}

// Nhan ngan cho tieu de bang. Nhan day du trong registry ("Creator xuat hien trong du lieu")
// lam bang phinh ra phai cuon ngang; ten day du van con o tooltip va tab Metric.
const SHORT = {
  creators_seen: 'Creator', creators_active: 'Creator có đơn hợp lệ', gmv: 'GMV', net_gmv: 'GMV thực',
  orders: 'Đơn hợp lệ', items_sold: 'SP bán', aov: 'AOV', est_commission: 'Hoa hồng',
  commission_base: 'Gốc HH', commission_rate: '% hoa hồng',
  refund_amount: 'Hoàn/huỷ', refund_orders: 'Đơn huỷ', refund_rate: '% hoàn (tiền)',
};
const shortLabel = (k, m) => SHORT[k] ?? m?.label ?? k;
const byKey = () => Object.fromEntries(METRICS.map(m => [m.key, m]));

// --- tabs ---
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#nav').children)
    x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current');
  for (const x of document.querySelectorAll('.content section'))
    x.classList.toggle('hide', x.id !== `tab-${b.dataset.tab}`);
  $('#crumb').textContent = b.textContent;
});

// ---------- Tong quan ----------
const KPI_ORDER = ['creators_seen', 'creators_active', 'gmv', 'net_gmv', 'orders', 'items_sold',
                   'aov', 'est_commission', 'commission_base', 'commission_rate',
                   'refund_amount', 'refund_orders', 'refund_rate'];

// Metric tu uy quyen CREATOR. CO Y khong cho vao KPI_ORDER/SUM_KEYS: API creator khong tra
// ve thoi diem tao nen moi lan sync la mot ANH CHUP trang thai hien tai. Cong 7 ngay lai
// la dem cung mot yeu cau hang mau 7 lan. Chi hien gia tri cua NGAY CHUP GAN NHAT.
const SNAP_KEYS = ['sample_requests', 'samples_completed', 'showcase_products', 'target_collaborations'];
const lastSnapshot = () =>
  [...DAILY].reverse().find(d => SNAP_KEYS.some(k => d[k] !== undefined)) ?? null;

// So sanh ngay moi nhat voi ngay lien truoc. Khong co ngay truoc thi khong hien gi,
// hon la hien "+0%" gia.
function delta(key, cur) {
  const prev = prevPeriod();
  // Chua du du lieu cho ky truoc thi noi thang, dung de trong khien nguoi doc tuong khong doi.
  if (!prev.length) return '<span class="delta flat" title="Chưa đủ dữ liệu cho kỳ trước đó">—</span>';
  const was = totals(prev)[key];
  if (!was) return '';
  const pct = ((cur - was) / Math.abs(was)) * 100;
  if (!Number.isFinite(pct)) return '';
  return `<span class="delta ${pct >= 0 ? 'up' : 'down'}"
    title="Kỳ trước: ${fmt(was)}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

// Sparkline: duong xu huong trong KY dang chon, ve tu du lieu da co san.
function spark(key, days = DAILY) {
  if (days.length < 2) return '';
  const vals = days.map(d => Number(d[key]) || 0);
  const max = Math.max(...vals), min = Math.min(...vals), range = (max - min) || 1;
  const W = 120, H = 28;
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * (W - 4) + 2,
    H - 4 - ((v - min) / range) * (H - 8),
  ]);
  const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
  const up = vals.at(-1) >= vals.at(-2);
  const [lx, ly] = pts.at(-1);
  // KHONG dung preserveAspectRatio="none": no keo gian viewBox theo be ngang the,
  // bien duong xu huong thanh hinh tam giac meo.
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}"
    preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path class="sl" d="${line}"/>
    <circle class="sd" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2"/></svg>`;
}

function renderKpis() {
  const m = byKey();
  const days = inPeriod();
  const t = totals(days);
  const seen = CREATORS.filter(c => Number(c.days) > 0).length;
  const active = CREATORS.filter(c => Number(c.orders) > 0).length;

  $('#kpis').innerHTML = KPI_ORDER.filter(k => m[k]?.available && !m[k].live).map(k => {
    const v = k === 'creators_seen' ? seen : k === 'creators_active' ? active : (t[k] ?? 0);
    return `<div class="card kpi">
      <div class="kpi-l">${esc(m[k].label)}
        <span class="info" tabindex="0" title="${esc(m[k].definition)}&#10;&#10;Công thức: ${esc(m[k].formula)}">ⓘ</span>
      </div>
      <div class="n" title="${fmt(v, m[k].unit)}">${fmtKpi(v, m[k].unit)}</div>
      <div class="kpi-f">${k.startsWith('creators_') ? '' : delta(k, v)}
        <span class="muted">${esc(m[k].unit)}</span></div>
      ${k.startsWith('creators_') ? '' : spark(k, days)}
    </div>`;
  }).join('');

  // Anh chup: an han khoi khi chua creator nao uy quyen, thay vi hien 4 the 0 vinh vien.
  const snap = lastSnapshot();
  const keys = SNAP_KEYS.filter(k => m[k] && snap?.[k] !== undefined);
  $('#snap-wrap').classList.toggle('hide', !keys.length);
  if (keys.length) {
    $('#snap-day').textContent = dayLabel(snap.day);
    $('#kpis-snap').innerHTML = keys.map(k => `<div class="card kpi">
      <div class="kpi-l">${esc(m[k].label)}
        <span class="info" tabindex="0" title="${esc(m[k].definition)}&#10;&#10;Lưu ý: ${esc(m[k].pitfalls)}">ⓘ</span>
      </div>
      <div class="n" title="${fmt(snap[k], m[k].unit)}">${fmtKpi(snap[k], m[k].unit)}</div>
      <div class="kpi-f"><span class="muted">${esc(m[k].unit)}</span></div>
    </div>`).join('');
  }

  $('#kpis-na').innerHTML = METRICS.filter(x => !x.available).map(x => `
    <div class="card kpi na">
      <div class="kpi-l">${esc(x.label)}</div>
      <div class="n">—</div>
      <p class="why">${esc(x.source)}</p>
    </div>`).join('');
}

// Bieu do cot bang HTML/CSS, khong dung SVG: SVG phai chon giua "none" (keo gian lam
// meo chu) va "meet" (can giua, chua hai ben trong). Cot chi la div co chieu cao thi
// khong bao gio meo, chu luon sac net, va tu co gian theo be rong the.
function renderChart() {
  const key = $('#c-metric').value || 'gmv';
  const m = byKey()[key];
  const days = inPeriod();
  if (!days.length) { $('#chart').innerHTML = '<p class="empty">Chưa có dữ liệu ngày nào.</p>'; return; }
  const vals = days.map(d => Number(d[key]) || 0);
  const max = Math.max(...vals, 1);
  $('#chart').innerHTML = `<div class="bars" role="img"
      aria-label="Biểu đồ ${esc(m?.label ?? key)} theo ngày">
    ${days.map((d, i) => {
      const v = vals[i];
      return `<div class="bar-col" title="${esc(d.day)}: ${fmt(v, m?.unit)}">
        <div class="bar-v">${fmtKpi(v, m?.unit)}</div>
        <div class="bar-track"><div class="bar-fill" style="height:${((v / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-x">${esc(dayLabel(d.day))}</div>
      </div>`;
    }).join('')}
  </div>`;
}

async function loadSummary() {
  const [s, daily] = await Promise.all([get('/api/summary'), get('/api/daily')]);
  DAILY = daily;
  // Du lieu KHONG realtime: hom nay khong bao gio duoc keo, va ngay da qua van con doi
  // khi don chuyen PENDING -> SETTLED/INELIGIBLE. Phai noi ro, khong de nguoi dung doan.
  const f = s.freshness ?? {};
  const lag = f.newest && f.today
    ? Math.round((new Date(f.today) - new Date(f.newest)) / 86400e3) : null;
  $('#fresh').innerHTML = f.newest
    ? `<span class="dot-${lag <= 1 ? 'ok' : 'err'}"></span> dữ liệu đến <b>${esc(f.newest)}</b>
       ${lag > 1 ? `· trễ ${lag} ngày` : '· hôm nay chưa chốt nên không kéo'}`
    : 'chưa có dữ liệu';

  const r = s.lastSync;
  $('#sync-banner').innerHTML = r
    ? `<span class="dot-${r.status === 'ok' ? 'ok' : 'err'}"></span>
       Lần kéo gần nhất: <b>${dt(r.started_at)}</b> · ${esc(r.status)} · ${r.rows_written} dòng
       ${r.note ? `· <span class="warn-text">${esc(r.note)}</span>` : ''}`
    : '<span class="dot-err"></span> Chưa kéo dữ liệu lần nào.';
  renderKpis(); renderChart(); renderDaily();
}

// ---------- Creator ----------
let SORT = { key: 'net_gmv', dir: -1 };
const CCOLS = [
  { key: 'username',        label: 'Creator',      num: false },
  { key: 'days',            label: 'Số ngày',      num: true },
  { key: 'gmv',             label: 'GMV',          num: true },
  { key: 'net_gmv',         label: 'GMV thực',     num: true },
  { key: 'refund_amount',   label: 'Hoàn/huỷ',     num: true },
  { key: 'refund_orders',   label: 'Đơn huỷ',      num: true },
  { key: 'refund_rate',     label: '% hoàn (tiền)', num: true, unit: '%' },
  { key: 'orders',          label: 'Đơn hợp lệ',   num: true },
  { key: 'items_sold',      label: 'SP bán',       num: true },
  { key: 'aov',             label: 'AOV',          num: true },
  { key: 'commission_base', label: 'Gốc hoa hồng', num: true },
  { key: 'est_commission',  label: 'Hoa hồng',     num: true },
  { key: 'commission_rate', label: '% hoa hồng',   num: true, unit: '%' },
  { key: 'first_seen',      label: 'Thấy đầu',     num: false },
  { key: 'last_seen',       label: 'Thấy cuối',    num: false },
];
// Ty le khong cong duoc -> dong tong de trong, thay vi cong bay ra so vo nghia.
const SUMMABLE = new Set(['days','gmv','net_gmv','refund_amount','refund_orders','orders','items_sold','commission_base','est_commission']);

function creatorRows() {
  const kw = $('#c-q').value.trim().toLowerCase();
  return CREATORS.filter(r => !kw || r.username.toLowerCase().includes(kw))
    .sort((a, b) => {
      const { key, dir } = SORT;
      const col = CCOLS.find(c => c.key === key);
      if (col?.num) return (Number(a[key]) - Number(b[key])) * dir;
      return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir;
    });
}

function renderCreators() {
  const rows = creatorRows();
  $('#c-count').textContent = `${rows.length}/${CREATORS.length} creator`;
  const head = CCOLS.map(c => {
    const on = SORT.key === c.key;
    return `<th class="${c.num ? 'num ' : ''}sortable" data-sort="${c.key}"
      aria-sort="${on ? (SORT.dir === 1 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}<span
      class="arrow">${on ? (SORT.dir === 1 ? '▲' : '▼') : ''}</span></th>`;
  }).join('');
  const cell = (r, c) => c.key === 'username' ? `<td>@${esc(r.username)}</td>`
    : c.num ? `<td class="num">${fmt(r[c.key], c.unit)}</td>`
    : `<td>${d2(r[c.key])}</td>`;
  const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);
  $('#t-creators').innerHTML = `
    <thead><tr>${head}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>${CCOLS.map(c => cell(r, c)).join('')}</tr>`).join('')
      : `<tr><td colspan="${CCOLS.length}" class="empty">Không có creator nào khớp “${esc($('#c-q').value)}”.</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr>${CCOLS.map((c, i) =>
      i === 0 ? `<td>Tổng ${rows.length} creator</td>`
      : SUMMABLE.has(c.key) ? `<td class="num">${fmt(sum(c.key))}</td>` : '<td></td>').join('')}</tr></tfoot>` : ''}`;
}

function exportCsv() {
  const rows = creatorRows();
  const head = CCOLS.map(c => c.label).join(',');
  const body = rows.map(r => CCOLS.map(c => csvCell(r[c.key])).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `creators-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ---------- San pham / Shop ----------
// Doc tu /api/products, tuc tu bang THO sku_orders. Khac KPI tab Tong quan: o day don huy
// da bi loai ngay trong SQL (VALID_ROW), nen con so cong lai bang dung net_gmv chu khong
// phai gmv gop. Vi vay cot phai goi la 'GMV thuc' -- giong nhan o bang Creator. Goi no la
// 'GMV' nhu truoc thi hai tab hien hai so khac nhau duoi cung mot ten.
let PRODUCTS = { products: [], shops: [], byContentType: [] };
let PVIEW = 'products';
let PSORT = { products: { key: 'gmv', dir: -1 }, shops: { key: 'gmv', dir: -1 } };

const PCOLS = [
  { key: 'product_name',    label: 'Sản phẩm',      wide: true },
  { key: 'shop_name',       label: 'Shop' },
  { key: 'gmv',             label: 'GMV thực',      num: true },
  { key: 'orders',          label: 'Đơn',           num: true },
  { key: 'items',           label: 'SL bán',        num: true },
  { key: 'creators',        label: 'Creator',       num: true },
  { key: 'avg_rate',        label: '% hoa hồng',    num: true, unit: '%' },
  { key: 'est_commission',  label: 'Hoa hồng',      num: true },
];
const SCOLS = [
  { key: 'shop_name',       label: 'Shop',          wide: true },
  { key: 'gmv',             label: 'GMV thực',      num: true },
  { key: 'orders',          label: 'Đơn',           num: true },
  { key: 'products',        label: 'Sản phẩm',      num: true },
  { key: 'creators',        label: 'Creator',       num: true },
  { key: 'est_commission',  label: 'Hoa hồng',      num: true },
];
// Giong bang creator: ty le khong cong duoc nen dong tong de trong.
const PSUMMABLE = new Set(['gmv', 'orders', 'items', 'est_commission']);

const pcols = () => PVIEW === 'products' ? PCOLS : SCOLS;

function productRows() {
  const kw = $('#p-q').value.trim().toLowerCase();
  const sort = PSORT[PVIEW];
  const cols = pcols();
  return PRODUCTS[PVIEW]
    .filter(r => !kw || `${r.product_name ?? ''} ${r.shop_name ?? ''}`.toLowerCase().includes(kw))
    .sort((a, b) => {
      const col = cols.find(c => c.key === sort.key);
      if (col?.num) return (Number(a[sort.key]) - Number(b[sort.key])) * sort.dir;
      return String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), 'vi') * sort.dir;
    });
}

// Mot thanh chia ty le: cau tra loi "LIVE hay VIDEO ra don?" phai doc duoc trong 1 giay,
// khong bat nguoi dung tu chia bon con so GMV cho nhau.
// 6 trieu tren 17 ty = 0,035%. Lam tron 1 chu so ra "0.0%" ben canh mot so khac 0
// trong nhu bug, nen phan nho hon 0,1% duoc hien 2 chu so.
const pctShare = (v, total) => {
  if (!total) return '0%';
  const p = Number(v) / total * 100;
  return `${p < 0.1 ? p.toFixed(2) : p.toFixed(1)}%`;
};

function renderShare() {
  const rows = PRODUCTS.byContentType;
  const total = rows.reduce((t, r) => t + Number(r.gmv || 0), 0);
  if (!total) { $('#p-share').innerHTML = ''; return; }
  $('#p-share').innerHTML = `<div class="share" role="img"
    aria-label="${esc(rows.map(r => `${r.content_type} ${pctShare(r.gmv, total)}`).join(', '))}">
    ${rows.map((r, i) => {
      const pct = r.gmv / total * 100;
      return `<span class="share-seg s${i % 4}" style="width:${pct}%"
        title="${esc(r.content_type)}: ${fmt(r.gmv)} (${pctShare(r.gmv, total)})">${pct >= 7
          ? `${esc(r.content_type)} ${pct.toFixed(0)}%` : ''}</span>`;
    }).join('')}</div>`;
}

function renderContentCards() {
  const rows = PRODUCTS.byContentType;
  const total = rows.reduce((t, r) => t + Number(r.gmv || 0), 0);
  $('#p-content').innerHTML = rows.length ? rows.map((r, i) => `
    <div class="card kpi">
      <div class="kpi-l"><span class="swatch s${i % 4}"></span>${esc(r.content_type)}</div>
      <div class="n" title="${fmt(r.gmv)} đ">${fmtKpi(r.gmv)}</div>
      <div class="kpi-f"><span class="chip">${pctShare(r.gmv, total)} GMV</span>
        <span class="muted">${vnd.format(r.orders)} đơn</span></div>
      <p class="why">${vnd.format(r.contents)} nội dung · ${vnd.format(r.creators)} creator</p>
    </div>`).join('')
    : '<p class="sub">Chưa có dòng thô nào. Bảng này chỉ có dữ liệu từ lần kéo sau khi bật lưu dòng thô.</p>';
}

function renderProducts() {
  renderShare(); renderContentCards();
  const cols = pcols();
  const rows = productRows();
  const all = PRODUCTS[PVIEW].length;
  $('#p-count').textContent = `${rows.length}/${all} ${PVIEW === 'products' ? 'sản phẩm' : 'shop'}`;
  const sort = PSORT[PVIEW];

  const head = cols.map(c => {
    const on = sort.key === c.key;
    return `<th class="${c.num ? 'num ' : ''}${c.wide ? 'wide ' : ''}sortable" data-sort="${c.key}"
      aria-sort="${on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}<span
      class="arrow">${on ? (sort.dir === 1 ? '▲' : '▼') : ''}</span></th>`;
  }).join('');

  // Ten san pham TikTok dai hang tram ky tu -> cat bang CSS, giu nguyen van o title.
  const cell = (r, c) => c.num
    ? `<td class="num">${fmt(r[c.key], c.unit)}</td>`
    : `<td class="${c.wide ? 'wide' : 'clip'}" title="${esc(r[c.key])}">${esc(r[c.key] ?? '—')}</td>`;
  const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);

  $('#t-products').innerHTML = `
    <thead><tr>${head}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>${cols.map(c => cell(r, c)).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="empty">${all
        ? `Không có gì khớp “${esc($('#p-q').value)}”.`
        : 'Chưa có dòng thô nào trong kỳ này.'}</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr>${cols.map((c, i) =>
      i === 0 ? `<td>Tổng ${rows.length}</td>`
      : PSUMMABLE.has(c.key) ? `<td class="num">${fmt(sum(c.key))}</td>` : '<td></td>').join('')}</tr></tfoot>` : ''}`;
}

async function loadProducts() {
  // limit 200: bang nay de TIM va XEP HANG, khong phai de doc het. Keo het vai nghin san
  // pham ra client chi lam cham ma khong ai cuon tới cuoi.
  PRODUCTS = await get(`/api/products?limit=200${PERIOD ? `&days=${PERIOD}` : ''}`);
  renderProducts();
}

function exportProductsCsv() {
  const cols = pcols();
  const rows = productRows();
  const head = cols.map(c => c.label).join(',');
  const body = rows.map(r => cols.map(c => csvCell(r[c.key])).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + head + '\n' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${PVIEW}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ---------- Theo ngay ----------
function renderDaily() {
  const m = byKey();
  // Bo creators_active khoi bang: no gan nhu luon bang creators_seen (chi khac khi mot
  // creator ca ngay toan don huy), ma hai cot dem creator canh nhau thi doc khong ra.
  // Van giu o the KPI, noi co du cho ghi ten day du.
  const keys = KPI_ORDER.filter(k => m[k]?.available && !m[k].live && k !== 'creators_active');
  $('#t-daily').innerHTML = inPeriod().length ? `
    <thead><tr><th>Ngày</th>${keys.map(k =>
      `<th class="num" title="${esc(m[k].label)}">${esc(shortLabel(k, m[k]))}</th>`).join('')}</tr></thead>
    <tbody>${[...inPeriod()].reverse().map(d => `<tr><td class="nowrap" title="${esc(d.day)}">${esc(dayLabel(d.day))}</td>${
      keys.map(k => `<td class="num">${fmt(d[k], m[k].unit)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">Chưa kéo ngày nào.</td></tr></tbody>';
}

// ---------- He thong ----------
function renderSystem() {
  if (!SYSTEM) return;
  const { authorizations, categoryAssets, activeCipher, syncRuns, coverage } = SYSTEM;
  // floor, khong round: con 0.4 ngay phai doc ra "0 ngay". So am = da het han, va
  // "con -3 ngay" thi khong ai hieu la het han ca.
  const days = (iso) => iso ? Math.floor((new Date(iso) - Date.now()) / 86400e3) : null;
  const expiry = (n, iso) => n === null ? '—'
    : n < 0 ? `<b class="warn-text">đã hết hạn</b> (${dt(iso)})`
    : `còn ${n} ngày (${dt(iso)})`;

  const auth = authorizations.map(a => {
    const scopes = a.granted_scopes ?? [];
    const ad = days(a.access_expire_at), rd = days(a.refresh_expire_at);
    return `<div class="card">
      <div class="head"><b>${esc(a.role)}</b>
        <span class="tag ${a.status === 'active' ? 'ok' : 'off'}">${esc(a.status)}</span>
        ${a.user_type ? `<span class="tag grp">user_type ${esc(a.user_type)}</span>` : ''}</div>
      <dl class="meta">
        <dt>open_id</dt><dd><code>${esc(a.open_id)}</code></dd>
        <dt>Uỷ quyền lúc</dt><dd>${dt(a.authorized_at)}</dd>
        <dt>Access token</dt><dd>${expiry(ad, a.access_expire_at)}</dd>
        <dt>Refresh token</dt><dd>${expiry(rd, a.refresh_expire_at)}</dd>
        <dt>Scope (${scopes.length})</dt><dd>${scopes.length
          ? scopes.map(s => `<code class="${s === 'partner.cap_orders.read' ? 'key-scope' : ''}">${esc(s)}</code>`).join(' ')
          : '—'}</dd>
      </dl></div>`;
  }).join('');

  const assets = `<div class="card table-card"><table>
    <thead><tr><th>Category asset</th><th>Thị trường</th><th>Cipher</th><th>Dùng được</th></tr></thead>
    <tbody>${categoryAssets.map(a => {
      const on = a.cipher === activeCipher;
      return `<tr><td>${esc(a.category_name)}</td><td>${esc(a.target_market)}</td>
        <td><code>${esc(a.cipher.slice(0, 22))}…</code></td>
        <td>${on ? '<span class="tag ok">đang dùng</span>'
                 : '<span class="tag off">16032001 / 16032015</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>`;

  const runs = `<div class="card table-card"><table>
    <thead><tr><th>#</th><th>Bắt đầu</th><th>Xong</th><th>Trạng thái</th><th class="num">Dòng ghi</th><th>Ghi chú</th></tr></thead>
    <tbody>${syncRuns.map(r => `<tr><td>${r.id}</td><td>${dt(r.started_at)}</td>
      <td>${dt(r.finished_at)}</td>
      <td><span class="tag ${r.status === 'ok' ? 'ok' : r.status === 'running' ? 'grp' : 'warn'}">${esc(r.status)}</span></td>
      <td class="num">${fmt(r.rows_written)}</td><td>${esc(r.note) || '—'}</td></tr>`).join('')}</tbody></table></div>`;

  const am = SYSTEM.authMetrics ?? {};
  const m = byKey();
  // Token sap het han la nguyen nhan pho bien nhat lam sync chet am tham -> to mau canh bao.
  const warnAt = { access_token_days_left: 7, refresh_token_days_left: 30 };
  const authCards = Object.entries(am).map(([k, v]) => {
    const warn = warnAt[k] !== undefined && v !== null && v <= warnAt[k];
    return `<div class="card kpi${warn ? ' warn' : ''}">
      <div class="kpi-l">${esc(m[k]?.label ?? k)}
        ${m[k] ? `<span class="info" tabindex="0" title="${esc(m[k].definition)}&#10;&#10;Lưu ý: ${esc(m[k].pitfalls)}">ⓘ</span>` : ''}
      </div>
      <div class="n">${v === null ? '—' : fmt(v)}</div>
      <div class="kpi-f"><span class="muted">${esc(m[k]?.unit ?? '')}</span>
        ${warn ? `<span class="delta down">${v < 0 ? 'đã hết hạn' : 'sắp hết hạn'}</span>` : ''}</div>
    </div>`;
  }).join('');

  $('#system').innerHTML = `
    <div class="sec-head"><h3>Uỷ quyền</h3></div>
    <div class="kpis">${authCards}</div>
    <div class="sec-head"><h3>Dữ liệu đang có</h3></div>
    <div class="kpis">
      <div class="card kpi"><div class="kpi-l">Khoảng ngày</div><div class="n sm">${esc(coverage.from_day ?? '—')} → ${esc(coverage.to_day ?? '—')}</div></div>
      <div class="card kpi"><div class="kpi-l">Số ngày</div><div class="n">${coverage.days ?? 0}</div></div>
      <div class="card kpi"><div class="kpi-l">Dòng metric</div><div class="n">${fmt(coverage.rows ?? 0)}</div></div>
      <div class="card kpi"><div class="kpi-l">Creator</div><div class="n">${CREATORS.length}</div></div>
    </div>
    <div class="sec-head"><h3>Chi tiết uỷ quyền</h3></div>
    <div class="two-col">${auth}</div>
    <div class="sec-head"><h3>Category asset (${categoryAssets.length})</h3>
      ${DOCS?.api?.category_assets?.docUrl ? `<a class="doclink" target="_blank" rel="noopener"
        href="${esc(DOCS.api.category_assets.docUrl)}"
        title="${esc(DOCS.api.category_assets.method)} ${esc(DOCS.api.category_assets.path)}"
        >${esc(DOCS.api.category_assets.title)} ↗</a>` : ''}</div>
    <p class="sub">Chỉ cipher của <b>Creator Management</b> gọi được <code>cap_order/search</code>; 20 cái còn lại trả lỗi.</p>
    ${assets}
    <div class="sec-head"><h3>Lịch sử kéo dữ liệu</h3></div>
    ${runs}`;
}

async function loadCreators() {
  CREATORS = await get(`/api/creators${PERIOD ? `?days=${PERIOD}` : ''}`);
  renderCreators();
}

// Bam mot creator -> xem dien bien theo ngay cua rieng ho. Truoc day khong co duong nao
// nhin mot creator theo thoi gian, chi co tong cong ca ky.
let DRILL = null;
async function openDrill(username) {
  DRILL = username;
  $('#creator-drill').innerHTML = '<div class="card drill"><p class="muted">Đang tải…</p></div>';
  const rows = await get(`/api/creator-daily?username=${encodeURIComponent(username)}`);
  const m = byKey();
  // Metric anh chup chi them cot khi chinh creator nay co -- creator chua uy quyen thi
  // bang khong phinh ra 4 cot rong.
  const keys = ['gmv','net_gmv','orders','refund_orders','est_commission',
                ...SNAP_KEYS.filter(k => rows.some(r => r[k] !== undefined))];
  $('#creator-drill').innerHTML = `<div class="card drill">
    <div class="drill-head">
      <h3>@${esc(username)}</h3>
      <button class="btn ghost sm" id="drill-close" aria-label="Đóng">Đóng</button>
    </div>
    ${rows.length ? `<table><thead><tr><th>Ngày</th>${
      keys.map(k => `<th class="num" title="${esc(m[k]?.label ?? k)}">${esc(shortLabel(k, m[k]))}</th>`).join('')
    }</tr></thead><tbody>${[...rows].reverse().map(r => `<tr>
      <td class="nowrap">${esc(dayLabel(r.day))}</td>${
      keys.map(k => `<td class="num">${fmt(r[k], m[k]?.unit)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<p class="empty">Creator này chưa có ngày nào trong dữ liệu.</p>'}
  </div>`;
}
async function loadSystem() {
  SYSTEM = await get('/api/system');
  renderSystem();

  $('#side-foot').innerHTML = `<span class="tag ${SYSTEM.authorizations.some(a => a.status === 'active') ? 'ok' : 'warn'}">
    ${SYSTEM.authorizations.filter(a => a.status === 'active').length} uỷ quyền đang hoạt động</span>`;
}
// --- Wiki: tim kiem + 2 kieu hien thi -------------------------------------
// Tim tren toan bo noi dung cua metric, khong chi tren nhan.
const wikiHaystack = (m) => {
  const F = DOCS?.fields ?? {};
  const docText = (m.fields ?? []).flatMap(f => F[f] ? [f, F[f].en, F[f].vi] : [f]);
  return [m.label, m.key, m.group, m.unit, m.level, m.definition, m.formula, m.source, m.pitfalls,
          ...docText].join(' ').toLowerCase();
};

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

// Tab Metric = TRA CUU mot chi so, khong phai so sanh so lieu.
// 19 the lon dan hang chi thay ~8 cai moi man va khong so sanh duoc; doi sang
// danh sach + chi tiet: thay het dau muc trong mot man, bam vao doc sau.
let SELECTED = null;

function metricRow(m, kw, on) {
  return `<button class="mx-row${on ? ' on' : ''}" data-key="${esc(m.key)}" aria-current="${on}">
    <span class="dot ${m.available ? 'ok' : 'na'}" aria-hidden="true"></span>
    <span class="mx-row-t">${hl(m.label, kw)}</span>
    <code>${hl(m.key, kw)}</code>
  </button>`;
}

// Link toi dung trang tai lieu TikTok ma mo ta ben duoi duoc trich ra, de doi chieu lai duoc.
function apiDocLink(m) {
  const api = DOCS?.api?.cap_order_search;
  if (!api?.docUrl || !(m.fields ?? []).length) return '';
  return `<a class="doclink" href="${esc(api.docUrl)}" target="_blank" rel="noopener"
    title="${esc(api.method)} ${esc(api.path)}">${esc(api.title)} ↗</a>`;
}

function fieldRows(m, kw) {
  const F = DOCS?.fields ?? {};
  const list = (m.fields ?? []).filter(f => F[f]);
  if (!list.length) return '<p class="derived">Chỉ số dẫn xuất — tính từ metric khác, không đọc trường API nào.</p>';
  return `<table class="fieldtab"><tbody>${list.map(f => `
    <tr><td class="fname"><code>${esc(f)}</code></td>
        <td><div class="en">${hl(F[f].en, kw)}</div>
            <div class="vi">${hl(F[f].vi, kw)}</div></td></tr>`).join('')}</tbody></table>`;
}

// Thu tu ĐỌC: y nghia truoc, ky thuat sau. Day la thu nguoi dung can dau tien.
function metricDetail(m, kw) {
  return `<article class="mx-detail-in">
    <div class="mx-head">
      <h3>${hl(m.label, kw)}</h3>
      <div class="mx-chips">
        <code>${hl(m.key, kw)}</code>
        ${status(m)}
        <span class="tag grp">${esc(m.group)}</span>
      </div>
    </div>

    <p class="mx-def">${hl(m.definition, kw)}</p>

    <dl class="mx-facts">
      <div><dt>Đơn vị</dt><dd>${esc(m.unit)}</dd></div>
      <div><dt>Cấp</dt><dd>${esc(m.level)}</dd></div>
      <div><dt>Pipeline</dt><dd>${m.available ? 'đã kéo' : 'chưa kéo'}</dd></div>
    </dl>

    <h4>Công thức <span class="by ours">dashboard tự tính</span></h4>
    <p><code class="formula">${hl(m.formula, kw)}</code></p>

    <h4>Trường API <span class="by tiktok">nguyên văn TikTok + bản dịch</span>${apiDocLink(m)}</h4>
    ${fieldRows(m, kw)}

    <h4>Cần lưu ý</h4>
    <p class="pit">${hl(m.pitfalls, kw)}</p>

    <h4>Nguồn</h4>
    <p class="muted">${hl(m.source, kw)}</p>
  </article>`;
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

  // Loc xong ma muc dang chon roi khoi danh sach thi nhay ve muc dau.
  if (!rows.some(m => m.key === SELECTED)) SELECTED = rows[0].key;
  const cur = rows.find(m => m.key === SELECTED);

  const groups = [...new Set(rows.map(m => m.group))];
  const list = groups.map(gr => {
    const items = rows.filter(m => m.group === gr);
    return `<div class="mx-grp">${esc(gr)}<span>${items.length}</span></div>
      ${items.map(m => metricRow(m, kw, m.key === SELECTED)).join('')}`;
  }).join('');

  $('#wiki').innerHTML = `<div class="mx">
    <nav class="mx-list" id="mx-list" aria-label="Danh sách metric">${list}</nav>
    <div class="mx-detail">${metricDetail(cur, kw)}</div>
  </div>`;
}

$('#btn-sync').addEventListener('click', async (e) => {
  const days = Number($('#sync-days').value) || 3;
  e.target.disabled = true; e.target.textContent = 'Đang kéo…';
  try {
    const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days }) }).then(x => x.json());
    alert(r.error ? `Lỗi: ${r.error}` : `Xong: ${r.written} dòng${r.errors?.length ? `\n${r.errors.join('\n')}` : ''}`);
    await Promise.all([loadSummary(), loadCreators(), loadSystem(), loadProducts()]);
  } finally { e.target.disabled = false; e.target.textContent = 'Kéo dữ liệu'; }
});

// Hai nut, mot handler: hai luong chi khac tham so `role`, de rieng hai ham thi som muon
// mot ben duoc sua ma ben kia khong.
async function showAuthLink(role) {
  const r = await get(`/api/authorize-url?role=${role}`);
  $('#link-out').innerHTML = r.url
    ? `<p class="sub">Link uỷ quyền <b>${esc(role)}</b> — dùng MỘT LẦN, hết hạn sau
         ${r.expiresInDays >= 1 ? `${r.expiresInDays} ngày` : `${Math.round(r.expiresInDays * 1440)} phút`}:</p>
       <code class="link-out">${esc(r.url)}</code>`
    : `<p class="warn-text">Không lấy được link: ${esc(r.error ?? 'lỗi không rõ')}</p>`;
}
$('#btn-link').addEventListener('click', () => showAuthLink('partner'));
$('#btn-link-creator').addEventListener('click', () => showAuthLink('creator'));

$('#btn-sync-creator').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Đang kéo…';
  try {
    const r = await fetch('/api/sync-creator', { method: 'POST' }).then(x => x.json());
    alert(r.error ? `Lỗi: ${r.error}`
      : `Xong: ${r.creators} creator, ${r.written} dòng${
          [...(r.errors ?? []), ...(r.warnings ?? [])].length
            ? `\n${[...r.errors, ...r.warnings].join('\n')}` : ''}`);
    await Promise.all([loadSummary(), loadCreators(), loadSystem()]);
  } finally { e.target.disabled = false; e.target.textContent = 'Kéo dữ liệu creator'; }
});

$('#btn-export').addEventListener('click', exportCsv);
$('#c-metric').addEventListener('change', renderChart);

$('#period').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#period').children) x.setAttribute('aria-pressed', String(x === b));
  PERIOD = b.dataset.days ? Number(b.dataset.days) : null;
  // Ca hai bang deu phai doi theo cung ky, neu khong tab no noi ky khac tab kia.
  await Promise.all([loadCreators(), loadProducts()]);
  renderKpis(); renderChart(); renderDaily();
});
$('#c-q').addEventListener('input', renderCreators);
$('#creator-drill').addEventListener('click', (e) => {
  if (e.target.closest('#drill-close')) { DRILL = null; $('#creator-drill').innerHTML = ''; }
});

$('#t-creators').addEventListener('click', (e) => {
  const td = e.target.closest('tbody td');
  if (td) {
    const name = td.closest('tr')?.querySelector('td')?.textContent?.replace(/^@/, '');
    if (name) openDrill(name);
    return;
  }
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const k = th.dataset.sort;
  // Bam lai cung cot thi dao chieu; doi cot thi so giam dan, chu tang dan.
  SORT = SORT.key === k ? { key: k, dir: -SORT.dir }
       : { key: k, dir: CCOLS.find(c => c.key === k)?.num ? -1 : 1 };
  renderCreators();
});

$('#btn-export-p').addEventListener('click', exportProductsCsv);
$('#p-q').addEventListener('input', renderProducts);

$('#p-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#p-view').children) x.setAttribute('aria-pressed', String(x === b));
  PVIEW = b.dataset.view;
  renderProducts();
});

$('#t-products').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const k = th.dataset.sort;
  const cur = PSORT[PVIEW];
  PSORT[PVIEW] = cur.key === k ? { key: k, dir: -cur.dir }
    : { key: k, dir: pcols().find(c => c.key === k)?.num ? -1 : 1 };
  renderProducts();
});

$('#w-q').addEventListener('input', renderWiki);
$('#w-group').addEventListener('change', renderWiki);
$('#w-status').addEventListener('change', renderWiki);
$('#wiki').addEventListener('click', (e) => {
  const b = e.target.closest('.mx-row'); if (!b) return;
  SELECTED = b.dataset.key; renderWiki();
  $('#wiki').querySelector('.mx-row.on')?.scrollIntoView({ block: 'nearest' });
});

$('#w-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#w-view').children) x.setAttribute('aria-pressed', String(x === b));
  renderWiki();
});

// "/" nhay vao o tim cua tab dang mo, tru khi dang go trong mot o khac.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const box = !$('#tab-chi-so').classList.contains('hide') ? $('#w-q')
            : !$('#tab-creator').classList.contains('hide') ? $('#c-q')
            : !$('#tab-san-pham').classList.contains('hide') ? $('#p-q') : null;
  if (!box) return;
  e.preventDefault(); box.focus();
});

(async () => {
  try {
  [METRICS, DOCS] = await Promise.all([get('/api/metrics'), get('/api/fields')]);
  $('#w-group').insertAdjacentHTML('beforeend',
    [...new Set(METRICS.map(m => m.group))].map(g => `<option>${esc(g)}</option>`).join(''));
  // Bieu do chi chon duoc metric da noi API va khong phai dem creator.
  $('#c-metric').insertAdjacentHTML('beforeend', METRICS
    .filter(m => m.available && !m.key.startsWith('creators_'))
    .map(m => `<option value="${esc(m.key)}"${m.key === 'gmv' ? ' selected' : ''}>${esc(m.label)}</option>`).join(''));
  renderWiki();
  await Promise.all([loadCreators(), loadSystem(), loadProducts()]);
  await loadSummary();   // can CREATORS truoc de KPI dem dung so creator trong ky
  } catch (e) { reportError('init', e); }
})();
