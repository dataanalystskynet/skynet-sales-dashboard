// =====================================================================
// SKYNET EXPRESS – charts.js : themed Chart.js helpers
// (gradient "3D" bars, soft shadows, INR / KG tooltips, donut centre text)
// =====================================================================
import { inr, inrAxis, kg, kgShort, int, isNil } from './utils.js';

const registry = new Set();
export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
export function palette() { return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(cssVar); }
export function destroyAll() { registry.forEach((c) => { try { c.destroy(); } catch (_) { /* ignore */ } }); registry.clear(); }

function alpha(hex, a) {
  const h = hex.replace('#', ''); const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
export const fmtBy = (kind, short = false) => (v) => isNil(v) ? '—'
  : kind === 'inr' ? (short ? inrAxis(v) : inr(v)) : kind === 'kg' ? (short ? kgShort(v) : kg(v)) : kind === 'pct' ? Number(v).toFixed(1) + '%' : int(v);

// ---------- 3D helpers ----------
function rgbOf(c) {
  if (!c || typeof c !== 'string') return [120, 140, 180];
  const s = c.trim();
  if (s.startsWith('#')) { const h = s.slice(1); const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; }
  const m = s.match(/rgba?\(([^)]+)\)/); if (m) return m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  return [120, 140, 180];
}
/** amt < 0 darkens, amt > 0 lightens (0..1) */
function shade(c, amt, a = 1) {
  const [r, g, b] = rgbOf(c); const f = (x) => Math.round(amt < 0 ? x * (1 + amt) : x + (255 - x) * amt);
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}
const colorAt = (ds, i) => (Array.isArray(ds._c3d) ? ds._c3d[i % ds._c3d.length] : ds._c3d);

/** Extruded bars: a lighter top face and a darker side face behind every bar */
const bar3d = {
  id: 'bar3d',
  afterDatasetDraw(chart, args) {
    const meta = args.meta; if (meta.type !== 'bar' || meta.hidden) return;
    const ds = chart.data.datasets[args.index]; if (!ds._c3d) return;
    const horiz = chart.options.indexAxis === 'y'; const c = chart.ctx;
    const stackTop = chart.data.datasets.length - 1;
    c.save();
    meta.data.forEach((el, i) => {
      const v = ds.data[i]; if (v === null || v === undefined || Number(v) === 0) return;
      const p = el.getProps(['x', 'y', 'base', 'width', 'height']);
      let L, R, T, B;
      if (horiz) { L = Math.min(p.x, p.base); R = Math.max(p.x, p.base); T = p.y - p.height / 2; B = p.y + p.height / 2; }
      else { L = p.x - p.width / 2; R = p.x + p.width / 2; T = Math.min(p.y, p.base); B = Math.max(p.y, p.base); }
      if (!(R - L > 0.5) || !(B - T > 0.5)) return;
      const d = Math.max(3, Math.min(10, (horiz ? B - T : R - L) * 0.34));
      const col = colorAt(ds, i); const hot = el.active;
      // side face
      c.beginPath(); c.moveTo(R, T); c.lineTo(R + d, T - d); c.lineTo(R + d, B - d); c.lineTo(R, B); c.closePath();
      const sg = c.createLinearGradient(R, 0, R + d, 0); sg.addColorStop(0, shade(col, hot ? -0.25 : -0.42)); sg.addColorStop(1, shade(col, hot ? -0.4 : -0.58));
      c.fillStyle = sg; c.fill();
      // top face (only the outer end of a stack gets a lit cap)
      if (!chart.options.scales?.x?.stacked || args.index === stackTop || horiz) {
        c.beginPath(); c.moveTo(L, T); c.lineTo(L + d, T - d); c.lineTo(R + d, T - d); c.lineTo(R, T); c.closePath();
        c.fillStyle = shade(col, hot ? 0.45 : 0.28); c.fill();
      }
      if (hot) { c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1.2; c.strokeRect(L + 0.5, T + 0.5, R - L - 1, B - T - 1); }
    });
    c.restore();
  },
};
/** Solid front face, lit at the top/right end */
function face(color, horiz) {
  return (ctx) => {
    const { chart } = ctx; const { chartArea, ctx: c } = chart;
    const col = Array.isArray(color) ? color[ctx.dataIndex % color.length] : color;
    if (!chartArea) return col;
    const g = horiz ? c.createLinearGradient(chartArea.left, 0, chartArea.right, 0) : c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    if (horiz) { g.addColorStop(0, shade(col, -0.3)); g.addColorStop(1, shade(col, 0.08)); }
    else { g.addColorStop(0, shade(col, 0.08)); g.addColorStop(1, shade(col, -0.3)); }
    return g;
  };
}
/** Bars grow from the bottom (left for horizontal) one after another */
const growAnim = { duration: 1800, easing: 'easeOutCubic',
  delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex * 55, 1300) + ctx.datasetIndex * 120 : 0) };
const pad3d = { padding: { top: 12, right: 12 } };

/** Re-play the 3D grow animation when the cursor enters a bar chart */
function replayOnHover(ch) {
  const cv = ch.canvas; let last = 0;
  cv.addEventListener('mouseenter', () => {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = Date.now(); if (now - last < 3500) return; last = now;
    ch.reset(); ch.update();
  });
}
/** Spin a doughnut once around its centre when the cursor enters it */
function spinOnHover(ch) {
  const cv = ch.canvas; let busy = false;
  cv.addEventListener('mouseenter', () => {
    if (busy || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    busy = true; const t0 = performance.now(), ms = 2800, start = ch.options.rotation || 0;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (t) => {
      if (!ch.canvas) { busy = false; return; }
      const k = Math.min(1, (t - t0) / ms);
      ch.options.rotation = start + 360 * ease(k); ch.update('none');
      if (k < 1) requestAnimationFrame(step); else { ch.options.rotation = start; ch.update('none'); busy = false; }
    };
    requestAnimationFrame(step);
  });
}

/** 3D doughnut: extruded ring edge underneath + glossy light on top */
const DONUT_DEPTH = 14;
const donut3d = {
  id: 'donut3d',
  beforeDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0); if (!meta || meta.type !== 'doughnut') return;
    const c = chart.ctx; const cols = chart.data.datasets[0]._c3d || [];
    c.save();
    for (let k = DONUT_DEPTH; k >= 1; k--) {
      meta.data.forEach((el, i) => {
        if (!chart.getDataVisibility(i)) return;
        const p = el.getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius']);
        if (p.endAngle - p.startAngle <= 0) return;
        c.beginPath(); c.arc(p.x, p.y + k, p.outerRadius, p.startAngle, p.endAngle); c.arc(p.x, p.y + k, p.innerRadius, p.endAngle, p.startAngle, true); c.closePath();
        c.fillStyle = shade(cols[i % cols.length], k === DONUT_DEPTH ? -0.7 : -0.38 - (k / DONUT_DEPTH) * 0.25); c.fill();
      });
    }
    c.restore();
  },
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0); if (!meta || meta.type !== 'doughnut' || !meta.data.length) return;
    const p0 = meta.data[0].getProps(['x', 'y', 'innerRadius', 'outerRadius']); const c = chart.ctx;
    c.save();
    c.beginPath(); c.arc(p0.x, p0.y, p0.outerRadius, 0, Math.PI * 2); c.arc(p0.x, p0.y, p0.innerRadius, Math.PI * 2, 0, true); c.closePath(); c.clip();
    const g = c.createLinearGradient(0, p0.y - p0.outerRadius, 0, p0.y + p0.outerRadius);
    g.addColorStop(0, 'rgba(255,255,255,.34)'); g.addColorStop(0.45, 'rgba(255,255,255,.06)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.22)');
    c.fillStyle = g; c.fillRect(p0.x - p0.outerRadius, p0.y - p0.outerRadius, p0.outerRadius * 2, p0.outerRadius * 2);
    c.restore();
  },
};

const softShadow = {
  id: 'softShadow',
  beforeDatasetDraw(chart) { const c = chart.ctx; c.save(); c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 10; c.shadowOffsetY = 5; },
  afterDatasetDraw(chart) { chart.ctx.restore(); },
};
const centerText = {
  id: 'centerText',
  afterDraw(chart, _a, opts) {
    if (!opts || !opts.title) return;
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = cssVar('--text'); ctx.font = `700 20px Archivo, sans-serif`; ctx.fillText(opts.title, x, y - 9);
    ctx.fillStyle = cssVar('--muted'); ctx.font = `500 12px Archivo, sans-serif`; ctx.fillText(opts.sub || '', x, y + 13);
    ctx.restore();
  },
};

function applyDefaults() {
  const C = window.Chart; if (!C) return;
  C.defaults.font.family = 'Archivo, "Segoe UI", sans-serif';
  C.defaults.font.size = 12;
  C.defaults.color = cssVar('--text-2');
  C.defaults.borderColor = cssVar('--grid');
  C.defaults.plugins.legend.labels.usePointStyle = true;
  C.defaults.plugins.legend.labels.boxWidth = 8;
  C.defaults.plugins.tooltip.backgroundColor = cssVar('--panel-solid');
  C.defaults.plugins.tooltip.titleColor = cssVar('--text');
  C.defaults.plugins.tooltip.bodyColor = cssVar('--text-2');
  C.defaults.plugins.tooltip.borderColor = cssVar('--panel-border');
  C.defaults.plugins.tooltip.borderWidth = 1;
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.cornerRadius = 10;
  C.defaults.maintainAspectRatio = false;
  C.defaults.animation.duration = 700;
}

/** Ring segment colour with a soft radial light (top-left) */
function face3dArc(color) {
  return (ctx) => {
    const { chart } = ctx; const el = ctx.element; if (!chart.chartArea || !el) return color;
    const { x, y, outerRadius } = el.getProps(['x', 'y', 'outerRadius']); if (!outerRadius) return color;
    const g = chart.ctx.createRadialGradient(x - outerRadius * 0.35, y - outerRadius * 0.45, outerRadius * 0.1, x, y, outerRadius * 1.05);
    g.addColorStop(0, shade(color, 0.22)); g.addColorStop(1, shade(color, -0.12)); return g;
  };
}
function vGradient(color) {
  return (ctx) => {
    const { chart } = ctx; const { chartArea, ctx: c } = chart;
    if (!chartArea) return color;
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, color); g.addColorStop(1, alpha(color, 0.45)); return g;
  };
}
function hGradient(color) {
  return (ctx) => {
    const { chart } = ctx; const { chartArea, ctx: c } = chart;
    if (!chartArea) return color;
    const g = c.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    g.addColorStop(0, alpha(color, 0.5)); g.addColorStop(1, color); return g;
  };
}
function areaGradient(color) {
  return (ctx) => {
    const { chart } = ctx; const { chartArea, ctx: c } = chart;
    if (!chartArea) return alpha(color, 0.2);
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, alpha(color, 0.32)); g.addColorStop(1, alpha(color, 0)); return g;
  };
}

export function makeChart(canvas, config) {
  applyDefaults();
  const old = window.Chart.getChart(canvas); if (old) { old.destroy(); registry.delete(old); }
  const ch = new window.Chart(canvas, config); registry.add(ch);
  if (config.type === 'doughnut') spinOnHover(ch);
  else if (config.type === 'bar') replayOnHover(ch);
  return ch;
}

const axis = (kind, extra = {}) => ({ grid: { color: cssVar('--grid'), drawTicks: false }, border: { display: false },
  ticks: { padding: 8, precision: kind === 'int' ? 0 : undefined, callback: (v) => fmtBy(kind, true)(v) }, ...extra });
const catAxis = (extra = {}) => ({ grid: { display: false }, border: { display: false }, ticks: { padding: 6, maxRotation: 0, autoSkipPadding: 14 }, ...extra });

/** Bars + line on a second axis */
export function comboChart(canvas, { labels, bars, line }) {
  const p = palette();
  return makeChart(canvas, {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'bar', label: bars.label, data: bars.data, yAxisID: 'y', backgroundColor: face(bars.color || p[1], false), _c3d: bars.color || p[1], borderRadius: 0, maxBarThickness: 26, order: 2 },
      { type: 'line', label: line.label, data: line.data, yAxisID: 'y1', borderColor: line.color || p[0], backgroundColor: line.color || p[0],
        tension: 0.35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2.5, order: 1 },
    ] },
    options: {
      interaction: { mode: 'index', intersect: false }, animation: growAnim, layout: pad3d,
      scales: { x: catAxis(), y: axis(bars.kind, { position: 'left' }), y1: axis(line.kind, { position: 'right', grid: { display: false } }) },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtBy(c.datasetIndex === 0 ? bars.kind : line.kind)(c.raw)}` } } },
    },
    plugins: [softShadow, bar3d],
  });
}

export function lineChart(canvas, { labels, series, kind, area = true }) {
  const p = palette();
  return makeChart(canvas, {
    type: 'line',
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data, borderColor: s.color || p[i % 8],
      backgroundColor: area && series.length <= 2 ? areaGradient(s.color || p[i % 8]) : (s.color || p[i % 8]), fill: area && series.length <= 2,
      tension: 0.35, pointRadius: series.length > 3 ? 0 : 2, pointHoverRadius: 5, borderWidth: 2.2, borderDash: s.dash || [] })) },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: catAxis(), y: axis(kind, { beginAtZero: true }) },
      plugins: { legend: { display: series.length > 1 }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtBy(kind)(c.raw)}` } } },
    },
  });
}

export function barChart(canvas, { labels, series, kind, stacked = false, horizontal = false, onClick }) {
  const p = palette();
  return makeChart(canvas, {
    type: 'bar',
    data: { labels, datasets: series.map((s, i) => ({ label: s.label, data: s.data,
      backgroundColor: face(s.colors || s.color || p[i % 8], horizontal), _c3d: s.colors || s.color || p[i % 8],
      borderRadius: 0, maxBarThickness: horizontal ? 18 : 30 })) },
    options: {
      indexAxis: horizontal ? 'y' : 'x', animation: growAnim, layout: pad3d,
      interaction: { mode: 'index', intersect: false },
      onClick: onClick ? (_e, els) => { if (els.length) onClick(els[0].index); } : undefined,
      onHover: onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
      scales: horizontal
        ? { y: catAxis({ stacked, ticks: { autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 22 ? l.slice(0, 21) + '…' : l; } } }), x: axis(kind, { stacked, beginAtZero: true }) }
        : { x: catAxis({ stacked }), y: axis(kind, { stacked, beginAtZero: true }) },
      plugins: { legend: { display: series.length > 1 }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtBy(kind)(c.raw)}` } } },
    },
    plugins: [softShadow, bar3d],
  });
}

export function donutChart(canvas, { labels, data, colors, kind = 'int', title, sub, extra }) {
  const p = palette();
  const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
  return makeChart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: (ctx) => { const cs = colors || p; return face3dArc(cs[ctx.dataIndex % cs.length])(ctx); }, _c3d: colors || p, borderColor: cssVar('--panel-solid'), borderWidth: 2, hoverOffset: 14 }] },
    options: {
      cutout: '62%', layout: { padding: { bottom: DONUT_DEPTH + 4, top: 6 } },
      animation: { animateRotate: true, animateScale: true, duration: 2000, easing: 'easeOutCubic' },
      plugins: {
        legend: { position: 'bottom' },
        centerText: { title, sub },
        tooltip: { callbacks: { label: (c) => {
          const pctv = total ? ((Number(c.raw) / total) * 100).toFixed(1) : '0.0';
          const more = extra ? extra(c.dataIndex) : '';
          return ` ${c.label}: ${fmtBy(kind)(c.raw)} (${pctv}%)${more}`;
        } } },
      },
    },
    plugins: [donut3d, centerText, softShadow],
  });
}
