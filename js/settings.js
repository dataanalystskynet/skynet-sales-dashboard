// =====================================================================
// SKYNET EXPRESS – settings.js : Application Settings (admin)
// Session timeout, page size, username login, import batch size,
// billing currency + approved exchange rates, saved column mappings.
// =====================================================================
import { rpc, sb, isDemo } from './api.js';
import { appState } from './app.js';
import { panel } from './ui.js';
import { FIELDS } from './excel-import.js';
import { CONFIG } from './config.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, dmy, dmyTime, emptyState } from './utils.js';
import { isAdmin } from './permissions.js';

export async function render(root) {
  const s = appState.settings;
  let fx = [];
  try { fx = (await sb().from('exchange_rates').select('currency,rate_to_inr,effective_date,approved_by')).data || []; } catch (_) { /* ignore */ }
  const maps = Object.entries(s.field_mappings || {});
  let dp = { is_set: false };
  if (isAdmin()) { try { dp = await rpc('default_password_info'); } catch (_) { /* ignore */ } }
  root.innerHTML = `<div class="grid g-2">
    ${panel({ title: 'General', body: `
      <label class="field"><span>Company name</span><input class="input" id="s-company" value="${esc(s.company_name || CONFIG.APP_NAME)}"></label>
      <div class="grid g-2"><label class="field"><span>Automatic logout after inactivity (minutes)</span><input class="input" type="number" min="5" max="480" id="s-timeout" value="${esc(s.session_timeout_minutes ?? 30)}"></label>
      <label class="field"><span>Default table page size</span><select class="select" id="s-page">${[10, 15, 25, 50, 100].map((n) => `<option ${Number(s.default_page_size) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <div class="grid g-2"><label class="field"><span>Also allow login with User ID</span><select class="select" id="s-ulogin"><option value="true" ${s.allow_username_login !== false ? 'selected' : ''}>Yes</option><option value="false" ${s.allow_username_login === false ? 'selected' : ''}>No – mobile number (or e-mail) only</option></select></label>
      <label class="field"><span>Import batch size (rows per database call)</span><input class="input" type="number" min="50" max="2000" step="50" id="s-batch" value="${esc(s.import_batch_size ?? 500)}"></label></div>
      <label class="field"><span>Max upload size (MB)</span><input class="input" type="number" min="1" max="100" id="s-maxmb" value="${esc(s.max_upload_mb ?? 30)}"></label>
      <button class="btn btn-primary" id="s-save"><i data-lucide="save"></i>Save settings</button>` })}
    ${panel({ title: 'Billing currency & exchange rates', sub: 'CUSTOMER GRAND TOTAL is treated as INR. Only add rates if the business owner confirms non-INR billing.', body: `
      <label class="field"><span>Default billing currency for imports</span><select class="select" id="s-cur">${fx.map((r) => `<option ${r.currency === (s.billing_currency || 'INR') ? 'selected' : ''}>${esc(r.currency)}</option>`).join('') || '<option>INR</option>'}</select></label>
      <div class="table-wrap"><table class="data"><thead><tr><th>Currency</th><th class="right">Rate to INR</th><th>Effective</th><th>Approved by</th></tr></thead><tbody>
        ${fx.map((r) => `<tr><td>${esc(r.currency)}</td><td class="right num">${esc(r.rate_to_inr)}</td><td>${esc(dmy(r.effective_date))}</td><td>${esc(r.approved_by || '')}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid g-3 mt"><label class="field"><span>Currency (ISO)</span><input class="input" id="fx-c" maxlength="3" placeholder="USD"></label>
        <label class="field"><span>₹ per 1 unit</span><input class="input" id="fx-r" type="number" step="0.000001" min="0"></label>
        <label class="field"><span>Approved by</span><input class="input" id="fx-a" placeholder="Name"></label></div>
      <button class="btn" id="fx-save"><i data-lucide="plus"></i>Save rate</button>
      <p class="muted" style="font-size:12px">SHIPMENT VALUE (declared value, multiple currencies) is never added to revenue.</p>` })}
  </div>
  ${isAdmin() ? panel({ title: 'Default password', cls: 'mt', sub: 'Used for new users ("Default password") and for "Reset to default password". Stored only on the server – never shown again, never in the website code.', body: `
      <div class="kv"><div>Status</div><div>${dp.is_set ? `<span class="badge ok">Set</span> <span class="muted">last changed ${esc(dmyTime(dp.updated_at))}</span>` : '<span class="badge hold">Not set yet</span>'}</div></div>
      <div class="grid g-2 mt"><label class="field"><span>New default password (min 8, letters + numbers)</span><input class="input" id="dp-1" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Confirm</span><input class="input" id="dp-2" type="password" autocomplete="new-password"></label></div>
      <button class="btn btn-primary" id="dp-save"><i data-lucide="key-round"></i>Save default password</button>
      <p class="muted" style="font-size:12px">Users who get the default password must set their own password at first login.</p>` }) : ''}
  ${panel({ title: 'Saved column mappings', sub: 'Custom Excel headings learned from earlier imports (in addition to the built-in aliases).', cls: 'mt', body: maps.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th>Excel heading key</th><th>Dashboard field</th><th></th></tr></thead><tbody>${maps.map(([k, f]) => `<tr><td>${esc(k)}</td><td>${esc(FIELDS[f]?.label || f)}</td><td><button class="btn btn-sm btn-danger" data-rm="${esc(k)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('No custom mappings saved yet. Save one from the import mapping step.', 'columns-3') })}
  ${panel({ title: 'Connection', cls: 'mt', body: `<div class="kv"><div>Mode</div><div>${isDemo() ? 'Demo sandbox (synthetic data, nothing saved)' : 'Supabase'}</div><div>Project URL</div><div>${esc(CONFIG.SUPABASE_URL)}</div><div>Key in browser</div><div>Publishable key only (protected by RLS). The service role key is never used in the frontend.</div></div>` })}`;
  const save = async (k, v) => { await rpc('set_setting', { p_key: k, p_value: v }); appState.settings[k] = v; };
  root.querySelector('#s-save').onclick = async () => {
    const t = Number(root.querySelector('#s-timeout').value), b = Number(root.querySelector('#s-batch').value), mb = Number(root.querySelector('#s-maxmb').value);
    if (!(t >= 5 && t <= 480)) return toast('Timeout must be 5–480 minutes.', 'err');
    if (!(b >= 50 && b <= 2000)) return toast('Batch size must be 50–2000.', 'err');
    try {
      await save('company_name', root.querySelector('#s-company').value.trim() || CONFIG.APP_NAME);
      await save('session_timeout_minutes', t); await save('default_page_size', Number(root.querySelector('#s-page').value));
      await save('allow_username_login', root.querySelector('#s-ulogin').value === 'true'); await save('import_batch_size', b); await save('max_upload_mb', mb);
      await save('billing_currency', root.querySelector('#s-cur').value);
      toast('Settings saved. The new logout timeout applies from the next login.', 'ok');
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  root.querySelector('#dp-save')?.addEventListener('click', async () => {
    const a = root.querySelector('#dp-1').value, b2 = root.querySelector('#dp-2').value;
    if (a !== b2) return toast('The two entries do not match.', 'err');
    if (a.length < 8 || !/[A-Za-z]/.test(a) || !/\d/.test(a)) return toast('Default password: min 8 characters with letters and numbers.', 'err');
    try { await rpc('set_default_password', { p_password: a }); toast('Default password saved.', 'ok'); render(root); } catch (e) { toast(errMsg(e), 'err'); }
  });
  root.querySelector('#fx-save').onclick = async () => {
    const c = root.querySelector('#fx-c').value.trim().toUpperCase(), r = Number(root.querySelector('#fx-r').value), a = root.querySelector('#fx-a').value.trim();
    if (!/^[A-Z]{3}$/.test(c)) return toast('Enter a 3-letter currency code.', 'err');
    if (!(r > 0)) return toast('Enter a positive rate.', 'err');
    if (!a) return toast('Enter who approved the rate.', 'err');
    try { await rpc('upsert_exchange_rate', { p_currency: c, p_rate: r, p_approved_by: a }); toast('Rate saved.', 'ok'); render(root); } catch (e) { toast(errMsg(e), 'err'); }
  };
  root.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
    const m = { ...(s.field_mappings || {}) }; delete m[b.dataset.rm];
    try { await save('field_mappings', m); toast('Mapping removed.', 'ok'); render(root); } catch (e) { toast(errMsg(e), 'err'); }
  });
  icons(root);
}
export { html, raw, setHTML };
