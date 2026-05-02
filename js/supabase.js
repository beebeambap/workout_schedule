// Lightweight wrapper that exposes a single Supabase client (or null).
const URL = window.SUPABASE_URL || '';
const KEY = window.SUPABASE_ANON_KEY || '';

export const sbReady = !!(URL && KEY) && !!window.supabase;

export const sb = sbReady
  ? window.supabase.createClient(URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
