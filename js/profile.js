// =====================================================================
// SKYNET EXPRESS – profile.js : My Profile (name, e-mail, mobile, photo,
// password – password & e-mail changes go through Supabase Auth)
// =====================================================================
import { rpc, sb } from './api.js';
import { profile, setContext, getContext, PERMISSION_DEFS } from './permissions.js';
import { changePassword, changeEmail } from './auth.js';
import { renderAvatar } from './app.js';
import { panel } from './ui.js';
import { esc, html, raw, setHTML, icons, toast, errMsg, dmyTime } from './utils.js';

export async function render(root) {
  const p = profile(); const ctx = getContext();
  root.innerHTML = `<div class="grid g-1-2">
    ${panel({ title: 'My profile', cls: 'watermark', body: `<div style="display:flex;gap:18px;align-items:center"><div class="avatar lg" id="pf-av"></div>
        <div><h2 style="font-size:20px">${esc(p.full_name)}</h2><div class="muted">${esc(p.email)}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><span class="badge info" style="text-transform:capitalize">${esc(p.role)}</span><span class="badge mute">Data scope: ${esc(ctx.scope)}</span></div></div></div>
      <label class="btn mt" style="width:fit-content"><i data-lucide="image-up"></i>Change photo<input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden></label>
      <div class="kv mt"><div>User ID</div><div>${esc(p.username || '—')}</div><div>Assigned hubs</div><div>${esc((p.assigned_hubs || []).join(', ') || '—')}</div>
        <div>Salesperson identity</div><div>${esc((p.salesperson_names || []).join(', ') || '—')}</div><div>Last login</div><div>${esc(p.last_login_at ? dmyTime(p.last_login_at) : '—')}</div></div>` })}
    <div class="grid">
      ${panel({ title: 'Personal details', body: `<div class="grid g-2"><label class="field"><span>Full name</span><input class="input" id="pf-name" value="${esc(p.full_name)}" maxlength="120"></label>
        <label class="field"><span>Mobile number (login ID – changed by admin)</span><input class="input" id="pf-mobile" value="${esc(p.mobile || '')}" disabled></label></div>
        <button class="btn btn-primary" id="pf-save"><i data-lucide="save"></i>Save details</button>` })}
      ${panel({ title: 'E-mail address', sub: 'A confirmation link is sent to the new address; the change applies after you confirm it.', body: `<div class="grid g-2"><label class="field"><span>New e-mail</span><input class="input" id="pf-email" type="email" value="${esc(p.email)}"></label></div>
        <button class="btn" id="pf-email-btn"><i data-lucide="mail"></i>Change e-mail</button>` })}
      ${panel({ title: 'Change password', body: `<div class="grid g-3"><label class="field"><span>Current password</span><input class="input" id="pw0" type="password" autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input class="input" id="pw1" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Confirm new password</span><input class="input" id="pw2" type="password" autocomplete="new-password"></label></div>
        <button class="btn" id="pw-btn"><i data-lucide="key-round"></i>Update password</button>` })}
    </div></div>
    ${panel({ title: 'My permissions', sub: 'Set by your administrator', cls: 'mt', body: `<div class="perm-grid">${PERMISSION_DEFS.map((d) => `<div class="perm-row"><span>${esc(d.label)}</span><b style="text-transform:capitalize">${esc(ctx.permissions[d.key] || '—')}</b></div>`).join('')}</div>` })}`;
  renderAvatar(root.querySelector('#pf-av'), p);
  const refreshCtx = (np) => { setContext({ ...getContext(), profile: { ...getContext().profile, ...np } }); document.querySelector('#user-name').textContent = np.full_name; renderAvatar(document.querySelector('#user-avatar'), getContext().profile); };
  root.querySelector('#pf-save').onclick = async () => {
    const full_name = root.querySelector('#pf-name').value.trim();
    if (!full_name) return toast('Name cannot be empty.', 'err');
    try { const np = await rpc('update_my_profile', { p: { full_name } }); refreshCtx(np); toast('Profile saved.', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
  };
  root.querySelector('#pf-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Use a PNG, JPG or WEBP image.', 'err');
    if (f.size > 2 * 1048576) return toast('Image must be under 2 MB.', 'err');
    try {
      const path = `${p.id}/avatar-${Date.now()}.${f.type.split('/')[1]}`;
      const { error } = await sb().storage.from('avatars').upload(path, f, { upsert: true, contentType: f.type });
      if (error) throw error;
      const url = sb().storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const np = await rpc('update_my_profile', { p: { avatar_url: url } }); refreshCtx(np); renderAvatar(root.querySelector('#pf-av'), np); toast('Photo updated.', 'ok');
    } catch (err) { toast(errMsg(err), 'err'); }
  };
  root.querySelector('#pf-email-btn').onclick = async () => {
    const em = root.querySelector('#pf-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) return toast('Enter a valid e-mail.', 'err');
    if (em === p.email) return toast('That is already your e-mail.', 'info');
    try { await changeEmail(em); toast('Confirmation sent. Check both inboxes to complete the change.', 'ok', 7000); } catch (e) { toast(errMsg(e), 'err'); }
  };
  root.querySelector('#pw-btn').onclick = async () => {
    const a = root.querySelector('#pw1').value, b = root.querySelector('#pw2').value, cur = root.querySelector('#pw0').value;
    if (!cur) return toast('Enter your current password.', 'err');
    if (a !== b) return toast('New passwords do not match.', 'err');
    try { await changePassword(a, cur); ['#pw0', '#pw1', '#pw2'].forEach((s) => { root.querySelector(s).value = ''; }); toast('Password updated.', 'ok'); } catch (e) { toast(errMsg(e), 'err'); }
  };
  icons(root);
}
export { html, raw, setHTML };
