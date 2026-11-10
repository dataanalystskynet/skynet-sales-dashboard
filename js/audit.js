// =====================================================================
// SKYNET EXPRESS – audit.js : Audit Logs (hold changes, imports, users,
// targets, settings) – server-side paginated, exportable
// =====================================================================
import { rpc } from './api.js';
import { can } from './permissions.js';
import { panel } from './ui.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, dmyTime, int, debounce, exportExcel, emptyState } from './utils.js';

const fmtVal = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? Object.entries(v).filter(([k]) => !['preferences', 'permission_overrides'].includes(k)).slice(0, 8).map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ') : String(v));

export async function render(root) {
  const st = { page: 1, size: 25, action: '', search: '', from: '', to: '' };
  root.innerHTML = panel({ title: 'Audit logs', sub: 'Who changed what and when. Hold changes record AWB, old status, new status, user, date-time and remarks.',
    tools: can('excel_export') ? '<button class="btn" id="a-exp"><i data-lucide="download"></i>Export</button>' : '',
    body: `<div class="table-tools"><div class="input-icon grow"><i data-lucide="search"></i><input class="input" id="a-q" placeholder="Search AWB / record, user or remarks"></div>
      <select class="select" id="a-act" style="width:220px"><option value="">All actions</option></select>
      <input class="input" type="date" id="a-from" style="width:160px" aria-label="From"><input class="input" type="date" id="a-to" style="width:160px" aria-label="To"></div><div id="a-tbl"></div><div class="pager" id="a-pg"></div>` });
  const params = () => ({ p_page: st.page, p_size: st.size, p_action: st.action || null, p_search: st.search || null, p_from: st.from || null, p_to: st.to || null });
  const load = async () => {
    const tbl = root.querySelector('#a-tbl'); tbl.innerHTML = '<div class="skel" style="height:240px"></div>';
    try {
      const r = await rpc('get_audit_logs', params());
      const sel = root.querySelector('#a-act'); if (sel.options.length === 1) r.actions.sort().forEach((a) => { const o = document.createElement('option'); o.value = a; o.textContent = a.replace(/_/g, ' '); sel.appendChild(o); });
      setHTML(tbl, r.rows.length ? html`<div class="table-wrap"><table class="data responsive"><thead><tr><th>Date & time</th><th>User</th><th>Action</th><th>Record</th><th>Old value</th><th>New value</th><th>Remarks</th></tr></thead><tbody>
        ${r.rows.map((a) => html`<tr><td data-label="Date">${dmyTime(a.created_at)}</td><td data-label="User">${a.user_name || '—'}</td><td data-label="Action"><span class="badge ${a.action === 'HOLD_STATUS_CHANGE' ? 'warn' : 'info'}">${a.action.replace(/_/g, ' ')}</span></td>
          <td data-label="Record">${a.record_type || ''} ${a.record_id || ''}</td><td data-label="Old" title="${fmtVal(a.old_value)}">${fmtVal(a.old_value)}</td><td data-label="New" title="${fmtVal(a.new_value)}">${fmtVal(a.new_value)}</td><td data-label="Remarks">${a.remarks || ''}</td></tr>`)}</tbody></table></div>`
        : raw(emptyState('No audit entries match.', 'scroll-text')));
      const pages = Math.max(1, Math.ceil(r.total / st.size));
      setHTML(root.querySelector('#a-pg'), html`<span>${int(r.total)} entries</span><span class="pages"><button class="btn btn-sm" data-p="-1" ${st.page <= 1 ? raw('disabled') : ''}><i data-lucide="chevron-left"></i></button><span>Page ${st.page} / ${pages}</span><button class="btn btn-sm" data-p="1" ${st.page >= pages ? raw('disabled') : ''}><i data-lucide="chevron-right"></i></button></span>`);
    } catch (e) { setHTML(tbl, raw(emptyState(errMsg(e), 'circle-alert'))); }
    icons(root);
  };
  root.querySelector('#a-pg').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { st.page += Number(b.dataset.p); load(); } });
  root.querySelector('#a-q').addEventListener('input', debounce((e) => { st.search = e.target.value.trim(); st.page = 1; load(); }, 400));
  root.querySelector('#a-act').addEventListener('change', (e) => { st.action = e.target.value; st.page = 1; load(); });
  root.querySelector('#a-from').addEventListener('change', (e) => { st.from = e.target.value; st.page = 1; load(); });
  root.querySelector('#a-to').addEventListener('change', (e) => { st.to = e.target.value; st.page = 1; load(); });
  root.querySelector('#a-exp')?.addEventListener('click', async () => {
    try { const r = await rpc('get_audit_logs', { ...params(), p_page: 1, p_size: 5000 });
      exportExcel('SKYNET_Audit_Log', [{ name: 'Audit', rows: r.rows, columns: [{ key: 'created_at', label: 'Date & Time', type: 'text', get: (a) => dmyTime(a.created_at) }, { key: 'user_name', label: 'User', type: 'text' },
        { key: 'action', label: 'Action', type: 'text' }, { key: 'record_type', label: 'Record Type', type: 'text' }, { key: 'record_id', label: 'Record ID / AWB', type: 'text' },
        { key: 'old_value', label: 'Old Value', type: 'text', get: (a) => fmtVal(a.old_value) }, { key: 'new_value', label: 'New Value', type: 'text', get: (a) => fmtVal(a.new_value) }, { key: 'remarks', label: 'Remarks', type: 'text' }] }]);
    } catch (e) { toast(errMsg(e), 'err'); }
  });
  load();
}
export { esc };
