const ALIASES = {
  member_name: ['member_name', 'name', 'member', '회원명', '회원', '이름', '성함'],
  date: ['date', '날짜', '일자'],
  start_time: ['start_time', 'start', '시작시간', '시작', '시간'],
  duration_min: ['duration_min', 'duration', '소요시간', '소요', '시간(분)'],
  end_time: ['end_time', 'end', '종료시간', '종료']
};

const pad = n => String(n).padStart(2, '0');

function normalizeHeader(h) {
  const t = String(h || '').trim().toLowerCase();
  for (const [k, list] of Object.entries(ALIASES)) {
    if (list.some(a => a.toLowerCase() === t)) return k;
  }
  return t;
}

function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date && !isNaN(s)) {
    return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  }
  const str = String(s).trim();
  // Korean: 2026년 5월 4일
  let m = str.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // ISO-like: 2026-05-04 / 2026/5/4 / 2026.5.4 / 2026 5 4
  m = str.match(/(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // 2-digit year: 25/04/30
  m = str.match(/(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `20${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return null;
}

function parseTime(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{1,2})[:시\s.](\d{1,2})/);
  if (!m) m = str.match(/^(\d{1,2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2] || '0', 10);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return [h, mi];
}

function rowsToSessions(rows) {
  const sessions = [];
  const warnings = [];
  rows.forEach((r, i) => {
    const get = (k) => r[k];
    const name = String(get('member_name') ?? '').trim();
    const dateRaw = get('date');
    const startRaw = get('start_time');
    let duration = parseInt(get('duration_min'), 10);
    const endRaw = get('end_time');

    if (!name) { warnings.push({ row: i + 1, msg: '회원명 누락' }); return; }
    const date = parseDate(dateRaw);
    if (!date) { warnings.push({ row: i + 1, msg: '날짜 형식 오류' }); return; }
    const st = parseTime(startRaw);
    if (!st) { warnings.push({ row: i + 1, msg: '시작시간 형식 오류' }); return; }

    if (!duration && endRaw) {
      const et = parseTime(endRaw);
      if (et) duration = (et[0] * 60 + et[1]) - (st[0] * 60 + st[1]);
    }
    if (!Number.isFinite(duration) || duration <= 0) duration = 50;

    sessions.push({
      name,
      date,
      startTime: pad(st[0]) + ':' + pad(st[1]),
      durationMin: duration
    });
  });
  return { sessions, warnings };
}

export async function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (r) => resolve(rowsToSessions(r.data)),
      error: reject
    });
  });
}

export async function parseXLSX(file) {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const norm = json.map(row => {
    const o = {};
    for (const [k, v] of Object.entries(row)) o[normalizeHeader(k)] = v;
    return o;
  });
  return rowsToSessions(norm);
}

// Heuristic line parser for OCR text. Pairs Korean names with times found
// in the same line (regardless of order), under a date anchor from a prior line.
export function parseFreeText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const sessions = [];
  let currentDate = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const dateHit = parseDate(line);
    if (dateHit) {
      currentDate = dateHit;
      // Don't 'continue' — a single line may contain both a date and entries
    }
    if (!currentDate) continue;

    const names = [...line.matchAll(/([가-힯]{2,4})/g)].map(m => m[1]);
    const times = [...line.matchAll(/(\d{1,2})\s*[:시.]\s*(\d{0,2})/g)]
      .map(m => ({ h: parseInt(m[1], 10), mi: parseInt(m[2] || '0', 10) }))
      .filter(t => t.h >= 0 && t.h <= 23 && t.mi >= 0 && t.mi <= 59);

    if (!names.length || !times.length) continue;
    const n = Math.min(names.length, times.length);
    for (let i = 0; i < n; i++) {
      sessions.push({
        name: names[i],
        date: currentDate,
        startTime: pad(times[i].h) + ':' + pad(times[i].mi),
        durationMin: 50
      });
    }
  }
  return { sessions, warnings: [] };
}
