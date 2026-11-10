// =====================================================================
// SKYNET EXPRESS – filters.js : global filter system (all pages)
// Values come dynamically from the database (get_filter_options) –
// hubs, salespersons, countries and customers are never hard-coded.
// =====================================================================
import { rpc } from './api.js';
import { $, esc, setHTML, html, raw, addDays, monthStart, dmy, storageGet, storageSet, toast } from './utils.js';

const KEY = 'skynet_filters_v1';
const EMPTY = { from: '', to: '', preset: 'last30', hub: '', customer_name: '', customer_code: '', salesperson: '', country: '', hold: '' };
export const state = { ...EMPTY, ...(storageGet(KEY, {}) || {}) };
let options = { hubs: [], salespersons: [], countries: [], customers: [], awb_states: [], services: [] };
let applyHandler = () => {};

export function onApply(fn) { applyHandler = fn; }
export function getOptions() { return options; }
export async function loadOptions() {
  options = await rpc('get_filter_options', {}, { silent: true });
  if (!state.from || !state.to) applyPreset(state.preset || 'last30', false);
  return options;
}

/** Filters as sent to the database functions (empty values removed) */
export function params(extra = {}) {
  const o = {};
  for (const k of ['from', 'to', 'hub', 'customer_name', 'customer_code', 'salesperson', 'country', 'hold']) if (state[k]) o[k] = state[k];
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v !== null && v !== undefined) o[k] = v;
  return o;
}

export function applyPreset(p, fire = true) {
  const max = options.max_date || new Date().toISOString().slice(0, 10);
  const min = options.min_date || max;
  state.preset = p;
  if (p === 'latest') { state.from = max; state.to = max; }
  else if (p === 'last7') { state.from = addDays(max, -6); state.to = max; }
  else if (p === 'last30') { state.from = addDays(max, -29); state.to = max; }
  else if (p === 'this_month') { state.from = monthStart(max); state.to = max; }
  else if (p === 'last_month') { const lmEnd = addDays(monthStart(max), -1); state.from = monthStart(lmEnd); state.to = lmEnd; }
  else if (p === 'last90') { state.from = addDays(max, -89); state.to = max; }
  else if (p === 'all') { state.from = min; state.to = max; }
  if (state.from < min && p !== 'custom') { /* keep – previous-period comparison still valid */ }
  syncTopControls();
  if (fire) apply();
}

export function apply() {
  if (state.from && state.to && state.from > state.to) { toast('Start date must be before end date.', 'err'); return; }
  storageSet(KEY, state);
  renderChips();
  applyHandler();
}
export function reset() {
  Object.assign(state, EMPTY);
  applyPreset('last30', false);
  const bar = $('#filterbar'); if (bar) renderFilterBar(bar);
  apply();
}

// ---------- Top bar (date range + origin hub) ----------
export function bindTopControls() {
  const f = $('#date-from'), t = $('#date-to'), h = $('#hub-select');
  syncTopControls();
  f.addEventListener('change', () => { state.from = f.value; state.preset = 'custom'; syncPresetSelect(); apply(); });
  t.addEventListener('change', () => { state.to = t.value; state.preset = 'custom'; syncPresetSelect(); apply(); });
  h.addEventListener('change', () => { state.hub = h.value; apply(); });
}
export function syncTopControls() {
  const f = $('#date-from'), t = $('#date-to'), h = $('#hub-select');
  if (!f) return;
  f.value = state.from || ''; t.value = state.to || '';
  if (options.min_date) { f.min = t.min = ''; }
  setHTML(h, html`<option value="">All Hubs</option>${options.hubs.map((x) => html`<option value="${x}" ${x === state.hub ? raw('selected') : ''}>${x}</option>`)}`);
  syncPresetSelect();
}
function syncPresetSelect() { const p = $('#flt-preset'); if (p) p.value = state.preset || 'custom'; }

// ---------- Filter bar ----------
export function renderFilterBar(el) {
  const sp = options.salespersons || [];
  setHTML(el, html`
    <label class="field"><span>Period</span>
      <select class="select" id="flt-preset">
        <option value="latest">Latest booking day</option><option value="last7">Last 7 days</option>
        <option value="last30">Last 30 days</option><option value="this_month">This month</option>
        <option value="last_month">Last month</option><option value="last90">Last 90 days</option>
        <option value="all">All dates</option><option value="custom">Custom range</option>
      </select></label>
    <label class="field"><span>Customer name</span>
      <input class="input" id="flt-cname" list="dl-cname" placeholder="All customers" value="${state.customer_name}" autocomplete="off"></label>
    <label class="field"><span>Customer code</span>
      <input class="input" id="flt-ccode" list="dl-ccode" placeholder="All codes" value="${state.customer_code}" autocomplete="off"></label>
    <label class="field"><span>Salesperson</span>
      <select class="select" id="flt-sp"><option value="">All salespersons</option>
        ${options.has_unassigned ? html`<option value="__UNASSIGNED__" ${state.salesperson === '__UNASSIGNED__' ? raw('selected') : ''}>(Unassigned)</option>` : ''}
        ${sp.map((x) => html`<option value="${x}" ${x === state.salesperson ? raw('selected') : ''}>${x}</option>`)}</select></label>
    <label class="field"><span>Destination country</span>
      <select class="select" id="flt-country"><option value="">All countries</option>
        ${options.countries.map((x) => html`<option value="${x}" ${x === state.country ? raw('selected') : ''}>${x}</option>`)}</select></label>
    <label class="field"><span>Hold status</span>
      <select class="select" id="flt-hold">
        <option value="">All</option>
        <option value="YES" ${state.hold === 'YES' ? raw('selected') : ''}>YES (Hold)</option>
        <option value="NO" ${state.hold === 'NO' ? raw('selected') : ''}>NO (Unhold)</option></select></label>
    <div class="actions">
      <button class="btn btn-primary" id="flt-apply"><i data-lucide="filter"></i>Apply filters</button>
      <button class="btn" id="flt-reset" title="Reset filters"><i data-lucide="rotate-ccw"></i>Reset</button>
    </div>
    <datalist id="dl-cname">${options.customers.map((c) => html`<option value="${c.name}">${c.code}</option>`)}</datalist>
    <datalist id="dl-ccode">${options.customers.map((c) => html`<option value="${c.code}">${c.name}</option>`)}</datalist>`);
  syncPresetSelect();
  $('#flt-preset', el).addEventListener('change', (e) => { if (e.target.value !== 'custom') applyPreset(e.target.value, false); });
  $('#flt-apply', el).addEventListener('click', () => {
    state.customer_name = $('#flt-cname', el).value.trim();
    state.customer_code = $('#flt-ccode', el).value.trim();
    state.salesperson = $('#flt-sp', el).value;
    state.country = $('#flt-country', el).value;
    state.hold = $('#flt-hold', el).value;
    apply();
  });
  $('#flt-reset', el).addEventListener('click', reset);
  el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#flt-apply', el).click(); }));
}

const LABELS = { hub: 'Hub', customer_name: 'Customer', customer_code: 'Code', salesperson: 'Salesperson', country: 'Country', hold: 'Hold' };
export function renderChips() {
  const el = $('#filter-chips'); if (!el) return;
  const chips = [];
  if (state.from && state.to) chips.push(html`<span class="chip"><i data-lucide="calendar"></i>${dmy(state.from)} → ${dmy(state.to)}</span>`);
  for (const k of Object.keys(LABELS)) {
    if (!state[k]) continue;
    const v = k === 'salesperson' && state[k] === '__UNASSIGNED__' ? '(Unassigned)' : k === 'hold' ? (state[k] === 'YES' ? 'YES (Hold)' : 'NO (Unhold)') : state[k];
    chips.push(html`<span class="chip">${LABELS[k]}: ${v}<button data-clear="${k}" aria-label="Remove ${LABELS[k]} filter"><i data-lucide="x"></i></button></span>`);
  }
  setHTML(el, html`${chips}`);
  el.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    state[b.dataset.clear] = ''; const bar = $('#filterbar'); if (bar) renderFilterBar(bar); syncTopControls(); apply();
  }));
}

/** Programmatic filter change (drill-downs) */
export function setFilter(k, v) { state[k] = v; const bar = $('#filterbar'); if (bar) renderFilterBar(bar); syncTopControls(); apply(); }
export const escAttr = esc;
