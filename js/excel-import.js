// =====================================================================
// SKYNET EXPRESS – excel-import.js : Excel Data Import module
//  1 Upload  2 Read sheets / detect header  3 Validate required columns
//  4 Normalise headings + field mapping  5 Preview  6 Validate values
//  7 In-file duplicates (latest-record-wins)  8 Compare with database
//  9 Summary  10 Confirm  11 Batched UPSERT  12 Report + error download
//
//  DUPLICATE RULE (documented): AWB NUMBER is the unique key.
//   * Same AWB several times in ONE file -> the row with the LATEST
//     CREATED DATE wins; if dates are equal the row LOWER in the sheet wins.
//     Superseded rows are listed in the error report as DUPLICATE.
//   * AWB not in database -> INSERT.  AWB already in database -> UPDATE
//     with the file's data (before-image is kept for rollback).
//   * Records missing from a new file are NEVER deleted.
// =====================================================================
import { rpc, sb } from './api.js';
import * as filtersMod from './filters.js';
import { appState } from './app.js';
import { isAdmin, can } from './permissions.js';
import { panel } from './ui.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, int, dmy, dmyTime, pad, exportExcel, emptyState, confirmDialog, modal, closeOverlays, isNil, inr, kg } from './utils.js';

// ---------------------------------------------------------------- field mapping
export const FIELDS = {
  awb_number: { label: 'AWB Number', required: true, aliases: ['AWB NUMBER', 'AWB NO', 'AWB NO.', 'AWB', 'AWB #', 'AIRWAY BILL NUMBER', 'AIRWAYBILL NO', 'DOCKET NUMBER', 'DOCKET NO'] },
  booking_date: { label: 'Booking Date', required: true, aliases: ['CREATED DATE', 'BOOKING DATE', 'BOOKING DT', 'CREATED ON', 'BOOKED ON', 'CREATION DATE'] },
  customer_name: { label: 'Customer Name', rec: true, aliases: ['CUSTOMER NAME', 'CLIENT NAME', 'CUSTOMER'] },
  customer_code: { label: 'Customer Code', rec: true, aliases: ['CUSTOMER CODE', 'CLIENT CODE', 'CUST CODE', 'CUSTOMER ID'] },
  customer_type: { label: 'Customer Type', aliases: ['CUSTOMER TYPE'] },
  shipper_city: { label: 'Shipper City', aliases: ['SHIPPER CITY', 'ORIGIN CITY'] },
  shipper_state: { label: 'Shipper State', aliases: ['SHIPPER STATE', 'ORIGIN STATE'] },
  shipper_country: { label: 'Shipper Country', aliases: ['SHIPPER COUNTRY'] },
  destination_country: { label: 'Destination Country', rec: true, aliases: ['CONSIGNEE COUNTRY', 'DESTINATION COUNTRY', 'DEST COUNTRY', 'DESTINATION'] },
  destination_city: { label: 'Destination City', aliases: ['CONSIGNEE CITY', 'DESTINATION CITY'] },
  service_name: { label: 'Service', aliases: ['SERVICE NAME', 'SERVICE'] },
  vendor_name: { label: 'Vendor', aliases: ['VENDOR NAME'] },
  product_name: { label: 'Product', aliases: ['PRODUCT NAME', 'PRODUCT'] },
  awb_state: { label: 'AWB State', aliases: ['AWB STATE', 'AWB STATUS', 'SHIPMENT STATUS'] },
  entry_type: { label: 'Entry Type', aliases: ['ENTRY TYPE'] },
  pcs: { label: 'PCS', num: true, int: true, aliases: ['PCS', 'PIECES', 'NO OF PCS'] },
  actual_weight: { label: 'Actual Weight', num: true, aliases: ['ACTUAL WEIGHT', 'ACTUAL WT', 'ACTUAL WT.(KG.)'] },
  volumetric_weight: { label: 'Volumetric Weight', num: true, aliases: ['VOLUMETRIC WEIGHT', 'VOLUMETRIC WT', 'VOL WEIGHT'] },
  chargeable_weight: { label: 'Chargeable Weight (KG)', num: true, rec: true, aliases: ['CHARGEABLE WT.(KG.)', 'CHARGEABLE WT (KG)', 'CHARGEABLE WEIGHT', 'CHARGEABLE WT', 'CHG WT', 'CHARGED WEIGHT'] },
  shipment_value: { label: 'Shipment Value (declared)', num: true, aliases: ['SHIPMENT VALUE', 'DECLARED VALUE'] },
  shipment_currency: { label: 'Shipment Currency', aliases: ['SHIPMENT CURRENCY', 'CURRENCY'] },
  customer_freight: { label: 'Customer Freight', num: true, aliases: ['CUSTOMER FREIGHT'] },
  customer_other_charges: { label: 'Customer Other Charges', num: true, aliases: ['CUSTOMER OTHER CHARGE TOTAL', 'OTHER CHARGES'] },
  sales_fsc_percent: { label: 'Sales FSC %', num: true, aliases: ['SALES FSC %', 'FSC %'] },
  customer_taxable_amount: { label: 'Customer Taxable Amount', num: true, aliases: ['CUSTOMER TAXABLE AMOUNT', 'TAXABLE AMOUNT'] },
  customer_cgst: { label: 'Customer CGST', num: true, aliases: ['CUSTOMER CGST', 'CGST'] },
  customer_sgst: { label: 'Customer SGST', num: true, aliases: ['CUSTOMER SGST', 'SGST'] },
  customer_igst: { label: 'Customer IGST', num: true, aliases: ['CUSTOMER IGST', 'IGST'] },
  customer_grand_total: { label: 'Customer Grand Total (revenue)', num: true, rec: true, aliases: ['CUSTOMER GRAND TOTAL', 'GRAND TOTAL', 'TOTAL AMOUNT', 'NET AMOUNT'] },
  salesperson_name: { label: 'Salesperson', rec: true, aliases: ['SALESMAN NAME', 'SALESPERSON', 'SALES PERSON', 'SALESPERSON NAME', 'SALES EXECUTIVE'] },
  origin_hub_code: { label: 'Origin Hub Code', rec: true, aliases: ['ORIGIN HUB CODE', 'HUB CODE', 'ORIGIN HUB CD'] },
  is_hold: { label: 'Hold Status', rec: true, aliases: ['IS HOLD?', 'IS HOLD', 'HOLD', 'HOLD STATUS', 'ON HOLD'] },
};
/** "ORIGIN HUB CODE\n" -> "ORIGIN HUB CODE" (display) ; loose key for matching */
export const normHeader = (h) => String(h ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
export const looseKey = (h) => normHeader(h).replace(/[^A-Z0-9%]/g, '');
const ALIAS = new Map(); for (const [f, def] of Object.entries(FIELDS)) for (const a of def.aliases) ALIAS.set(looseKey(a), f);

export function autoMap(headers, custom = {}) {
  const used = new Set(); const map = {};
  headers.forEach((h, i) => {
    const lk = looseKey(h); if (!lk) return;
    const f = custom[lk] || ALIAS.get(lk);
    if (f && FIELDS[f] && !used.has(f)) { map[i] = f; used.add(f); }
  });
  return map; // colIndex -> field
}

// ---------------------------------------------------------------- value parsing
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function validYMD(y, m, d) { if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null; const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null; }
/** Indian convention: ambiguous dates are DD/MM/YYYY */
export function parseDate(v) {
  if (isNil(v) || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return validYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') { if (v < 20000 || v > 80000) return null; const d = new Date(Math.round((v - 25569) * 864e5)); return validYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return validYMD(y, +m[2], +m[1]); }
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/); if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3})[A-Za-z]*[\s\-/,]+(\d{2,4})/); if (m && MONTHS[m[2].toUpperCase()]) { let y = +m[3]; if (y < 100) y += 2000; return validYMD(y, MONTHS[m[2].toUpperCase()], +m[1]); }
  return null;
}
export function parseNum(v) {
  if (isNil(v) || v === '') return { v: null, ok: true };
  if (typeof v === 'number') return { v: Number.isFinite(v) ? v : null, ok: Number.isFinite(v) };
  const s = String(v).replace(/[₹,\s]/g, '').replace(/^INR/i, '');
  if (s === '' || s === '-') return { v: null, ok: true };
  const x = Number(s); return Number.isFinite(x) ? { v: x, ok: true } : { v: null, ok: false };
}
export function parseHold(v) {
  if (isNil(v) || v === '') return { v: false, ok: true };
  if (typeof v === 'boolean') return { v, ok: true };
  const s = String(v).trim().toUpperCase();
  if (['YES', 'Y', 'TRUE', '1', 'HOLD', 'ON HOLD', 'HOLD YES'].includes(s)) return { v: true, ok: true };
  if (['NO', 'N', 'FALSE', '0', 'UNHOLD', 'UN HOLD', 'RELEASED', 'NA', 'N/A', '-'].includes(s)) return { v: false, ok: true };
  return { v: false, ok: false };
}
function awbText(v) {
  if (isNil(v)) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace(/\.0+$/, '');
  return String(v).trim().replace(/\.0+$/, '').replace(/\s+/g, '');
}
function rawValue(v) {
  if (v instanceof Date && !isNaN(v)) return `${pad(v.getDate())}-${pad(v.getMonth() + 1)}-${v.getFullYear()}` + (v.getHours() || v.getMinutes() ? ` ${pad(v.getHours())}:${pad(v.getMinutes())}` : '');
  if (typeof v === 'string') return v.trim();
  return v ?? null;
}
const r3 = (x) => (isNil(x) ? null : Math.round(x * 1000) / 1000);
const r2 = (x) => (isNil(x) ? null : Math.round(x * 100) / 100);

/** Convert one sheet row -> shipment record + issues */
export function transformRow(row, headers, map, rowNo, fx) {
  const issues = []; const rec = { data_quality_flags: [] }; const rawObj = {};
  headers.forEach((h, i) => { if (h) rawObj[h] = rawValue(row[i]); });
  for (const [ci, f] of Object.entries(map)) {
    const v = row[ci]; const def = FIELDS[f];
    if (f === 'awb_number') rec.awb_number = awbText(v);
    else if (f === 'booking_date') { rec.booking_date = parseDate(v); if (!rec.booking_date) issues.push(['ERROR', f, `Invalid or blank ${headers[ci]}: "${rawValue(v) ?? ''}"`]); }
    else if (f === 'is_hold') { const h = parseHold(v); rec.is_hold = h.v; if (!h.ok) { issues.push(['WARNING', f, `Unrecognised hold value "${v}" – treated as NO`]); rec.data_quality_flags.push('HOLD_VALUE_UNKNOWN'); } }
    else if (def.num) {
      const p = parseNum(v);
      if (!p.ok) { issues.push(['WARNING', f, `Non-numeric ${headers[ci]}: "${v}" – stored as blank`]); rec.data_quality_flags.push('NUMBER_INVALID'); }
      rec[f] = def.int ? (isNil(p.v) ? null : Math.round(p.v)) : f.includes('weight') ? r3(p.v) : r2(p.v);
    } else rec[f] = isNil(v) || String(v).trim() === '' ? null : String(rawValue(v)).trim();
  }
  if (!rec.awb_number) issues.push(['ERROR', 'awb_number', 'AWB NUMBER is blank']);
  if (rec.origin_hub_code) rec.origin_hub_code = rec.origin_hub_code.toUpperCase();
  if (!isNil(rec.chargeable_weight) && rec.chargeable_weight < 0) issues.push(['ERROR', 'chargeable_weight', 'Negative chargeable weight']);
  if (isNil(rec.chargeable_weight)) { rec.chargeable_weight = 0; rec.data_quality_flags.push('WEIGHT_BLANK'); issues.push(['WARNING', 'chargeable_weight', 'Chargeable weight blank – stored as 0']); }
  if (isNil(rec.customer_grand_total)) { rec.customer_grand_total = 0; rec.data_quality_flags.push('GRAND_TOTAL_BLANK'); issues.push(['WARNING', 'customer_grand_total', 'Customer grand total blank – stored as ₹0']); }
  if (!rec.salesperson_name) { rec.salesperson_name = null; rec.data_quality_flags.push('SALESMAN_BLANK'); issues.push(['WARNING', 'salesperson_name', 'Salesman name blank – shown as Unassigned']); }
  if (!rec.customer_code && !rec.customer_name) { rec.data_quality_flags.push('CUSTOMER_BLANK'); issues.push(['WARNING', 'customer_code', 'Customer code and name blank']); }
  else if (!rec.customer_code) rec.customer_code = rec.customer_name; // keep grouping stable
  if (rec.is_hold === undefined) rec.is_hold = false;
  // billing currency (CUSTOMER GRAND TOTAL is INR unless the business owner says otherwise)
  rec.billing_currency = fx.currency; rec.fx_rate_to_inr = fx.rate; rec.grand_total_original = rec.customer_grand_total;
  if (fx.currency !== 'INR') rec.customer_grand_total = r2(rec.customer_grand_total * fx.rate);
  rec.raw_excel_data = rawObj;
  return { rec, issues, rowNo };
}

// ---------------------------------------------------------------- state
const S = { step: 1, file: null, wb: null, sheet: null, headerRow: 0, headers: [], rows: [], map: {}, result: null, existing: null, importing: false };
const STEP_NAMES = ['Upload', 'Sheet & headers', 'Column mapping', 'Preview', 'Validate & compare', 'Import', 'Report'];

export async function render(root) {
  Object.assign(S, { step: 1, file: null, wb: null, sheet: null, headers: [], rows: [], map: {}, result: null, existing: null, importing: false });
  root.innerHTML = `${panel({ title: 'Excel data import', sub: 'Upload the booking report (.xlsx / .xls / .csv). Existing AWBs are updated, new AWBs inserted – nothing is deleted.', body: '<div class="steps" id="steps"></div><div id="stage"></div>' })}
    ${panel({ title: 'Import history', sub: 'Every import is logged. Admins can roll back an import (restores previous values, removes AWBs it inserted).', cls: 'mt', body: '<div id="hist"></div>' })}`;
  drawSteps(root); stageUpload(root); loadHistory(root);
}
function drawSteps(root) {
  setHTML(root.querySelector('#steps'), html`${STEP_NAMES.map((n_, i) => html`<span class="step ${i + 1 === S.step ? 'on' : i + 1 < S.step ? 'done' : ''}"><i>${i + 1 < S.step ? '✓' : i + 1}</i>${n_}</span>`)}`);
}
const go = (root, n_) => { S.step = n_; drawSteps(root); };

// ---- 1. upload
function stageUpload(root) {
  go(root, 1);
  const st = root.querySelector('#stage');
  setHTML(st, html`<label class="dropzone" id="dz" tabindex="0"><input type="file" id="file" accept=".xlsx,.xls,.xlsm,.csv" hidden>
      <i data-lucide="file-spreadsheet"></i><h3 style="margin-top:10px">Drop the Excel file here or click to browse</h3>
      <p class="muted">Main sheet "Worksheet" is detected automatically · max ${appState.settings.max_upload_mb || 30} MB · file is processed in your browser</p></label>`);
  const dz = st.querySelector('#dz'), inp = st.querySelector('#file');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) readFile(root, e.dataTransfer.files[0]); });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') inp.click(); });
  inp.addEventListener('change', () => { if (inp.files[0]) readFile(root, inp.files[0]); });
}

async function readFile(root, file) {
  const maxMb = Number(appState.settings.max_upload_mb) || 30;
  if (!/\.(xlsx|xls|xlsm|csv)$/i.test(file.name)) return toast('Only .xlsx, .xls, .xlsm or .csv files are accepted.', 'err');
  if (file.size > maxMb * 1048576) return toast(`File is larger than ${maxMb} MB.`, 'err');
  if (!window.XLSX) return toast('Excel library is still loading – try again in a moment.', 'err');
  const st = root.querySelector('#stage');
  setHTML(st, html`<div class="empty"><i data-lucide="loader"></i><div>Reading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…</div></div>`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const buf = await file.arrayBuffer();
    S.wb = window.XLSX.read(buf, { type: 'array', cellDates: true, dense: true, cellFormula: false, cellHTML: false });
    S.file = file;
    stageSheet(root);
  } catch (e) { toast('Could not read the file: ' + errMsg(e), 'err'); stageUpload(root); }
}

// ---- 2. sheet + header detection
function sheetRows(name) { return window.XLSX.utils.sheet_to_json(S.wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }); }
function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const keys = (rows[i] || []).map(looseKey);
    if (keys.some((k) => ALIAS.get(k) === 'awb_number')) return i;
  }
  return 0;
}
function stageSheet(root) {
  go(root, 2);
  const names = S.wb.SheetNames;
  const info = names.map((n_) => { const ref = S.wb.Sheets[n_]['!ref']; const rng = ref ? window.XLSX.utils.decode_range(ref) : null; return { n: n_, rows: rng ? rng.e.r : 0, cols: rng ? rng.e.c + 1 : 0 }; });
  const def = names.find((x) => x.toLowerCase() === 'worksheet') || info.sort((a, b) => b.rows - a.rows)[0].n;
  const st = root.querySelector('#stage');
  setHTML(st, html`<div class="grid g-2"><div>
      <label class="field"><span>Sheet to import (${names.length} sheet${names.length > 1 ? 's' : ''} found)</span>
        <select class="select" id="sheet">${info.map((x) => html`<option value="${x.n}" ${x.n === def ? raw('selected') : ''}>${x.n} – ~${int(x.rows)} data rows, ${x.cols} columns</option>`)}</select></label>
      <div class="notice info"><i data-lucide="info"></i><div>The header row is detected automatically (the row containing "AWB NUMBER"). Headings are normalised – extra spaces and line breaks such as in <b>"ORIGIN HUB CODE↵"</b> are removed.</div></div>
    </div><div class="kv"><div>File</div><div>${S.file.name}</div><div>Size</div><div>${(S.file.size / 1048576).toFixed(2)} MB</div><div>Last modified</div><div>${dmyTime(S.file.lastModified)}</div></div></div>
    <div class="mt" style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="back">Choose another file</button><button class="btn btn-primary" id="next"><i data-lucide="arrow-right"></i>Detect columns</button></div>`);
  st.querySelector('#back').onclick = () => stageUpload(root);
  st.querySelector('#next').onclick = () => {
    S.sheet = st.querySelector('#sheet').value;
    const all = sheetRows(S.sheet);
    if (all.length < 2) return toast('This sheet has no data rows.', 'err');
    S.headerRow = detectHeader(all);
    S.headers = (all[S.headerRow] || []).map(normHeader);
    // make duplicate headings unique so no column is lost
    const seen = {}; S.headers = S.headers.map((h, i) => { h = h || `COLUMN ${i + 1}`; seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h} (${seen[h]})` : h; });
    S.rows = all.slice(S.headerRow + 1).filter((r) => r && r.some((c) => !isNil(c) && String(c).trim() !== ''));
    S.map = autoMap(S.headers, appState.settings.field_mappings || {});
    stageMapping(root);
  };
}

// ---- 3/4. mapping
function stageMapping(root) {
  go(root, 3);
  const st = root.querySelector('#stage');
  const mappedFields = new Set(Object.values(S.map));
  const missingReq = Object.entries(FIELDS).filter(([f, d]) => d.required && !mappedFields.has(f));
  const missingRec = Object.entries(FIELDS).filter(([f, d]) => d.rec && !mappedFields.has(f));
  const opts = (sel) => `<option value="">— keep in raw data only —</option>` + Object.entries(FIELDS).map(([f, d]) => `<option value="${f}" ${f === sel ? 'selected' : ''}>${esc(d.label)}${d.required ? ' *' : ''}</option>`).join('');
  setHTML(st, html`
    <div class="stat-tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="stat-tile"><small>Data rows</small><b>${int(S.rows.length)}</b></div>
      <div class="stat-tile"><small>Columns detected</small><b>${S.headers.length}</b></div>
      <div class="stat-tile"><small>Mapped to dashboard fields</small><b>${Object.keys(S.map).length}</b></div>
      <div class="stat-tile"><small>Preserved in raw data</small><b>${S.headers.length}</b></div></div>
    ${missingReq.length ? html`<div class="notice mt"><i data-lucide="triangle-alert"></i><div><b>Required column missing:</b> ${missingReq.map(([, d]) => d.label).join(', ')}. Map it below to continue.</div></div>` : ''}
    ${missingRec.length ? html`<div class="notice info mt"><i data-lucide="info"></i><div>Not found (optional, dashboards will show blanks): ${missingRec.map(([, d]) => d.label).join(', ')}.</div></div>` : ''}
    <div class="table-wrap mt" style="max-height:420px"><table class="data map-table"><thead><tr><th>#</th><th>Excel heading (normalised)</th><th>Sample value</th><th>Dashboard field</th></tr></thead><tbody>
      ${S.headers.map((h, i) => html`<tr><td class="muted">${i + 1}</td><td><b>${h}</b></td><td class="muted">${String(rawValue(S.rows.find((r) => !isNil(r[i]))?.[i]) ?? '').slice(0, 40)}</td>
        <td><select class="select" data-col="${i}">${raw(opts(S.map[i]))}</select></td></tr>`)}</tbody></table></div>
    <div class="mt" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${isAdmin() || can('app_settings') ? raw('<button class="btn" id="save-map"><i data-lucide="save"></i>Save mapping for future files</button>') : ''}
      <button class="btn" id="back">Back</button><button class="btn btn-primary" id="next"><i data-lucide="eye"></i>Preview data</button></div>`);
  st.querySelectorAll('select[data-col]').forEach((s) => s.addEventListener('change', () => {
    const col = s.dataset.col, f = s.value;
    if (f) for (const [c, ff] of Object.entries(S.map)) if (ff === f && c !== col) { delete S.map[c]; const o = st.querySelector(`select[data-col="${c}"]`); if (o) o.value = ''; }
    if (f) S.map[col] = f; else delete S.map[col];
  }));
  st.querySelector('#back').onclick = () => stageSheet(root);
  st.querySelector('#save-map')?.addEventListener('click', async () => {
    const custom = { ...(appState.settings.field_mappings || {}) };
    for (const [c, f] of Object.entries(S.map)) { const lk = looseKey(S.headers[c]); if (ALIAS.get(lk) !== f) custom[lk] = f; }
    try { await rpc('set_setting', { p_key: 'field_mappings', p_value: custom }); appState.settings.field_mappings = custom; toast('Column mapping saved. Future files with these headings map automatically.', 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); }
  });
  st.querySelector('#next').onclick = () => {
    const mf = new Set(Object.values(S.map));
    const miss = Object.entries(FIELDS).filter(([f, d]) => d.required && !mf.has(f));
    if (miss.length) return toast('Map the required columns first: ' + miss.map(([, d]) => d.label).join(', '), 'err');
    stagePreview(root);
  };
}

// ---- 5. preview
function stagePreview(root) {
  go(root, 4);
  const fields = Object.entries(S.map).sort((a, b) => a[0] - b[0]);
  const fx = { currency: 'INR', rate: 1 };
  const sample = S.rows.slice(0, 15).map((r, i) => transformRow(r, S.headers, S.map, i, fx).rec);
  const st = root.querySelector('#stage');
  setHTML(st, html`<p class="muted">First 15 of ${int(S.rows.length)} rows after mapping and normalisation (dates shown DD-MM-YYYY, weights in KG, amounts in ₹).</p>
    <div class="table-wrap" style="max-height:440px"><table class="data"><thead><tr>${fields.map(([, f]) => html`<th>${FIELDS[f].label}</th>`)}</tr></thead><tbody>
      ${sample.map((r) => html`<tr>${fields.map(([, f]) => html`<td class="${FIELDS[f].num ? 'right num' : ''}">${f === 'booking_date' ? (r[f] ? dmy(r[f]) : raw('<span class="badge hold">invalid</span>')) : f === 'is_hold' ? (r[f] ? 'YES' : 'NO') : f === 'customer_grand_total' ? inr(r[f]) : f.includes('weight') ? kg(r[f]) : r[f] ?? '—'}</td>`)}</tr>`)}</tbody></table></div>
    <div class="mt" style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="back">Back to mapping</button><button class="btn btn-primary" id="next"><i data-lucide="shield-check"></i>Validate & check duplicates</button></div>`);
  st.querySelector('#back').onclick = () => stageMapping(root);
  st.querySelector('#next').onclick = () => stageValidate(root);
}

// ---- 6-9. validate + duplicates + compare
async function stageValidate(root) {
  go(root, 5);
  const st = root.querySelector('#stage');
  setHTML(st, html`<div class="empty"><i data-lucide="loader"></i><div id="vmsg">Validating ${int(S.rows.length)} rows…</div></div>`);
  await new Promise((r) => setTimeout(r, 30));
  const fxDefault = { currency: 'INR', rate: 1 };
  const out = [], issues = [];
  S.rows.forEach((row, i) => {
    const rowNo = S.headerRow + 2 + i; // Excel row number
    const t = transformRow(row, S.headers, S.map, rowNo, fxDefault);
    t.issues.forEach(([type, field, message]) => issues.push({ row: rowNo, awb: t.rec.awb_number || '', type, field, message }));
    t.row = row; out.push(t);
  });
  const valid = out.filter((t) => !t.issues.some((x) => x[0] === 'ERROR'));
  const failed = out.length - valid.length;
  // latest-record-wins inside the file
  const best = new Map(); let dupRows = 0;
  for (const t of valid) {
    const k = t.rec.awb_number; const cur = best.get(k);
    if (!cur) { best.set(k, t); continue; }
    dupRows++;
    const winner = t.rec.booking_date > cur.rec.booking_date || (t.rec.booking_date === cur.rec.booking_date && t.rowNo > cur.rowNo) ? t : cur;
    const loser = winner === t ? cur : t;
    best.set(k, winner);
    issues.push({ row: loser.rowNo, awb: k, type: 'DUPLICATE', field: 'awb_number', message: `Duplicate AWB in file – superseded by row ${winner.rowNo} (latest CREATED DATE wins; tie → lower row wins)` });
  }
  const finalRows = [...best.values()];
  // compare with database
  const awbs = finalRows.map((t) => t.rec.awb_number); const existing = new Set();
  try {
    for (let i = 0; i < awbs.length; i += 5000) {
      st.querySelector('#vmsg').textContent = `Comparing with database… ${int(Math.min(i + 5000, awbs.length))} / ${int(awbs.length)}`;
      (await rpc('import_check_existing', { p_awbs: awbs.slice(i, i + 5000) }, { silent: true })).forEach((a) => existing.add(a));
    }
  } catch (e) { toast('Could not compare with database: ' + errMsg(e), 'err'); stagePreview(root); return; }
  S.result = { finalRows, issues, failed, dupRows, existing, total: S.rows.length };
  const warn = issues.filter((x) => x.type === 'WARNING').length;
  const newCount = finalRows.filter((t) => !existing.has(t.rec.awb_number)).length;
  let fxList = [{ currency: 'INR', rate_to_inr: 1 }];
  try { const { data } = await sb().from('exchange_rates').select('currency,rate_to_inr'); if (data?.length) fxList = data; } catch (_) { /* INR only */ }
  const defCur = appState.settings.billing_currency || 'INR';
  const dates = finalRows.map((t) => t.rec.booking_date).sort();
  setHTML(st, html`
    <div class="stat-tiles">
      <div class="stat-tile"><small>Total rows</small><b>${int(S.result.total)}</b></div>
      <div class="stat-tile"><small>New AWBs (insert)</small><b style="color:var(--good)">${int(newCount)}</b></div>
      <div class="stat-tile"><small>Existing AWBs (update)</small><b style="color:var(--accent-2)">${int(finalRows.length - newCount)}</b></div>
      <div class="stat-tile"><small>Duplicate rows in file</small><b style="color:var(--warn)">${int(dupRows)}</b></div>
      <div class="stat-tile"><small>Failed / invalid rows</small><b style="color:var(--bad)">${int(failed)}</b></div>
      <div class="stat-tile"><small>Rows with warnings</small><b>${int(new Set(issues.filter((x) => x.type === 'WARNING').map((x) => x.row)).size)}</b></div>
    </div>
    <div class="kv mt"><div>Booking dates in file</div><div>${dmy(dates[0])} → ${dmy(dates.at(-1))}</div>
      <div>Records to write</div><div><b>${int(finalRows.length)}</b> (unique AWBs) in batches of ${appState.settings.import_batch_size || 500}</div>
      <div>Issues found</div><div>${int(failed)} errors · ${int(warn)} warnings · ${int(dupRows)} duplicates – none are silently discarded; download the report below.</div></div>
    <div class="grid g-2 mt"><div>
      <label class="field"><span>Billing currency of CUSTOMER GRAND TOTAL</span><select class="select" id="cur">${fxList.map((r) => html`<option value="${r.currency}" data-rate="${r.rate_to_inr}" ${r.currency === defCur ? raw('selected') : ''}>${r.currency}${r.currency === 'INR' ? ' (no conversion)' : ' @ ₹ ' + r.rate_to_inr}</option>`)}</select></label>
      <p class="muted" style="font-size:12px;margin-top:-6px">Keep INR unless the business owner confirmed amounts are billed in another currency. Approved rates are managed in Application Settings; originals are preserved.</p>
    </div><div><label class="check" style="margin-top:28px"><input type="checkbox" id="ok"> I have reviewed the summary. Update ${int(finalRows.length - newCount)} existing and insert ${int(newCount)} new AWBs.</label></div></div>
    <div class="mt" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${issues.length ? raw('<button class="btn" id="dl"><i data-lucide="download"></i>Download issues (Excel)</button>') : ''}
      <button class="btn" id="back">Back</button><button class="btn btn-primary" id="go" ${finalRows.length ? '' : 'disabled'}><i data-lucide="upload"></i>Import ${int(finalRows.length)} records</button></div>`);
  st.querySelector('#back').onclick = () => stagePreview(root);
  st.querySelector('#dl')?.addEventListener('click', () => downloadIssues(issues, S.file.name));
  st.querySelector('#go').onclick = () => {
    if (!st.querySelector('#ok').checked) return toast('Tick the confirmation box first.', 'err');
    const o = st.querySelector('#cur').selectedOptions[0];
    runImport(root, { currency: o.value, rate: Number(o.dataset.rate) || 1 });
  };
}

function downloadIssues(issues, fileName) {
  exportExcel('Import_issues_' + fileName.replace(/\.[^.]+$/, '').replace(/\W+/g, '_'), [{ name: 'Issues', rows: issues,
    columns: [{ key: 'row', label: 'Excel Row', type: 'num' }, { key: 'awb', label: 'AWB Number', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'field', label: 'Field', type: 'text' }, { key: 'message', label: 'Message', type: 'text' }] }]);
}

// ---- 10-12. import
async function runImport(root, fx) {
  if (S.importing) return; S.importing = true;
  go(root, 6);
  const st = root.querySelector('#stage');
  const { finalRows, issues, failed, dupRows } = S.result;
  const recs = finalRows.map((t) => { const r = transformRow(t.row, S.headers, S.map, t.rowNo, fx); return { rec: r.rec, rowNo: t.rowNo }; });
  const batch = Math.min(2000, Math.max(50, Number(appState.settings.import_batch_size) || 500));
  setHTML(st, html`<h3>Importing ${int(recs.length)} records…</h3><p class="muted">Keep this tab open. Each batch is committed safely; a failing batch is split to isolate bad rows.</p>
    <div class="progress mt"><i id="bar"></i></div><div class="mt" id="pmsg">Starting…</div>`);
  let importId;
  try {
    importId = await rpc('import_begin', { p_file: S.file.name, p_sheet: S.sheet, p_total: S.result.total, p_billing_currency: fx.currency,
      p_meta: { header_row: S.headerRow + 1, columns: S.headers.length, mapping: Object.fromEntries(Object.entries(S.map).map(([c, f]) => [S.headers[c], f])), rule: 'latest CREATED DATE wins; tie -> lower row' } });
  } catch (e) { S.importing = false; toast(errMsg(e), 'err'); stageValidate(root); return; }
  let ins = 0, upd = 0, done = 0; const failedRows = [];
  const bar = st.querySelector('#bar'), msg = st.querySelector('#pmsg');
  const send = async (chunk) => {
    try { const r = await rpc('import_batch', { p_import_id: importId, p_rows: chunk.map((c) => c.rec) }, { silent: true }); ins += r.inserted; upd += r.updated; done += chunk.length; }
    catch (e) {
      if (chunk.length > 1 && !/not authorised|not running/i.test(e.message)) { const mid = Math.ceil(chunk.length / 2); await send(chunk.slice(0, mid)); await send(chunk.slice(mid)); }
      else { chunk.forEach((c) => failedRows.push({ row: c.rowNo, awb: c.rec.awb_number, type: 'ERROR', field: 'database', message: errMsg(e) })); done += chunk.length; }
    }
    bar.style.width = ((done / recs.length) * 100).toFixed(1) + '%';
    msg.textContent = `${int(done)} / ${int(recs.length)} processed · ${int(ins)} inserted · ${int(upd)} updated · ${int(failedRows.length)} failed`;
  };
  for (let i = 0; i < recs.length; i += batch) await send(recs.slice(i, i + batch));
  const allIssues = [...issues, ...failedRows];
  const totalFailed = failed + failedRows.length;
  const status = ins + upd === 0 && totalFailed > 0 ? 'failed' : totalFailed > 0 ? 'partial' : 'completed';
  let log = null;
  try { log = await rpc('import_finish', { p_import_id: importId, p_status: status, p_stats: { total_rows: S.result.total, duplicate_records: dupRows, failed_records: totalFailed, warnings: issues.filter((x) => x.type === 'WARNING').length }, p_errors: allIssues.filter((x) => x.type !== 'WARNING').concat(allIssues.filter((x) => x.type === 'WARNING')).slice(0, 5000) }); }
  catch (e) { toast('Import finished but log could not be closed: ' + errMsg(e), 'err'); }
  S.importing = false;
  go(root, 7);
  setHTML(st, html`<div class="notice ${status === 'completed' ? 'info' : ''}"><i data-lucide="${status === 'completed' ? 'circle-check' : 'triangle-alert'}"></i><div><b>Import ${status}</b> – import #${importId}, ${S.file.name}</div></div>
    <div class="stat-tiles mt">
      <div class="stat-tile"><small>Total rows</small><b>${int(S.result.total)}</b></div>
      <div class="stat-tile"><small>Inserted (new)</small><b style="color:var(--good)">${int(ins)}</b></div>
      <div class="stat-tile"><small>Updated (existing)</small><b style="color:var(--accent-2)">${int(upd)}</b></div>
      <div class="stat-tile"><small>Duplicate rows in file</small><b style="color:var(--warn)">${int(dupRows)}</b></div>
      <div class="stat-tile"><small>Failed</small><b style="color:var(--bad)">${int(totalFailed)}</b></div>
      <div class="stat-tile"><small>Status</small><b style="text-transform:capitalize">${status}</b></div></div>
    <div class="mt" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${allIssues.length ? raw('<button class="btn" id="dl"><i data-lucide="download"></i>Download error report (Excel)</button>') : ''}
      <a class="btn" href="#/dashboard"><i data-lucide="layout-dashboard"></i>Open dashboard</a>
      <button class="btn btn-primary" id="again"><i data-lucide="upload"></i>Import another file</button></div>`);
  st.querySelector('#dl')?.addEventListener('click', () => downloadIssues(allIssues, S.file.name));
  st.querySelector('#again').onclick = () => render(root.closest('.page') || root);
  toast(`Import ${status}: ${int(ins)} inserted, ${int(upd)} updated, ${int(totalFailed)} failed.`, status === 'completed' ? 'ok' : 'info', 7000);
  try { await filtersMod.loadOptions(); filtersMod.renderFilterBar(document.querySelector('#filterbar')); filtersMod.syncTopControls(); } catch (_) { /* ignore */ }
  loadHistory(root);
  void log;
}

// ---------------------------------------------------------------- history + rollback
async function loadHistory(root) {
  const el = root.querySelector('#hist'); if (!el) return;
  try {
    const r = await rpc('get_import_logs', { p_page: 1, p_size: 50 }, { silent: true });
    if (!r.rows.length) { setHTML(el, raw(emptyState('No imports yet.', 'file-spreadsheet'))); return; }
    setHTML(el, html`<div class="table-wrap"><table class="data responsive"><thead><tr><th>#</th><th>File</th><th>Uploaded</th><th>By</th><th class="right">Rows</th><th class="right">New</th><th class="right">Updated</th><th class="right">Duplicates</th><th class="right">Failed</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.rows.map((x) => html`<tr><td data-label="#">${x.id}</td><td data-label="File">${x.file_name}</td><td data-label="Uploaded">${dmyTime(x.uploaded_at)}</td><td data-label="By">${x.uploaded_by_name || ''}</td>
        <td class="right num" data-label="Rows">${int(x.total_rows)}</td><td class="right num" data-label="New">${int(x.new_records)}</td><td class="right num" data-label="Updated">${int(x.updated_records)}</td>
        <td class="right num" data-label="Duplicates">${int(x.duplicate_records)}</td><td class="right num" data-label="Failed">${int(x.failed_records)}</td>
        <td data-label="Status"><span class="badge ${x.status === 'completed' ? 'ok' : x.status === 'rolled_back' ? 'mute' : x.status === 'running' ? 'info' : 'warn'}">${x.status.replace('_', ' ')}</span></td>
        <td data-label="">${x.error_count ? html`<button class="btn btn-sm" data-err="${x.id}" data-file="${x.file_name}"><i data-lucide="download"></i>Issues</button>` : ''}
          ${isAdmin() && x.status !== 'rolled_back' ? html`<button class="btn btn-sm btn-danger" data-rb="${x.id}"><i data-lucide="undo-2"></i>Roll back</button>` : ''}</td></tr>`)}</tbody></table></div>`);
    el.querySelectorAll('[data-err]').forEach((b) => b.addEventListener('click', async () => { const errs = await rpc('get_import_errors', { p_import_id: Number(b.dataset.err) }); downloadIssues(errs, b.dataset.file); }));
    el.querySelectorAll('[data-rb]').forEach((b) => b.addEventListener('click', () => rollbackDialog(root, Number(b.dataset.rb))));
  } catch (e) { setHTML(el, raw(emptyState(errMsg(e), 'circle-alert'))); }
  icons(el);
}
function rollbackDialog(root, id) {
  const m = modal({ title: `Roll back import #${id}`,
    body: `<p>AWBs inserted by this import will be <b>deleted</b> and AWBs it updated will be <b>restored</b> to their previous values. Records changed again by a later import are skipped to protect newer data. This action is logged.</p>
      <label class="field"><span>Reason (required)</span><textarea class="input" id="rb-reason" maxlength="300"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rb-go"><i data-lucide="undo-2"></i>Roll back import</button>` });
  icons(m);
  m.querySelector('#rb-go').onclick = async () => {
    const reason = m.querySelector('#rb-reason').value.trim(); if (reason.length < 3) return toast('Enter a reason.', 'err');
    try { const r = await rpc('import_rollback', { p_import_id: id, p_reason: reason }); closeOverlays(); toast(`Rolled back: ${int(r.deleted)} deleted, ${int(r.restored)} restored, ${int(r.skipped)} skipped.`, 'ok', 7000); loadHistory(root); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
}
export { confirmDialog };
