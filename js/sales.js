// =====================================================================
// SKYNET EXPRESS – sales.js : PAGE 3 – Sales Team Performance
// Leaderboard, rankings, contribution, daily / monthly trends,
// targets vs actual (targets are never assumed – only configured ones).
// =====================================================================
import { rpc } from './api.js';
import { barChart, lineChart, donutChart, palette } from './charts.js';
import { kpiCard, setKpi, TONES, panel, chartBox, seg, bindSeg, skeleton, clientTable, rangeLabel, prevLabel } from './ui.js';
import { serverTable } from './shipments.js';
import { inr, inrShort, int, kg, kgShort, growth, shortDay, monLabel, isNil, n, html, raw, setHTML, drawer, share, emptyState, icons, esc, pct } from './utils.js';
import { can } from './permissions.js';

export async function render(root, { filters, isStale }) {
  root.innerHTML = skeleton(5, 4);
  const d = await rpc('get_sales_performance', { f: filters.params() });
  if (isStale()) return;
  const k = d.kpi, rf = d.range; const rv = d.flags.revenue;
  const sps = d.salespersons;
  const tot = sps.reduce((a, s) => a + n(rv ? s.rev : s.awb), 0);
  sps.forEach((s, i) => { s.rank = i + 1; s.share = tot ? (n(rv ? s.rev : s.awb) / tot) * 100 : null; s.growth = growth(rv ? s.rev : s.awb, rv ? s.prev_rev : s.prev_awb); });

  root.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard({ id: 'sp', label: 'Total salespersons', icon: 'user-check', tone: TONES.violet })}
      ${kpiCard({ id: 'rev', label: 'Total sales revenue', icon: 'indian-rupee', tone: TONES.amber })}
      ${kpiCard({ id: 'awb', label: 'Total AWB bookings', icon: 'package', tone: TONES.red })}
      ${kpiCard({ id: 'wt', label: 'Total weight', icon: 'weight', tone: TONES.blue })}
      ${kpiCard({ id: 'avg', label: 'Avg revenue per salesperson', icon: 'calculator', tone: TONES.teal })}
    </div>
    <div class="grid g-1-2 mt">
      ${panel({ title: 'Leaderboard', sub: 'Ranked by ' + (rv ? 'revenue' : 'AWB count') + ' · ' + rangeLabel(rf), body: '<div class="leader" id="leader"></div>' })}
      ${panel({ title: 'Top 10 salespersons', tools: seg('top', [['rev', 'Revenue'], ['awb', 'Shipments'], ['wt', 'Weight']], rv ? 'rev' : 'awb'), body: chartBox('ch-top', 'tall'), cls: 'watermark' })}
    </div>
    <div class="grid g-2-1 mt">
      ${panel({ title: 'Daily salesperson performance', sub: 'Top 8 by ' + (rv ? 'revenue' : 'AWBs'), tools: seg('daily', [['rev', 'Revenue'], ['awb', 'AWB'], ['wt', 'Weight']], rv ? 'rev' : 'awb'), body: chartBox('ch-daily') })}
      ${panel({ title: 'Sales team contribution', sub: 'Share of ' + (rv ? 'revenue' : 'AWBs'), body: chartBox('ch-share') })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Monthly salesperson growth', sub: 'Last 12 months · top 6', tools: seg('monthly', [['rev', 'Revenue'], ['awb', 'AWB'], ['wt', 'Weight']], rv ? 'rev' : 'awb'), body: chartBox('ch-month') })}
      ${panel({ title: 'Target vs actual', sub: 'Month: ' + monLabel(d.target_month), tools: can('target_management') ? '<a class="btn btn-sm" href="#/targets"><i data-lucide="target"></i>Manage targets</a>' : '', body: '<div id="targets"></div>' })}
    </div>
    ${panel({ title: 'Salesperson performance', sub: prevLabel(rf) + ' for growth', cls: 'mt', body: '<div id="tbl"></div>' })}`;

  setKpi(root, 'sp', k.salespersons, int, sps.some((s) => s.name === 'Unassigned') ? '<span>+ Unassigned bookings</span>' : '');
  setKpi(root, 'rev', k.revenue, inr, isNil(k.revenue) ? '' : '<span>≈ ' + inrShort(k.revenue) + '</span>');
  setKpi(root, 'awb', k.awb, int); setKpi(root, 'wt', k.weight, kg);
  setKpi(root, 'avg', k.avg_revenue, inr, '<span>Excludes unassigned AWBs</span>');

  // Leaderboard
  const leaders = sps.slice(0, 10); const max = Math.max(1, ...leaders.map((s) => n(rv ? s.rev : s.awb)));
  setHTML(root.querySelector('#leader'), leaders.length ? html`${leaders.map((s) => html`<div class="leader-row" data-name="${s.name}" tabindex="0">
      <span class="rank ${s.rank <= 3 ? 'r' + s.rank : ''}">${s.rank}</span>
      <div style="min-width:0"><div class="nm">${s.name}</div><div class="bar"><i style="width:${((n(rv ? s.rev : s.awb) / max) * 100).toFixed(1)}%"></i></div></div>
      <div class="right"><b class="num">${rv ? inrShort(s.rev) : int(s.awb) + ' AWB'}</b><div class="muted" style="font-size:11.5px">${raw(s.growth === null ? 'New' : `<span class="trend ${s.growth > 0 ? 'up' : s.growth < 0 ? 'down' : 'flat'}">${esc(pct(s.growth))}</span>`)}</div></div></div>`)}`
    : raw(emptyState()));
  root.querySelectorAll('.leader-row').forEach((r) => { const go = () => openSalesperson(sps.find((s) => s.name === r.dataset.name), filters); r.addEventListener('click', go); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });

  const p = palette();
  const drawTop = (m) => { const list = [...sps].sort((a, b) => n(b[m]) - n(a[m])).slice(0, 10);
    barChart(root.querySelector('#ch-top'), { horizontal: true, kind: m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int', labels: list.map((s) => s.name),
      series: [{ label: m === 'rev' ? 'Revenue' : m === 'wt' ? 'Weight' : 'AWBs', data: list.map((s) => s[m]), color: m === 'rev' ? p[2] : m === 'wt' ? p[1] : p[0] }], onClick: (i) => openSalesperson(list[i], filters) }); };
  drawTop(rv ? 'rev' : 'awb'); bindSeg(root, 'top', drawTop);

  const drawDaily = (m) => { const days = [...new Set(d.daily.map((x) => x.d))].sort(); const names = [...new Set(d.daily.map((x) => x.name))];
    lineChart(root.querySelector('#ch-daily'), { labels: days.map(shortDay), kind: m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int', area: false,
      series: names.map((nm, i) => ({ label: nm, color: p[i % 8], data: days.map((dd) => d.daily.find((x) => x.d === dd && x.name === nm)?.[m] ?? 0) })) }); };
  drawDaily(rv ? 'rev' : 'awb'); bindSeg(root, 'daily', drawDaily);

  const top7 = sps.slice(0, 7); const restV = tot - top7.reduce((a, s) => a + n(rv ? s.rev : s.awb), 0);
  donutChart(root.querySelector('#ch-share'), { kind: rv ? 'inr' : 'int', labels: [...top7.map((s) => s.name), ...(restV > 0 ? ['Others'] : [])], data: [...top7.map((s) => (rv ? s.rev : s.awb)), ...(restV > 0 ? [restV] : [])],
    colors: [...p.slice(0, 7), 'rgba(140,150,180,.45)'], title: int(sps.filter((s) => s.name !== 'Unassigned').length), sub: 'salespersons' });

  const drawMonth = (m) => { const months = [...new Set(d.monthly.map((x) => x.m))].sort(); const names = sps.slice(0, 6).map((s) => s.name);
    barChart(root.querySelector('#ch-month'), { kind: m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int', labels: months.map(monLabel),
      series: names.map((nm, i) => ({ label: nm, color: p[i], data: months.map((mm) => d.monthly.find((x) => x.m === mm && x.name === nm)?.[m] ?? 0) })) }); };
  drawMonth(rv ? 'rev' : 'awb'); bindSeg(root, 'monthly', drawMonth);

  renderTargets(root.querySelector('#targets'), d.targets, d.target_month);

  clientTable(root.querySelector('#tbl'), {
    rows: sps, pageSize: 15, exportName: 'SKYNET_Salesperson_Report', exportSheet: 'Salespersons', searchKeys: ['name'], searchPlaceholder: 'Search salesperson',
    sort: { key: rv ? 'rev' : 'awb', dir: 'desc' }, onRowClick: (s) => openSalesperson(s, filters),
    columns: [
      { key: 'rank', label: 'Rank', type: 'int', total: false }, { key: 'name', label: 'Salesperson', type: 'text' },
      { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' },
      { key: 'share', label: 'Revenue Share %', type: 'share' }, { key: 'growth', label: 'Growth %', type: 'growth' },
      { key: 'customers', label: 'Customers', type: 'int', total: false }, { key: 'hold', label: 'Hold AWBs', type: 'int' },
    ] });
}

export function renderTargets(el, targets, month, compact = false) {
  if (!targets.length) {
    setHTML(el, raw(emptyState(`No sales targets have been configured for ${monLabel(month)}. Targets are never assumed – an administrator must set them.`, 'target')));
    return;
  }
  const line = (label, actual, target, fmt) => {
    if (isNil(target)) return html`<div class="t-line"><div class="t-meta"><span>${label}</span><span class="muted">No target set</span></div></div>`;
    if (isNil(actual)) return html`<div class="t-line"><div class="t-meta"><span>${label}</span><span class="muted">Restricted</span></div></div>`;
    const pc = target > 0 ? (actual / target) * 100 : 0; const remaining = Math.max(0, target - actual);
    return html`<div class="t-line"><div class="t-meta"><span>${label}: <b>${fmt(actual)}</b> / ${fmt(target)}</span><b>${pc.toFixed(1)}%</b></div>
      <div class="bar"><i class="${pc >= 100 ? 'done' : ''}" style="width:${Math.min(100, pc).toFixed(1)}%"></i></div>
      <div class="muted" style="font-size:11.5px;margin-top:3px">${pc >= 100 ? 'Target achieved' : 'Remaining: ' + fmt(remaining)}</div></div>`;
  };
  setHTML(el, html`<div class="chart-box short"><canvas id="ch-target"></canvas></div>
    <div class="grid ${compact ? 'g-2' : 'g-2'} mt">${targets.map((t) => html`<div class="target-card"><h4><span>${t.salesperson_name}</span></h4>
      ${line('Revenue', t.actual_revenue, t.revenue_target, inrShort)}${line('AWBs', t.actual_awb, t.awb_target, int)}${line('Weight', t.actual_weight, t.weight_target, kgShort)}</div>`)}</div>`);
  const p = palette();
  const useRev = targets.some((t) => !isNil(t.revenue_target));
  barChart(el.querySelector('#ch-target'), { kind: useRev ? 'inr' : 'int', labels: targets.map((t) => t.salesperson_name),
    series: [{ label: 'Target', data: targets.map((t) => (useRev ? t.revenue_target : t.awb_target)), color: p[5] }, { label: 'Actual', data: targets.map((t) => (useRev ? t.actual_revenue : t.actual_awb)), color: p[0] }] });
}

export async function openSalesperson(s, filters) {
  if (!s) return;
  const spFilter = s.name === 'Unassigned' ? '__UNASSIGNED__' : s.name;
  const d = drawer({ title: s.name, sub: `Rank #${s.rank || '—'} · ${s.customers ?? '—'} customers`,
    body: html`<div class="detail-hero"><div><small>AWBs</small><b>${int(s.awb)}</b></div><div><small>Weight</small><b>${kg(s.wt)}</b></div>
      <div><small>Revenue</small><b>${isNil(s.rev) ? 'Restricted' : inr(s.rev)}</b></div><div><small>Growth</small><b>${s.growth === null ? 'New' : pct(s.growth)}</b></div></div>
      <div class="chart-box short"><canvas id="sp-ch"></canvas></div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">${raw(can('excel_export') ? '<button class="btn" id="sp-exp"><i data-lucide="download"></i>Export AWBs</button>' : '')}</div>
      <div class="section-title">AWBs booked</div><div id="sp-tbl"></div>`.html });
  const getF = () => filters.params({ salesperson: spFilter });
  const t = serverTable(d.querySelector('#sp-tbl'), getF, { compact: true, exportName: 'Salesperson_' + s.name.replace(/\W+/g, '_') });
  d.querySelector('#sp-exp')?.addEventListener('click', () => t.exportAll());
  icons(d);
  try {
    const rows = await rpc('get_datewise_report', { f: getF(), p_type: 'date' }, { silent: true });
    const useRev = rows.some((r) => !isNil(r.rev));
    barChart(d.querySelector('#sp-ch'), { kind: useRev ? 'inr' : 'int', labels: rows.map((r) => shortDay(r.d)), series: [{ label: useRev ? 'Daily revenue' : 'Daily AWBs', data: rows.map((r) => (useRev ? r.rev : r.awb)), color: palette()[0] }] });
  } catch (_) { d.querySelector('#sp-ch')?.closest('.chart-box')?.remove(); }
}
export { share };
