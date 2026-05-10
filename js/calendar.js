import { lookupHoliday } from './holidays.js';

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];
const FULL_START = 0;
const FULL_END = 24; // on-screen always shows full 24h
export const HOUR_HEIGHT = 56; // pixels per hour

function dayClass(date) {
  // returns extra class names based on day of week / holiday
  const dow = date.getDay();
  const cls = [];
  if (dow === 0) cls.push('dow-sun');
  else if (dow === 6) cls.push('dow-sat');
  if (lookupHoliday(ymd(date))) cls.push('is-holiday');
  return cls.join(' ');
}

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const startOfWeek = (d) => {
  const x = new Date(d);
  const day = x.getDay();
  const offset = (day + 6) % 7;
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

function initials(name) {
  if (!name) return '?';
  if (/[a-zA-Z]/.test(name)) {
    return name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }
  return name.slice(-2);
}

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Assigns laneIdx and totalLanes to events based on time overlap clusters.
function layoutEventsInColumn(events) {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin);
  let i = 0;
  while (i < sorted.length) {
    const cluster = [sorted[i]];
    let endMax = sorted[i].endMin;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMin < endMax) {
      cluster.push(sorted[j]);
      endMax = Math.max(endMax, sorted[j].endMin);
      j++;
    }
    const lanes = []; // each lane = endMin of last event
    for (const e of cluster) {
      let laneIdx = lanes.findIndex(end => end <= e.startMin);
      if (laneIdx === -1) {
        laneIdx = lanes.length;
        lanes.push(e.endMin);
      } else {
        lanes[laneIdx] = e.endMin;
      }
      e.laneIdx = laneIdx;
    }
    const totalLanes = lanes.length;
    for (const e of cluster) e.totalLanes = totalLanes;
    i = j;
  }
  return sorted;
}

export function renderWeek(container, anchor, sessions, members, fitToSessions = false, opts = {}) {
  const { hideMemberName = false, exportMode = false } = opts;
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)); // Mon..Sun
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const weekSet = new Set(days.map(ymd));
  const weekSessions = sessions.filter(s => weekSet.has(s.date));

  // On-screen view always shows the full 24h. Trim only happens when
  // exporting (so the JPG output is compact when a single member's
  // sessions are clustered in a short range).
  let hStart = FULL_START;
  let hEnd = FULL_END;
  if (exportMode && fitToSessions && weekSessions.length) {
    const startMins = weekSessions.map(s => toMin(s.startTime));
    const endMins = weekSessions.map(s => toMin(s.startTime) + (s.durationMin || 50));
    hStart = Math.max(0, Math.floor(Math.min(...startMins) / 60));
    hEnd = Math.min(24, Math.ceil(Math.max(...endMins) / 60));
    if (hEnd <= hStart) hEnd = hStart + 1;
  }

  const totalHours = hEnd - hStart;
  const bodyHeight = totalHours * HOUR_HEIGHT;
  const showPmDivider = hStart < 12 && hEnd > 12;

  const klass = ['wg'];
  if (exportMode) klass.push('wg-export');
  if (hideMemberName) klass.push('wg-time-only');

  let html = `<div class="${klass.join(' ')}">`;

  // Header row (corner + 7 day heads)
  html += `<div class="wg-header">`;
  html += `<div class="wg-corner"></div>`;
  for (const d of days) {
    const isToday = ymd(d) === today ? ' today' : '';
    const dc = dayClass(d);
    const holiday = lookupHoliday(ymd(d));
    const sub = holiday ? `<span class="wg-holiday-name">${escapeHtml(holiday)}</span>` : '';
    html += `<div class="wg-day-head${isToday} ${dc}">${d.getMonth() + 1}/${d.getDate()} (${DOW_KR[d.getDay()]})${sub}</div>`;
  }
  html += `</div>`;

  // Body row (hour-label col + 7 day cols)
  html += `<div class="wg-body" style="height:${bodyHeight}px">`;

  // Hour-label column
  html += `<div class="wg-hour-col">`;
  for (let h = hStart; h < hEnd; h++) {
    html += `<div class="wg-hour-label" data-hour="${h}" style="height:${HOUR_HEIGHT}px">${pad(h)}:00</div>`;
  }
  html += `</div>`;

  // Day columns
  for (const d of days) {
    const dStr = ymd(d);
    html += `<div class="wg-day-col" data-date="${dStr}">`;

    // Hour grid lines (between hours) + optional thicker AM/PM line at 12
    for (let h = hStart + 1; h < hEnd; h++) {
      const top = (h - hStart) * HOUR_HEIGHT;
      const isPm = (h === 12 && showPmDivider);
      html += `<div class="wg-hour-line${isPm ? ' wg-pm' : ''}" style="top:${top}px"></div>`;
    }

    const dayEvs = sessions
      .filter(s => s.date === dStr)
      .map(s => ({
        ...s,
        startMin: toMin(s.startTime),
        endMin: toMin(s.startTime) + (s.durationMin || 50),
      }));

    const laid = layoutEventsInColumn(dayEvs);
    const baseMin = hStart * 60;
    const isPastDay = dStr < today;
    for (const e of laid) {
      const m = memberMap[e.memberId];
      const isPersonal = !m;
      const color = isPersonal ? '#6b7280' : (m?.color || '#6b7280');
      const display = isPersonal ? (e.title || '내 일정') : (m?.name || '?');
      const top = ((e.startMin - baseMin) / 60) * HOUR_HEIGHT;
      const height = Math.max(20, ((e.endMin - e.startMin) / 60) * HOUR_HEIGHT - 1);
      const widthPct = 100 / e.totalLanes;
      const leftPct = e.laneIdx * widthPct;
      const endTime = computeEndTime(e.startTime, e.durationMin);
      const mono = (!hideMemberName && !isPersonal)
        ? `<span class="ev-mono" aria-hidden="true">${escapeHtml(initials(m.name))}</span>`
        : '';
      const label = hideMemberName
        ? `<span class="ev-time">${escapeHtml(e.startTime)}~${escapeHtml(endTime)}</span>`
        : `${mono}<span class="ev-name">${escapeHtml(display)}</span><span class="ev-time">${escapeHtml(e.startTime)}</span>`;
      const sid = escapeHtml(e.id || '');
      const status = e.status || 'scheduled';
      const evCls = ['wg-event'];
      if (isPersonal) evCls.push('wg-event-personal');
      if (isPastDay) evCls.push('is-past');
      if (status === 'canceled') evCls.push('is-canceled');
      if (status === 'completed') evCls.push('is-completed');
      if (status === 'noshow_charged') evCls.push('is-noshow-charged');
      if (status === 'noshow_free') evCls.push('is-noshow-free');
      html += `<div class="${evCls.join(' ')}" data-session-id="${sid}" style="top:${top}px;height:${height}px;left:calc(${leftPct}% + 1px);width:calc(${widthPct}% - 2px);background:${color}">${label}</div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  html += `</div>`;
  container.innerHTML = html;

  if (!exportMode) appendNowLine(container, days, hStart, hEnd);

  return `${start.getFullYear()}년 ${start.getMonth() + 1}월 ${start.getDate()}일 주`;
}

function appendNowLine(container, days, hStart, hEnd) {
  const wg = container.querySelector('.wg');
  if (!wg) return;

  const now = new Date();
  const todayStr = ymd(now);
  const dayIdx = days.findIndex(d => ymd(d) === todayStr);
  if (dayIdx < 0) return;

  const totalMin = now.getHours() * 60 + now.getMinutes();
  const baseMin = hStart * 60;
  const endMin = hEnd * 60;
  if (totalMin < baseMin || totalMin >= endMin) return;

  const body = wg.querySelector('.wg-body');
  if (!body) return;
  const top = ((totalMin - baseMin) / 60) * HOUR_HEIGHT;

  const line = document.createElement('div');
  line.className = 'wg-now-line';
  line.style.top = top + 'px';
  line.title = `현재 ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const dot = document.createElement('span');
  dot.className = 'wg-now-dot';
  line.appendChild(dot);

  body.appendChild(line);
}

export function renderMonth(container, anchor, sessions, members, opts = {}) {
  const { hideMemberName = false } = opts;
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  // Monday-first grid: shift back to nearest preceding Monday
  const monOffset = (first.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const gridStart = addDays(first, -monOffset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = ymd(new Date());
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const gridClass = 'month-grid' + (hideMemberName ? ' time-only' : '');
  let html = `<div class="${gridClass}">`;
  // Monday-first day-head order: 월화수목금토일
  const dowOrder = ['월', '화', '수', '목', '금', '토', '일'];
  const dowOrderClass = ['', '', '', '', '', 'dow-sat', 'dow-sun'];
  for (let i = 0; i < 7; i++) {
    html += `<div class="day-head ${dowOrderClass[i]}">${dowOrder[i]}</div>`;
  }
  for (const d of days) {
    const dStr = ymd(d);
    let cls = 'day';
    if (d.getMonth() !== anchor.getMonth()) cls += ' other';
    if (dStr === today) cls += ' today';
    cls += ' ' + dayClass(d);
    const holiday = lookupHoliday(dStr);
    const isPastDay = dStr < today;
    const evs = sessions
      .filter(s => s.date === dStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(s => {
        const m = memberMap[s.memberId];
        const isPersonal = !m;
        const color = isPersonal ? '#6b7280' : (m?.color || '#6b7280');
        const display = isPersonal ? (s.title || '내 일정') : (m?.name || '?');
        const label = hideMemberName
          ? `${escapeHtml(s.startTime)}~${escapeHtml(computeEndTime(s.startTime, s.durationMin))}`
          : `${escapeHtml(display)} ${escapeHtml(s.startTime)}`;
        const sid = escapeHtml(s.id || '');
        const status = s.status || 'scheduled';
        const evCls = ['ev'];
        if (isPersonal) evCls.push('ev-personal');
        if (isPastDay) evCls.push('is-past');
        if (status === 'canceled') evCls.push('is-canceled');
        if (status === 'completed') evCls.push('is-completed');
        if (status === 'noshow_charged') evCls.push('is-noshow-charged');
        if (status === 'noshow_free') evCls.push('is-noshow-free');
        return `<span class="${evCls.join(' ')}" data-session-id="${sid}" style="background:${color}">${label}</span>`;
      }).join('');
    const holidayLine = holiday ? `<span class="day-holiday">${escapeHtml(holiday)}</span>` : '';
    html += `<div class="${cls}" data-date="${dStr}"><span class="day-num">${d.getDate()}</span>${holidayLine}${evs}</div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
}
