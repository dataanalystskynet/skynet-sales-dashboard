// =====================================================================
// SKYNET EXPRESS – auth.js : login (email or User ID), remember me,
// forgot / reset password, logout, automatic idle session expiry.
// Passwords are handled ONLY by Supabase Auth – never stored by the app.
// =====================================================================
import { sb, rpc, setRemember } from './api.js';
import { toast, errMsg, modal, closeOverlays, esc } from './utils.js';

export async function getSession() {
  const { data } = await sb().auth.getSession();
  return data?.session || null;
}

export async function signIn(login, password, remember) {
  login = String(login || '').trim();
  if (!login || !password) throw new Error('Enter your User ID / e-mail and password.');
  setRemember(!!remember);
  let email = login;
  if (!login.includes('@')) {
    const { data, error } = await sb().rpc('email_for_login', { p_login: login });
    if (error || !data) throw new Error('Invalid login credentials');
    email = data;
  }
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Invalid login credentials' : error.message);
  try { await rpc('touch_last_login', {}, { silent: true }); } catch (_) { /* non-blocking */ }
  return data.session;
}

export async function signOut(reason) {
  stopIdleTimer();
  try { await sb().auth.signOut(); } catch (_) { /* ignore */ }
  if (reason) sessionStorage.setItem('skynet_logout_reason', reason);
  location.hash = '#/login';
  location.reload();
}

export async function sendPasswordReset(email) {
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb().auth.resetPasswordForEmail(String(email).trim(), { redirectTo });
  if (error) throw error;
}

/** Change password. If currentPassword is given it is verified first (re-authentication). */
export async function changePassword(newPassword, currentPassword, email) {
  if (!newPassword || newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) throw new Error('Use letters and numbers in the password.');
  if (currentPassword && email) {
    const { error } = await sb().auth.signInWithPassword({ email, password: currentPassword });
    if (error) throw new Error('Current password is incorrect.');
  }
  const { error } = await sb().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function changeEmail(newEmail) {
  const { error } = await sb().auth.updateUser({ email: String(newEmail).trim() }, { emailRedirectTo: location.origin + location.pathname });
  if (error) throw error;
}

/** Password-recovery link landing: Supabase fires PASSWORD_RECOVERY */
export function watchAuthEvents() {
  sb().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showSetNewPassword();
    if (event === 'SIGNED_OUT' && document.body.classList.contains('authed')) location.reload();
  });
}

function showSetNewPassword() {
  const m = modal({
    title: 'Set a new password',
    body: `<p class="muted">Choose a new password for your account (min. 8 characters, letters and numbers).</p>
      <label class="field"><span>New password</span><input class="input" type="password" id="np1" autocomplete="new-password"></label>
      <label class="field"><span>Confirm password</span><input class="input" type="password" id="np2" autocomplete="new-password"></label>`,
    foot: `<button class="btn btn-primary" id="np-save">Save password</button>`,
  });
  m.querySelector('#np-save').addEventListener('click', async () => {
    const a = m.querySelector('#np1').value, b = m.querySelector('#np2').value;
    if (a !== b) return toast('Passwords do not match.', 'err');
    try { await changePassword(a); closeOverlays(); toast('Password updated. You are now logged in.', 'ok'); }
    catch (e) { toast(errMsg(e), 'err'); }
  });
}

export function showForgotPassword(prefill = '') {
  const m = modal({
    title: 'Forgot password',
    body: `<p class="muted">Enter your registered e-mail. We will send a secure reset link.</p>
      <label class="field"><span>E-mail address</span><input class="input" type="email" id="fp-email" value="${esc(prefill.includes('@') ? prefill : '')}" autocomplete="email"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="fp-send">Send reset link</button>`,
  });
  m.querySelector('#fp-send').addEventListener('click', async () => {
    const email = m.querySelector('#fp-email').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid e-mail address.', 'err');
    try { await sendPasswordReset(email); closeOverlays(); toast('If this e-mail is registered, a reset link has been sent.', 'ok', 6000); }
    catch (e) { toast(errMsg(e), 'err'); }
  });
}

// ---------- Idle session expiry ----------
let idleTimer = null, idleMinutes = 30, warnTimer = null;
const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
function resetIdle() {
  clearTimeout(idleTimer); clearTimeout(warnTimer);
  if (!idleMinutes) return;
  const ms = idleMinutes * 60000;
  warnTimer = setTimeout(() => toast('You will be logged out in 1 minute due to inactivity.', 'info', 8000), Math.max(ms - 60000, 1000));
  idleTimer = setTimeout(() => signOut('Your session expired after ' + idleMinutes + ' minutes of inactivity.'), ms);
}
const throttledReset = (() => { let last = 0; return () => { const t = Date.now(); if (t - last > 5000) { last = t; resetIdle(); } }; })();
export function startIdleTimer(minutes) {
  idleMinutes = Number(minutes) || 30;
  EVENTS.forEach((e) => window.addEventListener(e, throttledReset, { passive: true }));
  resetIdle();
}
export function stopIdleTimer() {
  clearTimeout(idleTimer); clearTimeout(warnTimer);
  EVENTS.forEach((e) => window.removeEventListener(e, throttledReset));
}
