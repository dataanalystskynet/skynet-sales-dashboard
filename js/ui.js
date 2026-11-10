// =====================================================================
// SKYNET EXPRESS – ui.js : shared building blocks (KPI cards, panels,
// skeletons, client-side sortable/searchable/paginated tables)
// Totals in tables are always computed over ALL rows, never the page.
// =====================================================================
import { esc, html, raw, setHTML, icons, inr, int, kg, dmy, share, pct, isNil, debounce, emptyState, holdBadge, exportExcel, animateValue, inrShort, n, toast } from './utils.js';
import { can } from './permissions.js';

export function kpiCard({ id, label, icon, tone = 'var(--skynet-red)' }) {
  return `<div class="kpi" style="--kpi-tone:${tone}" id="kpi-${esc(id)}">
    <div class="k-top"><span class="k-label">${esc(label)}</span><span class="k-icon"><i data-lucide="${esc(icon)}"></i></span></div>
    <div class="k-value" data-v>—</div><div class="k-foot" data-f></div></div>`;
}
export function setKpi(root, id, value, fmt, footHtml = '') {
  const el = root.querySelector('#kpi-' + id); if (!el) return;
  const v = el.querySelector('[data-v]');
  const len = isNil(value) ? 0 : fmt(value).length;
  v.style.fontSize = len >= 18 ? '17px' : len >= 15 ? '20px' : '';
  animateValue(v, value, fmt);
  if (!isNil(value)) v.title = fmt(value);
  const f = el.querySelector('[data-f]'); f.innerHTML = footHtml; icons(f);
}
export const TONES = { red: 'var(--c1)', blue: 'var(--c2)', amber: 'var(--c3)', teal: 'var(--c4)', violet: 'var(--c5)', sky: 'var(--c6)', coral: 'var(--c7)', lime: 'var(--c8)' };

export function panel({ title, sub = '', tools = '', body = '', cls = '', id = '' }) {
  return `<section class="panel ${cls}" ${id ? `id="${esc(id)}"` : ''}><div class="panel-head"><div><h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
    <div class="tools">${tools}</div></div>${body}</section>`;
}
export function chartBox(id, cls = '') { return `<div class="chart-box ${cls}"><canvas id="${esc(id)}" role="img" aria-label="${esc(id)} chart"></canvas></div>`; }
export function seg(name, options, active) {
  return `<div class="seg" data-seg="${esc(name)}" role="tablist">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === active ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
export function bindSeg(root, name, cb) {
  const s = root.querySelector(`[data-seg="${name}"]`); if (!s) return;
  s.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v); });
}
export function skeleton(kpis = 10, charts = 4) {
  return `<div class="kpi-grid">${Array.from({ length: kpis }, () => '<div class="skel skel-kpi"></div>').join('')}</div>
    <div class="grid g-2 mt">${Array.from({ length: charts }, () => '<div class="skel skel-chart"></div>').join('')}</div>`;
}

// ---------- formatting by column type ----------
export function fmtCell(type, v, row) {
  if (type === 'inr') return isNil(v) ? '<span class="muted">—</span>' : esc(inr(v));
  if (type === 'kg') return isNil(v) ? '<span class="muted">—</span>' : esc(kg(v));
  if (type === 'int') return esc(int(v));
  if (type === 'date') return esc(dmy(v));
  if (type === 'share') return esc(share(v));
  if (type === 'growth') return isNil(v) ? '<span class="badge info">New</span>' : `<span class="trend ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${esc(pct(v))}</span>`;
  if (type === 'hold') return holdBadge(v);
  return esc(v ?? '—');
}
const NUMERIC = new Set(['inr', 'kg', 'int', 'share', 'growth']);

/**
 * Client-side table for aggregated data.
 * opts: { columns:[{key,label,type,get,render,width}], rows, pageSize, searchKeys, onRowClick,
 *         exportName, exportSheet, sort:{key,dir}, totals:true, toolsHtml }
 */
export function clientTable(container, opts) {
  const st = { q: '', sort: opts.sort || null, page: 1, size: opts.pageSize || 15 };
  const cols = opts.columns;
  const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
  const canExport = can('excel_export') && opts.exportName;
  setHTML(container, html`<div class="table-tools">
      <div class="input-icon grow"><i data-lucide="search"></i><input class="input" data-q placeholder="${opts.searchPlaceholder || 'Search…'}" aria-label="Search table"></div>
      ${raw(opts.toolsHtml || '')}
      ${canExport ? raw('<button class="btn" data-export><i data-lucide="download"></i>Export Excel</button>') : ''}
    </div>
    <div class="table-wrap"><table class="data responsive"><thead></thead><tbody></tbody><tfoot></tfoot></table></div>
    <div class="pager"></div>`);
  const thead = container.querySelector('thead'), tbody = container.querySelector('tbody'), tfoot = container.querySelector('tfoot'), pager = container.querySelector('.pager');

  function filtered() {
    let rows = opts.rows;
    if (st.q) {
      const q = st.q.toLowerCase(); const keys = opts.searchKeys || cols.map((c) => c.key);
      rows = rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
    }
    if (st.sort) {
      const c = cols.find((x) => x.key === st.sort.key); const d = st.sort.dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const x = val(c, a), y = val(c, b);
        if (isNil(x) && isNil(y)) return 0; if (isNil(x)) return 1; if (isNil(y)) return -1;
        return (typeof x === 'number' || NUMERIC.has(c.type) ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * d;
      });
    }
    return rows;
  }
  function draw() {
    const rows = filtered(); const pages = Math.max(1, Math.ceil(rows.length / st.size)); st.page = Math.min(st.page, pages);
    thead.innerHTML = '<tr>' + cols.map((c) => `<th class="sortable ${NUMERIC.has(c.type) ? 'right' : ''}" data-k="${esc(c.key)}" scope="col">${esc(c.label)}<span class="sort-ind">${st.sort?.key === c.key ? (st.sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span></th>`).join('') + '</tr>';
    const slice = rows.slice((st.page - 1) * st.size, st.page * st.size);
    tbody.innerHTML = slice.length ? slice.map((r, i) => `<tr class="${opts.onRowClick ? 'clickable' : ''}" data-i="${(st.page - 1) * st.size + i}">${cols.map((c) =>
      `<td class="${NUMERIC.has(c.type) ? 'right num' : ''}" data-label="${esc(c.label)}">${c.render ? c.render(r) : fmtCell(c.type, val(c, r), r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}">${emptyState(st.q ? 'No rows match your search.' : 'No records for the selected filters.')}</td></tr>`;
    if (opts.totals !== false && rows.length) {
      tfoot.innerHTML = '<tr>' + cols.map((c, i) => {
        if (i === 0) return `<td>Total (${esc(int(rows.length))})</td>`;
        if (['inr', 'kg', 'int'].includes(c.type) && c.total !== false) {
          const vals = rows.map((r) => val(c, r)).filter((x) => !isNil(x));
          return `<td class="right num">${vals.length ? fmtCell(c.type, vals.reduce((a, b) => a + Number(b), 0)) : '—'}</td>`;
        }
        return '<td></td>';
      }).join('') + '</tr>';
    } else tfoot.innerHTML = '';
    pager.innerHTML = `<span>Showing ${rows.length ? (st.page - 1) * st.size + 1 : 0}–${Math.min(st.page * st.size, rows.length)} of ${int(rows.length)}</span>
      <span class="pages"><select class="select" data-size aria-label="Rows per page">${[10, 15, 25, 50, 100].map((s) => `<option ${s === st.size ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-sm" data-p="prev" ${st.page <= 1 ? 'disabled' : ''} aria-label="Previous page"><i data-lucide="chevron-left"></i></button>
      <span>Page ${st.page} / ${pages}</span>
      <button class="btn btn-sm" data-p="next" ${st.page >= pages ? 'disabled' : ''} aria-label="Next page"><i data-lucide="chevron-right"></i></button></span>`;
    icons(container);
  }
  container.querySelector('[data-q]').addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 1; draw(); }, 250));
  thead.addEventListener('click', (e) => { const th = e.target.closest('th'); if (!th) return; const k = th.dataset.k;
    st.sort = st.sort?.key === k ? { key: k, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: NUMERIC.has(cols.find((c) => c.key === k).type) ? 'desc' : 'asc' }; draw(); });
  pager.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; st.page += b.dataset.p === 'next' ? 1 : -1; draw(); });
  pager.addEventListener('change', (e) => { if (e.target.matches('[data-size]')) { st.size = Number(e.target.value); st.page = 1; draw(); } });
  if (opts.onRowClick) tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr && !e.target.closest('button,a')) opts.onRowClick(filtered()[Number(tr.dataset.i)]); });
  const ex = container.querySelector('[data-export]');
  if (ex) ex.addEventListener('click', () => {
    const rows = filtered();
    exportExcel(opts.exportName, [{ name: opts.exportSheet || 'Report', rows, columns: cols.filter((c) => c.export !== false).map((c) => ({ key: c.key, label: c.label, get: c.get, type: c.type === 'int' || c.type === 'share' || c.type === 'growth' ? 'num' : c.type })) }]);
    toast(`Exported ${int(rows.length)} rows to Excel.`, 'ok');
  });
  draw();
  return { redraw: draw, setRows(r) { opts.rows = r; st.page = 1; draw(); } };
}

export function noAccess(msg = 'You do not have permission to view this section.') { return `<div class="panel">${emptyState(msg, 'lock')}</div>`; }
export function rangeLabel(r) { return r ? `${dmy(r.from)} → ${dmy(r.to)} · ${r.days} day${r.days > 1 ? 's' : ''}` : ''; }
export function prevLabel(r) { return r ? `vs ${dmy(r.prev_from)} → ${dmy(r.prev_to)}` : ''; }
export { inrShort, n };
