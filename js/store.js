import { sb } from './supabase.js';

const palette = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4'];

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

const cache = {
  members: [],
  sessions: [],
};

let listener = null;
let channel = null;

function notify() { if (listener) listener(); }

function rowToMember(r) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    memo: r.memo || '',
    status: r.status || 'active',
    statusAt: r.status_at || null,
  };
}

function rowToSession(r) {
  return {
    id: r.id,
    memberId: r.member_id || null,
    title: r.title || null,
    date: r.date,
    startTime: typeof r.start_time === 'string' ? r.start_time.slice(0, 5) : r.start_time,
    durationMin: r.duration_min,
  };
}

export const Store = {
  // ---- sync reads from cache ----
  members: () => cache.members,
  sessions: () => cache.sessions,
  countByMember() {
    const c = {};
    cache.sessions.forEach(s => { c[s.memberId] = (c[s.memberId] || 0) + 1; });
    return c;
  },

  onUpdate(fn) { listener = fn; },

  // ---- lifecycle ----
  async init() {
    if (!sb) throw new Error('Supabase가 설정되지 않았습니다.');
    await this.refresh();
    this.subscribe();
  },

  async refresh() {
    const [mRes, sRes] = await Promise.all([
      sb.from('members').select('*').order('name'),
      sb.from('sessions').select('*').order('date').order('start_time'),
    ]);
    if (mRes.error) throw mRes.error;
    if (sRes.error) throw sRes.error;
    cache.members = mRes.data.map(rowToMember);
    cache.sessions = sRes.data.map(rowToSession);
    notify();
  },

  subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('pt-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, (p) => applyMemberChange(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, (p) => applySessionChange(p))
      .subscribe();
  },

  async teardown() {
    if (channel) { await sb.removeChannel(channel); channel = null; }
    cache.members = [];
    cache.sessions = [];
    notify();
  },

  // ---- writes ----
  async ensureMember(name, color, memo) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('회원명이 비어 있습니다.');
    const existing = cache.members.find(m => m.name === trimmed);
    if (existing) {
      const patch = {};
      if (color && color !== existing.color) patch.color = color;
      if (memo && !existing.memo) patch.memo = memo;
      if (Object.keys(patch).length) await this.updateMember(existing.id, patch);
      return existing;
    }
    const { data, error } = await sb.from('members').insert({
      name: trimmed,
      color: color || colorFor(trimmed),
      memo: memo || '',
    }).select().single();
    if (error) throw error;
    const m = rowToMember(data);
    upsertCache(cache.members, m);
    notify();
    return m;
  },

  async updateMember(id, patch) {
    const cur = cache.members.find(x => x.id === id);
    if (!cur) return null;
    const update = {};
    if (patch.name != null) {
      const t = String(patch.name).trim();
      if (!t) throw new Error('회원명이 비어 있습니다.');
      if (t !== cur.name && cache.members.some(x => x.id !== id && x.name === t)) {
        throw new Error('동일 이름의 회원이 이미 있습니다.');
      }
      update.name = t;
    }
    if (patch.color != null) update.color = patch.color;
    if (patch.memo != null) update.memo = String(patch.memo);
    if (patch.status != null) {
      update.status = patch.status;
      if (patch.status !== cur.status) {
        // record status change date
        const today = new Date();
        update.status_at = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      }
    }
    const { data, error } = await sb.from('members').update(update).eq('id', id).select().single();
    if (error) throw error;
    const m = rowToMember(data);
    upsertCache(cache.members, m);
    notify();
    return m;
  },

  async removeMember(id) {
    const { error } = await sb.from('members').delete().eq('id', id);
    if (error) throw error;
    cache.members = cache.members.filter(m => m.id !== id);
    cache.sessions = cache.sessions.filter(s => s.memberId !== id);
    notify();
  },

  async addSessions(arr) {
    if (!arr.length) return [];
    const rows = arr.map(s => {
      const row = {
        member_id: s.memberId || null,
        date: s.date,
        start_time: s.startTime,
        duration_min: s.durationMin,
      };
      if (s.title) row.title = s.title;
      return row;
    });
    const { data, error } = await sb.from('sessions').insert(rows).select();
    if (error) throw error;
    const inserted = data.map(rowToSession);
    inserted.forEach(s => upsertCache(cache.sessions, s));
    notify();
    return inserted;
  },

  async removeSession(id) {
    const { error } = await sb.from('sessions').delete().eq('id', id);
    if (error) throw error;
    cache.sessions = cache.sessions.filter(s => s.id !== id);
    notify();
  },
};

function upsertCache(list, item) {
  const idx = list.findIndex(x => x.id === item.id);
  if (idx >= 0) list[idx] = item; else list.push(item);
}

function applyMemberChange(payload) {
  const { eventType, new: nu, old: ol } = payload;
  if (eventType === 'DELETE') {
    cache.members = cache.members.filter(m => m.id !== ol.id);
    cache.sessions = cache.sessions.filter(s => s.memberId !== ol.id);
  } else {
    upsertCache(cache.members, rowToMember(nu));
  }
  notify();
}

function applySessionChange(payload) {
  const { eventType, new: nu, old: ol } = payload;
  if (eventType === 'DELETE') {
    cache.sessions = cache.sessions.filter(s => s.id !== ol.id);
  } else {
    upsertCache(cache.sessions, rowToSession(nu));
  }
  notify();
}
