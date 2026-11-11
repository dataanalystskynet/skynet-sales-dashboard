// =====================================================================
// SKYNET EXPRESS – utils.js : formatting (INR / KG / DD-MM-YYYY), DOM,
// XSS-safe templating, toasts, modals, drawers, Excel export helpers.
// =====================================================================

// ---------- Formatting ----------
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const wtFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec1 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const isNil = (v) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
export const n = (v) => (isNil(v) || v === '' ? 0 : Number(v));

/** Amount format used everywhere: "₹ 1,00,000" – rupee symbol, ONE space, Indian grouping, no decimals */
export function inr(v) {
  if (isNil(v)) return '—';
  const x = Math.round(Number(v));
  return (x < 0 ? '−' : '') + '₹ ' + numFmt.format(Math.abs(x));
}
/** Same full format (kept for existing callers – amounts are never abbreviated or shown with decimals) */
export const inrShort = inr;
/** Chart-axis ticks only: "₹ 14 L" / "₹ 1 Cr" (whole numbers; one decimal only if the tick itself is fractional) */
export function inrAxis(v) {
  if (isNil(v)) return '';
  const x = Number(v), a = Math.abs(x), sg = x < 0 ? '−' : '';
  const t = (q) => (Number.isInteger(q) ? String(q) : q.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e7) return sg + '₹ ' + t(Math.round(a / 1e6) / 10) + ' Cr';
  if (a >= 1e5) return sg + '₹ ' + t(Math.round(a / 1e4) / 10) + ' L';
  return sg + '₹ ' + numFmt.format(Math.round(a));
}
export function int(v) { return isNil(v) ? '—' : numFmt.format(Number(v)); }
/** 1,234.50 KG */
export function kg(v, withUnit = true) { return isNil(v) ? '—' : wtFmt.format(Number(v)) + (withUnit ? ' KG' : ''); }
export function kgShort(v) {
  if (isNil(v)) return '—';
  const x = Number(v);
  if (Math.abs(x) >= 1e5) return (x / 1e5).toFixed(2) + ' L KG';
  return numFmt.format(x) + ' KG';
}
export function pct(v, digits = 1) { return isNil(v) || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(digits) + '%'; }
export function share(v) { return isNil(v) || !Number.isFinite(v) ? '—' : dec1.format(v) + '%'; }

/** Growth % = ((cur - prev) / prev) * 100 ; safe for zero previous */
export function growth(cur, prev) {
  if (isNil(cur) || isNil(prev)) return null;
  cur = Number(cur); prev = Number(prev);
  if (prev === 0) return cur === 0 ? 0 : null; // null => "New" (no base)
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ---------- Dates (DD-MM-YYYY display, ISO internally) ----------
export function pad(x) { return String(x).padStart(2, '0'); }
export function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function parseISO(s) { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function dmy(s) {
  if (!s) return '—';
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) { const [y, m, d] = str.slice(0, 10).split('-'); return `${d}-${m}-${y}`; }
  const d = new Date(str); return isNaN(d) ? str : `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}
export function dmyTime(s) {
  if (!s) return '—';
  const d = new Date(s); if (isNaN(d)) return String(s);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monLabel(iso) { const d = parseISO(iso); return d ? MON[d.getMonth()] + '-' + d.getFullYear() : ''; }
export function shortDay(iso) { const d = parseISO(iso); return d ? pad(d.getDate()) + '-' + MON[d.getMonth()] : ''; }
export function addDays(iso, k) { const d = parseISO(iso); d.setDate(d.getDate() + k); return isoDate(d); }
export function weekStart(iso) { const d = parseISO(iso); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return isoDate(d); } // Monday
export function monthStart(iso) { return String(iso).slice(0, 7) + '-01'; }

/** Roll a daily series [{d, ...metrics}] up to week / month buckets */
export function rollup(daily, mode, keys = ['awb', 'wt', 'rev']) {
  if (mode === 'daily') return daily.map((r) => ({ ...r, label: shortDay(r.d) }));
  const map = new Map();
  for (const r of daily) {
    const k = mode === 'weekly' ? weekStart(r.d) : monthStart(r.d);
    if (!map.has(k)) map.set(k, Object.fromEntries([['d', k], ...keys.map((x) => [x, null])]));
    const o = map.get(k);
    for (const x of keys) if (!isNil(r[x])) o[x] = n(o[x]) + Number(r[x]);
  }
  return [...map.values()].sort((a, b) => a.d.localeCompare(b.d))
    .map((o) => ({ ...o, label: mode === 'weekly' ? 'Wk ' + shortDay(o.d) : monLabel(o.d) }));
}

// ---------- Security: escaping ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function esc(v) { return isNil(v) ? '' : String(v).replace(/[&<>"'`]/g, (c) => ESC[c]); }
/** Tagged template that escapes every interpolation unless wrapped with raw() */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v && v.__raw) out += v.html;
      else if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.html : esc(x))).join('');
      else out += esc(v);
    }
  });
  return { __raw: true, html: out, toString() { return out; } };
}
export const raw = (s) => ({ __raw: true, html: String(s ?? ''), toString() { return this.html; } });

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function setHTML(el, tpl) { el.innerHTML = tpl && tpl.__raw ? tpl.html : esc(tpl); icons(el); return el; }
export function icons(root) { try { if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' }, nameAttr: 'data-lucide', ...(root ? {} : {}) }); } catch (_) { /* ignore */ } }
export function debounce(fn, ms = 350) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function uid() { return Math.random().toString(36).slice(2, 10); }
export function storageGet(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } }
export function storageSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* ignore */ } }

// ---------- Loading bar ----------
let loadingCount = 0;
export function loading(on) {
  let bar = $('#loading-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'loading-bar'; bar.className = 'loading-bar'; document.body.appendChild(bar); }
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  bar.style.opacity = loadingCount ? '1' : '0';
  bar.style.width = loadingCount ? '70%' : '100%';
  if (!loadingCount) setTimeout(() => { if (!loadingCount) bar.style.width = '0'; }, 350);
}

// ---------- Toasts ----------
export function toast(msg, type = 'info', ms = 4200) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const ic = type === 'ok' ? 'circle-check' : type === 'err' ? 'circle-alert' : 'info';
  setHTML(t, html`<i data-lucide="${ic}"></i><div>${msg}</div>`);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
}
export function errMsg(e) {
  if (!e) return 'Unknown error';
  const m = e.message || e.error_description || e.msg || String(e);
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Cannot reach the server. Check your internet connection and try again.';
  if (/JWT expired|invalid JWT/i.test(m)) return 'Your session has expired. Please log in again.';
  return m.replace(/^Not authorised: /, 'Not authorised – ');
}

// ---------- Modal & drawer ----------
export function closeOverlays() { $$('.overlay,.modal,.drawer').forEach((x) => x.remove()); document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape') closeOverlays(); }
export function modal({ title, body, foot = '', wide = false, onMount, locked = false }) {
  closeOverlays();
  const ov = document.createElement('div'); ov.className = 'overlay'; if (!locked) ov.addEventListener('click', closeOverlays);
  const m = document.createElement('div'); m.className = 'modal' + (wide ? ' wide' : ''); m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  setHTML(m, html`<div class="modal-head"><h2>${title}</h2><span class="top-spacer"></span>
    <button class="btn btn-ghost icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
    <div class="modal-body">${raw(body)}</div>${raw(foot ? '<div class="modal-foot">' + foot + '</div>' : '')}`);
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeOverlays));
  if (locked) m.querySelectorAll('[data-close]').forEach((b) => b.remove());
  document.body.append(ov, m); if (!locked) document.addEventListener('keydown', escClose);
  if (onMount) onMount(m);
  const f = m.querySelector('input,select,textarea,button.btn-primary'); if (f) setTimeout(() => f.focus(), 30);
  return m;
}
export function drawer({ title, sub = '', body = '', onMount }) {
  closeOverlays();
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.addEventListener('click', closeOverlays);
  const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog');
  setHTML(d, html`<div class="drawer-head"><div><h2>${title}</h2><div class="muted" style="font-size:12.5px">${sub}</div></div>
    <span class="top-spacer"></span><button class="btn btn-ghost icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div>
    <div class="drawer-body">${raw(body)}</div>`);
  d.querySelector('[data-close]').addEventListener('click', closeOverlays);
  document.body.append(ov, d); document.addEventListener('keydown', escClose);
  if (onMount) onMount(d);
  return d;
}
export function confirmDialog(title, message, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-primary' : 'btn-blue'}" data-ok>${esc(okLabel)}</button>` });
    let done = false;
    m.querySelector('[data-ok]').addEventListener('click', () => { done = true; closeOverlays(); resolve(true); });
    const obs = new MutationObserver(() => { if (!document.body.contains(m)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- UI fragments ----------
export function emptyState(msg = 'No records match the selected filters.', icon = 'package-search') {
  return `<div class="empty"><i data-lucide="${icon}"></i><div>${esc(msg)}</div></div>`;
}
export function trendHtml(g, label = 'vs prev. period') {
  if (g === null || g === undefined) return `<span class="trend flat">New</span><span>${esc(label)}</span>`;
  const cls = g > 0.05 ? 'up' : g < -0.05 ? 'down' : 'flat';
  const ic = cls === 'up' ? 'trending-up' : cls === 'down' ? 'trending-down' : 'minus';
  return `<span class="trend ${cls}"><i data-lucide="${ic}"></i>${esc(pct(g))}</span><span>${esc(label)}</span>`;
}
export function holdBadge(isHold) { return isHold ? '<span class="badge hold">YES · Hold</span>' : '<span class="badge ok">NO · Unhold</span>'; }
export function restricted() { return '<span class="restricted"><i data-lucide="lock"></i>Restricted</span>'; }

/** Animated counter for KPI values */
export function animateValue(el, to, fmt, ms = 900) {
  if (isNil(to)) { el.innerHTML = restricted(); icons(el); return; }
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.textContent = fmt(to); return; }
  const start = performance.now(); const from = 0;
  const step = (t) => { const p = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to); };
  requestAnimationFrame(step);
}

// ---------- Excel export (SheetJS) ----------
/** columns: [{key, label, type:'inr'|'kg'|'date'|'num'|'text'|'pct', get?}] */
export function exportExcel(fileBase, sheets) {
  if (!window.XLSX) { toast('Excel library not loaded', 'err'); return; }
  const wb = window.XLSX.utils.book_new();
  for (const s of sheets) {
    const aoa = [s.columns.map((c) => c.label)];
    for (const r of s.rows) {
      aoa.push(s.columns.map((c) => {
        const v = c.get ? c.get(r) : r[c.key];
        if (isNil(v)) return '';
        if (c.type === 'date') return dmy(v);
        if (c.type === 'inr') return Math.round(Number(v));
        if (c.type === 'kg' || c.type === 'num' || c.type === 'pct') return Math.round(Number(v) * 100) / 100;
        return typeof v === 'object' ? JSON.stringify(v) : v;
      }));
    }
    if (s.totals) aoa.push(s.columns.map((c, i) => (i === 0 ? 'TOTAL' : s.totals[c.key] ?? '')));
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = s.columns.map((c) => ({ wch: Math.max(10, Math.min(40, c.label.length + 4)) }));
    s.columns.forEach((c, ci) => {
      if (c.type !== 'inr' && c.type !== 'kg') return;
      for (let ri = 1; ri < aoa.length; ri++) {
        const ref = window.XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = c.type === 'inr' ? '"₹ "#,##,##0' : '#,##0.00';
      }
    });
    window.XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet').slice(0, 31));
  }
  const stamp = isoDate(new Date()).split('-').reverse().join('-');
  window.XLSX.writeFile(wb, `${fileBase}_${stamp}.xlsx`);
}
