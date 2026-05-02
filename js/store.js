const KEY_M = 'pt_members';
const KEY_S = 'pt_sessions';

const palette = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4'];

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

const load = (k) => JSON.parse(localStorage.getItem(k) || '[]');
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const newId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const Store = {
  members: () => load(KEY_M),
  sessions: () => load(KEY_S),

  ensureMember(name, color, memo) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('회원명이 비어 있습니다.');
    const ms = load(KEY_M);
    let m = ms.find(x => x.name === trimmed);
    if (!m) {
      m = {
        id: newId(),
        name: trimmed,
        color: color || colorFor(trimmed),
        memo: memo || '',
      };
      ms.push(m);
      save(KEY_M, ms);
    } else {
      let dirty = false;
      if (color && color !== m.color) { m.color = color; dirty = true; }
      if (memo && !m.memo) { m.memo = memo; dirty = true; }
      if (dirty) save(KEY_M, ms);
    }
    return m;
  },

  updateMember(id, patch) {
    const ms = load(KEY_M);
    const m = ms.find(x => x.id === id);
    if (!m) return null;
    if (patch.name != null) {
      const trimmed = String(patch.name).trim();
      if (!trimmed) throw new Error('회원명이 비어 있습니다.');
      if (trimmed !== m.name && ms.some(x => x.id !== id && x.name === trimmed)) {
        throw new Error('동일 이름의 회원이 이미 있습니다.');
      }
      m.name = trimmed;
    }
    if (patch.color != null) m.color = patch.color;
    if (patch.memo != null) m.memo = String(patch.memo);
    save(KEY_M, ms);
    return m;
  },

  addSessions(arr) {
    const ss = load(KEY_S);
    arr.forEach(s => ss.push({ id: newId(), ...s }));
    save(KEY_S, ss);
  },

  removeMember(id) {
    save(KEY_M, load(KEY_M).filter(m => m.id !== id));
    save(KEY_S, load(KEY_S).filter(s => s.memberId !== id));
  },

  removeSession(id) {
    save(KEY_S, load(KEY_S).filter(s => s.id !== id));
  },

  countByMember() {
    const counts = {};
    load(KEY_S).forEach(s => { counts[s.memberId] = (counts[s.memberId] || 0) + 1; });
    return counts;
  }
};
