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
  console.warn('[레슨핏] Supabase 미설정', status);
}

// Default lock uses navigator.locks; under brief contention it can throw
// "lock ... was released because another request stole it". For a single
// trainer using a few tabs, a simple in-process mutex is sufficient and
// avoids the Web Locks race entirely.
//
// Defensive timeout: if a lock-holding callback hangs (e.g. a stuck network
// request to Supabase auth), we force-release after 30s so subsequent app
// operations don't pile up behind it forever.
const LOCK_TIMEOUT_MS = 30_000;
const _locks = new Map();
async function inProcessLock(name, _timeout, fn) {
  const prev = _locks.get(name) || Promise.resolve();
  let release;
  const slot = new Promise((r) => { release = r; });
  // Tail of chain ignores prior failures so one rejection doesn't break the chain.
  _locks.set(name, prev.catch(() => {}).then(() => slot));
  try {
    await prev.catch(() => {});
    return await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error(`Supabase auth lock timeout (${LOCK_TIMEOUT_MS / 1000}s)`)),
        LOCK_TIMEOUT_MS
      )),
    ]);
  } finally {
    release();
  }
}

export const sb = sbReady
  ? window.supabase.createClient(URL_VAL, KEY_VAL, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        lock: inProcessLock,
      },
    })
  : null;
