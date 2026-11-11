// =====================================================================
// SKYNET EXPRESS – dashboard.js : PAGE 1 – Executive Dashboard
// =====================================================================
import { rpc } from './api.js';
import { comboChart, lineChart, barChart, donutChart, palette } from './charts.js';
import { kpiCard, setKpi, TONES, panel, chartBox, seg, bindSeg, skeleton, rangeLabel, prevLabel } from './ui.js';
import { inr, inrShort, int, kg, kgShort, growth, trendHtml, rollup, dmy, shortDay, monLabel, isNil, n, esc, html, raw, setHTML, pct, share, emptyState, parseISO } from './utils.js';

export async function render(root, { filters, isStale }) {
  root.innerHTML = skeleton(10, 4);
  const d = await rpc('get_dashboard', { f: filters.params() });
  if (isStale()) return;
  const k = d.kpi, p = d.prev_kpi, rf = d.range;
  const avgWt = k.awb ? n(k.weight) / k.awb : null;
  const revAwb = k.awb && !isNil(k.revenue) ? k.revenue / k.awb : null;
  const revKg = !isNil(k.revenue) && n(k.weight) > 0 ? k.revenue / k.weight : null;

  root.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard({ id: 'awb', label: 'Total AWB bookings', icon: 'package', tone: TONES.red })}
      ${kpiCard({ id: 'wt', label: 'Total chargeable weight', icon: 'weight', tone: TONES.blue })}
      ${kpiCard({ id: 'rev', label: 'Customer grand total', icon: 'indian-rupee', tone: TONES.amber })}
      ${kpiCard({ id: 'cust', label: 'Total customers', icon: 'building-2', tone: TONES.teal })}
      ${kpiCard({ id: 'sp', label: 'Total salespersons', icon: 'user-check', tone: TONES.violet })}
      ${kpiCard({ id: 'hold', label: 'Hold shipments', icon: 'circle-pause', tone: TONES.coral })}
      ${kpiCard({ id: 'unhold', label: 'Unhold shipments', icon: 'circle-check', tone: TONES.lime })}
      ${kpiCard({ id: 'avgwt', label: 'Avg weight per shipment', icon: 'scale', tone: TONES.sky })}
      ${kpiCard({ id: 'revawb', label: 'Avg revenue per AWB', icon: 'receipt-indian-rupee', tone: TONES.amber })}
      ${kpiCard({ id: 'revkg', label: 'Avg revenue per KG', icon: 'calculator', tone: TONES.blue })}
    </div>
    <section class="panel summary-strip mt" id="today"></section>
    <div class="grid g-2-1 mt">
      ${panel({ title: 'Daily booking trend', sub: rangeLabel(rf), cls: 'watermark', tools: seg('trend', [['awb', 'AWB'], ['wt', 'Weight'], ['rev', 'Revenue']], 'awb'), body: chartBox('ch-trend', 'tall') })}
      ${panel({ title: 'Hold vs unhold', sub: 'Share of shipments in the period', tools: seg('hold', [['count', 'Count'], ['wt', 'Weight'], ['rev', 'Revenue']], 'count'), body: chartBox('ch-hold') + '<div id="hold-figs" class="mt"></div>' })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Sales trend', sub: 'Customer grand total (₹)', tools: seg('sales', [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], 'daily'), body: chartBox('ch-sales') })}
      ${panel({ title: 'Weight trend', sub: 'Chargeable weight (KG)', tools: seg('wtrend', [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], 'daily'), body: chartBox('ch-weight') })}
    </div>
    <div class="grid g-1-2 mt">
      ${panel({ title: 'Sales growth', sub: prevLabel(rf), body: '<div id="growth"></div>' })}
      ${panel({ title: 'Current vs previous period', sub: 'Day-by-day comparison of equal-length periods', tools: seg('cmp', [['rev', 'Revenue'], ['awb', 'AWB'], ['wt', 'Weight']], 'rev'), body: chartBox('ch-cmp') })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Top 10 customers', tools: seg('tc', [['by_revenue', 'Revenue'], ['by_awb', 'Shipments'], ['by_weight', 'Weight']], 'by_revenue'), body: chartBox('ch-tc', 'tall') })}
      ${panel({ title: 'Top 10 salespersons', tools: seg('ts', [['by_revenue', 'Revenue'], ['by_awb', 'AWB'], ['by_weight', 'Weight']], 'by_revenue'), body: chartBox('ch-ts', 'tall') })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Business insights', sub: 'Calculated from the filtered data', body: '<div id="insights"></div>' })}
      ${panel({ title: 'Service mix', sub: 'AWB count by service', body: chartBox('ch-svc') })}
    </div>`;

  const gAwb = growth(k.awb, p.awb), gWt = growth(k.weight, p.weight), gRev = growth(k.revenue, p.revenue), gCus = growth(k.customers, p.customers);
  setKpi(root, 'awb', k.awb, int, trendHtml(gAwb));
  setKpi(root, 'wt', k.weight, kg, trendHtml(gWt));
  setKpi(root, 'rev', k.revenue, inr, isNil(k.revenue) ? '' : trendHtml(gRev, 'vs prev. period'));
  setKpi(root, 'cust', k.customers, int, trendHtml(gCus));
  setKpi(root, 'sp', k.salespersons, int, k.unassigned ? `<span>${int(k.unassigned)} AWBs unassigned</span>` : '<span>All AWBs assigned</span>');
  setKpi(root, 'hold', k.hold, int, `<span>${share(k.awb ? (k.hold / k.awb) * 100 : 0)} of AWBs</span>`);
  setKpi(root, 'unhold', k.unhold, int, `<span>${share(k.awb ? (k.unhold / k.awb) * 100 : 0)} of AWBs</span>`);
  setKpi(root, 'avgwt', isNil(k.weight) ? null : avgWt, kg, '<span>Chargeable KG ÷ AWBs</span>');
  setKpi(root, 'revawb', revAwb, inr, '<span>Grand total ÷ AWBs</span>');
  setKpi(root, 'revkg', revKg, inr, '<span>Grand total ÷ chargeable KG</span>');

  renderToday(root.querySelector('#today'), d.daily);

  // A. Daily booking trend
  const daily = d.daily;
  const drawTrend = (m) => {
    const labels = daily.map((x) => shortDay(x.d));
    const metric = { awb: ['AWB bookings', 'int'], wt: ['Chargeable weight', 'kg'], rev: ['Customer grand total', 'inr'] }[m];
    const lineKey = m === 'rev' ? 'awb' : 'rev';
    comboChart(root.querySelector('#ch-trend'), { labels,
      bars: { label: metric[0], data: daily.map((x) => x[m]), kind: metric[1] },
      line: { label: lineKey === 'rev' ? 'Revenue' : 'AWB bookings', data: daily.map((x) => x[lineKey]), kind: lineKey === 'rev' ? 'inr' : 'int' } });
  };
  drawTrend('awb'); bindSeg(root, 'trend', drawTrend);

  // G. Hold vs unhold
  const drawHold = (m) => {
    const data = m === 'count' ? [k.hold, k.unhold] : m === 'wt' ? [k.hold_weight, k.unhold_weight] : [k.hold_revenue, k.unhold_revenue];
    const kind = m === 'count' ? 'int' : m === 'wt' ? 'kg' : 'inr';
    const restricted = (m === 'wt' && isNil(k.weight)) || (m === 'rev' && isNil(k.revenue));
    const tot = n(data[0]) + n(data[1]);
    donutChart(root.querySelector('#ch-hold'), { labels: ['Hold (YES)', 'Unhold (NO)'], data: restricted ? [0, 0] : data, colors: [palette()[0], palette()[3]], kind,
      title: restricted ? 'Restricted' : tot ? share((n(data[0]) / tot) * 100) : '0%', sub: 'on hold' });
  };
  drawHold('count'); bindSeg(root, 'hold', drawHold);
  setHTML(root.querySelector('#hold-figs'), html`<table class="data"><thead><tr><th></th><th class="right">AWBs</th><th class="right">Weight</th><th class="right">Revenue</th></tr></thead><tbody>
    <tr><td><span class="badge hold">YES · Hold</span></td><td class="right num">${int(k.hold)}</td><td class="right num">${kg(k.hold_weight)}</td><td class="right num">${isNil(k.revenue) ? '—' : inr(k.hold_revenue)}</td></tr>
    <tr><td><span class="badge ok">NO · Unhold</span></td><td class="right num">${int(k.unhold)}</td><td class="right num">${kg(k.unhold_weight)}</td><td class="right num">${isNil(k.revenue) ? '—' : inr(k.unhold_revenue)}</td></tr></tbody></table>`);

  // B / C. Sales & weight trends
  const drawSales = (mode) => { const r = rollup(daily, mode); barChart(root.querySelector('#ch-sales'), { labels: r.map((x) => x.label), series: [{ label: 'Revenue', data: r.map((x) => x.rev), color: palette()[2] }], kind: 'inr' }); };
  const drawWeight = (mode) => { const r = rollup(daily, mode); lineChart(root.querySelector('#ch-weight'), { labels: r.map((x) => x.label), series: [{ label: 'Chargeable weight', data: r.map((x) => x.wt), color: palette()[1] }], kind: 'kg' }); };
  drawSales('daily'); bindSeg(root, 'sales', drawSales);
  drawWeight('daily'); bindSeg(root, 'wtrend', drawWeight);

  // D. Growth
  const gRow = (label, cur, prev, fmt) => { const g = growth(cur, prev); return html`<tr><td>${label}</td><td class="right num">${isNil(cur) ? '—' : fmt(cur)}</td><td class="right num">${isNil(prev) ? '—' : fmt(prev)}</td>
    <td class="right num">${isNil(cur) || isNil(prev) ? '—' : fmt(n(cur) - n(prev))}</td><td class="right">${raw(isNil(cur) ? '—' : g === null ? '<span class="badge info">New</span>' : `<span class="trend ${g > 0 ? 'up' : g < 0 ? 'down' : 'flat'}">${pct(g)}</span>`)}</td></tr>`; };
  setHTML(root.querySelector('#growth'), html`<div class="table-wrap"><table class="data"><thead><tr><th>Metric</th><th class="right">Current</th><th class="right">Previous</th><th class="right">Change</th><th class="right">Growth %</th></tr></thead><tbody>
    ${gRow('Revenue', k.revenue, p.revenue, inrShort)}${gRow('Shipments (AWB)', k.awb, p.awb, int)}${gRow('Weight', k.weight, p.weight, kgShort)}${gRow('Active customers', k.customers, p.customers, int)}
    ${gRow('Revenue / AWB', revAwb, p.awb && !isNil(p.revenue) ? p.revenue / p.awb : null, inr)}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Growth % = (Current − Previous) ÷ Previous × 100. "New" means the previous period had no value to compare.</p>`);
  const drawCmp = (m) => {
    const len = rf.days; const curMap = new Map(daily.map((x) => [x.d, x[m]])); const prevMap = new Map(d.prev_daily.map((x) => [x.d, x[m]]));
    const labels = [], cur = [], prev = [];
    for (let i = 0; i < len; i++) {
      const cd = new Date(parseISO(rf.from)); cd.setDate(cd.getDate() + i); const pd = new Date(parseISO(rf.prev_from)); pd.setDate(pd.getDate() + i);
      const ci = cd.toLocaleDateString('en-CA'), pi = pd.toLocaleDateString('en-CA');
      labels.push('Day ' + (i + 1)); cur.push(curMap.get(ci) ?? 0); prev.push(prevMap.get(pi) ?? 0);
    }
    const kind = m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int';
    lineChart(root.querySelector('#ch-cmp'), { labels, kind, area: false, series: [{ label: 'Current period', data: cur, color: palette()[0] }, { label: 'Previous period', data: prev, color: palette()[5], dash: [5, 4] }] });
  };
  drawCmp('rev'); bindSeg(root, 'cmp', drawCmp);

  // E / F. Top 10
  const metricOf = (key) => (key === 'by_revenue' ? ['rev', 'inr', 'Revenue'] : key === 'by_awb' ? ['awb', 'int', 'AWB'] : ['wt', 'kg', 'Weight']);
  const drawTop = (canvasId, list, key, nameFn, color) => { const [mk, kind, lbl] = metricOf(key);
    barChart(root.querySelector(canvasId), { horizontal: true, kind, labels: list.map(nameFn), series: [{ label: lbl, data: list.map((x) => x[mk]), color }] }); };
  const tc = (key) => drawTop('#ch-tc', d.top_customers[key], key, (x) => x.name || x.code, palette()[1]);
  const ts = (key) => drawTop('#ch-ts', d.top_sales[key], key, (x) => x.name, palette()[0]);
  tc('by_revenue'); bindSeg(root, 'tc', tc); ts('by_revenue'); bindSeg(root, 'ts', ts);

  // Insights
  const best = (arr, key) => arr.reduce((b, x) => (isNil(x[key]) ? b : !b || x[key] > b[key] ? x : b), null);
  const months = rollup(daily, 'monthly'); const bd = best(daily, 'rev') || best(daily, 'awb'); const bm = best(months, 'rev') || best(months, 'awb');
  const workDays = daily.filter((x) => parseISO(x.d).getDay() !== 0);
  const ins = [
    ['Best performing day', bd ? `${dmy(bd.d)} – ${isNil(bd.rev) ? int(bd.awb) + ' AWBs' : inr(bd.rev)}` : '—'],
    ['Best performing month', bm ? `${monLabel(bm.d)} – ${isNil(bm.rev) ? int(bm.awb) + ' AWBs' : inrShort(bm.rev)}` : '—'],
    ['Average bookings per working day', workDays.length ? int(workDays.reduce((a, x) => a + x.awb, 0) / workDays.length) + ' AWBs' : '—'],
    ['Average revenue per working day', workDays.length && !isNil(k.revenue) ? inr(workDays.reduce((a, x) => a + n(x.rev), 0) / workDays.length) : '—'],
    ['Revenue per KG', isNil(revKg) ? '—' : inr(revKg)],
    ['Revenue per AWB', isNil(revAwb) ? '—' : inr(revAwb)],
    ['Average weight per AWB', isNil(avgWt) || isNil(k.weight) ? '—' : kg(avgWt)],
    ['Zero-value AWBs (cancelled / RTO etc.)', int(k.zero_revenue)],
  ];
  setHTML(root.querySelector('#insights'), html`<div class="kv">${ins.map(([a, b]) => html`<div>${a}</div><div><b>${b}</b></div>`)}</div>`);
  barChart(root.querySelector('#ch-svc'), { horizontal: true, kind: 'int', labels: d.services.map((x) => x.name), series: [{ label: 'AWBs', data: d.services.map((x) => x.awb), color: palette()[4] }] });

  if (!daily.length) root.querySelector('#ch-trend').closest('.chart-box').innerHTML = emptyState('No bookings in the selected period. Change the date range or filters.');
}

function renderToday(el, daily) {
  if (!daily.length) { el.innerHTML = `<div><h3>Daily business summary</h3><div class="muted">No bookings in range</div></div>`; return; }
  const today = new Date().toLocaleDateString('en-CA');
  const ref = daily.at(-1);
  const prev = [...daily].reverse().find((x) => x.d < ref.d && parseISO(x.d).getDay() !== 0) || null;
  const isToday = ref.d === today;
  const diff = prev && !isNil(ref.rev) ? ref.rev - n(prev.rev) : null;
  const g = prev ? growth(isNil(ref.rev) ? ref.awb : ref.rev, isNil(ref.rev) ? prev.awb : prev.rev) : null;
  setHTML(el, html`<div><h3>${isToday ? "Today's business" : 'Latest business day'}</h3><div class="muted" style="font-size:12.5px">${dmy(ref.d)}${isToday ? '' : ' (latest booking date in range)'}</div></div>
    <div><div class="s-label">Bookings</div><div class="s-val">${int(ref.awb)}</div></div>
    <div><div class="s-label">Weight</div><div class="s-val">${kgShort(ref.wt)}</div></div>
    <div><div class="s-label">Revenue</div><div class="s-val">${isNil(ref.rev) ? '—' : inrShort(ref.rev)}</div></div>
    <div><div class="s-label">Previous working day ${prev ? '(' + dmy(prev.d) + ')' : ''}</div><div class="s-val">${prev ? int(prev.awb) + ' AWBs' : '—'}</div></div>
    <div><div class="s-label">Revenue difference · growth</div><div class="s-val">${raw(diff === null ? '—' : `${esc((diff >= 0 ? '+' : '−') + inrShort(Math.abs(diff)))} <span class="trend ${g > 0 ? 'up' : g < 0 ? 'down' : 'flat'}" style="font-size:14px">${esc(pct(g))}</span>`)}</div></div>`);
}
