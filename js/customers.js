// =====================================================================
// SKYNET EXPRESS – customers.js : PAGE 2 – Customer Analysis
// =====================================================================
import { rpc } from './api.js';
import { barChart, lineChart, donutChart, comboChart, palette } from './charts.js';
import { kpiCard, setKpi, TONES, panel, chartBox, seg, bindSeg, skeleton, clientTable, rangeLabel, prevLabel } from './ui.js';
import { serverTable } from './shipments.js';
import { inr, inrShort, int, kg, growth, trendHtml, shortDay, isNil, n, html, setHTML, drawer, share, emptyState, icons, raw, dmy } from './utils.js';
import { can } from './permissions.js';

export async function render(root, { filters, isStale }) {
  root.innerHTML = skeleton(6, 4);
  const d = await rpc('get_customer_analysis', { f: filters.params() });
  if (isStale()) return;
  const k = d.kpi, rf = d.range, cs = d.customers;
  const totalRev = cs.reduce((a, c) => a + n(c.rev), 0);
  cs.forEach((c) => { c.avg = c.awb && !isNil(c.rev) ? c.rev / c.awb : null; c.share = totalRev ? (n(c.rev) / totalRev) * 100 : null; c.growth = growth(c.rev ?? c.awb, c.rev === null ? c.prev_awb : c.prev_rev); });

  root.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      ${kpiCard({ id: 'active', label: 'Active customers', icon: 'building-2', tone: TONES.teal })}
      ${kpiCard({ id: 'awb', label: 'Customer shipments', icon: 'package', tone: TONES.red })}
      ${kpiCard({ id: 'wt', label: 'Customer weight', icon: 'weight', tone: TONES.blue })}
      ${kpiCard({ id: 'rev', label: 'Customer revenue', icon: 'indian-rupee', tone: TONES.amber })}
      ${kpiCard({ id: 'avg', label: 'Avg revenue per customer', icon: 'calculator', tone: TONES.violet })}
      ${kpiCard({ id: 'new', label: 'New customers', icon: 'user-plus', tone: TONES.lime })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Top 20 customers', sub: rangeLabel(rf), tools: seg('top', [['rev', 'Revenue'], ['wt', 'Weight'], ['awb', 'AWB count']], 'rev'), body: chartBox('ch-top', 'tall'), cls: 'watermark' })}
      ${panel({ title: 'Customer revenue comparison', sub: 'Top 10 · current ' + prevLabel(rf), tools: seg('cmp', [['rev', 'Revenue'], ['awb', 'AWB']], 'rev'), body: chartBox('ch-cmp', 'tall') })}
    </div>
    <div class="grid g-2-1 mt">
      ${panel({ title: 'Customer booking trend', sub: 'Daily revenue of the top 5 customers', body: chartBox('ch-trend') })}
      ${panel({ title: 'New vs existing customers', sub: 'Customers active in the period', body: chartBox('ch-new') })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Customer acquisition & activity', sub: 'Active customers per day and first-time customers', body: chartBox('ch-acq') })}
      ${panel({ title: 'Customer revenue contribution', sub: 'Share of revenue · top 10 vs rest', body: chartBox('ch-share') })}
    </div>
    ${panel({ title: 'Customer performance', sub: 'Click a customer to see all AWBs', cls: 'mt', body: '<div id="tbl"></div>' })}`;

  setKpi(root, 'active', k.active, int, trendHtml(growth(k.active, k.prev_active)));
  setKpi(root, 'awb', k.awb, int);
  setKpi(root, 'wt', k.weight, kg);
  setKpi(root, 'rev', k.revenue, inr, isNil(k.revenue) ? '' : '<span>≈ ' + inrShort(k.revenue) + '</span>');
  setKpi(root, 'avg', k.avg_revenue, inr, '<span>Revenue ÷ active customers</span>');
  setKpi(root, 'new', k.new_customers, int, `<span>${int(k.returning)} returning customers</span>`);

  const p = palette();
  const drawTop = (m) => { const list = [...cs].sort((a, b) => n(b[m]) - n(a[m])).slice(0, 20);
    barChart(root.querySelector('#ch-top'), { horizontal: true, kind: m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int', labels: list.map((c) => c.name || c.code),
      series: [{ label: m === 'rev' ? 'Revenue' : m === 'wt' ? 'Weight' : 'AWBs', data: list.map((c) => c[m]), color: m === 'rev' ? p[2] : m === 'wt' ? p[1] : p[0] }], onClick: (i) => openCustomer(list[i], filters) }); };
  drawTop('rev'); bindSeg(root, 'top', drawTop);

  const drawCmp = (m) => { const list = cs.slice(0, 10); const pk = m === 'rev' ? 'prev_rev' : 'prev_awb';
    barChart(root.querySelector('#ch-cmp'), { kind: m === 'rev' ? 'inr' : 'int', labels: list.map((c) => (c.name || c.code).slice(0, 14)),
      series: [{ label: 'Current period', data: list.map((c) => c[m]), color: p[0] }, { label: 'Previous period', data: list.map((c) => c[pk] ?? 0), color: p[5] }] }); };
  drawCmp('rev'); bindSeg(root, 'cmp', drawCmp);

  const days = [...new Set(d.top5_daily.map((x) => x.d))].sort();
  const top5 = cs.slice(0, 5);
  lineChart(root.querySelector('#ch-trend'), { labels: days.map(shortDay), kind: isNil(k.revenue) ? 'int' : 'inr', area: false,
    series: top5.map((c, i) => ({ label: (c.name || c.code).slice(0, 22), color: p[i], data: days.map((dd) => { const r = d.top5_daily.find((x) => x.d === dd && x.code === c.code); return r ? (isNil(k.revenue) ? r.awb : r.rev) : 0; }) })) });

  donutChart(root.querySelector('#ch-new'), { labels: ['New customers', 'Returning customers'], data: [k.new_customers, k.returning], colors: [p[7], p[1]], title: int(k.active), sub: 'active customers' });
  comboChart(root.querySelector('#ch-acq'), { labels: d.daily.map((x) => shortDay(x.d)), bars: { label: 'Active customers', data: d.daily.map((x) => x.active), kind: 'int', color: p[3] }, line: { label: 'New customers', data: d.daily.map((x) => x.new), kind: 'int', color: p[7] } });
  const top10 = cs.slice(0, 10); const rest = totalRev - top10.reduce((a, c) => a + n(c.rev), 0);
  if (isNil(k.revenue)) root.querySelector('#ch-share').closest('.chart-box').innerHTML = emptyState('Revenue visibility is restricted for your account.', 'lock');
  else donutChart(root.querySelector('#ch-share'), { kind: 'inr', labels: [...top10.map((c) => (c.name || c.code).slice(0, 20)), 'All other customers'], data: [...top10.map((c) => c.rev), rest],
    colors: [...p, ...p].slice(0, 10).concat(['rgba(140,150,180,.45)']), title: share(totalRev ? (top10.reduce((a, c) => a + n(c.rev), 0) / totalRev) * 100 : 0), sub: 'from top 10' });

  clientTable(root.querySelector('#tbl'), {
    rows: cs, pageSize: 15, exportName: 'SKYNET_Customer_Report', exportSheet: 'Customers', searchKeys: ['code', 'name'], searchPlaceholder: 'Search customer name or code',
    sort: { key: 'rev', dir: 'desc' }, onRowClick: (c) => openCustomer(c, filters),
    columns: [
      { key: 'code', label: 'Customer Code', type: 'text' }, { key: 'name', label: 'Customer Name', type: 'text' },
      { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' },
      { key: 'avg', label: 'Average Revenue', type: 'inr', total: false }, { key: 'share', label: 'Revenue Share %', type: 'share' },
      { key: 'growth', label: 'Growth %', type: 'growth' }, { key: 'last_in_range', label: 'Last Booking', type: 'date' },
      { key: 'is_new', label: 'Type', type: 'text', get: (c) => (c.is_new ? 'New' : 'Existing'), render: (c) => (c.is_new ? '<span class="badge ok">New</span>' : '<span class="badge mute">Existing</span>') },
    ] });
}

export function openCustomer(c, filters) {
  const d = drawer({ title: c.name || c.code, sub: `Customer code ${c.code} · ${dmy(filters.state.from)} → ${dmy(filters.state.to)}`,
    body: html`<div class="detail-hero">
        <div><small>AWBs</small><b>${int(c.awb)}</b></div><div><small>Weight</small><b>${kg(c.wt)}</b></div>
        <div><small>Revenue</small><b>${isNil(c.rev) ? 'Restricted' : inr(c.rev)}</b></div><div><small>First booking (ever)</small><b>${dmy(c.lifetime_first)}</b></div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">${raw(can('excel_export') ? '<button class="btn" id="c-exp"><i data-lucide="download"></i>Export customer AWBs</button>' : '')}</div>
      <div class="section-title">All AWBs for this customer</div><div id="c-tbl"></div>`.html });
  const getF = () => filters.params({ customer_code: c.code });
  const t = serverTable(d.querySelector('#c-tbl'), getF, { compact: true, exportName: 'Customer_' + c.code });
  d.querySelector('#c-exp')?.addEventListener('click', () => t.exportAll());
  icons(d);
}
