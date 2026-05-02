const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
const HOUR_START = 6;
const HOUR_END = 23; // exclusive

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => {
  const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x;
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function renderWeek(container, anchor, sessions, members) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  let html = '<div class="week-grid">';
  html += '<div class="head"></div>';
  for (const d of days) {
    const cls = ymd(d) === today ? 'head today' : 'head';
    html += `<div class="${cls}">${d.getMonth() + 1}/${d.getDate()} (${DOW_KR[d.getDay()]})</div>`;
  }

  for (let h = HOUR_START; h < HOUR_END; h++) {
    html += `<div class="hour-label">${pad(h)}:00</div>`;
    for (const d of days) {
      const dStr = ymd(d);
      const items = sessions
        .filter(s => s.date === dStr && parseInt(s.startTime.slice(0, 2), 10) === h)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map(s => {
          const m = memberMap[s.memberId];
          const color = m?.color || '#6b7280';
          const name = m?.name || '?';
          return `<span class="event" style="background:${color}">${escapeHtml(s.startTime)} ${escapeHtml(name)}</span>`;
        }).join('');
      html += `<div class="cell">${items}</div>`;
    }
  }
  html += '</div>';
  container.innerHTML = html;

  return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 주`;
}

export function renderMonth(container, anchor, sessions, members) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  let html = '<div class="month-grid">';
  for (const name of DOW_KR) html += `<div class="day-head">${name}</div>`;
  for (const d of days) {
    const dStr = ymd(d);
    let cls = 'day';
    if (d.getMonth() !== anchor.getMonth()) cls += ' other';
    if (dStr === today) cls += ' today';
    const evs = sessions
      .filter(s => s.date === dStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(s => {
        const m = memberMap[s.memberId];
        const color = m?.color || '#6b7280';
        const name = m?.name || '?';
        return `<span class="ev" style="background:${color}">${escapeHtml(s.startTime)} ${escapeHtml(name)}</span>`;
      }).join('');
    html += `<div class="${cls}"><span class="day-num">${d.getDate()}</span>${evs}</div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
}
