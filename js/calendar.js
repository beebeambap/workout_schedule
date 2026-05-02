const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
const DEFAULT_START = 6;
const DEFAULT_END = 22; // exclusive

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const startOfWeek = (d) => {
  const x = new Date(d);
  const day = x.getDay();          // 0=Sun .. 6=Sat
  const offset = (day + 6) % 7;    // Mon→0, Tue→1, ..., Sun→6
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
};

export function computeEndTime(startTime, durationMin) {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + (durationMin || 0);
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return pad(eh) + ':' + pad(em);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function renderWeek(container, anchor, sessions, members, fitToSessions = false, opts = {}) {
  const { hideMemberName = false, exportMode = false } = opts;
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)); // Mon..Sun
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const weekSet = new Set(days.map(ymd));
  const weekSessions = sessions.filter(s => weekSet.has(s.date));

  let hStart = DEFAULT_START;
  let hEnd = DEFAULT_END;
  if (fitToSessions && weekSessions.length) {
    const startHours = weekSessions.map(s => parseInt(s.startTime.slice(0, 2), 10));
    const minH = Math.min(...startHours);
    const maxH = Math.max(...startHours);
    hStart = Math.max(0, minH - 1);
    hEnd = Math.min(24, maxH + 2);
  }

  const showAM = hStart < 12;
  const showPM = hEnd > 12;
  const amStart = hStart;
  const amEnd = Math.min(12, hEnd);
  const pmStart = Math.max(12, hStart);
  const pmEnd = hEnd;

  const gridClass = 'week-grid' + (hideMemberName ? ' time-only' : '');
  let html = `<div class="${gridClass}">`;
  html += '<div class="head"></div>';
  for (const d of days) {
    const cls = ymd(d) === today ? 'head today' : 'head';
    html += `<div class="${cls}">${d.getMonth() + 1}/${d.getDate()} (${DOW_KR[d.getDay()]})</div>`;
  }

  if (showAM) {
    html += `<div class="period-divider">오전 (AM)</div>`;
    html += renderHourRows(amStart, amEnd, days, sessions, memberMap, hideMemberName);
  }
  if (showPM) {
    html += `<div class="period-divider">오후 (PM)</div>`;
    html += renderHourRows(pmStart, pmEnd, days, sessions, memberMap, hideMemberName);
  }

  html += '</div>';
  container.innerHTML = html;

  if (!exportMode) appendNowLine(container, days);

  return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 주`;
}

function renderHourRows(hFrom, hTo, days, sessions, memberMap, hideMemberName) {
  let html = '';
  for (let h = hFrom; h < hTo; h++) {
    html += `<div class="hour-label" data-hour="${h}">${pad(h)}:00</div>`;
    for (const d of days) {
      const dStr = ymd(d);
      const items = sessions
        .filter(s => s.date === dStr && parseInt(s.startTime.slice(0, 2), 10) === h)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map(s => {
          const m = memberMap[s.memberId];
          const color = m?.color || '#6b7280';
          const name = m?.name || '?';
          const label = hideMemberName
            ? `${escapeHtml(s.startTime)}~${escapeHtml(computeEndTime(s.startTime, s.durationMin))}`
            : `${escapeHtml(s.startTime)} ${escapeHtml(name)}`;
          return `<span class="event" style="background:${color}">${label}</span>`;
        }).join('');
      html += `<div class="cell">${items}</div>`;
    }
  }
  return html;
}

function appendNowLine(container, days) {
  const grid = container.querySelector('.week-grid');
  if (!grid) return;

  const now = new Date();
  const todayStr = ymd(now);
  const dayIdx = days.findIndex(d => ymd(d) === todayStr);
  if (dayIdx < 0) return;

  const h = now.getHours();
  const m = now.getMinutes();

  const labels = grid.querySelectorAll('.hour-label');
  let target = null;
  for (const lbl of labels) {
    if (parseInt(lbl.dataset.hour, 10) === h) { target = lbl; break; }
  }
  if (!target) return;

  const top = target.offsetTop + (m / 60) * target.offsetHeight;
  const left = target.offsetLeft + target.offsetWidth + 1;

  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = top + 'px';
  line.style.left = left + 'px';
  line.title = `현재 ${pad(h)}:${pad(m)}`;

  const dot = document.createElement('span');
  dot.className = 'now-dot';
  line.appendChild(dot);

  grid.appendChild(line);
}

export function renderMonth(container, anchor, sessions, members, opts = {}) {
  const { hideMemberName = false } = opts;
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const gridClass = 'month-grid' + (hideMemberName ? ' time-only' : '');
  let html = `<div class="${gridClass}">`;
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
        const label = hideMemberName
          ? `${escapeHtml(s.startTime)}~${escapeHtml(computeEndTime(s.startTime, s.durationMin))}`
          : `${escapeHtml(s.startTime)} ${escapeHtml(name)}`;
        return `<span class="ev" style="background:${color}">${label}</span>`;
      }).join('');
    html += `<div class="${cls}"><span class="day-num">${d.getDate()}</span>${evs}</div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
}
