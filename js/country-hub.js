// =====================================================================
// SKYNET EXPRESS – country-hub.js : PAGE 4 – Country & Hub Analysis
// Destination = CONSIGNEE COUNTRY ; Origin hub = ORIGIN HUB CODE (dynamic)
// =====================================================================
import { rpc } from './api.js';
import { barChart, lineChart, donutChart, palette } from './charts.js';
import { kpiCard, setKpi, TONES, panel, chartBox, seg, bindSeg, skeleton, clientTable, rangeLabel } from './ui.js';
import { inr, inrShort, int, kg, shortDay, isNil, n, html, raw, setHTML, share, emptyState, icons } from './utils.js';

export async function render(root, { filters, isStale }) {
  root.innerHTML = skeleton(5, 4);
  const d = await rpc('get_country_hub', { f: filters.params() });
  if (isStale()) return;
  const p = palette(); const rv = d.flags.revenue;
  let html_ = '';
  if (d.flags.country) html_ += `
    <div class="grid g-2">
      ${panel({ title: 'Top 15 destination countries', sub: rangeLabel(d.range), tools: seg('ctop', [['awb', 'By AWB'], ['rev', 'By revenue'], ['wt', 'By weight']], 'awb'), body: chartBox('ch-ctop', 'tall'), cls: 'watermark' })}
      ${panel({ title: 'Country-wise revenue contribution', sub: 'Top 8 countries vs rest', body: chartBox('ch-cshare', 'tall') })}
    </div>
    <div class="grid g-2-1 mt">
      ${panel({ title: 'Country-wise booking trend', sub: 'Top 5 destinations', tools: seg('ctrend', [['awb', 'AWB'], ['rev', 'Revenue']], 'awb'), body: chartBox('ch-ctrend') })}
      ${panel({ title: 'Country-wise chargeable weight', sub: 'Top 10 destinations (KG)', body: chartBox('ch-cwt') })}
    </div>
    ${panel({ title: 'Destination country table', cls: 'mt', body: '<div id="ctbl"></div>' })}`;
  if (d.flags.hub) html_ += `
    <section class="panel ${d.flags.country ? 'mt' : ''}"><div class="panel-head"><div><h3>Origin hub analysis</h3><div class="sub">Hubs are read from the data – new hubs appear automatically</div></div>
      <div class="tools"><select class="select" id="hub-pick" aria-label="Select hub" style="width:200px"><option value="">All hubs</option>${d.hubs.map((h) => `<option value="${h.hub}">${h.hub}</option>`).join('')}</select></div></div>
      <div class="kpi-grid" id="hub-kpis">
        ${kpiCard({ id: 'h-awb', label: 'Total AWBs', icon: 'package', tone: TONES.red })}${kpiCard({ id: 'h-wt', label: 'Total weight', icon: 'weight', tone: TONES.blue })}
        ${kpiCard({ id: 'h-rev', label: 'Total revenue', icon: 'indian-rupee', tone: TONES.amber })}${kpiCard({ id: 'h-cus', label: 'Total customers', icon: 'building-2', tone: TONES.teal })}
        ${kpiCard({ id: 'h-hold', label: 'Hold shipments', icon: 'circle-pause', tone: TONES.coral })}</div></section>
    <div class="grid g-3 mt">
      ${panel({ title: 'Hub-wise revenue', body: chartBox('ch-hrev', 'short') })}
      ${panel({ title: 'Hub-wise weight', body: chartBox('ch-hwt', 'short') })}
      ${panel({ title: 'Hub-wise shipments', body: chartBox('ch-hawb', 'short') })}
    </div>
    <div class="grid g-2 mt">
      ${panel({ title: 'Hub daily trend', tools: seg('htrend', [['awb', 'AWB'], ['rev', 'Revenue'], ['wt', 'Weight']], 'awb'), body: chartBox('ch-htrend') })}
      ${panel({ title: 'Hub-wise customer contribution', sub: 'Customers per hub and top customers', body: chartBox('ch-hcus', 'short') + '<div id="hub-top" class="mt"></div>' })}
    </div>`;
  html_ += `<div class="grid g-2 mt">
      ${panel({ title: 'Shipper state analysis', tools: seg('st', [['awb', 'AWB'], ['rev', 'Revenue'], ['wt', 'Weight']], 'awb'), body: chartBox('ch-state', 'tall') })}
      ${panel({ title: 'Shipper city analysis', sub: 'Top 30 origin cities', body: '<div id="citytbl"></div>' })}
    </div>`;
  if (!d.flags.country && !d.flags.hub) { root.innerHTML = emptyState('No access', 'lock'); return; }
  root.innerHTML = html_;
  const kindOf = (m) => (m === 'rev' ? 'inr' : m === 'wt' ? 'kg' : 'int');
  const lblOf = (m) => (m === 'rev' ? 'Revenue' : m === 'wt' ? 'Weight' : 'AWBs');

  if (d.flags.country) {
    const co = d.countries;
    const drawTop = (m) => { const list = [...co].sort((a, b) => n(b[m]) - n(a[m])).slice(0, 15);
      barChart(root.querySelector('#ch-ctop'), { horizontal: true, kind: kindOf(m), labels: list.map((c) => c.name), series: [{ label: lblOf(m), data: list.map((c) => c[m]), color: m === 'rev' ? p[2] : m === 'wt' ? p[1] : p[0] }],
        onClick: (i) => filters.setFilter('country', list[i].name) }); };
    drawTop('awb'); bindSeg(root, 'ctop', drawTop);
    const totRev = co.reduce((a, c) => a + n(rv ? c.rev : c.awb), 0); const top8 = [...co].sort((a, b) => n(rv ? b.rev : b.awb) - n(rv ? a.rev : a.awb)).slice(0, 8);
    const rest = totRev - top8.reduce((a, c) => a + n(rv ? c.rev : c.awb), 0);
    donutChart(root.querySelector('#ch-cshare'), { kind: rv ? 'inr' : 'int', labels: [...top8.map((c) => c.name), 'Other countries'], data: [...top8.map((c) => (rv ? c.rev : c.awb)), rest],
      colors: [...p, 'rgba(140,150,180,.45)'], title: int(co.length), sub: 'countries' });
    const drawTrend = (m) => { const days = [...new Set(d.country_daily.map((x) => x.d))].sort(); const names = [...new Set(d.country_daily.map((x) => x.name))];
      lineChart(root.querySelector('#ch-ctrend'), { labels: days.map(shortDay), kind: kindOf(m), area: false,
        series: names.map((nm, i) => ({ label: nm, color: p[i], data: days.map((dd) => d.country_daily.find((x) => x.d === dd && x.name === nm)?.[m] ?? 0) })) }); };
    drawTrend('awb'); bindSeg(root, 'ctrend', drawTrend);
    const wtList = [...co].sort((a, b) => n(b.wt) - n(a.wt)).slice(0, 10);
    barChart(root.querySelector('#ch-cwt'), { kind: 'kg', labels: wtList.map((c) => c.name.length > 12 ? c.name.slice(0, 11) + '…' : c.name), series: [{ label: 'Weight', data: wtList.map((c) => c.wt), color: p[1] }] });
    const tot = co.reduce((a, c) => a + n(c.rev), 0);
    co.forEach((c) => { c.share = tot ? (n(c.rev) / tot) * 100 : null; c.rpk = !isNil(c.rev) && n(c.wt) ? c.rev / c.wt : null; });
    clientTable(root.querySelector('#ctbl'), { rows: co, pageSize: 10, exportName: 'SKYNET_Country_Report', exportSheet: 'Countries', sort: { key: 'awb', dir: 'desc' },
      onRowClick: (c) => filters.setFilter('country', c.name),
      columns: [{ key: 'name', label: 'Destination Country', type: 'text' }, { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' },
        { key: 'rev', label: 'Revenue ₹', type: 'inr' }, { key: 'share', label: 'Revenue Share %', type: 'share' }, { key: 'rpk', label: 'Revenue / KG', type: 'inr', total: false }, { key: 'customers', label: 'Customers', type: 'int', total: false }] });
  }

  if (d.flags.hub) {
    const hubs = d.hubs;
    const setHub = (h) => {
      const list = h ? hubs.filter((x) => x.hub === h) : hubs;
      const s = (k) => (list.every((x) => isNil(x[k])) ? null : list.reduce((a, x) => a + n(x[k]), 0));
      setKpi(root, 'h-awb', s('awb'), int); setKpi(root, 'h-wt', s('wt'), kg); setKpi(root, 'h-rev', s('rev'), inr);
      setKpi(root, 'h-cus', s('customers'), int, h ? '' : '<span>Sum of per-hub customers</span>');
      setKpi(root, 'h-hold', s('hold'), int, `<span>${kg(s('hold_wt'))} on hold</span>`);
    };
    setHub(''); root.querySelector('#hub-pick').addEventListener('change', (e) => setHub(e.target.value));
    const lbl = hubs.map((h) => h.hub);
    barChart(root.querySelector('#ch-hrev'), { kind: 'inr', labels: lbl, series: [{ label: 'Revenue', data: hubs.map((h) => h.rev), colors: lbl.map((_, i) => p[i % 8]) }] });
    barChart(root.querySelector('#ch-hwt'), { kind: 'kg', labels: lbl, series: [{ label: 'Weight', data: hubs.map((h) => h.wt), colors: lbl.map((_, i) => p[i % 8]) }] });
    donutChart(root.querySelector('#ch-hawb'), { labels: lbl, data: hubs.map((h) => h.awb), title: int(hubs.reduce((a, h) => a + h.awb, 0)), sub: 'AWBs' });
    const drawHT = (m) => { const days = [...new Set(d.hub_daily.map((x) => x.d))].sort();
      lineChart(root.querySelector('#ch-htrend'), { labels: days.map(shortDay), kind: kindOf(m), area: false,
        series: lbl.map((h, i) => ({ label: h, color: p[i % 8], data: days.map((dd) => d.hub_daily.find((x) => x.d === dd && x.hub === h)?.[m] ?? 0) })) }); };
    drawHT('awb'); bindSeg(root, 'htrend', drawHT);
    barChart(root.querySelector('#ch-hcus'), { kind: 'int', labels: lbl, series: [{ label: 'Customers', data: hubs.map((h) => h.customers), color: p[3] }] });
    setHTML(root.querySelector('#hub-top'), html`<div class="table-wrap"><table class="data"><thead><tr><th>Hub</th><th>Top customer</th><th class="right">AWBs</th><th class="right">Revenue</th></tr></thead><tbody>
      ${d.hub_top_customers.map((c) => html`<tr><td><span class="badge info">${c.hub}</span></td><td>${c.name || c.code}</td><td class="right num">${int(c.awb)}</td><td class="right num">${isNil(c.rev) ? '—' : inr(c.rev)}</td></tr>`)}</tbody></table></div>`);
  }

  const drawState = (m) => { const list = [...d.states].sort((a, b) => n(b[m]) - n(a[m])).slice(0, 15);
    barChart(root.querySelector('#ch-state'), { horizontal: true, kind: kindOf(m), labels: list.map((s) => s.name), series: [{ label: lblOf(m), data: list.map((s) => s[m]), color: p[4] }] }); };
  drawState('awb'); bindSeg(root, 'st', drawState);
  clientTable(root.querySelector('#citytbl'), { rows: d.cities, pageSize: 10, exportName: 'SKYNET_Shipper_City_Report', exportSheet: 'Cities', sort: { key: 'awb', dir: 'desc' },
    columns: [{ key: 'name', label: 'Shipper City', type: 'text' }, { key: 'state', label: 'State', type: 'text' }, { key: 'awb', label: 'AWBs', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' }] });
  icons(root);
}
export { share, raw };
