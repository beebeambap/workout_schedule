import { sb } from './supabase.js';

export async function getSession() {
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error) {
    console.error(error);
    return null;
  }
  return data.session;
}

export async function sendMagicLink(email) {
  if (!sb) throw new Error('Supabase가 설정되지 않았습니다.');
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!sb) return;
  await sb.auth.signOut();
}

export async function updateUserMetadata(data) {
  if (!sb) throw new Error('Supabase가 설정되지 않았습니다.');
  // Single retry for transient auth-lock contention
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: result, error } = await sb.auth.updateUser({ data });
    if (!error) return result.user;
    if (attempt === 0 && /lock .* was released|stole it/i.test(error.message || '')) {
      await new Promise(r => setTimeout(r, 150));
      continue;
    }
    throw error;
  }
}

export function onAuthChange(cb) {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
