// =====================================================================
// SKYNET EXPRESS – users.js : User Management (admin)
// Auth users are created / deleted through the "admin-users" Edge Function
// (service role stays server-side). Profiles + permissions are updated via
// the admin_update_user() database function. Passwords are never stored
// or exported by the app.
// =====================================================================
import { rpc, invokeAdmin, isDemo } from './api.js';
import { PERMISSION_DEFS, defaultPermission, isAdmin, profile } from './permissions.js';
import { panel } from './ui.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, modal, closeOverlays, dmyTime, exportExcel, emptyState, debounce, confirmDialog } from './utils.js';

let lookups = { salespersons: [], hubs: [] };

export async function render(root) {
  root.innerHTML = '<div class="skel skel-chart"></div>';
  const [users, lk] = await Promise.all([rpc('admin_list_users'), rpc('get_salesperson_names').catch(() => ({ salespersons: [], hubs: [] }))]);
  lookups = lk;
  root.innerHTML = panel({ title: 'Users', sub: `${users.length} accounts · roles, data scope and page permissions`,
    tools: `<button class="btn" id="u-exp"><i data-lucide="download"></i>Export users</button><button class="btn btn-primary" id="u-add"><i data-lucide="user-plus"></i>Add user</button>`,
    body: `<div class="table-tools"><div class="input-icon grow"><i data-lucide="search"></i><input class="input" id="u-q" placeholder="Search name, user ID or e-mail"></div>
      <select class="select" id="u-role" style="width:170px"><option value="">All roles</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="sales">Sales</option></select></div><div id="u-tbl"></div>` });
  const draw = () => {
    const q = root.querySelector('#u-q').value.toLowerCase(), role = root.querySelector('#u-role').value;
    const list = users.filter((u) => (!role || u.role === role) && (!q || [u.full_name, u.username, u.email, u.mobile].some((x) => (x || '').toLowerCase().includes(q))));
    setHTML(root.querySelector('#u-tbl'), list.length ? html`<div class="table-wrap"><table class="data responsive"><thead><tr><th>Name</th><th>User ID</th><th>E-mail</th><th>Mobile</th><th>Role</th><th>Hubs</th><th>Salesperson mapping</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
      ${list.map((u) => html`<tr><td data-label="Name"><b>${u.full_name || '—'}</b></td><td data-label="User ID">${u.username || '—'}</td><td data-label="E-mail">${u.email || '—'}</td><td data-label="Mobile">${u.mobile || '—'}</td>
        <td data-label="Role"><span class="badge info" style="text-transform:capitalize">${u.role}</span></td><td data-label="Hubs">${(u.assigned_hubs || []).join(', ') || '—'}</td>
        <td data-label="Salesperson">${[...(u.salesperson_names || []), ...(u.team_salespersons || []).map((x) => x + ' (team)')].join(', ') || raw('<span class="muted">Not mapped</span>')}</td>
        <td data-label="Status">${raw(u.is_active ? '<span class="badge ok">Active</span>' : '<span class="badge hold">Inactive</span>')}</td>
        <td data-label="Last login">${u.last_login_at ? dmyTime(u.last_login_at) : '—'}</td>
        <td data-label=""><button class="btn btn-sm" data-edit="${u.id}"><i data-lucide="pencil"></i>Edit</button></td></tr>`)}</tbody></table></div>`
      : raw(emptyState('No users match.', 'users')));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userForm(users.find((u) => u.id === b.dataset.edit), () => render(root))));
  };
  root.querySelector('#u-q').addEventListener('input', debounce(draw, 200));
  root.querySelector('#u-role').addEventListener('change', draw);
  root.querySelector('#u-add').addEventListener('click', () => userForm(null, () => render(root)));
  root.querySelector('#u-exp').addEventListener('click', () => exportExcel('SKYNET_Users', [{ name: 'Users', rows: users, columns: [
    { key: 'full_name', label: 'Full Name', type: 'text' }, { key: 'username', label: 'User ID', type: 'text' }, { key: 'email', label: 'E-mail', type: 'text' },
    { key: 'mobile', label: 'Mobile', type: 'text' }, { key: 'role', label: 'Role', type: 'text' }, { key: 'assigned_hubs', label: 'Assigned Hubs', type: 'text', get: (u) => (u.assigned_hubs || []).join(', ') },
    { key: 'salesperson_names', label: 'Salesperson Name', type: 'text', get: (u) => (u.salesperson_names || []).join(', ') }, { key: 'team_salespersons', label: 'Team', type: 'text', get: (u) => (u.team_salespersons || []).join(', ') },
    { key: 'is_active', label: 'Active', type: 'text', get: (u) => (u.is_active ? 'Active' : 'Inactive') }, { key: 'last_login_at', label: 'Last Login', type: 'text', get: (u) => (u.last_login_at ? dmyTime(u.last_login_at) : '') }] }]));
  draw(); icons(root);
}

function checkList(name, options, selected, placeholder) {
  return `<div class="field"><input class="input" data-filter="${name}" placeholder="${esc(placeholder)}" style="height:34px">
    <div data-list="${name}" style="max-height:150px;overflow:auto;border:1px solid var(--panel-border);border-radius:10px;padding:6px 10px;margin-top:6px">
    ${options.length ? options.map((o) => `<label class="check" style="display:flex;padding:3px 0"><input type="checkbox" name="${name}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('') : '<span class="muted">No values in data yet – import an Excel file first.</span>'}</div></div>`;
}

function userForm(u, onDone) {
  const isNew = !u; const me = profile();
  u = u || { full_name: '', username: '', email: '', mobile: '', role: 'sales', assigned_hubs: [], salesperson_names: [], team_salespersons: [], is_active: true, permission_overrides: {} };
  const permRow = (role) => PERMISSION_DEFS.map((d) => { const cur = u.permission_overrides?.[d.key] || 'default';
    return `<div class="perm-row"><span>${esc(d.label)}</span><select class="select" data-perm="${d.key}" ${role === 'admin' ? 'disabled' : ''}>
      <option value="default" ${cur === 'default' ? 'selected' : ''}>Default (${esc(defaultPermission(role, d.key))})</option>
      ${d.options.map((o) => `<option value="${o}" ${cur === o ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></div>`; }).join('');
  const m = modal({ title: isNew ? 'Add user' : 'Edit user – ' + (u.full_name || u.email), wide: true,
    body: `<div class="grid g-3">
        <label class="field"><span>Full name *</span><input class="input" id="f-name" value="${esc(u.full_name)}" maxlength="120"></label>
        <label class="field"><span>Mobile number * (login ID)</span><input class="input" id="f-mobile" value="${esc(u.mobile || '')}" maxlength="15" inputmode="tel" placeholder="10-digit mobile"></label>
        <label class="field"><span>E-mail address${isNew ? ' (optional – can be shared)' : ''}</span><input class="input" id="f-email" type="email" value="${esc(u.email || '')}" ${isNew ? '' : 'disabled title="Contact e-mail – set when the user was created"'}></label>
        <label class="field"><span>User ID (optional)</span><input class="input" id="f-user" value="${esc(u.username || '')}" placeholder="e.g. muskan" maxlength="40"></label>
        <label class="field"><span>Role *</span><select class="select" id="f-role" ${!isAdmin() && u.role === 'admin' ? 'disabled' : ''}>
          ${['sales', 'manager', 'admin'].filter((r) => isAdmin() || r !== 'admin').map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r === 'admin' ? 'Super Admin / Admin' : r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></label>
        <label class="field"><span>Status</span><select class="select" id="f-active"><option value="1" ${u.is_active ? 'selected' : ''}>Active</option><option value="0" ${u.is_active ? '' : 'selected'}>Inactive</option></select></label>
      </div>
      ${isNew ? `<div class="grid g-2"><div class="field"><span style="font-size:12.5px;color:var(--text-2)">Login setup</span>
          <div class="seg" id="f-mode"><button type="button" class="on" data-v="password">Set initial password</button><button type="button" data-v="invite">Send invitation e-mail</button></div></div>
          <label class="field" id="f-pw-wrap"><span>Initial password (min 8, letters + numbers)</span><input class="input" id="f-pw" type="password" autocomplete="new-password"></label></div>` : ''}
      <div class="section-title">Data mapping</div>
      <div class="grid g-3">
        <div><span style="font-size:12.5px;color:var(--text-2)">Assigned hub(s) – manager hub scope</span>${checkList('hubs', lookups.hubs, u.assigned_hubs || [], 'Filter hubs')}</div>
        <div><span style="font-size:12.5px;color:var(--text-2)">Salesperson identity (SALESMAN NAME this user is)</span>${checkList('sp', lookups.salespersons, u.salesperson_names || [], 'Search salesperson')}</div>
        <div><span style="font-size:12.5px;color:var(--text-2)">Team salespersons (manager supervises)</span>${checkList('team', lookups.salespersons, u.team_salespersons || [], 'Search salesperson')}</div>
      </div>
      <div class="section-title">Permissions <span class="muted" style="font-weight:400">– "Default" follows the role. Data scope uses the most restrictive of the three visibility settings.</span></div>
      <div class="perm-grid" id="f-perms">${permRow(u.role)}</div>
      ${!isNew ? `<div class="section-title">Account actions</div><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="f-setpw" type="button"><i data-lucide="key-round"></i>Set new password</button>
        ${u.id !== me.id ? '<button class="btn btn-danger" id="f-del" type="button"><i data-lucide="trash-2"></i>Delete user</button>' : ''}</div>` : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="f-save"><i data-lucide="save"></i>${isNew ? 'Create user' : 'Save changes'}</button>` });
  icons(m);
  m.querySelectorAll('[data-filter]').forEach((inp) => inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase(); m.querySelectorAll(`[data-list="${inp.dataset.filter}"] label`).forEach((l) => { l.style.display = l.textContent.toLowerCase().includes(q) ? 'flex' : 'none'; });
  }));
  m.querySelector('#f-role').addEventListener('change', (e) => { u.permission_overrides = collectPerms(m); setHTML(m.querySelector('#f-perms'), raw(permRow(e.target.value))); });
  let mode = 'password';
  m.querySelector('#f-mode')?.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v;
    m.querySelectorAll('#f-mode button').forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('#f-pw-wrap').classList.toggle('hidden', mode !== 'password'); });
  m.querySelector('#f-setpw')?.addEventListener('click', () => setPassword(u));
  m.querySelector('#f-del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete user', `Permanently delete ${u.full_name || u.email}? Their login is removed; audit history is kept. Consider "Inactive" instead.`, 'Delete user', true))) return;
    try { await invokeAdmin('delete', { user_id: u.id }); toast('User deleted.', 'ok'); onDone(); } catch (e) { toast(errMsg(e), 'err'); }
  });
  m.querySelector('#f-save').addEventListener('click', async () => {
    const vals = (n) => [...m.querySelectorAll(`input[name="${n}"]:checked`)].map((x) => x.value);
    const p = { full_name: m.querySelector('#f-name').value.trim(), username: m.querySelector('#f-user').value.trim().toLowerCase() || null, mobile: m.querySelector('#f-mobile').value.trim(),
      role: m.querySelector('#f-role').value, is_active: m.querySelector('#f-active').value === '1', assigned_hubs: vals('hubs'), salesperson_names: vals('sp'), team_salespersons: vals('team') };
    const perms = collectPerms(m);
    if (!p.full_name) return toast('Full name is required.', 'err');
    if (p.username && !/^[a-z0-9._-]{3,40}$/.test(p.username)) return toast('User ID: 3–40 characters, letters, numbers, dot, dash or underscore.', 'err');
    const mob = p.mobile.replace(/\D/g, '').slice(-10);
    if (mob.length !== 10 || !/^[+0-9 ()-]{10,15}$/.test(p.mobile)) return toast('Enter a valid 10-digit mobile number – users sign in with it.', 'err');
    p.mobile = mob;
    if (p.role === 'sales' && !p.salesperson_names.length) toast('Note: a SALES user without a salesperson mapping sees no shipment data.', 'info', 6000);
    try {
      if (isNew) {
        const email = m.querySelector('#f-email').value.trim();
        if (email && !/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid e-mail address (or leave it empty).', 'err');
        if (mode === 'invite' && !email) return toast('An invitation needs an e-mail address – or choose "Set initial password".', 'err');
        const password = mode === 'password' ? m.querySelector('#f-pw').value : null;
        if (mode === 'password' && (!password || password.length < 8 || !/\d/.test(password) || !/[A-Za-z]/.test(password))) return toast('Password: min 8 characters with letters and numbers.', 'err');
        await invokeAdmin('create', { email, password, invite: mode === 'invite', redirect_to: location.origin + location.pathname, ...p, permissions: perms });
        toast(mode === 'invite' ? `Invitation sent to ${email}.` : `User created – signs in with mobile ${p.mobile} and the password you set.`, 'ok', 7000);
      } else {
        await rpc('admin_update_user', { p_id: u.id, p, p_perms: perms });
        if (u.is_active !== p.is_active) { try { await invokeAdmin('set_active', { user_id: u.id, is_active: p.is_active }); } catch (_) { /* profile flag already blocks access */ } }
        toast('User updated.', 'ok');
      }
      closeOverlays(); onDone();
    } catch (e) { toast(errMsg(e), 'err', 7000); }
  });
}
function collectPerms(m) { const o = {}; m.querySelectorAll('[data-perm]').forEach((s) => { o[s.dataset.perm] = s.value; }); return o; }

function setPassword(u) {
  const m = modal({ title: 'Set new password – ' + (u.full_name || u.email),
    body: `<p class="muted">The user can also reset it themselves with "Forgot password". The password is sent directly to Supabase Auth and never stored by the app.</p>
      <label class="field"><span>New password</span><input class="input" id="sp-pw" type="password" autocomplete="new-password"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="sp-go">Set password</button>` });
  m.querySelector('#sp-go').onclick = async () => {
    const pw = m.querySelector('#sp-pw').value;
    if (pw.length < 8 || !/\d/.test(pw) || !/[A-Za-z]/.test(pw)) return toast('Password: min 8 characters with letters and numbers.', 'err');
    try { await invokeAdmin('set_password', { user_id: u.id, password: pw }); closeOverlays(); toast('Password updated.', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
  };
}
export { isDemo };
