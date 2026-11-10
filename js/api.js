// =====================================================================
// SKYNET EXPRESS – api.js : single Supabase client + RPC wrapper.
// In demo mode the same interface is served by demo.js (in-memory).
// =====================================================================
import { CONFIG, isDemoMode } from './config.js';
import { loading } from './utils.js';

let client = null;
let demo = false;
const REMEMBER_KEY = 'skynet_remember_me';

/** Session storage adapter: "Remember me" -> localStorage, otherwise sessionStorage
 *  (only the Supabase auth token lives here – never business data). */
const authStorage = {
  _store() { try { return localStorage.getItem(REMEMBER_KEY) === '0' ? sessionStorage : localStorage; } catch (_) { return null; } },
  getItem(k) { try { return this._store()?.getItem(k) ?? sessionStorage.getItem(k) ?? null; } catch (_) { return null; } },
  setItem(k, v) { try { this._store()?.setItem(k, v); } catch (_) { /* ignore */ } },
  removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
export function setRemember(on) { try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ } }

export async function initApi() {
  demo = isDemoMode();
  if (demo) {
    const mod = await import('./demo.js');
    client = mod.createDemoClient();
    return client;
  }
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase library failed to load.');
  client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage, storageKey: 'skynet-auth' },
  });
  return client;
}
export const sb = () => client;
export const isDemo = () => demo;

/** Call a database function. Throws a readable Error on failure. */
export async function rpc(name, params = {}, { silent = false } = {}) {
  if (!silent) loading(true);
  try {
    const { data, error } = await client.rpc(name, params);
    if (error) {
      const e = new Error(error.message || 'Request failed');
      e.code = error.code; e.details = error.details; throw e;
    }
    return data;
  } finally { if (!silent) loading(false); }
}

/** Invoke the admin-users Edge Function (service role stays on the server). */
export async function invokeAdmin(action, payload) {
  loading(true);
  try {
    const { data, error } = await client.functions.invoke(CONFIG.ADMIN_USERS_FUNCTION, { body: { action, ...payload } });
    if (error) {
      let msg = error.message;
      try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch (_) { /* ignore */ }
      if (/Failed to send a request|404|not found/i.test(msg || '')) {
        msg = 'The "admin-users" Edge Function is not deployed yet. See docs/SUPABASE_SETUP.md, step 6.';
      }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  } finally { loading(false); }
}
