// =====================================================================
// SKYNET EXPRESS – shipments.js : PAGE 5 – Daily Sales & Shipment Report
// Server-side pagination / sorting, hold management, AWB detail drawer,
// Excel export of the full filtered set, print, date-wise reports.
// =====================================================================
import { rpc } from './api.js';
import { can } from './permissions.js';
import { panel, fmtCell, clientTable } from './ui.js';
import { inr, int, kg, dmy, dmyTime, esc, html, raw, setHTML, icons, toast, errMsg, drawer, modal, closeOverlays, emptyState, holdBadge, exportExcel, debounce, isNil, loading } from './utils.js';
import { getOptions } from './filters.js';

export const SHIP_COLUMNS = [
  { key: 'awb_number', label: 'AWB Number', type: 'text' },
  { key: 'booking_date', label: 'Booking Date', type: 'date' },
  { key: 'customer_name', label: 'Customer', type: 'text' },
  { key: 'customer_code', label: 'Customer Code', type: 'text' },
  { key: 'shipper_city', label: 'Shipper City', type: 'text' },
  { key: 'shipper_state', label: 'Shipper State', type: 'text' },
  { key: 'destination_country', label: 'Destination Country', type: 'text' },
  { key: 'chargeable_weight', label: 'Weight KG', type: 'kg' },
  { key: 'revenue', label: 'Revenue ₹', type: 'inr' },
  { key: 'salesperson_name', label: 'Salesperson', type: 'text' },
  { key: 'origin_hub_code', label: 'Origin Hub', type: 'text' },
  { key: 'is_hold', label: 'Hold Status', type: 'hold' },
];
const EXPORT_COLS = [...SHIP_COLUMNS.map((c) => ({ ...c, type: c.type === 'hold' ? 'text' : c.type, get: c.key === 'is_hold' ? (r) => (r.is_hold ? 'YES' : 'NO') : c.key === 'salesperson_name' ? (r) => r.salesperson_name || 'Unassigned' : undefined })),
  { key: 'awb_state', label: 'AWB State', type: 'text' }, { key: 'service_name', label: 'Service', type: 'text' }, { key: 'pcs', label: 'PCS', type: 'num' }];

/** Fetch every row of a filtered set in chunks (export) */
export async function fetchAll(f, onProgress) {
  const size = 5000; let page = 1, all = [], total = 0;
  do {
    const r = await rpc('get_shipments', { f, p_page: page, p_size: size, p_sort: 'booking_date', p_dir: 'asc' }, { silent: true });
    total = r.total; all = all.concat(r.rows); page++;
    if (onProgress) onProgress(all.length, total);
    if (all.length >= 300000) break;
  } while (all.length < total);
  return all;
}

/** Server-side paginated shipment table, reusable in drill-downs */
export function serverTable(container, getFilters, { pageSize = 25, compact = false, exportName = 'Shipments', onLoaded } = {}) {
  const st = { page: 1, size: pageSize, sort: 'booking_date', dir: 'desc' };
  const cols = compact ? SHIP_COLUMNS.filter((c) => !['customer_code', 'shipper_state', 'shipper_city'].includes(c.key)) : SHIP_COLUMNS;
  setHTML(container, html`<div class="table-wrap"><table class="data responsive"><thead></thead><tbody></tbody></table></div><div class="pager"></div>`);
  const thead = container.querySelector('thead'), tbody = container.querySelector('tbody'), pager = container.querySelector('.pager');
  let last = null;
  async function load() {
    tbody.innerHTML = `<tr><td colspan="${cols.length}"><div class="skel" style="height:160px"></div></td></tr>`;
    try {
      last = await rpc('get_shipments', { f: getFilters(), p_page: st.page, p_size: st.size, p_sort: st.sort, p_dir: st.dir });
    } catch (e) { tbody.innerHTML = `<tr><td colspan="${cols.length}">${emptyState(errMsg(e), 'circle-alert')}</td></tr>`; icons(); return; }
    const pages = Math.max(1, Math.ceil(last.total / st.size));
    thead.innerHTML = '<tr>' + cols.map((c) => { const k = c.key === 'revenue' ? 'revenue' : c.key;
      return `<th class="sortable ${['kg', 'inr'].includes(c.type) ? 'right' : ''}" data-k="${k}" scope="col">${esc(c.label)}<span class="sort-ind">${st.sort === k ? (st.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>`; }).join('') + '</tr>';
    tbody.innerHTML = last.rows.length ? last.rows.map((r) => `<tr>${cols.map((c) => {
      if (c.key === 'awb_number') return `<td data-label="AWB"><button class="awb-link" data-awb="${esc(r.awb_number)}">${esc(r.awb_number)}</button></td>`;
      if (c.key === 'salesperson_name' && !r.salesperson_name) return `<td data-label="${esc(c.label)}"><span class="badge mute">Unassigned</span></td>`;
      return `<td class="${['kg', 'inr'].includes(c.type) ? 'right num' : ''}" data-label="${esc(c.label)}">${fmtCell(c.type, r[c.key], r)}</td>`; }).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}">${emptyState()}</td></tr>`;
    pager.innerHTML = `<span>${int(last.total)} AWBs · Weight ${esc(kg(last.summary.weight))} · Revenue ${esc(inr(last.summary.revenue))}</span>
      <span class="pages"><select class="select" data-size aria-label="Rows per page">${[25, 50, 100, 200].map((s) => `<option ${s === st.size ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-sm" data-p="first" ${st.page <= 1 ? 'disabled' : ''} aria-label="First page"><i data-lucide="chevrons-left"></i></button>
      <button class="btn btn-sm" data-p="prev" ${st.page <= 1 ? 'disabled' : ''} aria-label="Previous page"><i data-lucide="chevron-left"></i></button>
      <span>Page ${int(st.page)} / ${int(pages)}</span>
      <button class="btn btn-sm" data-p="next" ${st.page >= pages ? 'disabled' : ''} aria-label="Next page"><i data-lucide="chevron-right"></i></button>
      <button class="btn btn-sm" data-p="last" ${st.page >= pages ? 'disabled' : ''} aria-label="Last page"><i data-lucide="chevrons-right"></i></button></span>`;
    icons(container);
    if (onLoaded) onLoaded(last);
  }
  thead.addEventListener('click', (e) => { const th = e.target.closest('th'); if (!th) return; const k = th.dataset.k;
    if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = k; st.dir = ['chargeable_weight', 'revenue', 'booking_date'].includes(k) ? 'desc' : 'asc'; } st.page = 1; load(); });
  pager.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; const pages = Math.max(1, Math.ceil(last.total / st.size));
    st.page = { first: 1, prev: st.page - 1, next: st.page + 1, last: pages }[b.dataset.p]; load(); });
  pager.addEventListener('change', (e) => { if (e.target.matches('[data-size]')) { st.size = Number(e.target.value); st.page = 1; load(); } });
  tbody.addEventListener('click', (e) => { const b = e.target.closest('[data-awb]'); if (b) openAwb(b.dataset.awb, load); });
  load();
  return { reload: () => { st.page = 1; return load(); }, last: () => last,
    async exportAll() {
      if (!can('excel_export')) return toast('Excel export is not permitted for your account.', 'err');
      const total = last?.total ?? 0; if (!total) return toast('Nothing to export.', 'info');
      toast(`Preparing ${int(total)} rows…`, 'info'); loading(true);
      try { const rows = await fetchAll(getFilters()); exportExcel(exportName, [{ name: 'Shipments', rows, columns: EXPORT_COLS }]); toast(`Exported ${int(rows.length)} AWBs.`, 'ok'); }
      catch (e) { toast(errMsg(e), 'err'); } finally { loading(false); }
    } };
}

// ------------------------------------------------------------ page
export async function render(root, { filters }) {
  const opts = getOptions();
  const local = { awb_state: '', search: '' };
  root.innerHTML = `
    <div class="stat-tiles" id="hold-tiles">${'<div class="skel" style="height:70px"></div>'.repeat(6)}</div>
    ${panel({ title: 'Shipment register', sub: 'Every AWB matching the global filters', cls: 'mt',
      tools: `${can('excel_export') ? '<button class="btn" id="exp"><i data-lucide="download"></i>Export filtered data</button>' : ''}
        <button class="btn" id="dw"><i data-lucide="calendar-range"></i>Date-wise reports</button>
        <button class="btn" id="prt"><i data-lucide="printer"></i>Print</button>`,
      body: html`<div class="table-tools">
          <div class="input-icon grow"><i data-lucide="search"></i><input class="input" id="s-awb" placeholder="Search AWB number, customer name or code" aria-label="Search AWB"></div>
          <select class="select" id="s-state" style="width:220px" aria-label="AWB state"><option value="">All AWB states</option>${opts.awb_states.map((x) => html`<option>${x}</option>`)}</select>
        </div><div id="tbl"></div>`.html })}`;
  const getF = () => filters.params(local);
  const tbl = serverTable(root.querySelector('#tbl'), getF, { exportName: 'SKYNET_Shipment_Report', onLoaded: (r) => renderTiles(root.querySelector('#hold-tiles'), r) });
  root.querySelector('#s-awb').addEventListener('input', debounce((e) => { local.search = e.target.value.trim(); tbl.reload(); }, 400));
  root.querySelector('#s-state').addEventListener('change', (e) => { local.awb_state = e.target.value; tbl.reload(); });
  root.querySelector('#exp')?.addEventListener('click', () => tbl.exportAll());
  root.querySelector('#prt').addEventListener('click', () => window.print());
  root.querySelector('#dw').addEventListener('click', () => datewiseReports(getF));
  icons(root);
}

function renderTiles(el, r) {
  const s = r.summary; const f = r.flags;
  setHTML(el, html`
    <div class="stat-tile"><small>Hold shipments</small><b style="color:var(--bad)">${int(s.hold)}</b></div>
    <div class="stat-tile"><small>Unhold shipments</small><b style="color:var(--good)">${int(s.unhold)}</b></div>
    <div class="stat-tile"><small>Hold weight</small><b>${f.weight ? kg(s.hold_weight ?? 0) : '—'}</b></div>
    <div class="stat-tile"><small>Unhold weight</small><b>${f.weight ? kg(s.unhold_weight ?? 0) : '—'}</b></div>
    <div class="stat-tile"><small>Hold revenue</small><b>${f.revenue ? inr(s.hold_revenue ?? 0) : '—'}</b></div>
    <div class="stat-tile"><small>Unhold revenue</small><b>${f.revenue ? inr(s.unhold_revenue ?? 0) : '—'}</b></div>`);
}

async function datewiseReports(getF) {
  const m = modal({ title: 'Date-wise reports', wide: true,
    body: `<div class="seg" id="dw-seg"><button class="on" data-t="date">Date-wise revenue & weight</button><button data-t="customer">Date-wise customer bookings</button><button data-t="salesperson">Date-wise salesperson</button></div>
      <div id="dw-body" class="mt"><div class="skel" style="height:240px"></div></div>` });
  const COLS = {
    date: [{ key: 'd', label: 'Booking Date', type: 'date' }, { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'customers', label: 'Customers', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' }, { key: 'hold', label: 'Hold', type: 'int' }],
    customer: [{ key: 'd', label: 'Booking Date', type: 'date' }, { key: 'code', label: 'Customer Code', type: 'text' }, { key: 'name', label: 'Customer', type: 'text' }, { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' }],
    salesperson: [{ key: 'd', label: 'Booking Date', type: 'date' }, { key: 'name', label: 'Salesperson', type: 'text' }, { key: 'awb', label: 'AWB Count', type: 'int' }, { key: 'wt', label: 'Weight KG', type: 'kg' }, { key: 'rev', label: 'Revenue ₹', type: 'inr' }],
  };
  const load = async (t) => {
    const body = m.querySelector('#dw-body'); body.innerHTML = '<div class="skel" style="height:240px"></div>';
    try { const rows = await rpc('get_datewise_report', { f: getF(), p_type: t });
      clientTable(body, { columns: COLS[t], rows, pageSize: 15, exportName: 'SKYNET_Datewise_' + t, exportSheet: 'Date-wise ' + t, sort: { key: 'd', dir: 'asc' } }); }
    catch (e) { body.innerHTML = emptyState(errMsg(e), 'circle-alert'); icons(body); }
  };
  m.querySelector('#dw-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; m.querySelectorAll('#dw-seg button').forEach((x) => x.classList.toggle('on', x === b)); load(b.dataset.t); });
  load('date');
}

// ------------------------------------------------------------ AWB detail
export async function openAwb(awb, onChanged) {
  const d = drawer({ title: 'AWB ' + awb, sub: 'Complete shipment information', body: '<div class="skel" style="height:420px"></div>' });
  let res;
  try { res = await rpc('get_shipment_detail', { p_awb: awb }); }
  catch (e) { setHTML(d.querySelector('.drawer-body'), raw(emptyState(errMsg(e), 'lock'))); return; }
  const s = res.shipment, rawData = res.raw || {};
  const body = d.querySelector('.drawer-body');
  setHTML(body, html`
    <div class="detail-hero">
      <div><small>Booking date</small><b>${dmy(s.booking_date)}</b></div>
      <div><small>Chargeable weight</small><b>${'chargeable_weight' in s ? kg(s.chargeable_weight) : 'Restricted'}</b></div>
      <div><small>Customer grand total</small><b>${'customer_grand_total' in s ? inr(s.customer_grand_total) : 'Restricted'}</b></div>
      <div><small>Hold status</small><b>${raw(holdBadge(s.is_hold))}</b></div>
    </div>
    <div class="kv">
      <div>Customer</div><div>${s.customer_name || '—'} (${s.customer_code || '—'})</div>
      <div>Salesperson</div><div>${s.salesperson_name || 'Unassigned'}</div>
      <div>Origin hub</div><div>${s.origin_hub_code || '—'}</div>
      <div>Route</div><div>${s.shipper_city || '—'}, ${s.shipper_state || '—'} → ${s.destination_country || '—'}</div>
      <div>Service · AWB state</div><div>${s.service_name || '—'} · ${s.awb_state || '—'}</div>
      ${'customer_freight' in s ? html`<div>Freight + other charges</div><div>${inr(s.customer_freight)} + ${inr(s.customer_other_charges)} (FSC ${s.sales_fsc_percent ?? 0}%)</div>
      <div>Taxable · CGST · SGST · IGST</div><div>${inr(s.customer_taxable_amount)} · ${inr(s.customer_cgst)} · ${inr(s.customer_sgst)} · ${inr(s.customer_igst)}</div>
      <div>Billing currency</div><div>${s.billing_currency}${s.billing_currency !== 'INR' ? ` (original ${s.grand_total_original} @ ${s.fx_rate_to_inr})` : ''}</div>` : ''}
      ${s.data_quality_flags?.length ? html`<div>Data quality flags</div><div>${s.data_quality_flags.join(', ')}</div>` : ''}
    </div>
    <div class="mt" style="display:flex;gap:8px;flex-wrap:wrap">
      ${res.can_change_hold ? raw(`<button class="btn ${s.is_hold ? 'btn-blue' : 'btn-primary'}" id="hold-btn"><i data-lucide="${s.is_hold ? 'circle-play' : 'circle-pause'}"></i>${s.is_hold ? 'Release hold (set NO)' : 'Put on hold (set YES)'}</button>`) : ''}
      ${can('excel_export') ? raw('<button class="btn" id="awb-xls"><i data-lucide="download"></i>Download AWB report</button>') : ''}
      <button class="btn" id="awb-print"><i data-lucide="printer"></i>Print</button>
    </div>
    <div class="section-title">All Excel fields (${Object.keys(rawData).length})</div>
    <div class="kv" id="raw-kv">${Object.entries(rawData).map(([k, v]) => html`<div>${k}</div><div>${v === null || v === '' ? '—' : String(v)}</div>`)}</div>
    <div class="section-title">Status history</div>
    ${res.history.length ? html`<div class="table-wrap"><table class="data"><thead><tr><th>Date & time</th><th>Change</th><th>By</th><th>Remarks</th></tr></thead><tbody>
      ${res.history.map((h) => html`<tr><td>${dmyTime(h.created_at)}</td><td>${h.old_value?.is_hold ?? ''} → ${h.new_value?.is_hold ?? ''}</td><td>${h.user_name || ''}</td><td>${h.remarks || ''}</td></tr>`)}</tbody></table></div>`
      : raw('<p class="muted">No manual status changes recorded.</p>')}`);
  body.querySelector('#hold-btn')?.addEventListener('click', () => holdDialog(s, onChanged));
  body.querySelector('#awb-print').addEventListener('click', () => printAwb(s, rawData));
  body.querySelector('#awb-xls')?.addEventListener('click', () => exportExcel('AWB_' + s.awb_number, [{ name: 'AWB ' + s.awb_number, rows: Object.entries(rawData).map(([k, v]) => ({ k, v })), columns: [{ key: 'k', label: 'Field', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }] }]));
}

function holdDialog(s, onChanged) {
  const toHold = !s.is_hold;
  const m = modal({ title: (toHold ? 'Put AWB on hold' : 'Release hold') + ' – ' + s.awb_number,
    body: `<p>Status will change from <b>${s.is_hold ? 'YES (Hold)' : 'NO (Unhold)'}</b> to <b>${toHold ? 'YES (Hold)' : 'NO (Unhold)'}</b>. This change is recorded in the audit log.</p>
      <label class="field"><span>Remarks (required)</span><textarea class="input" id="hold-rem" maxlength="500" placeholder="Reason for the change"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="hold-save">${toHold ? 'Set YES (Hold)' : 'Set NO (Unhold)'}</button>` });
  m.querySelector('#hold-save').addEventListener('click', async () => {
    const rem = m.querySelector('#hold-rem').value.trim();
    if (rem.length < 3) return toast('Please enter remarks (at least 3 characters).', 'err');
    try { await rpc('set_hold_status', { p_awb: s.awb_number, p_hold: toHold, p_remarks: rem }); closeOverlays(); toast(`AWB ${s.awb_number} set to ${toHold ? 'YES (Hold)' : 'NO (Unhold)'}.`, 'ok'); if (onChanged) onChanged(); }
    catch (e) { toast(errMsg(e), 'err'); }
  });
}

function printAwb(s, rawData) {
  const w = window.open('', '_blank', 'width=900,height=700'); if (!w) return toast('Allow pop-ups to print.', 'err');
  const rows = Object.entries(rawData).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v ?? '')}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>AWB ${esc(s.awb_number)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%}td{border:1px solid #ccc;padding:4px 8px}td:first-child{width:35%;background:#f4f4f4}</style></head>
    <body><img src="${location.href.split('#')[0].replace(/[^/]*$/, '')}assets/images/skynet-logo-transparent.png" style="height:48px"><h1>Shipment report – AWB ${esc(s.awb_number)}</h1><p>Printed ${esc(dmyTime(new Date()))}</p><table>${rows}</table></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}
