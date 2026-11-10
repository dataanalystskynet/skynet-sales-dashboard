// =====================================================================
// SKYNET EXPRESS – charts.js : themed Chart.js helpers
// (gradient "3D" bars, soft shadows, INR / KG tooltips, donut centre text)
// =====================================================================
import { inr, inrShort, kg, kgShort, int, isNil } from './utils.js';

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
  : kind === 'inr' ? (short ? inrShort(v) : inr(v)) : kind === 'kg' ? (short ? kgShort(v) : kg(v)) : kind === 'pct' ? Number(v).toFixed(1) + '%' : int(v);

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
  const ch = new window.Chart(canvas, config); registry.add(ch); return ch;
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
      { type: 'bar', label: bars.label, data: bars.data, yAxisID: 'y', backgroundColor: vGradient(bars.color || p[1]), borderRadius: 6, maxBarThickness: 26, order: 2 },
      { type: 'line', label: line.label, data: line.data, yAxisID: 'y1', borderColor: line.color || p[0], backgroundColor: line.color || p[0],
        tension: 0.35, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2.5, order: 1 },
    ] },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: { x: catAxis(), y: axis(bars.kind, { position: 'left' }), y1: axis(line.kind, { position: 'right', grid: { display: false } }) },
      plugins: { tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtBy(c.datasetIndex === 0 ? bars.kind : line.kind)(c.raw)}` } } },
    },
    plugins: [softShadow],
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
      backgroundColor: s.colors || (horizontal ? hGradient(s.color || p[i % 8]) : vGradient(s.color || p[i % 8])),
      borderRadius: 6, maxBarThickness: horizontal ? 18 : 30 })) },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      onClick: onClick ? (_e, els) => { if (els.length) onClick(els[0].index); } : undefined,
      onHover: onClick ? (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; } : undefined,
      scales: horizontal
        ? { y: catAxis({ stacked, ticks: { autoSkip: false, callback(v) { const l = this.getLabelForValue(v); return l.length > 22 ? l.slice(0, 21) + '…' : l; } } }), x: axis(kind, { stacked, beginAtZero: true }) }
        : { x: catAxis({ stacked }), y: axis(kind, { stacked, beginAtZero: true }) },
      plugins: { legend: { display: series.length > 1 }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtBy(kind)(c.raw)}` } } },
    },
    plugins: [softShadow],
  });
}

export function donutChart(canvas, { labels, data, colors, kind = 'int', title, sub, extra }) {
  const p = palette();
  const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
  return makeChart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors || p, borderColor: cssVar('--panel-solid'), borderWidth: 3, hoverOffset: 10 }] },
    options: {
      cutout: '68%',
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
    plugins: [centerText, softShadow],
  });
}
