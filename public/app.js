import { periods } from './period.js';
import { csvCell } from './csv.js';
import { summarize, alertsFor, worst, change, RULES } from './alerts.js';
import { classify, eta } from './coverage.js';

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
// Kiem r.ok: khong co no thi body loi cua server ({error: "..."}) di tiep nhu du lieu
// that, va giao dien tu bao "chua co du lieu" trong khi that ra la server dang hong --
// hai trang thai rat khac nhau ma nguoi dung thay giong het.
const get = async (u) => {
  const r = await fetch(u);
  const body = await r.json().catch(() => null);
  if (!r.ok || body === null) {
    throw new Error(`${u} -> ${r.status}${body?.error ? `: ${body.error}` : ''}`);
  }
  return body;
};
const vnd = new Intl.NumberFormat('vi-VN');
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (v, unit) =>
  unit === '%' ? `${Number(v).toFixed(1)}%` : vnd.format(Math.round(Number(v) || 0));
// Intl vi-VN rut gon thanh "N" / "Tr" / "T" -- "9,6 T" (ty) va "666,2 Tr" (trieu) chi
// khac mot chu cai ma khac nhau 1000 lan, doc luot la nham. Viet thang ra cho ro.
const DON_VI = { N: 'ngh', Tr: 'tr', T: 'tỷ' };
// KPI dung ban rut gon de khong tran the; so day du nam o thuoc tinh title.
const fmtKpi = (v, unit) => {
  const n = Number(v) || 0;
  if (unit === '%') return `${n.toFixed(1)}%`;
  if (Math.abs(n) < 1e6) return vnd.format(Math.round(n));
  return compact.format(n).replace(/\s*(N|Tr|T)$/, (_, k) => ' ' + DON_VI[k]);
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const d2 = (s) => s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}` : '—';
// "2026-10-14" -> "T4 14/10". Ngay ISO day du bi xuong dong trong o bang chat.
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (s) => s ? `${WD[new Date(s + 'T00:00:00Z').getUTCDay()]} ${d2(s)}` : '—';
const dt = (s) => s ? new Date(s).toLocaleString('vi-VN') : '—';

let METRICS = [], DAILY = [], CREATORS = [], SYSTEM = null, CREATOR_DATA = null, DOCS = null;
// MOT bo chon ky duy nhat, ap cho KPI + bieu do + bang ngay + bang creator.
// Truoc day KPI lay ngay moi nhat con bang cong toan bo lich su -> hai cho noi hai ky khac nhau.
let PERIOD = 7;                       // so ngay, null = tat ca
// periods() o period.js: bo ngay chi co anh chup creator, va chi tra ve ky truoc khi no
// DAI BANG ky nay. Hai dieu kien do tung bi sai ngay tai day nen chuyen sang file rieng
// de test-period.mjs kiem duoc ma khong can DOM.
const inPeriod = () => periods(DAILY, PERIOD).cur;
const prevPeriod = () => periods(DAILY, PERIOD).prev;
const SUM_KEYS = ['gmv','net_gmv','orders','orders_all','items_sold','items_sold_net',
                  'refunded_items','est_commission','est_commission_net',
                  'commission_base','commission_base_net','refund_amount','refund_orders'];
// Cong metric goc roi TINH LAI ty le. Cong aov/ty le cua nhieu ngay lai la vo nghia.
function totals(days) {
  const t = {};
  for (const k of SUM_KEYS) t[k] = days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
  // Cung co so: gmv gom don huy -> mau so la TONG don. Hoa hong chia GOC hoa hong.
  const allOrders = t.orders_all || (t.orders + t.refund_orders);
  t.aov = allOrders ? t.gmv / allOrders : 0;
  t.commission_rate = t.commission_base ? (t.est_commission / t.commission_base) * 100 : 0;
  t.refund_rate = t.gmv ? (t.refund_amount / t.gmv) * 100 : 0;
  return t;
}

// Nhan tieng Anh chuan dung chung cho bang, bieu do va drill-down. Giữ cung mot
// vocabulary voi registry de khong co mot metric bi goi bang nhieu ten khac nhau.
const SHORT = {
  creators_seen: 'Creators with Order Data', creators_active: 'Active Creators',
  total_creators: 'Total Creators',
  gmv: 'Gross Attributed GMV', net_gmv: 'Net GMV (Estimated)',
  orders: 'Valid Orders', orders_all: 'Total Orders (Gross)', items_sold: 'Gross Units Sold',
  items_sold_net: 'Net Units Sold (Estimated)', refunded_items: 'Units on Refunded/Cancelled Lines',
  aov: 'Average Order Value (Gross AOV)',
  est_commission: 'Estimated Commission (Gross)', est_commission_net: 'Estimated Commission After Refunds/Cancellations',
  commission_base: 'Commission Base (Gross)', commission_base_net: 'Commission Base After Refunds/Cancellations',
  commission_rate: 'Estimated Commission Rate on Commission Base', refund_amount: 'Refund/Cancel Amount',
  refund_orders: 'Fully Refunded/Cancelled Orders', refund_rate: 'Refund/Cancel Rate by Value',
};
const shortLabel = (k, m) => SHORT[k] ?? m?.label ?? k;
const byKey = () => Object.fromEntries(METRICS.map(m => [m.key, m]));

// Tooltip cua cot lay tu registry metric. Cac cot tong hop theo san pham/shop
// khong co metric key rieng trong registry, nen khai bao cong thuc bo sung tai day.
// Khong dung title don thuan: title bi cat tuy trinh duyet va khong co layout on dinh.
const TABLE_TIPS = {
  'creator:days': {
    title: 'Days', definition: 'Number of distinct data days available for this creator in the selected period.',
    formula: 'COUNT(DISTINCT day)', unit: 'days', note: 'Only days with order data are counted.',
  },
  'creator:first_seen': {
    title: 'First Seen', definition: 'First data day on which this creator appeared in the selected period.',
    formula: 'MIN(day)', unit: 'date', note: 'This is the first observed order-data day, not the creator authorization date.',
  },
  'creator:last_seen': {
    title: 'Last Seen', definition: 'Most recent data day on which this creator appeared in the selected period.',
    formula: 'MAX(day)', unit: 'date', note: 'This is the last observed order-data day, not the latest TikTok activity timestamp.',
  },
  'product:gmv': {
    title: 'Net GMV (Estimated)', definition: 'GMV from valid SKU-order rows after excluding rows marked as refunded/cancelled.',
    formula: 'SUM(price.amount × quantity) WHERE VALID_ROW', unit: 'VND',
    note: 'Estimated because the API does not provide returned quantity for partial refunds.',
  },
  'shop:gmv': {
    title: 'Net GMV (Estimated)', definition: 'GMV from valid SKU-order rows after excluding rows marked as refunded/cancelled.',
    formula: 'SUM(price.amount × quantity) WHERE VALID_ROW', unit: 'VND',
    note: 'Estimated because the API does not provide returned quantity for partial refunds.',
  },
  'product:orders': {
    title: 'Valid Orders', definition: 'Distinct orders with at least one valid SKU-order row for the product.',
    formula: 'COUNT(DISTINCT order_id) WHERE VALID_ROW', unit: 'orders',
    note: 'A multi-SKU order is counted once.',
  },
  'shop:orders': {
    title: 'Valid Orders', definition: 'Distinct orders with at least one valid SKU-order row for the shop.',
    formula: 'COUNT(DISTINCT order_id) WHERE VALID_ROW', unit: 'orders',
    note: 'A multi-SKU order is counted once.',
  },
  'product:items': {
    title: 'Valid Units', definition: 'Quantity from valid SKU-order rows for the product.',
    formula: 'SUM(quantity) WHERE VALID_ROW', unit: 'items',
    note: 'Partial refunds cannot be measured exactly without returned_quantity.',
  },
  'product:creators': {
    title: 'Creators', definition: 'Distinct creators with valid attributed orders for the product.',
    formula: 'COUNT(DISTINCT creator_username) WHERE VALID_ROW', unit: 'creators',
    note: 'Creator profiles without an order are not included.',
  },
  'shop:products': {
    title: 'Unique Products', definition: 'Distinct products with valid attributed orders for the shop.',
    formula: 'COUNT(DISTINCT product_id) WHERE VALID_ROW', unit: 'products',
    note: 'Product IDs are counted within the selected period.',
  },
  'shop:creators': {
    title: 'Creators', definition: 'Distinct creators with valid attributed orders for the shop.',
    formula: 'COUNT(DISTINCT creator_username) WHERE VALID_ROW', unit: 'creators',
    note: 'Creator profiles without an order are not included.',
  },
  'product:avg_rate': {
    title: 'Avg. Standard Commission Rate',
    definition: 'Arithmetic average of TikTok standard commission rates across the product rows.',
    formula: 'ROUND(AVG(std_rate) / 100, 2)', unit: '%',
    note: 'This is not the effective commission rate; the weighted rate is shown in the creator metrics.',
  },
};
const TIP_CATALOG = new Map();

function columnTip(c, scope) {
  const specific = TABLE_TIPS[`${scope}:${c.key}`];
  const m = byKey()[c.key];
  if (specific) {
    return {
      ...specific,
      definitionVi: m?.definition,
      formulaVi: m?.formula,
      noteVi: m?.pitfalls,
    };
  }
  if (!m) return null;
  return {
    title: m.label,
    definition: m.definition,
    formula: m.formula,
    unit: m.unit,
    note: m.pitfalls,
    definitionVi: m.definition,
    formulaVi: m.formula,
    noteVi: m.pitfalls,
  };
}

function tipIdFor(c, scope) {
  const id = `${scope}:${c.key}`;
  const tip = columnTip(c, scope);
  if (tip) TIP_CATALOG.set(id, { ...tip, title: tip.title || c.label });
  return tip ? id : '';
}

// KPI cards are not table headers, so they cannot use `data-tip-id` from the
// table registry. Store the same structured fields on the info icon so the
// tooltip is rendered by the same accessible overlay instead of relying on a
// browser-native `title` tooltip that is easy to miss.
function tipDataAttrs(tip) {
  return `data-tip-title="${esc(tip?.title)}"
    data-tip-definition="${esc(tip?.definition)}"
    data-tip-definition-vi="${esc(tip?.definitionVi)}"
    data-tip-formula="${esc(tip?.formula)}"
    data-tip-formula-vi="${esc(tip?.formulaVi)}"
    data-tip-unit="${esc(tip?.unit)}"
    data-tip-note="${esc(tip?.note)}"
    data-tip-note-vi="${esc(tip?.noteVi)}"
    aria-label="Show definition and formula for ${esc(tip?.title)}"
    `;
}

function metricHeader(c, scope, extraClass = '', sortState = null) {
  const id = tipIdFor(c, scope);
  const sortable = sortState !== null;
  const on = sortable && sortState.key === c.key;
  const cls = `${extraClass}${c.num ? 'num ' : ''}${c.wide ? 'wide ' : ''}${c.key === 'username' ? 'who ' : ''}${sortable ? 'sortable' : ''}`;
  const sortAttrs = sortable
    ? ` data-sort="${esc(c.key)}" aria-sort="${on ? (sortState.dir === 1 ? 'ascending' : 'descending') : 'none'}"`
    : '';
  return `<th class="${cls}"${sortAttrs}${id ? ` data-tip-id="${esc(id)}"` : ''}>${esc(c.label)}${id
      ? `<span class="metric-help" tabindex="0" role="img" aria-label="Show definition and formula for ${esc(c.label)}">ⓘ</span>` : ''}${sortable
        ? `<span class="arrow">${on ? (sortState.dir === 1 ? '▲' : '▼') : ''}</span>` : ''}</th>`;
}

function showTooltip(target, tip) {
  if (!tip) return;
  let el = $('#metric-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'metric-tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.append(el);
  }
  const definitionVi = tip.definitionVi && tip.definitionVi !== tip.definition
    ? `<div class="metric-tip-vi"><b>Vietsub</b>${esc(tip.definitionVi)}</div>` : '';
  const formulaVi = tip.formulaVi && tip.formulaVi !== tip.formula
    ? `<div class="metric-tip-vi"><b>Vietsub</b><code>${esc(tip.formulaVi)}</code></div>` : '';
  const noteVi = tip.noteVi && tip.noteVi !== tip.note
    ? `<div class="metric-tip-vi"><b>Vietsub</b>${esc(tip.noteVi)}</div>` : '';
  el.innerHTML = `<strong class="metric-tip-title">${esc(tip.title)}</strong>
    <div class="metric-tip-item"><b>Definition / Định nghĩa</b>${esc(tip.definition)}${definitionVi}</div>
    <div class="metric-tip-item"><b>Formula / Công thức</b><code>${esc(tip.formula)}</code>${formulaVi}</div>
    <div class="metric-tip-meta"><b>Unit / Đơn vị:</b> ${esc(tip.unit)}${tip.note ? `<div class="metric-tip-note"><b>Note / Lưu ý:</b> ${esc(tip.note)}</div>` : ''}${noteVi}</div>`;
  el.hidden = false;
  const r = target.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const left = Math.min(Math.max(margin, r.left), window.innerWidth - el.offsetWidth - margin);
  const below = r.bottom + gap;
  const top = below + el.offsetHeight <= window.innerHeight - margin
    ? below : Math.max(margin, r.top - el.offsetHeight - gap);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function showMetricTooltip(target, id) {
  showTooltip(target, TIP_CATALOG.get(id));
}

function showInfoTooltip(target) {
  const d = target?.dataset ?? {};
  showTooltip(target, {
    title: d.tipTitle,
    definition: d.tipDefinition,
    definitionVi: d.tipDefinitionVi,
    formula: d.tipFormula,
    formulaVi: d.tipFormulaVi,
    unit: d.tipUnit,
    note: d.tipNote,
    noteVi: d.tipNoteVi,
  });
}

function hideMetricTooltip() {
  const el = $('#metric-tooltip');
  if (el) el.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  const target = e.target.closest?.('th[data-tip-id], .info[data-tip-title]');
  if (!target || target.contains(e.relatedTarget)) return;
  target.matches('th[data-tip-id]')
    ? showMetricTooltip(target, target.dataset.tipId)
    : showInfoTooltip(target);
});
document.addEventListener('pointerout', (e) => {
  const target = e.target.closest?.('th[data-tip-id], .info[data-tip-title]');
  if (!target || target.contains(e.relatedTarget)) return;
  hideMetricTooltip();
});
document.addEventListener('focusin', (e) => {
  const help = e.target.closest?.('.metric-help');
  if (help) showMetricTooltip(help.closest('th'), help.closest('th')?.dataset.tipId);
  const info = e.target.closest?.('.info[data-tip-title]');
  if (info) showInfoTooltip(info);
});
document.addEventListener('focusout', (e) => {
  if (e.target.closest?.('.metric-help, .info[data-tip-title]')) hideMetricTooltip();
});
addEventListener('resize', hideMetricTooltip);
addEventListener('scroll', hideMetricTooltip, true);

// Khung xuong luc dang tai: giu nguyen bo cuc nen trang khong nhay khi du lieu ve.
// `aria-busy` de trinh doc man hinh biet day la cho doi, khong phai noi dung that.
const skelRows = (n = 6) =>
  `<tbody aria-busy="true">${Array.from({ length: n }, () =>
    '<tr><td><div class="skel skel-row"></div></td></tr>').join('')}</tbody>`;
const skelKpis = (n = 4) =>
  Array.from({ length: n }, () =>
    '<div class="card kpi" aria-busy="true"><div class="skel skel-row"></div></div>').join('');

function showLoading() {
  $('#kpis').innerHTML = skelKpis(4);
  // #kpis-phu va #chart cung phai vao trang thai tai: bo sot chung thi khi doi ky, hai
  // vung do giu nguyen SO CUA KY CU nam canh skeleton cua ky moi -- doc ra tuong la so that.
  $('#kpis-phu').innerHTML = skelKpis(9);
  $('#chart').innerHTML = '<div class="skel skel-row" style="height:150px"></div>';
  $('#t-daily').innerHTML = skelRows(5);
  $('#t-creators').innerHTML = skelRows(8);
  $('#t-products').innerHTML = skelRows(8);
  $('#t-creator-data').innerHTML = skelRows(5);
}

// --- tabs ---
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#nav').children)
    x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current');
  // Dua tieu diem vao vung noi dung: nguoi dung ban phim doi tab xong phai o dung
  // cho moi, khong phai Tab lai tu dau thanh dieu huong.
  $('#main').focus({ preventScroll: true });
  for (const x of document.querySelectorAll('.content section'))
    x.classList.toggle('hide', x.id !== `tab-${b.dataset.tab}`);
  $('#crumb').textContent = b.textContent;
});

// ---------- Tong quan ----------
// Cac the cao bang nhau, cung co chu, cung sac do = khong the biet nhin cai nao truoc.
// Chia hai muc: 4 con so tra loi "ky nay the nao", con lai la chi tiet de doi chieu.
// Thu tu trong moi muc la thu tu doc, khong phai thu tu trong registry.
const KPI_CHINH = ['net_gmv', 'orders_all', 'est_commission', 'creators_active', 'total_creators'];
const KPI_PHU   = ['gmv', 'refund_amount', 'refund_orders', 'refund_rate',
                   'aov', 'items_sold', 'items_sold_net', 'refunded_items',
                   'commission_base', 'commission_rate', 'creators_seen'];
const KPI_ORDER = [...KPI_CHINH, ...KPI_PHU];

// This is a dashboard context metric, not a TikTok API metric. The partner API
// does not expose the full MCN binding list, so the honest scope is creator
// usernames that exist in our local `creators` table (seen at least once).
const DERIVED_KPIS = {
  total_creators: {
    label: 'Total Creators', unit: 'creators', available: true, live: false,
    definition: 'Distinct creator usernames present in the local creator dataset.',
    definitionVi: 'Số creator khác nhau đã từng xuất hiện trong dữ liệu cục bộ của dashboard.',
    formula: 'COUNT(DISTINCT creator_username) FROM creators',
    pitfalls: 'This is not the total number of creators currently bound to the MCN; TikTok does not expose that full binding list through this partner API.',
    pitfallsVi: 'Không phải tổng creator đang bind với MCN; TikTok không cung cấp toàn bộ danh sách bind qua partner API này.',
  },
};

// Metric tu uy quyen CREATOR. CO Y khong cho vao KPI_ORDER/SUM_KEYS: API creator khong tra
// ve thoi diem tao nen moi lan sync la mot ANH CHUP trang thai hien tai. Cong 7 ngay lai
// la dem cung mot yeu cau hang mau 7 lan. Chi hien gia tri cua NGAY CHUP GAN NHAT.
const SNAP_KEYS = ['sample_requests', 'samples_completed', 'showcase_products', 'target_collaborations'];
const lastSnapshot = () =>
  [...DAILY].reverse().find(d => SNAP_KEYS.some(k => d[k] !== undefined)) ?? null;

// So sanh ngay moi nhat voi ngay lien truoc. Khong co ngay truoc thi khong hien gi,
// hon la hien "+0%" gia.
function delta(key, cur, unit) {
  const prev = prevPeriod();
  // Chua du du lieu cho ky truoc thi noi thang, dung de trong khien nguoi doc tuong khong doi.
  if (!prev.length) return '<span class="delta flat" title="Chưa đủ dữ liệu cho kỳ trước đó">—</span>';
  const was = totals(prev)[key];
  if (!was) return '';
  // Metric da la TY LE thi "giam 1,1%" khong doc ra nghia: 1,1% cua 9,3% hay 1,1 diem?
  // Chenh lech diem phan tram la cach duy nhat khong mo ho, va cung la cach nguoi lam
  // so lieu doc. Metric thuong thi van la % thay doi.
  const laTyLe = unit === '%';
  const d = laTyLe ? cur - was : ((cur - was) / Math.abs(was)) * 100;
  if (!Number.isFinite(d)) return '';
  const nhan = laTyLe ? `${Math.abs(d).toFixed(1)} điểm` : `${Math.abs(d).toFixed(1)}%`;
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}"
    title="Kỳ trước: ${fmt(was, unit)}">${d >= 0 ? '▲' : '▼'} ${nhan}</span>`;
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

  // Nhan NGAN, dung chung voi tieu de bang (SHORT). Truoc day the KPI dung nhan day du
  // dang cau ("Ty le hoan/huy (theo gia tri)") nen xuong 2 dong va day moi the len 163px,
  // trong khi bang ngay duoi goi chinh no la "% hoan" -- mot thu, hai ten.
  const the = (k, chinh) => {
    const metric = m[k] ?? DERIVED_KPIS[k];
    const isDerived = Boolean(DERIVED_KPIS[k]);
    const v = k === 'total_creators' ? CREATORS.length
      : k === 'creators_seen' ? seen : k === 'creators_active' ? active : (t[k] ?? 0);
    const unit = metric.unit;
    const laCreator = k.startsWith('creators_');
    // Don vi KHONG lap lai khi con so da mang no: "9.3%" roi "%" nua thanh "1.1% %".
    const donVi = unit === '%' ? '' : `<span class="muted">${esc(unit)}</span>`;
    const tip = {
      title: shortLabel(k, metric), definition: metric.definition, formula: metric.formula,
      unit: metric.unit, note: metric.pitfalls,
      definitionVi: metric.definitionVi ?? metric.definition,
      formulaVi: metric.formulaVi ?? metric.formula,
      noteVi: metric.pitfallsVi ?? metric.pitfalls,
    };
    return `<div class="card kpi${chinh ? ' chinh' : ''}">
      <div class="kpi-l">${esc(shortLabel(k, metric))}
        <span class="info" tabindex="0" role="img" ${tipDataAttrs(tip)}>ⓘ</span>
      </div>
      <div class="n" title="${fmt(v, unit)}">${fmtKpi(v, unit)}</div>
      <div class="kpi-f">${isDerived || laCreator ? '' : delta(k, v, unit)}${donVi}</div>
      ${chinh && !laCreator && !isDerived ? spark(k, days) : ''}
    </div>`;
  };
  const co = (k) => (m[k] ?? DERIVED_KPIS[k])?.available && !(m[k] ?? DERIVED_KPIS[k]).live;
  $('#kpis').innerHTML = KPI_CHINH.filter(co).map(k => the(k, true)).join('');
  $('#kpis-phu').innerHTML = KPI_PHU.filter(co).map(k => the(k, false)).join('');

  // Anh chup: an han khoi khi chua creator nao uy quyen, thay vi hien 4 the 0 vinh vien.
  const snap = lastSnapshot();
  const keys = SNAP_KEYS.filter(k => m[k] && snap?.[k] !== undefined);
  $('#snap-wrap').classList.toggle('hide', !keys.length);
  if (keys.length) {
    $('#snap-day').textContent = dayLabel(snap.day);
    $('#kpis-snap').innerHTML = keys.map(k => `<div class="card kpi">
      <div class="kpi-l">${esc(m[k].label)}
        <span class="info" tabindex="0" role="img" ${tipDataAttrs({
          title: m[k].label, definition: m[k].definition, formula: m[k].formula,
          unit: m[k].unit, note: m[k].pitfalls,
          definitionVi: m[k].definition, formulaVi: m[k].formula, noteVi: m[k].pitfalls,
        })}>ⓘ</span>
      </div>
      <div class="n" title="${fmt(snap[k], m[k].unit)}">${fmtKpi(snap[k], m[k].unit)}</div>
      <div class="kpi-f"><span class="muted">${esc(m[k].unit)}</span></div>
    </div>`).join('');
  }

  const chuaKeo = METRICS.filter(x => !x.available);
  $('#na-count').textContent = `${chuaKeo.length} chỉ số`;
  $('#kpis-na').innerHTML = chuaKeo.map(x => `
    <div class="card kpi na">
      <div class="kpi-l">${esc(x.label)}</div>
      <div class="n">—</div>
      <p class="why">${esc(x.source)}</p>
    </div>`).join('');
}

// Bieu do cot bang HTML/CSS, khong dung SVG: SVG phai chon giua "none" (keo gian lam
// meo chu) va "meet" (can giua, chua hai ben trong). Cot chi la div co chieu cao thi
// khong bao gio meo, chu luon sac net, va tu co gian theo be rong the.
const TREND_AVERAGE_KEYS = new Set(['aov', 'commission_rate', 'refund_rate']);

function trendValue(rows, key) {
  const values = rows.map(d => Number(d[key])).filter(Number.isFinite);
  if (!values.length) return 0;
  if (TREND_AVERAGE_KEYS.has(key)) return values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + value, 0);
}

function trendRange(rows) {
  const first = rows[0]?.day;
  const last = rows.at(-1)?.day;
  return first && last && first !== last ? `${dayLabel(first)} – ${dayLabel(last)}` : dayLabel(first);
}

function renderChart() {
  const key = $('#c-metric').value || 'gmv';
  const m = byKey()[key];
  const days = inPeriod();
  if (!days.length) { $('#chart').innerHTML = '<p class="empty">Chưa có dữ liệu ngày nào.</p>'; return; }
  const size = Number($('#c-group')?.value || 3);
  const groups = [];
  for (let i = 0; i < days.length; i += size) groups.push(days.slice(i, i + size));
  const vals = groups.map(rows => trendValue(rows, key));
  const max = Math.max(...vals, 1);
  const mode = TREND_AVERAGE_KEYS.has(key) ? 'trung bình' : 'tổng';
  $('#chart-note').textContent = size === 1
    ? 'Mỗi cột là một ngày · rê chuột để xem giá trị chi tiết'
    : `${size === 7 ? 'Theo tuần' : `Mỗi ${size} ngày`} · ${mode} của các ngày trong nhóm · rê chuột để xem khoảng ngày`;
  $('#chart').innerHTML = `<div class="bars" role="img"
      aria-label="Biểu đồ ${esc(m?.label ?? key)} ${size === 1 ? 'theo ngày' : `gom ${size} ngày`}">
    ${groups.map((rows, i) => {
      const v = vals[i];
      const range = trendRange(rows);
      return `<div class="bar-col" title="${esc(range)} · ${esc(mode)}: ${fmt(v, m?.unit)} · ${rows.length} ngày">
        <div class="bar-v">${fmtKpi(v, m?.unit)}</div>
        <div class="bar-track"><div class="bar-fill" style="height:${((v / max) * 100).toFixed(1)}%"></div></div>
        <div class="bar-x">${esc(size === 1 ? dayLabel(rows[0].day) : range)}</div>
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
       ${r.note ? `· <span class="warn-text" title="${esc(r.note)}">${esc(r.note)}</span>` : ''}`
    : '<span class="dot-err"></span> Chưa kéo dữ liệu lần nào.';
  renderKpis(); renderChart(); renderDaily();
}

// ---------- Creator ----------
let SORT = { key: 'net_gmv', dir: -1 };
let ALERT_COUNTS = { stopped: 0, drop: 0, refund: 0, rise: 0 };
let ALERT_FILTER = '';            // '' = tat ca; hoac stopped|drop|refund|rise
// 16 cot thi phai cuon ngang moi lan muon xem % hoa hong, va cuon la mat ten creator.
// Bo "Gon" la nhung cot du de QUYET DINH; bo day du van con nguyen cho ai can doi chieu.
// MANG chu khong phai Set: day la thu tu DOC (ai -> ban duoc bao nhieu -> bao nhieu don
// -> moi don bao nhieu -> minh an bao nhieu -> co van de gi khong), khong phai thu tu khai bao.
const CCOLS_GON = ['username', 'alerts', 'net_gmv', 'orders_all', 'aov', 'est_commission', 'refund_rate'];
let CVIEW = 'gon';                // gon | day-du

// `delta: true` = cot co so sanh voi ky truoc ngay duoi con so.
const CCOLS = [
  { key: 'username',        label: 'Creator',      num: false },
  // Cot rieng: truoc day co nam ngay sau ten nen moi dong co o mot vi tri khac nhau,
  // vung giua bang so le va mat khong bam duoc vao dau de quet.
  { key: 'alerts',          label: 'Alerts',       num: false },
  { key: 'days',            label: 'Days',         num: true },
  { key: 'gmv',             label: 'Gross Attributed GMV', num: true , delta: true },
  { key: 'net_gmv',         label: 'Net GMV (Estimated)', num: true , delta: true },
  { key: 'refund_amount',   label: 'Refund/Cancel Amount', num: true },
  { key: 'refund_orders',   label: 'Fully Refunded/Cancelled Orders', num: true },
  { key: 'refund_rate',     label: 'Refund/Cancel Rate by Value', num: true, unit: '%' },
  { key: 'orders',          label: 'Valid Orders',  num: true , delta: true },
  { key: 'orders_all',      label: 'Total Orders (Gross)', num: true, delta: true },
  { key: 'items_sold',      label: 'Gross Units Sold', num: true },
  { key: 'items_sold_net',  label: 'Net Units Sold (Estimated)', num: true },
  { key: 'refunded_items',  label: 'Units on Refunded/Cancelled Lines', num: true },
  { key: 'aov',             label: 'Average Order Value (Gross AOV)', num: true },
  { key: 'commission_base', label: 'Commission Base (Gross)', num: true },
  { key: 'commission_base_net', label: 'Commission Base After Refunds/Cancellations', num: true },
  { key: 'est_commission',  label: 'Estimated Commission (Gross)', num: true , delta: true },
  { key: 'est_commission_net', label: 'Estimated Commission After Refunds/Cancellations', num: true },
  { key: 'commission_rate', label: 'Estimated Commission Rate on Commission Base', num: true, unit: '%' },
  { key: 'first_seen',      label: 'First Seen',    num: false },
  { key: 'last_seen',       label: 'Last Seen',     num: false },
];
// Ty le khong cong duoc -> dong tong de trong, thay vi cong bay ra so vo nghia.
const SUMMABLE = new Set(['days','gmv','net_gmv','refund_amount','refund_orders','orders','orders_all',
  'items_sold','items_sold_net','refunded_items','commission_base','commission_base_net',
  'est_commission','est_commission_net']);

const ccols = () => CVIEW === 'gon'
  ? CCOLS_GON.map(k => CCOLS.find(c => c.key === k)).filter(Boolean)
  : CCOLS;

function creatorRows() {
  const kw = $('#c-q').value.trim().toLowerCase();
  return CREATORS
    .filter(r => !ALERT_FILTER || r.alerts.some(a => a.code === ALERT_FILTER))
    .filter(r => !kw || r.username.toLowerCase().includes(kw))
    .sort((a, b) => {
      const { key, dir } = SORT;
      const col = CCOLS.find(c => c.key === key);
      if (col?.num) return (Number(a[key]) - Number(b[key])) * dir;
      // Cot canh bao sap theo MUC NANG (bad > warn > good > khong co), khong phai theo
      // chu cai -- xep "Hoan 23%" canh "GMV giam 40%" theo alphabet thi vo nghia.
      if (key === 'alerts') {
        const w = { bad: 3, warn: 2, good: 1 };
        const v = (r) => Math.max(0, ...r.alerts.map(x => w[x.level] ?? 0));
        return (v(a) - v(b)) * dir;
      }
      return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * dir;
    });
}

// Chip loc nhanh dau bang. Cau hoi dau tien khi mo bang nay la "ai dang tut?" --
// tra loi bang mot con so bam duoc, thay vi bat nguoi ta tu so 111 dong voi ky truoc.
const ALERT_CHIPS = [
  {
    code: 'stopped', level: 'bad', label: 'No Orders', compact: () => 'No orders',
    tip: () => 'No Orders — creator GMV is 0 in the selected period. Formula: current GMV = 0; previous-period GMV must be at least VND 1,000,000.',
  },
  {
    code: 'drop', level: 'bad', label: 'GMV Decline', compact: pct => `GMV down ${pct ?? ''}`.trim(),
    tip: () => `GMV Decline — gross attributed GMV fell by at least ${RULES.dropPct}% versus the previous period. Formula: (current GMV − previous GMV) / previous GMV ≤ −${RULES.dropPct}%; previous GMV must be at least VND ${vnd.format(RULES.minGmv)}.`,
  },
  {
    code: 'refund', level: 'warn', label: 'High Refund Rate', compact: pct => `Refund rate ${pct ?? ''}`.trim(),
    tip: () => `High Refund Rate — refund/cancel value is at least ${RULES.refundPct}% of gross attributed GMV. Formula: refund/cancel amount ÷ gross attributed GMV × 100% ≥ ${RULES.refundPct}%; at least ${RULES.minOrders} orders are required.`,
  },
  {
    code: 'rise', level: 'good', label: 'GMV Growth', compact: pct => `GMV up ${pct ?? ''}`.trim(),
    tip: () => `GMV Growth — gross attributed GMV grew by at least ${RULES.risePct}% versus the previous period. Formula: (current GMV − previous GMV) / previous GMV ≥ ${RULES.risePct}%; previous GMV must be at least VND ${vnd.format(RULES.minGmv)}.`,
  },
];

function renderAlertBar() {
  const el = $('#c-alerts');
  // Chon "tat ca" thi khong co ky truoc -> khong co co nao so sanh duoc. An han dai
  // nay con hon hien 4 con so 0 trong nhu moi thu deu on.
  const any = Object.values(ALERT_COUNTS).some(n => n > 0);
  el.classList.toggle('hide', !any);
  if (!any) { ALERT_FILTER = ''; return; }
  const active = ALERT_FILTER
    ? `Đang lọc: ${ALERT_CHIPS.find(c => c.code === ALERT_FILTER)?.label ?? 'Cảnh báo'}`
    : 'Lọc nhanh creator';
  const rule = PERIOD
    ? `So với ${PERIOD} ngày liền trước · tụt ≥${RULES.dropPct}% · hoàn ≥${RULES.refundPct}% · chỉ tính creator kỳ trước trên ${compact.format(RULES.minGmv)}đ`
    : `Kỳ “tất cả” không có kỳ trước để so · chỉ hiện hoàn ≥${RULES.refundPct}% · chọn 7 hoặc 30 ngày để thấy tụt dốc / tăng mạnh`;
  el.innerHTML = `
    <div class="alert-filter-top">
      <div class="alert-filter-title">Cảnh báo <span>${esc(active)}</span></div>
      <span class="alert-filter-period">${PERIOD ? `${PERIOD} ngày` : 'Tất cả thời gian'}</span>
    </div>
    <div class="alert-filter-options">
      <button class="chip-f${ALERT_FILTER ? '' : ' on'}" data-code="" aria-pressed="${!ALERT_FILTER}">
        <span class="chip-label">All</span><span class="chip-count">${CREATORS.length}</span>
      </button>
      ${ALERT_CHIPS.filter(c => ALERT_COUNTS[c.code]).map(c => `
        <button class="chip-f ${c.level}${ALERT_FILTER === c.code ? ' on' : ''}" data-code="${c.code}"
          aria-pressed="${ALERT_FILTER === c.code}" title="${esc(c.tip())}">
          <span class="chip-label">${esc(c.label)}</span><span class="chip-count">${ALERT_COUNTS[c.code]}</span>
        </button>`).join('')}
    </div>
    <p class="sub alert-why"><span class="alert-why-label">Quy tắc</span>${esc(rule)}</p>`;
}

// So sanh voi ky truoc, ngay duoi con so. null = khong so duoc (chon "tat ca", hoac ky
// truoc bang 0) -> khong hien gi, KHAC han hien "0%".
function cellDelta(r, key) {
  const d = change(r[key], r.prev?.[key]);
  if (d === null || Math.abs(d) < 1) return '';
  return `<div class="cd ${d >= 0 ? 'up' : 'down'}"
    title="Kỳ trước: ${fmt(r.prev[key])}">${d >= 0 ? '▲' : '▼'}${Math.abs(d).toFixed(0)}%</div>`;
}

function renderCreators() {
  const rows = creatorRows();
  renderAlertBar();
  $('#c-count').textContent = ALERT_FILTER
    ? `${rows.length} creator ${ALERT_CHIPS.find(c => c.code === ALERT_FILTER).label.toLowerCase()}`
    : `${rows.length}/${CREATORS.length} creator`;
  const cols = ccols();
  const head = `<th class="rank">#</th>` + cols.map(c => {
    // `who` tren ca th va td, neu khong phan ghim o header va o than bang lech nhau.
    return metricHeader(c, 'creator', '', SORT);
  }).join('');

  // Cot ten: avatar + co canh bao. avatar_url nam san trong creator_profiles tu lau
  // ma chua cho nao dung den.
  // Lop boc ben trong moi la flex. Dat `display:flex` thang len <td> pha layout bang:
  // o do thanh mot hop block rieng, va moi dong cao 79px thay vi 38px.
  const nameCell = (r) => `<td class="who"><div class="who-in">
    ${r.avatar_url
      ? `<img class="av" src="${esc(r.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="av ph" aria-hidden="true">${esc((r.username[0] ?? '?').toUpperCase())}</span>`}
    <span class="who-t">@${esc(r.username)}</span></div></td>`;

  const alertText = (a) => {
    const pct = a.text.match(/\d+(?:\.\d+)?%/)?.[0];
    const meta = ALERT_CHIPS.find(c => c.code === a.code);
    if (meta) return meta.compact(pct);
    return a.text;
  };
  const alertTitle = (a) => ALERT_CHIPS.find(c => c.code === a.code)?.tip() ?? a.text;
  const alertCell = (r) => `<td class="flags-cell"><div class="flags-in" role="list" aria-label="Cảnh báo">${
    r.alerts.length
      ? r.alerts.map(a => `<span class="flag ${a.level}" data-code="${esc(a.code)}" role="listitem"
          aria-label="${esc(alertText(a))}" title="${esc(alertTitle(a))}">${esc(alertText(a))}</span>`).join('')
      : '<span class="muted flags-empty">—</span>'}</div></td>`;

  const cell = (r, c) => c.key === 'username' ? nameCell(r)
    : c.key === 'alerts' ? alertCell(r)
    : c.num ? `<td class="num">${fmt(r[c.key], c.unit)}${c.delta ? cellDelta(r, c.key) : ''}</td>`
    : `<td>${d2(r[c.key])}</td>`;
  const sum = (k) => rows.reduce((t, r) => t + Number(r[k] || 0), 0);

  $('#t-creators').innerHTML = `
    <thead><tr>${head}</tr></thead>
    <tbody>${rows.length ? rows.map((r, i) => {
      const w = worst(r.alerts);
      // Xep hang theo CHINH cot dang sort, nen doi cot sort la thu tu # doi theo.
      return `<tr class="${w ? 'row-' + w.level : ''}"><td class="rank">${i + 1}</td>${
        cols.map(c => cell(r, c)).join('')}</tr>`;
    }).join('')
      : `<tr><td colspan="${cols.length + 1}" class="empty">${
          ALERT_FILTER ? 'Không creator nào trong nhóm này.'
                       : `Không có creator nào khớp “${esc($('#c-q').value)}”.`}</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr><td></td>${cols.map((c, i) =>
      i === 0 ? `<td>Tổng ${rows.length} creator</td>`
      : SUMMABLE.has(c.key) ? `<td class="num">${fmt(sum(c.key))}</td>` : '<td></td>').join('')}</tr></tfoot>` : ''}`;

}

// CSV luon xuat DU 16 cot va DU dong: che do "Gon" va gioi han 30 dong la de DOC
// tren man hinh, khong phai de cat bot du lieu mang di.
function exportCsv() {
  const rows = creatorRows();
  const head = CCOLS.map(c => c.label).join(',');
  // Cot canh bao la mang object -> phai doi sang chu truoc khi vao CSV.
  const oCsv = (r, c) => c.key === 'alerts' ? r.alerts.map(a => a.text).join('; ') : r[c.key];
  const body = rows.map(r => CCOLS.map(c => csvCell(oCsv(r, c))).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `creators-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ---------- San pham / Shop ----------
// Doc tu /api/products, tuc tu bang THO sku_orders. Khac KPI tab Tong quan: o day don huy
// da bi loai ngay trong SQL (VALID_ROW), nen con so cong lai la view GMV sau hoan/huy
// (gan voi net_gmv, nhung van la uoc tinh vi API khong co returned_quantity day du).
// Dung cung nhan 'GMV rong (uoc tinh)' de hai tab khong hien hai so khac nhau duoi cung
// mot ten.
let PRODUCTS = { products: [], shops: [], byContentType: [], coverage: null };
let PVIEW = 'products';
// Loc thay cho limit: bang tra ve HET, nguoi dung thu hep bang bo loc chu khong bi
// cat bot san. '' = khong loc.
let PSHOP = '';
let PSORT = { products: { key: 'gmv', dir: -1 }, shops: { key: 'gmv', dir: -1 } };

const PCOLS = [
  { key: 'product_name',    label: 'Product',       wide: true },
  { key: 'shop_name',       label: 'Shop' },
  { key: 'gmv',             label: 'Net GMV (Estimated)', num: true },
  { key: 'orders',          label: 'Valid Orders',   num: true },
  { key: 'items',           label: 'Valid Units',    num: true },
  { key: 'creators',        label: 'Creators',       num: true },
  { key: 'avg_rate',        label: 'Avg. Standard Commission Rate', num: true, unit: '%' },
  { key: 'est_commission',  label: 'Estimated Commission', num: true },
];
const SCOLS = [
  { key: 'shop_name',       label: 'Shop',          wide: true },
  { key: 'gmv',             label: 'Net GMV (Estimated)', num: true },
  { key: 'orders',          label: 'Valid Orders',   num: true },
  { key: 'products',        label: 'Unique Products', num: true },
  { key: 'creators',        label: 'Creators',       num: true },
  { key: 'est_commission',  label: 'Estimated Commission', num: true },
];
// Giong bang creator: ty le khong cong duoc nen dong tong de trong.
const PSUMMABLE = new Set(['gmv', 'orders', 'items', 'est_commission']);

const pcols = () => PVIEW === 'products' ? PCOLS : SCOLS;

function productRows() {
  const kw = $('#p-q').value.trim().toLowerCase();
  const sort = PSORT[PVIEW];
  const cols = pcols();
  return PRODUCTS[PVIEW]
    // Khop CHINH XAC khi go dung ten (chon tu goi y), con lai la khop mot phan --
    // go "colorkey" van ra ca "COLORKEY LUMINOUS VIET NAM".
    .filter(r => !PSHOP || (r.shop_name ?? '').toLowerCase().includes(PSHOP.toLowerCase()))
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

// Bang nay doc tu sku_orders, con KPI/creator doc tu metric_values. Hai bang khong phu
// cung mot khoang ngay: nhung ngay keo bang ban sync cu co metric ma khong co dong tho.
// Khi do noi THANG ra, thay vi de nguoi dung thay bang rong va tuong la khong co don.
function missingRawNote() {
  const c = PRODUCTS.coverage;
  if (!c || c.has_rows) return '';
  if (!c.newest_raw) {
    return 'Chưa có dòng thô nào. Bảng này chỉ có dữ liệu từ lần kéo sau khi bật lưu dòng thô.';
  }
  return `Không có dòng thô nào trong kỳ này. Dòng thô mới nhất là <b>${esc(c.newest_raw)}</b>,
    trong khi số liệu creator đã tới <b>${esc(c.anchor)}</b> — những ngày ở giữa được kéo bằng
    bản sync cũ (chỉ ghi metric, chưa ghi dòng thô). Kéo lại các ngày đó thì bảng này đầy lại.`;
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
    : `<p class="sub">${missingRawNote()}</p>`;
}

// Lua chon cua o loc lay TU CHINH du lieu dang co, nen khong bao gio co lua chon
// tro ve mot tap rong.
function renderFilters() {
  const shops = [...new Set(PRODUCTS.products.map(r => r.shop_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'vi'));

  // datalist chi la goi y: go dung ten shop thi loc, go khong khop thi hien het
  // (khong de nguoi dung roi vao bang rong ma khong hieu vi sao).
  $('#p-shop-list').innerHTML = shops.map(v => `<option value="${esc(v)}"></option>`).join('');
  $('#p-shop').placeholder = `Lọc theo shop… (${vnd.format(shops.length)})`;
}

function renderProducts() {
  renderShare(); renderContentCards(); renderFilters();
  const cols = pcols();
  const rows = productRows();
  const all = PRODUCTS[PVIEW].length;
  const donVi = PVIEW === 'products' ? 'sản phẩm' : 'shop';
  // Khong con limit: `all` la TOAN BO trong ky, `rows.length` la phan con lai sau bo loc.
  $('#p-count').textContent = `${vnd.format(rows.length)}/${vnd.format(all)} ${donVi}`;
  const sort = PSORT[PVIEW];

  const head = cols.map(c => metricHeader(c, PVIEW === 'products' ? 'product' : 'shop', '', sort)).join('');

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
        // Ly do day du da nam o khoi the ben tren; nhac lai nguyen van o day chi lam on.
        : 'Không có dòng thô nào trong kỳ này — xem giải thích ở trên.'}</td></tr>`}</tbody>
    ${rows.length ? `<tfoot><tr>${cols.map((c, i) =>
      i === 0 ? `<td>Tổng ${rows.length}</td>`
      : PSUMMABLE.has(c.key) ? `<td class="num">${fmt(sum(c.key))}</td>` : '<td></td>').join('')}</tr></tfoot>` : ''}`;
}

async function loadProducts() {
  // Lay HET, khong gioi han: bang de TIM thi phai tim duoc trong toan bo du lieu,
  // chu khong phai trong 200 dong dau. Loc va sap xep lam viec thu hep, khong phai limit.
  PRODUCTS = await get(`/api/products${PERIOD ? `?days=${PERIOD}` : ''}`);
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
      metricHeader({ key: k, label: shortLabel(k, m[k]), num: true, unit: m[k].unit }, 'daily')).join('')}</tr></thead>
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

  // Category assets la danh sach quyen theo category ma TikTok cap cho app. Chi cipher
  // cua Creator Management dang duoc dung cho cap_order/search; cac cipher con lai
  // van duoc tra ve nhung khong co quyen goi API tu tai khoan hien tai.
  const dung = categoryAssets.filter(a => a.cipher === activeCipher);
  const khongDung = categoryAssets.filter(a => a.cipher !== activeCipher);
  const bangAsset = (list) => `<table>
    <thead><tr><th>Category</th><th>Market</th><th>Cipher</th><th>API access</th></tr></thead>
    <tbody>${list.map(a => {
      const on = a.cipher === activeCipher;
      return `<tr><td>${esc(a.category_name)}</td><td>${esc(a.target_market)}</td>
        <td><code>${esc(a.cipher.slice(0, 22))}…</code></td>
        <td class="asset-status">${on
          ? '<span class="tag ok">Có quyền · đang dùng</span>'
          : '<span class="tag off">Chưa được cấp quyền</span><small class="asset-status-detail">Mã: 16032001 hoặc 16032015</small>'}</td></tr>`;
    }).join('')}</tbody></table>`;
  const assetGuide = `<div class="asset-guide" role="note">
      <div class="asset-guide-copy">
        <b>Category asset là gì?</b>
        <p>Đây là nhóm quyền truy cập theo category kinh doanh mà TikTok cấp cho app. <b>Cipher</b> là mã định danh dùng khi gọi API; không cần giải mã.</p>
        <p class="sub">Hiện chỉ <b>Creator Management</b> có quyền dùng cho <code>cap_order/search</code> để lấy dữ liệu đơn.</p>
      </div>
      <div class="asset-guide-counts" aria-label="Tóm tắt quyền truy cập">
        <span class="tag ok">${dung.length} có quyền</span>
        <span class="tag off">${khongDung.length} chưa có quyền</span>
      </div>
    </div>`;
  const assets = `${assetGuide}
    <div class="card table-card">${dung.length ? bangAsset(dung)
      : '<p class="empty">Chưa có category asset nào được cấp quyền dùng cho API.</p>'}</div>
    ${khongDung.length ? `<details class="xep">
      <summary><h2>Chưa được cấp quyền gọi API</h2><span class="dem">${khongDung.length} asset</span></summary>
      <div class="asset-error-note">
        <b>Vì sao không dùng được?</b>
        <p>Khi thử gọi API, các asset này trả một trong hai mã phản hồi sau:</p>
        <ul class="asset-error-list">
          <li><code>16032001</code><span>invalid main_account — tài khoản chính không hợp lệ</span></li>
          <li><code>16032015</code><span>permission denied — app chưa được cấp quyền</span></li>
        </ul>
        <p class="sub">Muốn dùng các category này, cần yêu cầu partner cấp đúng quyền/category trong TikTok Shop.</p>
      </div>
      <div class="card table-card">${bangAsset(khongDung)}</div>
    </details>` : ''}`;

  const runs = `<div class="card table-card"><table>
    <thead><tr><th>#</th><th>Bắt đầu</th><th>Xong</th><th>Trạng thái</th><th class="num">Dòng ghi</th><th>Ghi chú</th></tr></thead>
    <tbody>${syncRuns.map(r => `<tr><td>${r.id}</td><td>${dt(r.started_at)}</td>
      <td>${dt(r.finished_at)}</td>
      <td><span class="tag ${r.status === 'ok' ? 'ok' : r.status === 'running' ? 'grp' : 'warn'}">${esc(r.status)}</span></td>
      <td class="num">${fmt(r.rows_written)}</td>
      <td class="note" title="${esc(r.note)}">${esc(r.note) || '—'}</td></tr>`).join('')}</tbody></table></div>`;

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
    <div class="sec-head"><h2>Uỷ quyền</h2></div>
    <div class="kpis">${authCards}</div>
    <div class="sec-head"><h2>Dữ liệu đang có</h2></div>
    <div class="kpis">
      <div class="card kpi"><div class="kpi-l">Khoảng ngày</div><div class="n sm">${esc(coverage.from_day ?? '—')} → ${esc(coverage.to_day ?? '—')}</div></div>
      <div class="card kpi"><div class="kpi-l">Số ngày</div><div class="n">${coverage.days ?? 0}</div></div>
      <div class="card kpi"><div class="kpi-l">Dòng metric</div><div class="n">${fmt(coverage.rows ?? 0)}</div></div>
      <div class="card kpi"><div class="kpi-l">Creator</div><div class="n">${CREATORS.length}</div></div>
    </div>
    <div class="sec-head"><h2>Chi tiết uỷ quyền</h2></div>
    <div class="two-col">${auth}</div>
    <div class="sec-head"><h2>Quyền API theo category (${categoryAssets.length})</h2>
      ${DOCS?.api?.category_assets?.docUrl ? `<a class="doclink" target="_blank" rel="noopener"
        href="${esc(DOCS.api.category_assets.docUrl)}"
        title="${esc(DOCS.api.category_assets.method)} ${esc(DOCS.api.category_assets.path)}"
        >${esc(DOCS.api.category_assets.title)} ↗</a>` : ''}</div>
    ${assets}
    <div class="sec-head"><h2>Lịch sử kéo dữ liệu</h2></div>
    ${runs}`;
}

// ---------- Phủ sóng dữ liệu ----------
// Hai cau hoi truoc gio phai mo psql moi tra loi duoc: "keo xong chua" va "miss ngay nao".
// Lich 1 o = 1 ngay tra loi ca hai bang mat. Bang "Lich su keo du lieu" KHONG thay the duoc:
// no noi run nao loi, chu khong noi NGAY nao con khuyet -- va lo giua ky thi nam o ngay.
let COV = null, COV_TIMER = null;

function covParts() {
  const cal = COV?.calendar ?? [];
  const cur = COV?.dang_keo ?? null;
  return { cal, cur, ...classify(cal, COV ?? {}) };
}

const covEta = (left) => eta(left, COV?.days_10m ?? 0, COV?.running);

function renderCoverage() {
  const el = $('#cov-live'); if (!el || !COV) return;
  const { cal, cur, pending, unpulled, has, miss } = covParts();
  if (!cal.length) { el.innerHTML = ''; return; }

  const pct = (has.length / cal.length) * 100;
  const left = miss.length + pending.size + unpulled.length;
  const beat = COV.running?.since_beat;
  // Job dap nhip sau MOI ngay keo xong, nen khoang cach nhip = thoi gian keo mot ngay:
  // ~1 phut ngay thuong, ~4 phut ngay sale 42k dong. Nguong 8 phut nam tren muc do va
  // duoi nguong 15 phut cua reapStale() -- de giao dien noi duoc "dang im" trong khoang
  // giua, thay vi 13 phut lien hien "dang keo" cho mot job da chet.
  const stale = beat !== undefined && beat > 480;

  const tag = COV.running
    ? `<span class="tag ${stale ? 'warn' : 'grp'}">${stale ? `đang im ${Math.round(beat / 60)} phút` : 'đang kéo'}</span>`
    : miss.length ? `<span class="tag warn">thiếu ${miss.length} ngày</span>`
                  : unpulled.length ? `<span class="tag grp">chưa kéo ${unpulled.length} ngày</span>`
                  : '<span class="tag ok">đủ ngày</span>';

  // Thang la don vi nguoi doc dung de noi "thang 7 bi khuyet", nen chia theo thang.
  const months = new Map();
  for (const d of cal) {
    const k = d.day.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  const cls = (d) => d.rows ? (d.day === cur ? 'c-now' : 'c-has')
                            : pending.has(d.day) || unpulled.some(x => x.day === d.day) ? 'c-wait' : 'c-miss';
  const cal_html = [...months].map(([k, list]) => `<div class="cal-m">
      <span class="cal-ml">${k.slice(5)}/${k.slice(2, 4)}</span>
      <div class="cal-d">${list.map(d => `<span class="c ${cls(d)}" title="${esc(d.day)} · ${
        d.rows ? `${fmt(d.rows)} dòng` : pending.has(d.day) || unpulled.some(x => x.day === d.day) ? 'chưa kéo tới' : 'THIẾU'}"></span>`).join('')}</div>
    </div>`).join('');

  // Danh sach ngay thieu bang CHU: o vuong khong doc duoc bang ban phim, va day cung la
  // thu nguoi dung copy ra de kiem lai tren Partner Center.
  const missList = miss.length ? `<p class="cov-miss-list"><b>Ngày thiếu:</b> ${
    miss.slice(0, 24).map(d => `<code>${esc(d.day)}</code>`).join(' ')}${
    miss.length > 24 ? ` <span class="muted">+${miss.length - 24} ngày nữa</span>` : ''}</p>` : '';

  el.innerHTML = `<div class="card cov">
    <div class="cov-head">
      <h2>Phủ sóng dữ liệu</h2>${tag}
      <button class="btn ghost sm" id="btn-patch"${COV.running || !miss.length ? ' disabled' : ''}
        title="${COV.running ? 'đợi job đang chạy xong' : miss.length ? 'kéo lại đúng những ngày khuyết' : 'không thiếu ngày nào'}"
        >Vá ${miss.length} ngày thiếu</button>
    </div>
    <div class="cov-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <p class="cov-stat"><b>${has.length}/${cal.length}</b> ngày có dữ liệu
      <span class="muted">(${esc(cal[0].day)} → ${esc(cal[cal.length - 1].day)})</span>
      ${COV.running ? ` · đang kéo <b>${esc(cur ?? '—')}</b> · nhịp ${beat}s trước
        ${left ? `· ${esc(covEta(left))}` : ''}` : ''}
      ${miss.length ? ` · <span class="warn-text">khuyết ${miss.length} ngày</span>` : ''}
      ${unpulled.length ? ` · <span class="muted">chưa kéo ${unpulled.length} ngày</span>` : ''}
    </p>
    <div class="cal" aria-hidden="true">${cal_html}</div>
    <div class="cov-legend" aria-hidden="true">
      <span><i class="c c-has"></i> có dữ liệu</span>
      <span><i class="c c-now"></i> đang kéo</span>
      <span><i class="c c-wait"></i> chưa kéo tới</span>
      <span><i class="c c-miss"></i> thiếu</span>
    </div>
    ${missList}</div>`;
}

async function loadCoverage() {
  COV = await get('/api/coverage');
  renderCoverage();
  clearTimeout(COV_TIMER);
  // Chi hoi lai khi co job chay: khong chay thi khong co gi doi, dung bat server quet moi 15s.
  if (COV.running) COV_TIMER = setTimeout(() => loadCoverage().catch(e => reportError('coverage', e)), 15000);
}

async function loadCreators() {
  const raw = await get(`/api/creators${PERIOD ? `?days=${PERIOD}` : ''}`);
  // Gan co MOT lan o day, khong phai moi lan render: bang nay render lai theo tung phim
  // go vao o tim kiem.
  const { rows, counts } = summarize(raw);
  CREATORS = rows;
  ALERT_COUNTS = counts;
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
      keys.map(k => metricHeader({ key: k, label: shortLabel(k, m[k]), num: true, unit: m[k]?.unit }, 'drill')).join('')
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

function renderCreatorData() {
  const data = CREATOR_DATA ?? { rows: [], totals: {} };
  const totals = data.totals ?? {};
  const run = data.lastSync;
  const runNote = run?.note?.startsWith('creator sync: chua co creator nao uy quyen')
    ? 'Chưa có creator active để sync.'
    : run?.note ? 'Có chi tiết trong Hệ thống.' : '';
  const status = run
    ? `<div class="banner${run.status === 'error' ? ' err' : ''}">
        <span class="dot-${run.status === 'ok' ? 'ok' : 'err'}"></span>
        Lần sync creator gần nhất: <b>${dt(run.finished_at ?? run.started_at)}</b> ·
        ${esc(run.status)} · ${fmt(run.rows_written)} dòng
        ${runNote ? `<span class="muted" title="${esc(run.note)}">${esc(runNote)}</span>` : ''}
      </div>`
    : `<div class="banner"><span class="dot-err"></span>Chưa có lần sync creator nào.</div>`;
  $('#creator-data-status').innerHTML = status;

  const cards = [
    ['authorized_creators', 'Authorized Creators', 'creator',
      'Creator đã uỷ quyền và token hiện còn active.',
      "COUNT(*) FROM authorizations WHERE role='creator' AND status='active'"],
    ['synced_creators', 'Synced Creators', 'creator',
      'Creator đã có ít nhất một ảnh chụp dữ liệu từ Creator API.',
      'COUNT(DISTINCT creator_username) có snapshot mới nhất'],
    ['sample_requests', 'Sample Requests', 'requests',
      'Tổng yêu cầu hàng mẫu trong ảnh chụp mới nhất của các creator.',
      'SUM(sample_requests) theo creator'],
    ['samples_completed', 'Completed Samples', 'requests',
      'Tổng yêu cầu hàng mẫu đã hoàn thành trong ảnh chụp mới nhất.',
      'SUM(samples_completed) theo creator'],
    ['showcase_products', 'Showcase Products', 'products',
      'Tổng sản phẩm đang có trong showcase ở ảnh chụp mới nhất.',
      'SUM(showcase_products) theo creator'],
    ['target_collaborations', 'Target Collaborations', 'campaigns',
      'Tổng chiến dịch hợp tác creator đang thấy qua API.',
      'SUM(target_collaborations) theo creator'],
  ];
  $('#creator-data-kpis').innerHTML = cards.map(([key, label, unit, definition, formula]) => `
    <div class="card kpi">
      <div class="kpi-l">${esc(label)}
        <span class="info" tabindex="0" role="img" ${tipDataAttrs({
          title: label, definition, formula, unit, note: 'Đây là ảnh chụp trạng thái hiện tại, không phải số liệu theo kỳ.',
          definitionVi: definition, formulaVi: formula,
          noteVi: 'Đây là ảnh chụp trạng thái hiện tại, không phải số liệu theo kỳ.',
        })}>ⓘ</span>
      </div>
      <div class="n">${fmt(totals[key] ?? 0)}</div>
      <div class="kpi-f"><span class="muted">${esc(unit)}</span></div>
    </div>`).join('');

  const query = ($('#creator-data-q')?.value ?? '').trim().toLowerCase();
  const rows = (data.rows ?? []).filter(r =>
    !query || String(r.username ?? r.open_id).toLowerCase().includes(query));
  $('#creator-data-count').textContent = `${rows.length}/${(data.rows ?? []).length} creator`;
  const snap = (r, key) => r.snapshot_day ? fmt(r[key]) : '—';
  const name = (r) => r.username
    ? `<b>@${esc(r.username)}</b>`
    : `<span class="muted">Chưa lấy profile</span><small class="asset-status-detail"><code>${esc(r.open_id)}</code></small>`;
  const state = (r) => r.status === 'active'
    ? `<span class="tag ok">Active</span>`
    : `<span class="tag off">${esc(r.status ?? 'Unknown')}</span>`;
  $('#t-creator-data').innerHTML = `
    <thead><tr><th>Creator</th><th>Authorization</th><th>Snapshot date</th>
      <th class="num">Sample Requests</th><th class="num">Completed Samples</th>
      <th class="num">Showcase Products</th><th class="num">Target Collaborations</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>
      <td>${name(r)}</td>
      <td>${state(r)}<small class="asset-status-detail">${r.authorized_at ? `từ ${dt(r.authorized_at)}` : ''}</small></td>
      <td>${r.snapshot_day ? dayLabel(r.snapshot_day) : '<span class="muted">Chưa sync</span>'}</td>
      <td class="num">${snap(r, 'sample_requests')}</td>
      <td class="num">${snap(r, 'samples_completed')}</td>
      <td class="num">${snap(r, 'showcase_products')}</td>
      <td class="num">${snap(r, 'target_collaborations')}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">${query
      ? 'Không tìm thấy creator phù hợp.'
      : 'Chưa có creator nào uỷ quyền hoặc chưa tải được dữ liệu.'}</td></tr>`}</tbody>`;
}

async function loadCreatorData() {
  CREATOR_DATA = await get('/api/creator-data');
  renderCreatorData();
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

// Tim dung trang tai lieu TikTok theo endpoint that su dung. Truoc day chi can
// `m.fields.length` la UI luon gan Search CAP Affiliate Orders, lam cac metric
// creator (sample/showcase/collaboration) bi tro sai trang. Metric ghep co the
// hien nhieu link: moi link la mot API ma source cua metric thuc su nhac toi.
function apiDocsForMetric(m) {
  const source = String(m.source ?? '');
  const found = [];
  const add = (api) => {
    if (api?.docUrl && !found.some(x => x.docUrl === api.docUrl)) found.push(api);
  };
  for (const api of Object.values(DOCS?.api ?? {})) {
    if (api.path && source.includes(api.path)) add(api);
  }
  for (const api of Object.values(DOCS?.creatorApi ?? {})) {
    if (api.path && source.includes(api.path)) add(api);
  }

  // Mot so metric la metric dan xuat nhung van khai fields de cho nguoi doc
  // biet no duoc tinh tu API nao; source cua chung chi ghi "Dan xuat".
  if (!found.length && (m.fields ?? []).length) {
    add(DOCS?.api?.cap_order_search);
  }
  return found;
}

function apiDocLinks(m) {
  const links = apiDocsForMetric(m).map(api => `<a class="doclink" href="${esc(api.docUrl)}" target="_blank" rel="noopener"
    title="${esc(api.method)} ${esc(api.path)}">${esc(api.title)} ↗</a>`).join('');
  return links ? `<span class="doclinks" aria-label="API documentation">${links}</span>` : '';
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
      <h2>${hl(m.label, kw)}</h2>
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

    <h3>Công thức <span class="by ours">dashboard tự tính</span></h3>
    <p><code class="formula">${hl(m.formula, kw)}</code></p>

    <h3>Trường API <span class="by tiktok">nguyên văn TikTok + bản dịch</span>${apiDocLinks(m)}</h3>
    ${fieldRows(m, kw)}

    <h3>Cần lưu ý</h3>
    <p class="pit">${hl(m.pitfalls, kw)}</p>

    <h3>Nguồn</h3>
    <p class="muted">${hl(m.source, kw)}</p>
  </article>`;
}

// Kieu xem BANG cua tab Chi so. Ham nay duoc GOI o renderWiki nhung chua bao gio duoc
// dinh nghia -- bam nut "Bang" nem ReferenceError va khung noi dung tro nen trang.
// Bang de so sanh nhieu metric cung luc, nen chi lay nhung cot doc luot duoc.
function wikiTable(rows, kw) {
  return `<div class="card table-card"><table>
    <thead><tr>
      <th>Chỉ số</th><th>Mã</th><th>Nhóm</th><th>Đơn vị</th><th>Cấp</th>
      <th>Pipeline</th><th class="wide">Công thức</th>
    </tr></thead>
    <tbody>${rows.map(m => `<tr>
      <td>${hl(m.label, kw)}</td>
      <td><code>${hl(m.key, kw)}</code></td>
      <td>${esc(m.group)}</td>
      <td>${esc(m.unit)}</td>
      <td>${esc(m.level)}</td>
      <td>${status(m)}</td>
      <td class="wide" title="${esc(m.formula)}">${hl(m.formula, kw)}</td>
    </tr>`).join('')}</tbody></table></div>`;
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
    // Noi dung bo loc NAO dang lam rong ket qua. Truoc day luon noi 'khop ""' ke ca khi
    // nguoi dung khong go gi ma chi chon nhom/trang thai -- doc ra khong hieu vi sao rong.
    const dieuKien = [
      kw && `từ khoá “${esc(kw)}”`,
      g && `nhóm “${esc(g)}”`,
      st !== '' && (st === '1' ? 'trạng thái “Đã kéo”' : 'trạng thái “Chưa kéo”'),
    ].filter(Boolean);
    $('#wiki').innerHTML =
      `<p class="empty">Không có chỉ số nào khớp ${dieuKien.join(' + ')}.</p>`;
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
    await Promise.all([loadSummary(), loadCreators(), loadSystem(), loadProducts(), loadCoverage()]);
  } finally { e.target.disabled = false; e.target.textContent = 'Kéo dữ liệu'; }
});

// Delegate: nut nay bi ve lai moi 15 giay nen gan listener thang vao no la mat ngay sau.
$('#cov-live').addEventListener('click', async (e) => {
  const b = e.target.closest('#btn-patch'); if (!b) return;
  const { cal, miss } = covParts();
  if (!miss.length) return;
  b.disabled = true; b.textContent = 'Đang vá…';
  // skipExisting: bo qua ngay da co raw -> chi keo dung may ngay khuyet. Server tra ve
  // ngay va chay nen, khong giu request mo (va ca ky co the mat vai gio).
  const r = await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ days: cal.length, skipExisting: true }) }).then(x => x.json());
  if (r.error) { alert(`Lỗi: ${r.error}`); b.disabled = false; return; }
  await loadCoverage();     // COV.running = true -> tu dong poll 15 giay/lan
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

async function syncCreatorData(button) {
  button.disabled = true; button.textContent = 'Đang sync…';
  try {
    const r = await fetch('/api/sync-creator', { method: 'POST' }).then(x => x.json());
    alert(r.error ? `Lỗi: ${r.error}`
      : `Xong: ${r.creators} creator, ${r.written} dòng${
          [...(r.errors ?? []), ...(r.warnings ?? [])].length
            ? `\n${[...r.errors, ...r.warnings].join('\n')}` : ''}`);
    await Promise.all([loadSummary(), loadCreators(), loadSystem(), loadCreatorData()]);
  } finally { button.disabled = false; button.textContent = 'Sync Creator Data'; }
}
$('#btn-sync-creator').addEventListener('click', (e) => syncCreatorData(e.currentTarget));
$('#btn-sync-creator-data').addEventListener('click', (e) => syncCreatorData(e.currentTarget));

$('#btn-export').addEventListener('click', exportCsv);
$('#c-metric').addEventListener('change', renderChart);
$('#c-group').addEventListener('change', renderChart);
$('#creator-data-q').addEventListener('input', renderCreatorData);

$('#period').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#period').children) x.setAttribute('aria-pressed', String(x === b));
  PERIOD = b.dataset.days ? Number(b.dataset.days) : null;
  showLoading();
  // Ca hai bang deu phai doi theo cung ky, neu khong tab no noi ky khac tab kia.
  await Promise.all([loadCreators(), loadProducts()]);
  renderKpis(); renderChart(); renderDaily();
});
$('#c-q').addEventListener('input', renderCreators);
$('#creator-drill').addEventListener('click', (e) => {
  if (e.target.closest('#drill-close')) { DRILL = null; $('#creator-drill').innerHTML = ''; }
});

$('#c-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#c-view').children) x.setAttribute('aria-pressed', String(x === b));
  CVIEW = b.dataset.view;
  renderCreators();
});

$('#c-alerts').addEventListener('click', (e) => {
  const b = e.target.closest('.chip-f'); if (!b) return;
  ALERT_FILTER = b.dataset.code;
  renderCreators();
});

$('#t-creators').addEventListener('click', (e) => {
  if (e.target.closest('.metric-help')) return;
  const td = e.target.closest('tbody td');
  if (td && !td.closest('tr')?.querySelector('.empty')) {
    // Lay username tu o .who chu khong phai o dau tien: o dau tien gio la so thu tu.
    const name = td.closest('tr')?.querySelector('.who-t')?.textContent?.trim().split(/\s/)[0]?.replace(/^@/, '');
    if (name) openDrill(name);
    return;
  }
  const th = e.target.closest('th[data-sort]'); if (!th) return;
  const k = th.dataset.sort;
  // Bam lai cung cot thi dao chieu; doi cot thi so giam dan, chu tang dan.
  // Cot so VA cot canh bao mac dinh giam dan: bam vao "Canh bao" la de thay ai dang
  // co van de, khong phai de xem 90 dong "—" truoc.
  const giamTruoc = k === 'alerts' || CCOLS.find(c => c.key === k)?.num;
  SORT = SORT.key === k ? { key: k, dir: -SORT.dir } : { key: k, dir: giamTruoc ? -1 : 1 };
  renderCreators();
});

$('#p-shop').addEventListener('input', (e) => { PSHOP = e.target.value.trim(); renderProducts(); });

$('#btn-export-p').addEventListener('click', exportProductsCsv);
$('#p-q').addEventListener('input', renderProducts);

$('#p-view').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('#p-view').children) x.setAttribute('aria-pressed', String(x === b));
  PVIEW = b.dataset.view;
  renderProducts();
});

$('#t-products').addEventListener('click', (e) => {
  if (e.target.closest('.metric-help')) return;
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
            : !$('#tab-creator-data').classList.contains('hide') ? $('#creator-data-q')
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
    // `live` = trang thai HIEN TAI (token con bao nhieu ngay, bao nhieu scope...), khong
    // nam trong metric_values theo ngay -> chon vao chi ra bieu do trong.
    .filter(m => m.available && !m.live && !m.key.startsWith('creators_'))
    .map(m => `<option value="${esc(m.key)}"${m.key === 'gmv' ? ' selected' : ''}>${esc(m.label)}</option>`).join(''));
  renderWiki();
  showLoading();
  await Promise.all([loadCreators(), loadSystem(), loadCreatorData(), loadProducts(), loadCoverage()]);
  await loadSummary();   // can CREATORS truoc de KPI dem dung so creator trong ky
  } catch (e) {
    // Khung xuong aria-busy nam lai vinh vien neu khong co duong nay: nguoi dung cho mai
    // mot thu khong bao gio toi. Noi thang la hong.
    for (const id of ['#kpis', '#kpis-phu', '#t-daily', '#t-creators', '#t-products', '#t-creator-data']) {
      const el = $(id); if (el) el.innerHTML = '';
    }
    $('#chart').innerHTML = '<p class="empty">Không tải được dữ liệu.</p>';
    reportError('init', e);
  }
})();
