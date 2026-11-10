// =====================================================================
// SKYNET EXPRESS – demo.js
// In-browser sandbox that mirrors the Supabase API surface used by the app
// (auth, rpc, from().select(), storage, functions). Synthetic data only;
// everything lives in memory and resets on reload. Open with ?demo=1
// The permission logic here mirrors database/rls-policies.sql + views.sql.
// =====================================================================
import { defaultPermission, PERMISSION_DEFS } from './permissions.js';

// ---------------------------------------------------------------- data
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261102);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
function wpick(pairs) { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = R() * tot; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[0][0]; }
const iso = (d) => d.toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;

const P1 = ['Royal', 'Punjab', 'Global', 'Star', 'Shiv', 'Golden', 'Metro', 'Sai', 'Om', 'Prime', 'Swift', 'Sunrise', 'Blue Sky', 'Amrit', 'Lakshmi', 'National', 'Galaxy', 'Ganga', 'Sterling', 'Unity'];
const P2 = ['Overseas', 'Cargo Movers', 'Logistics', 'Express', 'Courier Services', 'International', 'Exports', 'Forwarders', 'Enterprises', 'Air Links', 'Traders', 'Worldwide'];
const CITIES = [['LUDHIANA', 'PUNJAB', 18], ['NEW DELHI', 'DELHI', 22], ['JALANDHAR', 'PUNJAB', 10], ['AMRITSAR', 'PUNJAB', 8], ['MUMBAI', 'MAHARASHTRA', 9], ['BENGALURU', 'KARNATAKA', 4], ['CHANDIGARH', 'CHANDIGARH', 6], ['GURUGRAM', 'HARYANA', 5], ['NOIDA', 'UTTAR PRADESH', 4], ['JAIPUR', 'RAJASTHAN', 3], ['AHMEDABAD', 'GUJARAT', 3], ['PUNE', 'MAHARASHTRA', 3], ['MOHALI', 'PUNJAB', 4]];
const COUNTRIES = [['AUSTRALIA', 22], ['CANADA', 20], ['UNITED KINGDOM', 14], ['UNITED STATES OF AMERICA', 12], ['NEW ZEALAND', 6], ['UNITED ARAB EMIRATES', 5], ['GERMANY', 3], ['ITALY', 3], ['SINGAPORE', 2], ['FRANCE', 2], ['NETHERLANDS', 2], ['IRELAND', 1.5], ['PORTUGAL', 1], ['SPAIN', 1], ['MALAYSIA', 1], ['JAPAN', 0.6], ['SAUDI ARABIA', 0.8], ['QATAR', 0.6]];
const SERVICES = [['SKYNET SAVER', 24, 320], ['SKYNET PREMIUM DDU', 24, 420], ['SKYNET EX DXB PREMIUM', 12, 380], ['SKYNET CANADA YYZ', 11, 360], ['SKYNET EX SIN PREMIUM', 10, 400], ['SKYNET CANADA YVR', 9, 365], ['EUROPE ECO', 7, 300], ['SKYNET PREMIUM DDP', 2, 520], ['UPS EXPRESS SAVER', 0.5, 650], ['DHL EXPRESS', 0.5, 700]];
const STATES = [['DELIVERED', 58], ['INTRANSIT', 20], ['ENTRY', 9], ['MANIFEST', 5], ['CANCELLED', 2], ['SHIPMENT HOLD', 1.5], ['SHIPMENT UNHOLD', 1.4], ['IN SCAN', 0.7], ['RTO', 0.4], ['UNDELIVERED', 0.2]];
const SALES = ['Aarav Mehta', 'Bhavna Kapoor', 'Chetan Arora', 'Divya Sharma', 'Eshan Gill', 'Farah Khan', 'Gagan Sidhu', 'Heena Bedi', 'Ishaan Rao', 'Jasleen Kaur', 'Kunal Verma', 'Lata Iyer'];

function buildData() {
  const customers = [];
  for (let i = 0; i < 160; i++) {
    const name = `${pick(P1)} ${pick(P2)}${R() < 0.2 ? ' Pvt Ltd' : ''}`;
    const code = 'C' + String(1000 + i * 7);
    const sp = R() < 0.05 ? null : SALES[Math.floor(Math.pow(R(), 1.4) * SALES.length)];
    const hub = R() < 0.84 ? 'DEL' : R() < 0.75 ? 'BOM' : 'BLR';
    const city = wpick(CITIES.map((c) => [c, c[2]]));
    customers.push({ name, code, sp, hub, city, w: 1 / Math.pow(i + 1, 0.95), start: R() < 0.18 ? Math.floor(R() * 60) : 0 });
  }
  const end = new Date(); end.setHours(12); end.setDate(end.getDate() - 1);
  const days = 75, rows = [];
  let awb = 2300000000;
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(end); d.setDate(end.getDate() - k);
    const dow = d.getDay();
    const base = dow === 0 ? 12 : dow === 6 ? 120 : 125;
    const count = Math.round(base * (0.8 + R() * 0.45) * (1 + (days - k) / days * 0.12));
    const eligible = customers.filter((c) => c.start <= days - k);
    const tw = eligible.reduce((a, c) => a + c.w, 0);
    for (let j = 0; j < count; j++) {
      let x = R() * tw, c = eligible[0];
      for (const e of eligible) { x -= e.w; if (x <= 0) { c = e; break; } }
      const svc = wpick(SERVICES.map((s) => [s, s[1]]));
      const wt = Math.max(0.5, Math.round(Math.exp(2.4 + R() * 1.6 - R() * 0.9) * 2) / 2);
      const act = r2(wt * (0.85 + R() * 0.15)), vol = r2(wt * (0.7 + R() * 0.3));
      const state = wpick(STATES);
      const freight = state === 'CANCELLED' ? 0 : r2(wt * svc[2] * (0.85 + R() * 0.3));
      const other = R() < 0.1 ? r2(150 + R() * 400) : 0;
      const taxable = r2(freight + other);
      const igst = R() < 0.75 ? r2(taxable * 0.18) : 0;
      const cgst = igst ? 0 : r2(taxable * 0.09), sgst = cgst;
      const gt = r2(taxable + igst + cgst + sgst);
      const hold = state === 'SHIPMENT HOLD' || R() < 0.004;
      const country = wpick(COUNTRIES);
      const row = {
        awb_number: String(awb++), booking_date: iso(d), customer_name: c.name, customer_code: c.code,
        shipper_city: c.city[0], shipper_state: c.city[1], shipper_country: 'INDIA', destination_country: country,
        service_name: svc[0], awb_state: state, entry_type: wpick([['API', 40], ['PORTAL', 36], ['SOFTWARE', 22], ['EXCEL - PORTAL', 2]]),
        pcs: R() < 0.85 ? 1 : 2 + Math.floor(R() * 3), actual_weight: act, volumetric_weight: vol, chargeable_weight: wt,
        shipment_value: r2(2000 + R() * 30000), shipment_currency: wpick([['INR', 67], ['CAD', 18], ['GBP', 11], ['USD', 4]]),
        customer_freight: freight, customer_other_charges: other, customer_taxable_amount: taxable,
        customer_cgst: cgst, customer_sgst: sgst, customer_igst: igst, customer_grand_total: gt, billing_currency: 'INR', fx_rate_to_inr: 1,
        salesperson_name: c.sp, origin_hub_code: c.hub, is_hold: hold, hold_remarks: null, data_quality_flags: c.sp ? [] : ['SALESMAN_BLANK'],
        first_import_id: 1, last_import_id: 1,
      };
      row.raw_excel_data = {
        'AWB NUMBER': row.awb_number, 'CREATED DATE': row.booking_date.split('-').reverse().join('/'), 'CUSTOMER CODE': c.code, 'CUSTOMER NAME': c.name,
        'SERVICE NAME': svc[0], 'SHIPPER NAME': 'Demo Shipper', 'SHIPPER CITY': c.city[0], 'SHIPPER STATE': c.city[1], 'SHIPPER COUNTRY': 'INDIA',
        'CONSIGNEE NAME': 'Demo Consignee', 'CONSIGNEE COUNTRY': country, 'SHIPMENT VALUE': row.shipment_value, 'SHIPMENT CURRENCY': row.shipment_currency,
        PCS: row.pcs, 'ACTUAL WEIGHT': act, 'VOLUMETRIC WEIGHT': vol, 'CHARGEABLE WT.(KG.)': wt, 'IS HOLD?': hold ? 'YES' : 'NO',
        'CUSTOMER FREIGHT': freight, 'CUSTOMER OTHER CHARGE TOTAL': other, 'CUSTOMER TAXABLE AMOUNT': taxable, 'CUSTOMER CGST': cgst,
        'CUSTOMER SGST': sgst, 'CUSTOMER IGST': igst, 'CUSTOMER GRAND TOTAL': gt, 'ENTRY TYPE': row.entry_type, 'AWB STATE': state,
        'SALESMAN NAME': c.sp || '', 'ORIGIN HUB CODE': c.hub,
      };
      rows.push(row);
    }
  }
  return rows;
}

// ---------------------------------------------------------------- state
const DB = {
  shipments: buildData(),
  profiles: [
    { id: 'u-admin', username: 'admin', full_name: 'Anil Admin', email: 'admin@demo.in', mobile: '9800000001', role: 'admin', assigned_hubs: [], salesperson_names: [], team_salespersons: [], avatar_url: null, is_active: true, preferences: {}, created_at: new Date().toISOString() },
    { id: 'u-mgr', username: 'manager', full_name: 'Meera Manager', email: 'manager@demo.in', mobile: '9800000002', role: 'manager', assigned_hubs: ['BOM', 'BLR'], salesperson_names: [], team_salespersons: ['Divya Sharma', 'Eshan Gill'], avatar_url: null, is_active: true, preferences: {}, created_at: new Date().toISOString() },
    { id: 'u-sales', username: 'aarav', full_name: 'Aarav Mehta', email: 'sales@demo.in', mobile: '9800000003', role: 'sales', assigned_hubs: [], salesperson_names: ['Aarav Mehta'], team_salespersons: [], avatar_url: null, is_active: true, preferences: {}, created_at: new Date().toISOString() },
  ],
  passwords: { 'u-admin': 'Demo@123', 'u-mgr': 'Demo@123', 'u-sales': 'Demo@123' },
  perms: [], // {user_id, permission_key, permission_value}
  targets: [], imports: [], audit: [], versions: [],
  settings: { company_name: 'SKYNET EXPRESS INDIA PVT. LTD.', billing_currency: 'INR', session_timeout_minutes: 30, default_page_size: 25, allow_username_login: true, import_batch_size: 500, field_mappings: {} },
  fx: [{ currency: 'INR', rate_to_inr: 1, effective_date: iso(new Date()), approved_by: 'system' }],
  seq: { target: 1, import: 2, audit: 1 },
};
DB.imports.push({ id: 1, file_name: 'demo-seed (synthetic)', sheet_name: 'Worksheet', total_rows: DB.shipments.length, new_records: DB.shipments.length, updated_records: 0, duplicate_records: 0, failed_records: 0, uploaded_by: 'u-admin', uploaded_by_name: 'Anil Admin', uploaded_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: 'completed', billing_currency: 'INR', errors: [], meta: {}, notes: null });
(() => { const m = DB.shipments.at(-1).booking_date.slice(0, 7) + '-01';
  [['Aarav Mehta', 9000000, 1400, 21000], ['Bhavna Kapoor', 7000000, 1100, 17000], ['Chetan Arora', 5500000, 900, 13000], ['Divya Sharma', 4000000, 650, 9500]]
    .forEach(([s, r, a, w]) => DB.targets.push({ id: DB.seq.target++, salesperson_name: s, target_month: m, revenue_target: r, awb_target: a, weight_target: w, notes: 'Demo target' })); })();

let currentUser = null;
try { const id = sessionStorage.getItem('skynet_demo_uid'); if (id) currentUser = DB.profiles.find((p) => p.id === id) || null; } catch (_) { /* ignore */ }

// ---------------------------------------------------------------- permission mirror
const me = () => currentUser && DB.profiles.find((p) => p.id === currentUser.id);
function getPerm(key) {
  const p = me(); if (!p || !p.is_active) return null;
  if (p.role === 'admin') return defaultPermission('admin', key);
  const o = DB.perms.find((x) => x.user_id === p.id && x.permission_key === key);
  return o ? o.permission_value : defaultPermission(p.role, key);
}
const allows = (k) => ['allow', 'view', 'all', 'assigned', 'own'].includes(getPerm(k));
const isAdmin = () => me()?.role === 'admin' && me()?.is_active;
function dataScope() {
  const p = me(); if (!p || !p.is_active) return 'none'; if (p.role === 'admin') return 'all';
  const rank = { all: 3, assigned: 2, own: 1 };
  const v = Math.min(...['shipment_visibility', 'customer_visibility', 'salesperson_visibility'].map((k) => rank[getPerm(k)] || 0));
  return { 3: 'all', 2: 'assigned', 1: 'own' }[v] || 'none';
}
function canSee(s) {
  const p = me(); if (!p?.is_active) return false; const sc = dataScope();
  if (sc === 'all') return true;
  if (sc === 'assigned') return p.assigned_hubs.includes(s.origin_hub_code) || [...p.team_salespersons, ...p.salesperson_names].includes(s.salesperson_name);
  if (sc === 'own') return p.salesperson_names.includes(s.salesperson_name);
  return false;
}
function deny(msg) { const e = new Error(msg); e.code = '42501'; throw e; }
function assertActive() { if (!me()?.is_active) deny('Not authorised: login required or account inactive'); }
function assertPerm(k) { assertActive(); if (!allows(k)) deny('Not authorised: missing permission ' + k); }
const myName = () => me()?.full_name || me()?.email || 'system';
function audit(action, record_type, record_id, old_value, new_value, remarks) {
  DB.audit.push({ id: DB.seq.audit++, user_id: me()?.id, user_name: myName(), action, record_type, record_id: String(record_id ?? ''), old_value: old_value ?? null, new_value: new_value ?? null, remarks: remarks ?? null, created_at: new Date().toISOString() });
}

// ---------------------------------------------------------------- scoped rows
function scoped(f = {}) {
  const p = me(); if (!p?.is_active) return [];
  const sc = dataScope(); if (sc === 'none') return [];
  const rv = allows('revenue_visibility'), wv = allows('weight_visibility');
  const hold = (f.hold || '').toUpperCase();
  const search = (f.search || '').trim().toLowerCase();
  const out = [];
  for (const s of DB.shipments) {
    if (sc !== 'all' && !canSee(s)) continue;
    if (f.from && s.booking_date < f.from) continue;
    if (f.to && s.booking_date > f.to) continue;
    if (f.hub && s.origin_hub_code !== f.hub) continue;
    if (f.customer_name && s.customer_name !== f.customer_name) continue;
    if (f.customer_code && s.customer_code !== f.customer_code) continue;
    if (f.salesperson && (f.salesperson === '__UNASSIGNED__' ? s.salesperson_name !== null : s.salesperson_name !== f.salesperson)) continue;
    if (f.country && s.destination_country !== f.country) continue;
    if ((hold === 'YES' || hold === 'NO') && s.is_hold !== (hold === 'YES')) continue;
    if (f.awb_state && s.awb_state !== f.awb_state) continue;
    if (f.service && s.service_name !== f.service) continue;
    if (search && !(s.awb_number.toLowerCase().startsWith(search) || (s.customer_name || '').toLowerCase().includes(search) || (s.customer_code || '').toLowerCase().startsWith(search))) continue;
    out.push({ awb_number: s.awb_number, booking_date: s.booking_date, customer_name: s.customer_name, customer_code: s.customer_code,
      shipper_city: s.shipper_city, shipper_state: s.shipper_state, destination_country: s.destination_country, service_name: s.service_name,
      awb_state: s.awb_state, entry_type: s.entry_type, pcs: s.pcs, chargeable_weight: wv ? s.chargeable_weight : null,
      revenue: rv ? s.customer_grand_total : null, salesperson_name: s.salesperson_name, origin_hub_code: s.origin_hub_code, is_hold: s.is_hold });
  }
  return out;
}
const sum = (rows, k) => { let t = null; for (const r of rows) if (r[k] !== null && r[k] !== undefined) t = (t || 0) + Number(r[k]); return t === null ? null : r2(t); };
const distinct = (rows, k) => new Set(rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined)).size;
function group(rows, keyFn) { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
const addDays = (d, k) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return iso(x); };
const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const omitDates = (f) => { const o = { ...f }; delete o.from; delete o.to; return o; };
const byDesc = (k, k2) => (a, b) => (b[k] ?? -Infinity) - (a[k] ?? -Infinity) || (k2 ? (b[k2] ?? 0) - (a[k2] ?? 0) : 0);
function resolveRange(f) {
  let from = f.from, to = f.to;
  if (!from || !to) { const rows = scoped(omitDates(f)); const ds = rows.map((r) => r.booking_date).sort(); from = from || ds[0] || iso(new Date()); to = to || ds.at(-1) || iso(new Date()); }
  if (to < from) throw new Error('End date is before start date');
  const n = diffDays(from, to) + 1;
  return { from, to, days: n, prev_from: addDays(from, -n), prev_to: addDays(from, -1) };
}
const flags = () => ({ revenue: allows('revenue_visibility'), weight: allows('weight_visibility') });
const agg = (rows) => ({ awb: rows.length, wt: sum(rows, 'chargeable_weight'), rev: sum(rows, 'revenue') });
const dailyOf = (rows) => [...group(rows, (r) => r.booking_date)].map(([d, g]) => ({ d, ...agg(g) })).sort((a, b) => a.d.localeCompare(b.d));

// ---------------------------------------------------------------- RPC implementations
const RPC = {
  get_my_context() {
    const p = me(); if (!p) deny('Profile not found');
    const permissions = {}; if (p.is_active) PERMISSION_DEFS.forEach((d) => { permissions[d.key] = getPerm(d.key); });
    return { profile: { ...p }, permissions, scope: dataScope(), server_time: new Date().toISOString() };
  },
  touch_last_login() { const p = me(); if (p) p.last_login_at = new Date().toISOString(); },
  email_for_login({ p_login }) { if (p_login.includes('@')) return p_login; return DB.profiles.find((p) => p.username === p_login.toLowerCase().trim() && p.is_active)?.email || null; },

  get_filter_options() {
    assertActive(); const s = scoped({});
    const uniq = (k) => [...new Set(s.map((r) => r[k]).filter(Boolean))].sort();
    const cust = new Map(); s.forEach((r) => cust.set(r.customer_code, r.customer_name));
    const ds = s.map((r) => r.booking_date).sort();
    return { hubs: uniq('origin_hub_code'), salespersons: uniq('salesperson_name'), has_unassigned: s.some((r) => r.salesperson_name === null),
      countries: uniq('destination_country'), awb_states: uniq('awb_state'), services: uniq('service_name'),
      customers: [...cust].map(([code, name]) => ({ code, name })).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      min_date: ds[0] || null, max_date: ds.at(-1) || null };
  },

  get_dashboard({ f = {} }) {
    assertPerm('page_executive');
    const rf = resolveRange(f);
    const s = scoped({ ...f, from: rf.from, to: rf.to }), p = scoped({ ...f, from: rf.prev_from, to: rf.prev_to });
    const c = [...group(s, (r) => r.customer_code)].map(([code, g]) => ({ code, name: g[0].customer_name, ...agg(g) }));
    const sp = [...group(s, (r) => r.salesperson_name || 'Unassigned')].map(([name, g]) => ({ name, ...agg(g) }));
    const H = s.filter((r) => r.is_hold), U = s.filter((r) => !r.is_hold);
    return {
      range: rf, flags: flags(),
      kpi: { awb: s.length, weight: sum(s, 'chargeable_weight'), revenue: sum(s, 'revenue'), customers: distinct(s, 'customer_code'), salespersons: distinct(s, 'salesperson_name'),
        hold: H.length, unhold: U.length, hold_weight: sum(H, 'chargeable_weight') ?? 0, unhold_weight: sum(U, 'chargeable_weight') ?? 0,
        hold_revenue: sum(H, 'revenue') ?? 0, unhold_revenue: sum(U, 'revenue') ?? 0, unassigned: s.filter((r) => !r.salesperson_name).length,
        zero_revenue: s.filter((r) => r.revenue === 0).length },
      prev_kpi: { awb: p.length, weight: sum(p, 'chargeable_weight'), revenue: sum(p, 'revenue'), customers: distinct(p, 'customer_code') },
      daily: dailyOf(s), prev_daily: dailyOf(p),
      top_customers: { by_revenue: [...c].sort(byDesc('rev', 'awb')).slice(0, 10), by_awb: [...c].sort(byDesc('awb')).slice(0, 10), by_weight: [...c].sort(byDesc('wt', 'awb')).slice(0, 10) },
      top_sales: { by_revenue: [...sp].sort(byDesc('rev', 'awb')).slice(0, 10), by_awb: [...sp].sort(byDesc('awb')).slice(0, 10), by_weight: [...sp].sort(byDesc('wt', 'awb')).slice(0, 10) },
      services: [...group(s, (r) => r.service_name)].map(([name, g]) => ({ name, awb: g.length, rev: sum(g, 'revenue') })).sort(byDesc('awb')).slice(0, 12),
      awb_states: [...group(s, (r) => r.awb_state)].map(([name, g]) => ({ name, awb: g.length })).sort(byDesc('awb')),
    };
  },

  get_customer_analysis({ f = {} }) {
    assertPerm('page_customers');
    const rf = resolveRange(f);
    const s = scoped({ ...f, from: rf.from, to: rf.to }), p = scoped({ ...f, from: rf.prev_from, to: rf.prev_to });
    const life = new Map(); for (const r of scoped(omitDates(f))) { const x = life.get(r.customer_code); if (!x || r.booking_date < x) life.set(r.customer_code, r.booking_date); }
    const pm = new Map([...group(p, (r) => r.customer_code)].map(([k, g]) => [k, agg(g)]));
    const customers = [...group(s, (r) => r.customer_code)].map(([code, g]) => {
      const ds = g.map((r) => r.booking_date).sort(); const pp = pm.get(code) || {};
      return { code, name: g[0].customer_name, ...agg(g), first_in_range: ds[0], last_in_range: ds.at(-1), active_days: new Set(ds).size,
        prev_awb: pp.awb ?? null, prev_wt: pp.wt ?? null, prev_rev: pp.rev ?? null, lifetime_first: life.get(code), is_new: life.get(code) >= rf.from };
    }).sort(byDesc('rev', 'awb'));
    const top5 = new Set(customers.slice(0, 5).map((c) => c.code));
    const daily = [...group(s, (r) => r.booking_date)].map(([d, g]) => ({ d, active: distinct(g, 'customer_code'),
      new: new Set(g.filter((r) => life.get(r.customer_code) === d).map((r) => r.customer_code)).size, awb: g.length, rev: sum(g, 'revenue') })).sort((a, b) => a.d.localeCompare(b.d));
    const top5_daily = [...group(s.filter((r) => top5.has(r.customer_code)), (r) => r.booking_date + '|' + r.customer_code)]
      .map(([k, g]) => ({ d: k.split('|')[0], code: g[0].customer_code, name: g[0].customer_name, rev: sum(g, 'revenue'), awb: g.length })).sort((a, b) => a.d.localeCompare(b.d));
    const nNew = customers.filter((c) => c.is_new).length;
    return { range: rf, flags: flags(),
      kpi: { active: customers.length, awb: s.length, weight: sum(s, 'chargeable_weight'), revenue: sum(s, 'revenue'),
        avg_revenue: customers.length && sum(s, 'revenue') !== null ? sum(s, 'revenue') / customers.length : null, new_customers: nNew, returning: customers.length - nNew, prev_active: pm.size },
      customers, daily, top5_daily };
  },

  get_sales_performance({ f = {}, p_month = null }) {
    assertPerm('page_sales');
    const rf = resolveRange(f);
    const s = scoped({ ...f, from: rf.from, to: rf.to }), p = scoped({ ...f, from: rf.prev_from, to: rf.prev_to });
    const month = (p_month || rf.to).slice(0, 7) + '-01';
    const mEnd = (() => { const d = new Date(month + 'T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); })();
    const pm = new Map([...group(p, (r) => r.salesperson_name || 'Unassigned')].map(([k, g]) => [k, agg(g)]));
    const sp = [...group(s, (r) => r.salesperson_name || 'Unassigned')].map(([name, g]) => ({ name, ...agg(g), customers: distinct(g, 'customer_code'),
      hold: g.filter((r) => r.is_hold).length, prev_awb: pm.get(name)?.awb ?? null, prev_wt: pm.get(name)?.wt ?? null, prev_rev: pm.get(name)?.rev ?? null })).sort(byDesc('rev', 'awb'));
    const top8 = new Set(sp.slice(0, 8).map((x) => x.name));
    const daily = [...group(s.filter((r) => top8.has(r.salesperson_name || 'Unassigned')), (r) => r.booking_date + '|' + (r.salesperson_name || 'Unassigned'))]
      .map(([k, g]) => ({ d: k.split('|')[0], name: k.split('|')[1], ...agg(g) })).sort((a, b) => a.d.localeCompare(b.d));
    const mStart = (() => { const d = new Date(rf.to.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 11); return iso(d); })();
    const monthly = [...group(scoped({ ...omitDates(f), from: mStart, to: rf.to }), (r) => r.booking_date.slice(0, 7) + '|' + (r.salesperson_name || 'Unassigned'))]
      .map(([k, g]) => ({ m: k.split('|')[0] + '-01', name: k.split('|')[1], ...agg(g) })).sort((a, b) => a.m.localeCompare(b.m));
    const ma = new Map([...group(scoped({ ...omitDates(f), from: month, to: mEnd }), (r) => r.salesperson_name || 'Unassigned')].map(([k, g]) => [k, agg(g)]));
    const vis = dataScope() === 'all' || allows('target_management') ? null : new Set([...me().salesperson_names, ...me().team_salespersons, ...scoped({}).map((r) => r.salesperson_name)]);
    const rv = allows('revenue_visibility'), wv = allows('weight_visibility');
    const targets = DB.targets.filter((t) => t.target_month === month && (!vis || vis.has(t.salesperson_name))).sort((a, b) => a.salesperson_name.localeCompare(b.salesperson_name))
      .map((t) => ({ id: t.id, salesperson_name: t.salesperson_name, target_month: t.target_month, revenue_target: rv ? t.revenue_target : null, awb_target: t.awb_target,
        weight_target: wv ? t.weight_target : null, actual_revenue: ma.get(t.salesperson_name)?.rev ?? (rv ? 0 : null), actual_awb: ma.get(t.salesperson_name)?.awb ?? 0,
        actual_weight: ma.get(t.salesperson_name)?.wt ?? (wv ? 0 : null) }));
    const named = sp.filter((x) => x.name !== 'Unassigned');
    return { range: rf, target_month: month, flags: { ...flags(), manage_targets: allows('target_management') },
      kpi: { salespersons: named.length, revenue: sum(s, 'revenue'), awb: s.length, weight: sum(s, 'chargeable_weight'),
        avg_revenue: named.length && rv ? named.reduce((a, x) => a + (x.rev || 0), 0) / named.length : null },
      salespersons: sp, daily, monthly, targets };
  },

  get_country_hub({ f = {} }) {
    assertActive(); if (!(allows('page_country') || allows('page_hub'))) deny('Not authorised: missing permission page_country/page_hub');
    const rf = resolveRange(f); const s = scoped({ ...f, from: rf.from, to: rf.to });
    const co = [...group(s, (r) => r.destination_country || '(Blank)')].map(([name, g]) => ({ name, ...agg(g), customers: distinct(g, 'customer_code') })).sort(byDesc('awb'));
    const top5 = new Set(co.slice(0, 5).map((x) => x.name));
    const hubs = [...group(s, (r) => r.origin_hub_code || '(Blank)')].map(([hub, g]) => ({ hub, ...agg(g), customers: distinct(g, 'customer_code'),
      hold: g.filter((r) => r.is_hold).length, hold_wt: sum(g.filter((r) => r.is_hold), 'chargeable_weight') })).sort(byDesc('awb'));
    const states = [...group(s, (r) => r.shipper_state || '(Blank)')].map(([name, g]) => ({ name, ...agg(g), customers: distinct(g, 'customer_code') })).sort(byDesc('awb'));
    const cities = [...group(s, (r) => r.shipper_city || '(Blank)')].map(([name, g]) => ({ name, state: g[0].shipper_state, ...agg(g) })).sort(byDesc('awb')).slice(0, 30);
    const country_daily = [...group(s.filter((r) => top5.has(r.destination_country || '(Blank)')), (r) => r.booking_date + '|' + (r.destination_country || '(Blank)'))]
      .map(([k, g]) => ({ d: k.split('|')[0], name: k.split('|')[1], awb: g.length, rev: sum(g, 'revenue') })).sort((a, b) => a.d.localeCompare(b.d));
    const hub_daily = [...group(s, (r) => r.booking_date + '|' + (r.origin_hub_code || '(Blank)'))]
      .map(([k, g]) => ({ d: k.split('|')[0], hub: k.split('|')[1], ...agg(g) })).sort((a, b) => a.d.localeCompare(b.d));
    const hub_top_customers = [];
    for (const [hub, g] of group(s, (r) => r.origin_hub_code || '(Blank)')) {
      [...group(g, (r) => r.customer_code)].map(([code, gg]) => ({ hub, code, name: gg[0].customer_name, awb: gg.length, rev: sum(gg, 'revenue') }))
        .sort(byDesc('awb')).slice(0, 5).forEach((x) => hub_top_customers.push(x));
    }
    return { range: rf, flags: { ...flags(), country: allows('page_country'), hub: allows('page_hub') }, countries: co, hubs, states, cities, country_daily, hub_daily, hub_top_customers };
  },

  get_shipments({ f = {}, p_page = 1, p_size = 25, p_sort = 'booking_date', p_dir = 'desc' }) {
    assertActive(); if (!(allows('page_shipments') || allows('page_customers') || allows('page_sales'))) deny('Not authorised: missing permission page_shipments');
    const cols = ['awb_number', 'booking_date', 'customer_name', 'customer_code', 'shipper_city', 'shipper_state', 'destination_country', 'chargeable_weight', 'revenue', 'salesperson_name', 'origin_hub_code', 'is_hold', 'awb_state', 'service_name', 'pcs'];
    const sort = cols.includes(p_sort) ? p_sort : 'booking_date'; const dir = p_dir === 'asc' ? 1 : -1;
    const size = Math.min(Math.max(p_size || 25, 1), allows('excel_export') ? 5000 : 200);
    const s = scoped(f);
    s.sort((a, b) => { const x = a[sort], y = b[sort]; if (x === y) return a.awb_number.localeCompare(b.awb_number); if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (x > y ? 1 : -1) * dir; });
    const H = s.filter((r) => r.is_hold), U = s.filter((r) => !r.is_hold);
    return { total: s.length, page: p_page, size, rows: s.slice((p_page - 1) * size, p_page * size),
      summary: { weight: sum(s, 'chargeable_weight'), revenue: sum(s, 'revenue'), hold: H.length, unhold: U.length, hold_weight: sum(H, 'chargeable_weight'), unhold_weight: sum(U, 'chargeable_weight'), hold_revenue: sum(H, 'revenue'), unhold_revenue: sum(U, 'revenue') },
      flags: { ...flags(), export: allows('excel_export'), hold_change: allows('hold_change') } };
  },

  get_datewise_report({ f = {}, p_type = 'date' }) {
    assertPerm('page_shipments'); const s = scoped(f);
    if (p_type === 'customer') return [...group(s, (r) => r.booking_date + '|' + r.customer_code)].map(([k, g]) => ({ d: k.split('|')[0], code: g[0].customer_code, name: g[0].customer_name, ...agg(g) })).sort((a, b) => a.d.localeCompare(b.d) || (b.rev ?? 0) - (a.rev ?? 0));
    if (p_type === 'salesperson') return [...group(s, (r) => r.booking_date + '|' + (r.salesperson_name || 'Unassigned'))].map(([k, g]) => ({ d: k.split('|')[0], name: k.split('|')[1], ...agg(g) })).sort((a, b) => a.d.localeCompare(b.d) || (b.rev ?? 0) - (a.rev ?? 0));
    return [...group(s, (r) => r.booking_date)].map(([d, g]) => ({ d, ...agg(g), customers: distinct(g, 'customer_code'), hold: g.filter((r) => r.is_hold).length })).sort((a, b) => a.d.localeCompare(b.d));
  },

  get_shipment_detail({ p_awb }) {
    assertActive(); const v = DB.shipments.find((s) => s.awb_number === String(p_awb).trim());
    if (!v || !canSee(v)) { const e = new Error('AWB not found or not authorised'); e.code = 'P0002'; throw e; }
    const shipment = { ...v }; delete shipment.raw_excel_data; let raw = { ...v.raw_excel_data };
    if (!allows('revenue_visibility')) { for (const k of Object.keys(raw)) if (/(TOTAL|FREIGHT|GST|TAXABLE|RATE|AMOUNT|FSC|CHARGE)/i.test(k)) delete raw[k];
      ['customer_freight', 'customer_other_charges', 'sales_fsc_percent', 'customer_taxable_amount', 'customer_cgst', 'customer_sgst', 'customer_igst', 'customer_grand_total', 'grand_total_original'].forEach((k) => delete shipment[k]); }
    if (!allows('weight_visibility')) { for (const k of Object.keys(raw)) if (/(WEIGHT|WT\.)/i.test(k)) delete raw[k]; ['actual_weight', 'volumetric_weight', 'chargeable_weight'].forEach((k) => delete shipment[k]); }
    return { shipment, raw, can_change_hold: allows('hold_change'),
      history: DB.audit.filter((a) => a.record_type === 'shipment' && a.record_id === v.awb_number).slice().reverse().map(({ action, user_name, old_value, new_value, remarks, created_at }) => ({ action, user_name, old_value, new_value, remarks, created_at })) };
  },

  set_hold_status({ p_awb, p_hold, p_remarks }) {
    assertPerm('hold_change'); if (!p_remarks || p_remarks.trim().length < 3) throw new Error('Remarks are required (min 3 characters)');
    const v = DB.shipments.find((s) => s.awb_number === String(p_awb).trim()); if (!v || !canSee(v)) throw new Error('AWB not found or not authorised');
    if (v.is_hold === p_hold) return { changed: false, is_hold: p_hold ? 'YES' : 'NO' };
    audit('HOLD_STATUS_CHANGE', 'shipment', v.awb_number, { is_hold: v.is_hold ? 'YES' : 'NO' }, { is_hold: p_hold ? 'YES' : 'NO' }, p_remarks.trim());
    v.is_hold = p_hold; v.hold_remarks = p_remarks.trim(); v.raw_excel_data['IS HOLD?'] = p_hold ? 'YES' : 'NO';
    return { changed: true, is_hold: p_hold ? 'YES' : 'NO' };
  },

  // ---- import
  import_begin({ p_file, p_sheet, p_total, p_meta = {}, p_billing_currency = 'INR' }) {
    assertPerm('excel_import'); const id = DB.seq.import++;
    DB.imports.push({ id, file_name: p_file, sheet_name: p_sheet, total_rows: p_total, new_records: 0, updated_records: 0, duplicate_records: 0, failed_records: 0, uploaded_by: me().id, uploaded_by_name: myName(), uploaded_at: new Date().toISOString(), finished_at: null, status: 'running', billing_currency: p_billing_currency, errors: [], meta: p_meta, notes: null });
    return id;
  },
  import_check_existing({ p_awbs }) { assertPerm('excel_import'); const set = new Set(DB.shipments.map((s) => s.awb_number)); return p_awbs.filter((a) => set.has(a)); },
  import_batch({ p_import_id, p_rows }) {
    assertPerm('excel_import'); const imp = DB.imports.find((i) => i.id === p_import_id && i.uploaded_by === me().id && i.status === 'running');
    if (!imp) deny('Import is not running or not yours');
    for (const r of p_rows) if (!r.booking_date || !/^\d{4}-\d{2}-\d{2}$/.test(r.booking_date)) throw new Error('null value in column "booking_date" violates not-null constraint');
    const idx = new Map(DB.shipments.map((s, i) => [s.awb_number, i])); let ins = 0, upd = 0;
    for (const r of p_rows) {
      const row = { ...r, awb_number: String(r.awb_number).trim(), chargeable_weight: r.chargeable_weight ?? 0, customer_grand_total: r.customer_grand_total ?? 0, is_hold: !!r.is_hold, last_import_id: p_import_id };
      if (idx.has(row.awb_number)) {
        const old = DB.shipments[idx.get(row.awb_number)];
        DB.versions.push({ import_id: p_import_id, awb_number: old.awb_number, old_row: JSON.parse(JSON.stringify(old)) });
        if (old.is_hold !== row.is_hold) audit('HOLD_STATUS_CHANGE', 'shipment', old.awb_number, { is_hold: old.is_hold ? 'YES' : 'NO' }, { is_hold: row.is_hold ? 'YES' : 'NO' }, 'Changed by Excel import #' + p_import_id);
        DB.shipments[idx.get(row.awb_number)] = { ...old, ...row, first_import_id: old.first_import_id }; upd++;
      } else { DB.shipments.push({ ...row, first_import_id: p_import_id }); idx.set(row.awb_number, DB.shipments.length - 1); ins++; }
    }
    imp.new_records += ins; imp.updated_records += upd; return { inserted: ins, updated: upd };
  },
  import_finish({ p_import_id, p_status, p_stats = {}, p_errors = [] }) {
    assertPerm('excel_import'); const imp = DB.imports.find((i) => i.id === p_import_id && i.status === 'running'); if (!imp) throw new Error('Import not found / not running');
    Object.assign(imp, { status: ['completed', 'partial', 'failed'].includes(p_status) ? p_status : 'completed', finished_at: new Date().toISOString(),
      total_rows: p_stats.total_rows ?? imp.total_rows, duplicate_records: p_stats.duplicate_records ?? 0, failed_records: p_stats.failed_records ?? 0, errors: (p_errors || []).slice(0, 5000), meta: { ...imp.meta, ...p_stats } });
    audit('EXCEL_IMPORT', 'import', imp.id, null, { file: imp.file_name, total: imp.total_rows, new: imp.new_records, updated: imp.updated_records, duplicates: imp.duplicate_records, failed: imp.failed_records, status: imp.status }, 'Excel import ' + imp.status);
    const { errors, ...rest } = imp; return rest;
  },
  import_rollback({ p_import_id, p_reason }) {
    assertActive(); if (!isAdmin()) deny('Only ADMIN can roll back imports');
    const imp = DB.imports.find((i) => i.id === p_import_id); if (!imp || imp.status === 'rolled_back') throw new Error('Import cannot be rolled back');
    const vers = new Map(DB.versions.filter((v) => v.import_id === p_import_id).map((v) => [v.awb_number, v.old_row]));
    let del = 0, res = 0;
    DB.shipments = DB.shipments.filter((s) => { if (s.last_import_id === p_import_id && s.first_import_id === p_import_id && !vers.has(s.awb_number)) { del++; return false; } return true; });
    DB.shipments = DB.shipments.map((s) => { if (s.last_import_id === p_import_id && vers.has(s.awb_number)) { res++; return vers.get(s.awb_number); } return s; });
    const skip = Math.max(imp.new_records + imp.updated_records - del - res, 0);
    imp.status = 'rolled_back'; imp.notes = `Rolled back by ${myName()}: ${del} deleted, ${res} restored, ${skip} skipped. ${p_reason || ''}`;
    audit('IMPORT_ROLLBACK', 'import', p_import_id, null, { deleted: del, restored: res, skipped: skip }, p_reason);
    return { deleted: del, restored: res, skipped: skip };
  },
  get_import_logs({ p_page = 1, p_size = 20 }) {
    assertActive(); if (!(allows('excel_import') || allows('audit_logs'))) deny('Not authorised');
    const all = isAdmin() || allows('audit_logs'); const list = DB.imports.filter((i) => all || i.uploaded_by === me().id).slice().reverse();
    return { total: list.length, rows: list.slice((p_page - 1) * p_size, p_page * p_size).map(({ errors, ...r }) => ({ ...r, error_count: errors.length })) };
  },
  get_import_errors({ p_import_id }) { assertActive(); return DB.imports.find((i) => i.id === p_import_id)?.errors || []; },

  // ---- users
  admin_list_users() { assertPerm('user_management'); return DB.profiles.map((p) => ({ ...p, permission_overrides: Object.fromEntries(DB.perms.filter((x) => x.user_id === p.id).map((x) => [x.permission_key, x.permission_value])) })); },
  admin_update_user({ p_id, p, p_perms }) {
    assertPerm('user_management'); const o = DB.profiles.find((x) => x.id === p_id); if (!o) throw new Error('User not found');
    if (!isAdmin() && (o.role === 'admin' || p.role === 'admin')) deny('Only ADMIN can modify admin accounts');
    if (p_id === me().id && ((p.role && p.role !== o.role) || p.is_active === false)) deny('You cannot change your own role or deactivate yourself');
    const old = { ...o };
    for (const k of ['full_name', 'username', 'mobile', 'role', 'assigned_hubs', 'salesperson_names', 'team_salespersons', 'is_active']) if (k in p) o[k] = p[k];
    if (p_perms) for (const [k, v] of Object.entries(p_perms)) {
      DB.perms = DB.perms.filter((x) => !(x.user_id === p_id && x.permission_key === k));
      if (v && v !== 'default' && v !== defaultPermission(o.role, k)) DB.perms.push({ user_id: p_id, permission_key: k, permission_value: v });
    }
    audit('USER_UPDATE', 'user', p_id, old, { ...o, permissions: p_perms }); return o;
  },
  get_salesperson_names() {
    assertActive(); if (!(allows('user_management') || allows('target_management'))) deny('Not authorised');
    return { salespersons: [...new Set(DB.shipments.map((s) => s.salesperson_name).filter(Boolean))].sort(), hubs: [...new Set(DB.shipments.map((s) => s.origin_hub_code).filter(Boolean))].sort() };
  },
  update_my_profile({ p }) {
    assertActive(); const o = me();
    if (p.full_name) o.full_name = String(p.full_name).slice(0, 120); if ('mobile' in p) o.mobile = p.mobile; if ('avatar_url' in p) o.avatar_url = p.avatar_url;
    if (p.preferences) o.preferences = { ...o.preferences, ...p.preferences }; return { ...o };
  },

  // ---- targets
  get_targets({ p_month }) { const m = String(p_month).slice(0, 7) + '-01'; const end = (() => { const d = new Date(m + 'T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return iso(d); })();
    const r = RPC.get_sales_performance({ f: { from: m, to: end }, p_month: m }); return { month: r.target_month, targets: r.targets, flags: r.flags, salespersons: r.salespersons }; },
  upsert_target({ p }) {
    assertPerm('target_management'); if (!p.salesperson_name) throw new Error('Salesperson is required');
    const m = String(p.target_month).slice(0, 7) + '-01'; let t = DB.targets.find((x) => x.salesperson_name === p.salesperson_name && x.target_month === m); const old = t ? { ...t } : null;
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
    if (!t) { t = { id: DB.seq.target++, salesperson_name: p.salesperson_name, target_month: m }; DB.targets.push(t); }
    Object.assign(t, { revenue_target: num(p.revenue_target), awb_target: num(p.awb_target), weight_target: num(p.weight_target), notes: p.notes || null });
    audit('TARGET_SAVE', 'target', t.id, old, t); return t;
  },
  delete_target({ p_id }) { assertPerm('target_management'); const t = DB.targets.find((x) => x.id === p_id); DB.targets = DB.targets.filter((x) => x.id !== p_id); audit('TARGET_DELETE', 'target', p_id, t, null); },

  // ---- audit, notifications, settings
  get_audit_logs({ p_page = 1, p_size = 25, p_action, p_search, p_from, p_to }) {
    assertPerm('audit_logs'); const q = (p_search || '').toLowerCase();
    const a = DB.audit.filter((l) => (!p_action || l.action === p_action) && (!p_from || l.created_at >= p_from) && (!p_to || l.created_at.slice(0, 10) <= p_to)
      && (!q || (l.record_id || '').toLowerCase().includes(q) || (l.user_name || '').toLowerCase().includes(q) || (l.remarks || '').toLowerCase().includes(q))).slice().reverse();
    return { total: a.length, actions: [...new Set(DB.audit.map((x) => x.action))], rows: a.slice((p_page - 1) * p_size, p_page * p_size) };
  },
  get_notifications() {
    assertActive();
    return { imports: DB.imports.slice(-6).reverse().map(({ id, file_name, status, new_records, updated_records, failed_records, uploaded_by_name, uploaded_at }) => ({ id, file_name, status, new_records, updated_records, failed_records, uploaded_by_name, uploaded_at })),
      holds: DB.audit.filter((a) => a.action === 'HOLD_STATUS_CHANGE').slice(-8).reverse().filter((a) => { const s = DB.shipments.find((x) => x.awb_number === a.record_id); return s && canSee(s); })
        .map((a) => ({ awb: a.record_id, is_hold: a.new_value?.is_hold, user_name: a.user_name, remarks: a.remarks, created_at: a.created_at })) };
  },
  set_setting({ p_key, p_value }) { assertActive(); if (!(isAdmin() || allows('app_settings'))) deny('Not authorised'); const old = DB.settings[p_key]; DB.settings[p_key] = p_value; audit('SETTING_CHANGE', 'setting', p_key, old, p_value); },
  upsert_exchange_rate({ p_currency, p_rate, p_approved_by }) {
    assertActive(); if (!(isAdmin() || allows('app_settings'))) deny('Not authorised');
    const c = String(p_currency).toUpperCase(); DB.fx = DB.fx.filter((x) => x.currency !== c);
    DB.fx.push({ currency: c, rate_to_inr: Number(p_rate), approved_by: p_approved_by, effective_date: iso(new Date()) }); audit('FX_RATE_CHANGE', 'setting', c, null, { rate_to_inr: p_rate, approved_by: p_approved_by });
  },
};

// ---------------------------------------------------------------- client facade
const clone = (x) => (x === undefined ? null : JSON.parse(JSON.stringify(x)));
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const listeners = [];

export function createDemoClient() {
  return {
    __demo: true,
    async rpc(name, params = {}) {
      await wait(name.startsWith('import') ? 25 : 90);
      const fn = RPC[name]; if (!fn) return { data: null, error: { message: 'Unknown function ' + name } };
      if (!currentUser && name !== 'email_for_login') return { data: null, error: { message: 'permission denied for function ' + name, code: '42501' } };
      try { return { data: clone(fn(params)), error: null }; } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
    from(table) {
      return { async select() {
        if (!currentUser) return { data: null, error: { message: 'permission denied' } };
        if (table === 'app_settings') return { data: Object.entries(DB.settings).map(([key, value]) => ({ key, value: clone(value) })), error: null };
        if (table === 'exchange_rates') return { data: clone(DB.fx), error: null };
        return { data: null, error: { message: 'permission denied for table ' + table } };
      } };
    },
    auth: {
      async getSession() { return { data: { session: currentUser ? { user: { id: currentUser.id, email: currentUser.email } } : null } }; },
      async signInWithPassword({ email, password }) {
        await wait(250); const p = DB.profiles.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
        if (!p || DB.passwords[p.id] !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        currentUser = p; try { sessionStorage.setItem('skynet_demo_uid', p.id); } catch (_) { /* ignore */ }
        return { data: { session: { user: { id: p.id, email: p.email } } }, error: null };
      },
      async signOut() { currentUser = null; try { sessionStorage.removeItem('skynet_demo_uid'); } catch (_) { /* ignore */ } listeners.forEach((f) => f('SIGNED_OUT')); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async resetPasswordForEmail() { await wait(200); return { error: null }; },
      async updateUser(u) {
        if (!currentUser) return { error: { message: 'Not logged in' } };
        if (u.password) DB.passwords[currentUser.id] = u.password;
        if (u.email) { currentUser.email = u.email; }
        return { data: { user: currentUser }, error: null };
      },
    },
    storage: { from() { return {
      async upload(path, file) { const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); this._last = url; DB._avatar = url; return { data: { path }, error: null }; },
      getPublicUrl() { return { data: { publicUrl: DB._avatar } }; },
    }; } },
    functions: { async invoke(_name, { body }) {
      await wait(200);
      try {
        if (!isAdmin() && !allows('user_management')) deny('Not authorised');
        if (body.action === 'create') {
          if (DB.profiles.some((p) => p.email.toLowerCase() === body.email.toLowerCase())) throw new Error('A user with this e-mail already exists');
          const id = 'u-' + Math.random().toString(36).slice(2, 8);
          DB.profiles.push({ id, username: body.username || null, full_name: body.full_name, email: body.email, mobile: body.mobile || null, role: body.role || 'sales', assigned_hubs: body.assigned_hubs || [], salesperson_names: body.salesperson_names || [], team_salespersons: body.team_salespersons || [], avatar_url: null, is_active: body.is_active !== false, preferences: {}, created_at: new Date().toISOString() });
          DB.passwords[id] = body.password || 'Invite@123';
          if (body.permissions) RPC.admin_update_user({ p_id: id, p: {}, p_perms: body.permissions });
          audit('USER_CREATE', 'user', id, null, { email: body.email, role: body.role }); return { data: { id }, error: null };
        }
        if (body.action === 'delete') { if (body.user_id === me().id) throw new Error('You cannot delete yourself'); DB.profiles = DB.profiles.filter((p) => p.id !== body.user_id); audit('USER_DELETE', 'user', body.user_id); return { data: { ok: true }, error: null }; }
        if (body.action === 'set_password') { DB.passwords[body.user_id] = body.password; audit('USER_PASSWORD_RESET', 'user', body.user_id); return { data: { ok: true }, error: null }; }
        if (body.action === 'set_active') { const p = DB.profiles.find((x) => x.id === body.user_id); p.is_active = !!body.is_active; audit('USER_UPDATE', 'user', body.user_id, null, { is_active: p.is_active }); return { data: { ok: true }, error: null }; }
        throw new Error('Unknown action');
      } catch (e) { return { data: null, error: { message: e.message, context: { json: async () => ({ error: e.message }) } } }; }
    } },
  };
}
