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

export function onAuthChange(cb) {
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
