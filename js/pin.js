// Local PIN lock — per (user, device). Stored in localStorage as
// { salt, hash } using SHA-256(salt + pin). Recovery is via signing out
// and re-authenticating with magic link, then setting a fresh PIN.

const RELOCK_AFTER_MS = 30_000; // 30 seconds backgrounded → require PIN again

function key(userId) { return `pt_pin_${userId}`; }
function bgKey() { return `pt_pin_lastVisible`; }

function makeSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hash(pin, salt) {
  const data = new TextEncoder().encode(salt + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isPinSet(userId) {
  if (!userId) return false;
  return !!localStorage.getItem(key(userId));
}

export async function setPin(userId, pin) {
  if (!userId) throw new Error('no user');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN은 숫자 4~6자리여야 합니다.');
  const salt = makeSalt();
  const h = await hash(pin, salt);
  localStorage.setItem(key(userId), JSON.stringify({ salt, hash: h }));
}

export async function verifyPin(userId, pin) {
  const raw = localStorage.getItem(key(userId));
  if (!raw) return false;
  try {
    const { salt, hash: stored } = JSON.parse(raw);
    const h = await hash(pin, salt);
    return h === stored;
  } catch (_) {
    return false;
  }
}

export function clearPin(userId) {
  if (!userId) return;
  localStorage.removeItem(key(userId));
}

// --- session / background tracking ---
let unlocked = false;

export function markUnlocked() {
  unlocked = true;
  sessionStorage.setItem('pt_pin_unlocked', '1');
}

export function isUnlocked() {
  return unlocked || sessionStorage.getItem('pt_pin_unlocked') === '1';
}

export function lockNow() {
  unlocked = false;
  sessionStorage.removeItem('pt_pin_unlocked');
}

export function noteVisibleNow() {
  localStorage.setItem(bgKey(), String(Date.now()));
}

export function shouldRelockOnReturn() {
  const t = parseInt(localStorage.getItem(bgKey()) || '0', 10);
  if (!t) return false;
  return Date.now() - t > RELOCK_AFTER_MS;
}
