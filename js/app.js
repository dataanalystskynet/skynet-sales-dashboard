// =====================================================================
// SKYNET EXPRESS – app.js : boot, login screen, shell, router, themes,
// notifications. Hash routing (#/dashboard) works on GitHub Pages.
// =====================================================================
import { CONFIG } from './config.js';
import { initApi, rpc, isDemo, sb } from './api.js';
import * as auth from './auth.js';
import { setContext, getContext, profile, allowedRoutes, firstAllowedRoute, ROUTES } from './permissions.js';
import * as filters from './filters.js';
import { destroyAll } from './charts.js';
import { startFx3d } from './fx3d.js';
import { $, $$, esc, html, raw, setHTML, toast, errMsg, icons, storageGet, storageSet, closeOverlays, dmyTime, int } from './utils.js';

const PAGES = {
  dashboard: () => import('./dashboard.js'),
  customers: () => import('./customers.js'),
  sales: () => import('./sales.js'),
  'country-hub': () => import('./country-hub.js'),
  shipments: () => import('./shipments.js'),
  import: () => import('./excel-import.js'),
  users: () => import('./users.js'),
  targets: () => import('./targets.js'),
  profile: () => import('./profile.js'),
  audit: () => import('./audit.js'),
  settings: () => import('./settings.js'),
};
export const appState = { settings: {}, currentRoute: null, renderToken: 0 };

const THEMES = [
  { id: 'navy', name: 'Navy Command', sw: 'linear-gradient(135deg,#0C1B3D 50%,#E32B24 50%)' },
  { id: 'crimson', name: 'Skynet Crimson', sw: 'linear-gradient(135deg,#1E0B12 50%,#FF8A5B 50%)' },
  { id: 'ocean', name: 'Ocean Route', sw: 'linear-gradient(135deg,#062636 50%,#18C3E0 50%)' },
  { id: 'emerald', name: 'Emerald Lane', sw: 'linear-gradient(135deg,#072117 50%,#2FCB8A 50%)' },
  { id: 'graphite', name: 'Graphite', sw: 'linear-gradient(135deg,#1A1D22 50%,#8FA8D8 50%)' },
];

// ---------------------------------------------------------------- boot
async function boot() {
  try { await initApi(); }
  catch (e) { $('#boot').textContent = 'Could not start: ' + errMsg(e); return; }
  auth.watchAuthEvents();
  startFx3d();
  let session = null;
  try { session = await auth.getSession(); } catch (_) { /* ignore */ }
  $('#boot').remove();
  if (session) await enterApp(); else showLogin();
}

function showLogin() {
  document.body.classList.remove('authed');
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  icons();
  const msg = sessionStorage.getItem('skynet_logout_reason');
  if (msg) { const box = $('#login-msg'); box.textContent = msg; box.classList.remove('hidden'); sessionStorage.removeItem('skynet_logout_reason'); }
  if (isDemo()) {
    const h = $('#demo-hint'); h.classList.remove('hidden');
    setHTML(h, html`<b>Demo mode</b> – synthetic data, nothing is saved to Supabase.<br>
      Mobile – Admin: <code>9800000001</code> · Manager: <code>9800000002</code> · Sales: <code>9800000003</code><br>Password for all: <code>Demo@123</code>`);
    if (!$('#login-id').value) { $('#login-id').value = '9800000001'; $('#login-pw').value = 'Demo@123'; }
  }
  $('#forgot-link').onclick = () => auth.showForgotPassword($('#login-id').value);
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#login-btn'); btn.disabled = true;
    $('#login-msg').classList.add('hidden');
    try {
      await auth.signIn($('#login-id').value, $('#login-pw').value, $('#login-remember').checked);
      $('#login-screen').classList.add('hidden');
      await enterApp();
    } catch (err) {
      const box = $('#login-msg'); box.textContent = errMsg(err); box.classList.remove('hidden');
    } finally { btn.disabled = false; }
  };
}

async function loadSettings() {
  try {
    const { data } = await sb().from('app_settings').select('key,value');
    appState.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  } catch (_) { appState.settings = {}; }
}

async function enterApp() {
  let ctx;
  try { ctx = await rpc('get_my_context'); }
  catch (e) {
    toast(errMsg(e), 'err');
    await sb().auth.signOut(); showLogin(); return;
  }
  if (!ctx.profile?.is_active) {
    await sb().auth.signOut();
    sessionStorage.setItem('skynet_logout_reason', 'Your account is inactive. Please contact the administrator.');
    showLogin(); return;
  }
  setContext(ctx);
  await loadSettings();
  const pref = ctx.profile.preferences || {};
  if (pref.theme && !storageGet('skynet_theme')) setTheme(pref.theme, pref.mode || 'dark', false);

  document.body.classList.add('authed');
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderShell();
  try { await filters.loadOptions(); } catch (e) { toast('Could not load filters: ' + errMsg(e), 'err'); }
  filters.renderFilterBar($('#filterbar'));
  filters.bindTopControls();
  filters.renderChips();
  filters.onApply(() => { const r = ROUTES.find((x) => x.id === appState.currentRoute); if (r?.filters) route(); });
  auth.startIdleTimer(Number(appState.settings.session_timeout_minutes) || CONFIG.SESSION_IDLE_MINUTES);
  window.addEventListener('hashchange', route);
  route();
  loadNotifications();
  if (ctx.profile.must_change_password) await auth.forcePasswordChange();
}

// ---------------------------------------------------------------- shell
let shellBound = false;
export function renderShell() {
  const p = profile();
  const routes = allowedRoutes();
  setHTML($('#nav'), html`${routes.map((r) => html`<a href="#/${r.id}" data-route="${r.id}" title="${r.label}"><i data-lucide="${r.icon}"></i><span class="label">${r.label}</span></a>`)}
    <a href="#/logout" data-route="logout" title="Logout"><i data-lucide="log-out"></i><span class="label">Logout</span></a>`);
  $('#nav [data-route="logout"]').addEventListener('click', (e) => { e.preventDefault(); auth.signOut(); });

  // user chip
  $('#user-name').textContent = p.full_name || p.email || 'User';
  $('#user-role').textContent = (p.role || '') + (isDemo() ? ' · demo' : '');
  renderAvatar($('#user-avatar'), p);

  icons();
  if (shellBound) return;
  shellBound = true;
  // sidebar hover-expand / auto-collapse
  const sb_ = $('#sidebar');
  sb_.addEventListener('mouseenter', () => sb_.classList.add('expanded'));
  sb_.addEventListener('mouseleave', () => sb_.classList.remove('expanded'));
  const pinned = storageGet('skynet_sidebar_pinned', false);
  if (pinned) { sb_.classList.add('pinned'); document.body.classList.add('sidebar-pinned'); }
  $('#pin-btn').onclick = () => {
    const on = !sb_.classList.contains('pinned');
    sb_.classList.toggle('pinned', on); document.body.classList.toggle('sidebar-pinned', on); storageSet('skynet_sidebar_pinned', on);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
  };
  $('#hamburger').onclick = () => sb_.classList.toggle('mobile-open');
  $('#nav').addEventListener('click', () => sb_.classList.remove('mobile-open'));
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 760 && sb_.classList.contains('mobile-open') && !sb_.contains(e.target) && !$('#hamburger').contains(e.target)) sb_.classList.remove('mobile-open');
  });

  // dropdowns
  setupDropdown('#user-btn', '#user-dd', renderUserMenu);
  setupDropdown('#theme-btn', '#theme-dd', renderThemeMenu);
  setupDropdown('#notif-btn', '#notif-dd', renderNotifMenu);
  icons();
}

export function renderAvatar(el, p) {
  if (p.avatar_url) setHTML(el, html`<img src="${p.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`);
  else el.textContent = (p.full_name || p.email || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
}

function setupDropdown(btnSel, ddSel, renderFn) {
  const btn = $(btnSel), dd = $(ddSel);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dd.classList.contains('hidden');
    $$('.dropdown').forEach((x) => x.classList.add('hidden'));
    if (open) { renderFn(dd); dd.classList.remove('hidden'); }
  });
  dd.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => dd.classList.add('hidden'));
}

function renderUserMenu(dd) {
  const p = profile();
  setHTML(dd, html`<div class="dd-head"><b>${p.full_name || 'User'}</b><div class="muted" style="font-size:12px">${p.email || ''}</div>
      <div style="margin-top:6px"><span class="badge info" style="text-transform:capitalize">${p.role}</span> <span class="badge mute">Scope: ${getContext().scope}</span></div></div>
    <a class="dd-item" href="#/profile"><i data-lucide="circle-user-round"></i>My Profile</a>
    <a class="dd-item" href="#/profile"><i data-lucide="key-round"></i>Change password</a>
    <button class="dd-item" id="dd-logout"><i data-lucide="log-out"></i>Logout</button>`);
  dd.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => dd.classList.add('hidden')));
  $('#dd-logout', dd).onclick = () => auth.signOut();
}

function renderThemeMenu(dd) {
  const cur = document.documentElement.dataset.theme, mode = document.documentElement.dataset.mode;
  setHTML(dd, html`<div class="dd-head"><b>Theme</b><div class="muted" style="font-size:12px">${THEMES.find((t) => t.id === cur)?.name || ''}</div></div>
    <div class="theme-swatches">${THEMES.map((t) => html`<button class="swatch ${t.id === cur ? 'active' : ''}" data-theme="${t.id}" title="${t.name}" aria-label="${t.name}" style="background:${raw(t.sw)}"></button>`)}</div>
    <div style="padding:4px 10px 8px"><div class="seg" style="width:100%">
      <button class="${mode === 'dark' ? 'on' : ''}" data-mode="dark" style="flex:1"><i data-lucide="moon"></i> Dark</button>
      <button class="${mode === 'light' ? 'on' : ''}" data-mode="light" style="flex:1"><i data-lucide="sun"></i> Light</button></div></div>`);
  dd.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { setTheme(b.dataset.theme, document.documentElement.dataset.mode); renderThemeMenu(dd); });
  dd.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { setTheme(document.documentElement.dataset.theme, b.dataset.mode); renderThemeMenu(dd); });
}

function setTheme(theme, mode, persist = true) {
  document.documentElement.dataset.theme = theme; document.documentElement.dataset.mode = mode;
  storageSet('skynet_theme', { theme, mode });
  if (persist) {
    rpc('update_my_profile', { p: { preferences: { theme, mode } } }, { silent: true }).catch(() => {});
    if (appState.currentRoute) route(); // re-render charts in new colours
  }
}

// ---------------------------------------------------------------- notifications
let notifData = null;
async function loadNotifications() {
  try {
    notifData = await rpc('get_notifications', {}, { silent: true });
    const seen = storageGet('skynet_notif_seen', 0);
    const latest = Math.max(0, ...[...(notifData.imports || []), ...(notifData.holds || [])].map((x) => new Date(x.uploaded_at || x.created_at).getTime()));
    $('#notif-dot').classList.toggle('hidden', !(latest > seen));
  } catch (_) { /* ignore */ }
}
function renderNotifMenu(dd) {
  storageSet('skynet_notif_seen', Date.now()); $('#notif-dot').classList.add('hidden');
  const d = notifData || { imports: [], holds: [] };
  const items = [
    ...d.imports.map((i) => ({ t: i.uploaded_at, h: html`<b>Excel import ${i.status}</b> – ${i.file_name}<br><span class="muted">${int(i.new_records)} new · ${int(i.updated_records)} updated · ${int(i.failed_records)} failed · ${i.uploaded_by_name || ''}</span>` })),
    ...d.holds.map((x) => ({ t: x.created_at, h: html`<b>AWB ${x.awb}</b> set to ${x.is_hold === 'YES' ? 'HOLD' : 'UNHOLD'}<br><span class="muted">${x.user_name || ''} – ${x.remarks || ''}</span>` })),
  ].sort((a, b) => String(b.t).localeCompare(String(a.t))).slice(0, 10);
  setHTML(dd, html`<div class="dd-head"><b>Notifications</b></div>
    ${items.length ? items.map((i) => html`<div class="notif-item">${i.h}<div class="muted" style="font-size:11px;margin-top:2px">${dmyTime(i.t)}</div></div>`)
      : raw('<div class="notif-item muted">No recent imports or hold changes.</div>')}`);
}

// ---------------------------------------------------------------- router
async function route() {
  closeOverlays();
  let id = (location.hash || '').replace(/^#\/?/, '').split('?')[0] || firstAllowedRoute();
  if (id === 'login') id = firstAllowedRoute();
  const r = ROUTES.find((x) => x.id === id);
  if (!r || !PAGES[id]) { location.hash = '#/' + firstAllowedRoute(); return; }
  if (!r.perm()) { toast('You do not have access to ' + r.label + '.', 'err'); location.hash = '#/' + firstAllowedRoute(); return; }
  appState.currentRoute = id;
  const token = ++appState.renderToken;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
  $('#page-title').textContent = r.label;
  document.title = r.label + ' · SKYNET Sales Intelligence';
  $('#filterbar').classList.toggle('hidden', !r.filters);
  $('#filter-chips').classList.toggle('hidden', !r.filters);
  destroyAll();
  const view = $('#view');
  try {
    const mod = await PAGES[id]();
    if (token !== appState.renderToken) return;
    view.innerHTML = '';
    const page = document.createElement('div'); page.className = 'page'; view.appendChild(page);
    await mod.render(page, { filters, app: appState, isStale: () => token !== appState.renderToken, refreshShell: () => { setContext(getContext()); renderShell(); } });
    icons();
  } catch (e) {
    if (token !== appState.renderToken) return;
    console.error(e);
    setHTML(view, html`<div class="panel"><div class="empty"><i data-lucide="circle-alert"></i><div><b>Could not load this page.</b></div>
      <div style="margin-top:6px">${errMsg(e)}</div><button class="btn mt" id="retry"><i data-lucide="refresh-cw"></i>Try again</button></div></div>`);
    $('#retry').onclick = route;
  }
}
export function rerender() { route(); }
boot();
