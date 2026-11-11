// =====================================================================
// SKYNET EXPRESS – targets.js : Sales Target Management (admin)
// Monthly revenue / AWB / weight targets per salesperson. A metric with
// no target stays blank – no default target is ever assumed.
// =====================================================================
import { rpc } from './api.js';
import { panel } from './ui.js';
import { renderTargets } from './sales.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, modal, closeOverlays, inr, int, kg, monLabel, confirmDialog, emptyState, isNil, isoDate } from './utils.js';
import { getOptions } from './filters.js';

export async function render(root) {
  const max = getOptions().max_date || isoDate(new Date());
  let month = max.slice(0, 7);
  root.innerHTML = panel({ title: 'Sales targets', sub: 'Set monthly targets for each salesperson. Achievement uses the customer grand total, AWB count and chargeable weight of that month.',
    tools: `<input type="month" class="input" id="t-month" value="${month}" style="width:170px" aria-label="Target month"><button class="btn btn-primary" id="t-add"><i data-lucide="plus"></i>Add / edit target</button>`,
    body: '<div id="t-list"></div>' }) + panel({ title: 'Target vs actual', cls: 'mt', body: '<div id="t-chart"></div>' });
  const load = async () => {
    const list = root.querySelector('#t-list'); list.innerHTML = '<div class="skel" style="height:200px"></div>';
    try {
      const d = await rpc('get_targets', { p_month: month + '-01' });
      const sps = (await rpc('get_salesperson_names')).salespersons;
      setHTML(list, d.targets.length ? html`<div class="table-wrap"><table class="data responsive"><thead><tr><th>Salesperson</th><th class="right">Revenue target</th><th class="right">Actual revenue</th><th class="right">AWB target</th><th class="right">Actual AWB</th><th class="right">Weight target</th><th class="right">Actual weight</th><th class="right">Revenue achievement</th><th></th></tr></thead><tbody>
        ${d.targets.map((t) => html`<tr><td data-label="Salesperson"><b>${t.salesperson_name}</b></td>
          <td class="right num" data-label="Revenue target">${isNil(t.revenue_target) ? '—' : inr(t.revenue_target)}</td><td class="right num" data-label="Actual revenue">${inr(t.actual_revenue)}</td>
          <td class="right num" data-label="AWB target">${isNil(t.awb_target) ? '—' : int(t.awb_target)}</td><td class="right num" data-label="Actual AWB">${int(t.actual_awb)}</td>
          <td class="right num" data-label="Weight target">${isNil(t.weight_target) ? '—' : kg(t.weight_target)}</td><td class="right num" data-label="Actual weight">${kg(t.actual_weight)}</td>
          <td class="right num" data-label="Achievement">${t.revenue_target ? ((t.actual_revenue / t.revenue_target) * 100).toFixed(1) + '%' : '—'}</td>
          <td data-label=""><button class="btn btn-sm" data-edit="${t.salesperson_name}"><i data-lucide="pencil"></i></button> <button class="btn btn-sm btn-danger" data-del="${t.id}" aria-label="Delete target"><i data-lucide="trash-2"></i></button></td></tr>`)}</tbody></table></div>`
        : raw(emptyState(`No targets set for ${monLabel(month + '-01')}.`, 'target')));
      renderTargets(root.querySelector('#t-chart'), d.targets, month + '-01');
      list.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(sps, d.targets.find((t) => t.salesperson_name === b.dataset.edit)));
      list.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        if (!(await confirmDialog('Delete target', 'Remove this target? This is recorded in the audit log.', 'Delete', true))) return;
        try { await rpc('delete_target', { p_id: Number(b.dataset.del) }); toast('Target deleted.', 'ok'); load(); } catch (e) { toast(errMsg(e), 'err'); }
      });
      root.querySelector('#t-add').onclick = () => form(sps, null);
    } catch (e) { setHTML(list, raw(emptyState(errMsg(e), 'circle-alert'))); }
    icons(root);
  };
  const form = (sps, t) => {
    const m = modal({ title: (t ? 'Edit' : 'Add') + ' target – ' + monLabel(month + '-01'),
      body: `<label class="field"><span>Salesperson *</span><select class="select" id="tf-sp" ${t ? 'disabled' : ''}>${sps.map((s) => `<option ${t?.salesperson_name === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <div class="grid g-3"><label class="field"><span>Monthly revenue target (₹)</span><input class="input" id="tf-rev" type="number" min="0" step="0.01" value="${t?.revenue_target ?? ''}"></label>
        <label class="field"><span>Monthly AWB target</span><input class="input" id="tf-awb" type="number" min="0" step="1" value="${t?.awb_target ?? ''}"></label>
        <label class="field"><span>Monthly weight target (KG)</span><input class="input" id="tf-wt" type="number" min="0" step="0.01" value="${t?.weight_target ?? ''}"></label></div>
        <p class="muted" style="font-size:12px">Leave a field blank if no target applies for that metric.</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="tf-save"><i data-lucide="save"></i>Save target</button>` });
    icons(m);
    m.querySelector('#tf-save').onclick = async () => {
      const p = { salesperson_name: t?.salesperson_name || m.querySelector('#tf-sp').value, target_month: month + '-01',
        revenue_target: m.querySelector('#tf-rev').value, awb_target: m.querySelector('#tf-awb').value, weight_target: m.querySelector('#tf-wt').value };
      if (!p.salesperson_name) return toast('Choose a salesperson.', 'err');
      if (!p.revenue_target && !p.awb_target && !p.weight_target) return toast('Enter at least one target.', 'err');
      if ([p.revenue_target, p.awb_target, p.weight_target].some((v) => v !== '' && Number(v) < 0)) return toast('Targets cannot be negative.', 'err');
      try { await rpc('upsert_target', { p }); closeOverlays(); toast('Target saved.', 'ok'); load(); } catch (e) { toast(errMsg(e), 'err'); }
    };
  };
  root.querySelector('#t-month').addEventListener('change', (e) => { month = e.target.value; load(); });
  load();
}
