// Build a valid VCALENDAR (.ics) string for Google/Apple/Outlook calendars.
// Times are emitted with TZID=Asia/Seoul. Personal events (no memberId)
// use their title; member events use the member name.

import { computeEndTime } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');

function fmtLocal(date, time) {
  const [y, m, d] = date.split('-');
  const [h, mi] = time.split(':');
  return `${y}${m}${d}T${pad(h)}${pad(mi)}00`;
}

function fmtUtc(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold long lines per RFC 5545 (max 75 octets)
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
    i += 73;
  }
  return parts.join('\r\n');
}

export function buildICS(sessions, members, options = {}) {
  const calName = options.calendarName || '레슨핏';
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));
  const stamp = fmtUtc(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lesson Fit//KR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeIcs(calName)}`),
    'X-WR-TIMEZONE:Asia/Seoul',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:KST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const s of sessions) {
    if (!s.date || !s.startTime) continue;
    const m = memberMap[s.memberId];
    const isPersonal = !m;
    const summary = isPersonal ? (s.title || '내 일정') : (m.name || '?');
    const dtStart = fmtLocal(s.date, s.startTime);
    const endTime = computeEndTime(s.startTime, s.durationMin || 50);
    const dtEnd = fmtLocal(s.date, endTime);

    const desc = !isPersonal && m.memo ? `메모: ${m.memo}` : '';
    const category = isPersonal ? '개인' : '레슨';

    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:${s.id}@lessonfit`),
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Seoul:${dtStart}`,
      `DTEND;TZID=Asia/Seoul:${dtEnd}`,
      fold(`SUMMARY:${escapeIcs(summary)}`),
      fold(`CATEGORIES:${escapeIcs(category)}`),
    );
    if (desc) lines.push(fold(`DESCRIPTION:${escapeIcs(desc)}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
