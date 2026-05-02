// Lightweight wrapper that exposes a single Supabase client (or null).
const URL_VAL = window.SUPABASE_URL || '';
const KEY_VAL = window.SUPABASE_ANON_KEY || '';
const HAS_LIB = !!window.supabase;

export const status = {
  url: !!URL_VAL,
  key: !!KEY_VAL,
  lib: HAS_LIB,
};

export const sbReady = status.url && status.key && status.lib;

if (!sbReady) {
  console.warn('[PT 스케줄러] Supabase 미설정', status);
}

export const sb = sbReady
  ? window.supabase.createClient(URL_VAL, KEY_VAL, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
