// =====================================================================
// SKYNET EXPRESS – filters.js : global filter system (all pages)
// Values come dynamically from the database (get_filter_options) –
// hubs, salespersons, countries and customers are never hard-coded.
// =====================================================================
import { rpc } from './api.js';
import { $, esc, setHTML, html, raw, addDays, monthStart, dmy, storageGet, storageSet, toast, inr, int, isNil } from './utils.js';

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
    <div class="field"><span>Customer name</span>
      <div class="combo" id="cmb-cname">
        <input class="input" id="flt-cname" placeholder="All customers" value="${state.customer_name}" autocomplete="off"
          role="combobox" aria-expanded="false" aria-controls="cmb-cname-list" aria-autocomplete="list">
        <i data-lucide="chevron-down" class="combo-caret"></i>
        <div class="combo-pop hidden" id="cmb-cname-list" role="listbox"></div>
      </div></div>
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
    <datalist id="dl-ccode">${options.customers.map((c) => html`<option value="${c.code}">${c.name} · ${custTotal(c)}</option>`)}</datalist>`);
  bindCustomerCombo(el);
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

// ---------- Customer name combobox: name + code on the left, customer total on the right ----------
const custTotal = (c) => (!isNil(c.rev) ? inr(c.rev) : !isNil(c.awb) ? int(c.awb) + ' AWB' : '');
function bindCustomerCombo(el) {
  const box = $('#cmb-cname', el); if (!box) return;
  const inp = $('#flt-cname', box), pop = $('#cmb-cname-list', box);
  const all = options.customers || [];
  const showRev = all.some((c) => !isNil(c.rev));
  let items = [], active = -1;
  const close = () => { pop.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); active = -1; };
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    items = (q ? all.filter((c) => (c.name || '').toLowerCase().includes(q) || String(c.code || '').toLowerCase().includes(q)) : all)
      .slice().sort((a, b) => (showRev ? (Number(b.rev) || 0) - (Number(a.rev) || 0) : (b.awb || 0) - (a.awb || 0)));
    const shown = items.slice(0, 300);
    const sumRev = items.reduce((t, c) => t + (Number(c.rev) || 0), 0), sumAwb = items.reduce((t, c) => t + (Number(c.awb) || 0), 0);
    setHTML(pop, html`<div class="combo-head"><span>Customer</span><span>${showRev ? 'Total revenue' : 'Total AWBs'}</span></div>
      <div class="combo-body">${shown.length ? shown.map((c, i) => html`<div class="combo-opt" role="option" data-i="${i}" id="cmb-opt-${i}">
          <span class="co-name"><b>${c.name || '(no name)'}</b><small>${c.code || ''} · ${int(c.awb)} AWB</small></span>
          <span class="co-total num">${custTotal(c)}</span></div>`) : html`<div class="combo-empty">No customer matches “${inp.value}”</div>`}
        ${items.length > shown.length ? html`<div class="combo-empty">+ ${int(items.length - shown.length)} more – type to narrow down</div>` : ''}</div>
      <div class="combo-foot"><span>Total · ${int(items.length)} customers</span><b class="num">${showRev ? inr(sumRev) : int(sumAwb) + ' AWB'}</b></div>`);
    pop.classList.remove('hidden'); inp.setAttribute('aria-expanded', 'true'); active = -1;
  };
  const pick = (i) => { const c = items[i]; if (!c) return; inp.value = c.name || ''; close(); };
  const mark = () => pop.querySelectorAll('.combo-opt').forEach((o, i) => { o.classList.toggle('on', i === active); if (i === active) { o.scrollIntoView({ block: 'nearest' }); inp.setAttribute('aria-activedescendant', o.id); } });
  inp.addEventListener('focus', draw);
  inp.addEventListener('input', draw);
  inp.addEventListener('keydown', (e) => {
    const n_ = pop.querySelectorAll('.combo-opt').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (pop.classList.contains('hidden')) draw(); active = Math.min(n_ - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
    else if (e.key === 'Escape') close();
  });
  pop.addEventListener('mousedown', (e) => { const o = e.target.closest('.combo-opt'); if (o) { e.preventDefault(); pick(+o.dataset.i); } });
  box.querySelector('.combo-caret').addEventListener('mousedown', (e) => { e.preventDefault(); if (pop.classList.contains('hidden')) { inp.focus(); draw(); } else close(); });
  inp.addEventListener('blur', () => setTimeout(close, 120));
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
