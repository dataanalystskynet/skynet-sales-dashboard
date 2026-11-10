// =====================================================================
// SKYNET EXPRESS – config.js
// Public frontend configuration. The publishable key is SAFE to ship in
// the browser ONLY because every table is protected by RLS and every
// business query goes through permission-checked database functions.
// NEVER put the service_role key (or any secret) in this file / repo.
// =====================================================================
export const CONFIG = {
  APP_NAME: 'SKYNET EXPRESS INDIA PVT. LTD.',
  APP_SHORT: 'SKYNET Sales Intelligence',

  // Supabase project "Daily Sales Report" – use the project ROOT url (not /rest/v1)
  SUPABASE_URL: 'https://wuswlqaaojluzwxgtptm.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_S5-GlfuLMMOp9ge8uq8g5w_Dwz-T6cg',

  // Name of the Edge Function that creates / deletes auth users (service role lives there)
  ADMIN_USERS_FUNCTION: 'admin-users',

  // Demo mode = fully working in-browser sandbox with synthetic data (no Supabase).
  // Turn on by opening the site with ?demo=1   (or set DEMO_MODE: true while developing).
  DEMO_MODE: false,

  DEFAULT_THEME: 'navy',
  DEFAULT_MODE: 'dark',
  DEFAULT_PAGE_SIZE: 25,
  SESSION_IDLE_MINUTES: 30,          // overridden by app_settings.session_timeout_minutes
  IMPORT_BATCH_SIZE: 500,            // rows per UPSERT batch
  MAX_UPLOAD_MB: 30,
  LOCALE: 'en-IN',
  CURRENCY: 'INR',
};

export function isDemoMode() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '1') return true;
    if (q.get('demo') === '0') return false;
  } catch (_) { /* ignore */ }
  return CONFIG.DEMO_MODE === true;
}
