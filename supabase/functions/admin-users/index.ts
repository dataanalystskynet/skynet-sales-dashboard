// =====================================================================
// SKYNET EXPRESS – Supabase Edge Function "admin-users"
// Server-side user administration that needs the service_role key:
//   action = create | delete | set_password | set_active
// The service_role key is injected by Supabase into the function runtime.
// It is NEVER shipped to the browser and NEVER committed to GitHub.
//
// Deploy:   supabase functions deploy admin-users
// Optional: supabase secrets set ALLOWED_ORIGINS=https://<you>.github.io
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
const ROLES = ['admin', 'manager', 'sales'];
const PERM_KEYS = ['page_executive', 'page_customers', 'page_sales', 'page_country', 'page_hub', 'page_shipments',
  'excel_import', 'excel_export', 'revenue_visibility', 'weight_visibility', 'customer_visibility', 'shipment_visibility',
  'salesperson_visibility', 'user_management', 'target_management', 'audit_logs', 'hold_change', 'app_settings'];
const PERM_VALUES = ['view', 'hide', 'allow', 'deny', 'all', 'assigned', 'own'];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED.includes('*') ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? '';
  return { 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
}
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
const strongPw = (pw: string) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
const mobileKey = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
// login e-mail for users whose real e-mail is shared / absent – they sign in with their mobile number
const LOGIN_DOMAIN = 'skynet-users.example.com';   // reserved domain – never receives mail
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 120).slice(0, 200) : []);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Who is calling? (verified from their own JWT)
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !who?.user) return reply(req, { error: 'Not authenticated' }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Authorise: active ADMIN, or active user whose user_management override = allow
  const { data: caller } = await admin.from('profiles').select('id, role, is_active, full_name, email').eq('id', who.user.id).single();
  if (!caller?.is_active) return reply(req, { error: 'Account inactive' }, 403);
  let allowed = caller.role === 'admin';
  if (!allowed) {
    const { data: p } = await admin.from('user_permissions').select('permission_value')
      .eq('user_id', caller.id).eq('permission_key', 'user_management').maybeSingle();
    allowed = p?.permission_value === 'allow';
  }
  if (!allowed) return reply(req, { error: 'Not authorised: missing permission user_management' }, 403);
  const isAdmin = caller.role === 'admin';

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return reply(req, { error: 'Invalid JSON body' }, 400); }

  const audit = (action: string, recordId: string, oldValue: unknown, newValue: unknown) =>
    admin.from('audit_logs').insert({ user_id: caller.id, user_name: caller.full_name || caller.email, action,
      record_type: 'user', record_id: recordId, old_value: oldValue ?? null, new_value: newValue ?? null });

  const targetOf = async (id: string) => {
    if (!uuidRe.test(id)) return null;
    const { data } = await admin.from('profiles').select('id, role, email, full_name, is_active').eq('id', id).single();
    return data;
  };

  try {
    // ------------------------------------------------------------ CREATE
    if (b.action === 'create') {
      const email = String(b.email ?? '').trim().toLowerCase();          // contact e-mail – optional, may be shared
      const role = String(b.role ?? 'sales');
      const username = b.username ? String(b.username).trim().toLowerCase() : null;
      const mobile = mobileKey(b.mobile);
      if (mobile.length !== 10) return reply(req, { error: 'A valid 10-digit mobile number is required (it is the login ID)' }, 400);
      if (email && !emailRe.test(email)) return reply(req, { error: 'Invalid e-mail address' }, 400);
      {
        const { data: all } = await admin.from('profiles').select('id, mobile');
        if ((all ?? []).some((x: { mobile: string | null }) => mobileKey(x.mobile) === mobile)) return reply(req, { error: 'This mobile number is already used by another user' }, 409);
      }
      if (!ROLES.includes(role)) return reply(req, { error: 'Invalid role' }, 400);
      if (role === 'admin' && !isAdmin) return reply(req, { error: 'Only ADMIN can create admin accounts' }, 403);
      if (username && !/^[a-z0-9._-]{3,40}$/.test(username)) return reply(req, { error: 'Invalid User ID' }, 400);
      if (username) {
        const { data: dup } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
        if (dup) return reply(req, { error: 'This User ID is already taken' }, 409);
      }
      const app_metadata = { role, username };
      const user_metadata = { full_name: String(b.full_name ?? '').slice(0, 120) };
      let userId: string;
      let loginEmail = email;
      if (b.invite) {
        if (!email) return reply(req, { error: 'An e-mail address is needed to send an invitation' }, 400);
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: b.redirect_to, data: user_metadata });
        if (error) return reply(req, { error: error.message }, 400);
        userId = data.user.id;
        await admin.auth.admin.updateUserById(userId, { app_metadata });
      } else {
        const pw = String(b.password ?? '');
        if (!strongPw(pw)) return reply(req, { error: 'Password must be 8+ characters with letters and numbers' }, 400);
        // use the real e-mail as the login e-mail when it is free; if it is shared with another
        // user (or empty) give this user a private login e-mail based on the mobile number
        const tryCreate = (em: string) => admin.auth.admin.createUser({ email: em, password: pw, email_confirm: true, app_metadata, user_metadata });
        let res = email ? await tryCreate(email) : null;
        if (!res || (res.error && /already|registered|exists/i.test(res.error.message))) {
          loginEmail = `m${mobile}@${LOGIN_DOMAIN}`;
          res = await tryCreate(loginEmail);
        }
        if (res.error) return reply(req, { error: res.error.message }, 400);
        userId = res.data.user.id;
      }
      // profile row was created by the on_auth_user_created trigger -> apply admin-chosen fields
      const { error: pErr } = await admin.from('profiles').upsert({
        id: userId, email: email || null, role, username,
        full_name: user_metadata.full_name,
        mobile,
        is_active: b.is_active !== false,
        assigned_hubs: strArr(b.assigned_hubs),
        salesperson_names: strArr(b.salesperson_names),
        team_salespersons: strArr(b.team_salespersons),
      });
      if (pErr) return reply(req, { error: 'User created but profile update failed: ' + pErr.message }, 500);
      const perms = Object.entries(b.permissions ?? {})
        .filter(([k, v]) => PERM_KEYS.includes(k) && PERM_VALUES.includes(String(v)))
        .map(([k, v]) => ({ user_id: userId, permission_key: k, permission_value: String(v), updated_by: caller.id }));
      if (perms.length) await admin.from('user_permissions').upsert(perms, { onConflict: 'user_id,permission_key' });
      await audit('USER_CREATE', userId, null, { email, mobile, role, username, invite: !!b.invite, shared_email: loginEmail !== email });
      return reply(req, { ok: true, id: userId, mobile_login: loginEmail !== email });
    }

    // ------------------------------------------------------------ actions on an existing user
    const id = String(b.user_id ?? '');
    const target = await targetOf(id);
    if (!target) return reply(req, { error: 'User not found' }, 404);
    if (target.role === 'admin' && !isAdmin) return reply(req, { error: 'Only ADMIN can modify admin accounts' }, 403);

    if (b.action === 'delete') {
      if (!isAdmin) return reply(req, { error: 'Only ADMIN can delete users' }, 403);
      if (id === caller.id) return reply(req, { error: 'You cannot delete yourself' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);   // profile cascades
      if (error) return reply(req, { error: error.message }, 400);
      await audit('USER_DELETE', id, target, null);
      return reply(req, { ok: true });
    }
    if (b.action === 'set_password') {
      const pw = String(b.password ?? '');
      if (!strongPw(pw)) return reply(req, { error: 'Password must be 8+ characters with letters and numbers' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
      if (error) return reply(req, { error: error.message }, 400);
      await audit('USER_PASSWORD_RESET', id, null, { by: caller.email });   // password itself never logged
      return reply(req, { ok: true });
    }
    if (b.action === 'set_active') {
      if (id === caller.id) return reply(req, { error: 'You cannot deactivate yourself' }, 400);
      const active = b.is_active === true;
      // ban_duration blocks new logins / token refresh at the Auth level too
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return reply(req, { error: error.message }, 400);
      await admin.from('profiles').update({ is_active: active }).eq('id', id);
      await audit('USER_UPDATE', id, { is_active: target.is_active }, { is_active: active });
      return reply(req, { ok: true });
    }
    return reply(req, { error: 'Unknown action' }, 400);
  } catch (e) {
    return reply(req, { error: (e as Error).message ?? 'Server error' }, 500);
  }
});
