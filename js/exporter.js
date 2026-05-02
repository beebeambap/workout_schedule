import { renderWeek, renderMonth, startOfWeek, addDays, ymd, computeEndTime } from './calendar.js';

const DOW_KR = ['일', '월', '화', '수', '목', '금', '토'];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function formatPeriod(anchor, mode) {
  if (mode === 'week') {
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    const sameYear = s.getFullYear() === e.getFullYear();
    const sameMonth = sameYear && s.getMonth() === e.getMonth();
    const left = `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}일(월)`;
    const right = sameMonth
      ? `${e.getDate()}일(일)`
      : (sameYear ? `${e.getMonth() + 1}월 ${e.getDate()}일(일)` : `${e.getFullYear()}년 ${e.getMonth() + 1}월 ${e.getDate()}일(일)`);
    return `${left} ~ ${right}`;
  }
  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`;
}

function buildWeekSummary(start, sessions) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const cells = days.map(d => {
    const dStr = ymd(d);
    const list = sessions
      .filter(s => s.date === dStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map(s => `${s.startTime}~${computeEndTime(s.startTime, s.durationMin)}`);
    return { dow: DOW_KR[d.getDay()], times: list };
  });

  let html = `<table class="export-summary-table"><tr>`;
  html += `<td class="summary-label">스케줄 요약</td>`;
  for (const c of cells) {
    const timesHtml = c.times.length
      ? c.times.map(t => `<div class="summary-time">${escapeHtml(t)}</div>`).join('')
      : `<div class="summary-time summary-empty">-</div>`;
    html += `<td class="summary-cell">
      <div class="summary-dow">${c.dow}</div>
      ${timesHtml}
    </td>`;
  }
  html += `</tr></table>`;
  return html;
}

// Build the export DOM, capture to canvas, return a JPG Blob.
export async function exportScheduleBlob({ member, anchor, mode, sessions, members }) {
  const filtered = member ? sessions.filter(s => s.memberId === member.id) : sessions;
  const title = member ? `${member.name}님 PT 스케줄` : '전체 PT 스케줄';

  const node = document.createElement('div');
  node.className = 'export-card';
  Object.assign(node.style, {
    position: 'absolute',
    left: '-10000px',
    top: '0',
    width: '900px',
    background: '#ffffff',
  });

  node.innerHTML = `
    <div class="export-header">
      <h2 class="export-title">${escapeHtml(title)}</h2>
      <p class="export-period">${escapeHtml(formatPeriod(anchor, mode))}</p>
    </div>
    <div class="export-calendar"></div>
  `;

  const calContainer = node.querySelector('.export-calendar');
  if (mode === 'week') {
    renderWeek(calContainer, anchor, filtered, members, !!member, {
      hideMemberName: !!member, exportMode: true,
    });
  } else {
    renderMonth(calContainer, anchor, filtered, members, { hideMemberName: !!member });
  }
  if (member && mode === 'week') {
    node.insertAdjacentHTML('beforeend', buildWeekSummary(startOfWeek(anchor), filtered));
  }

  document.body.appendChild(node);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(r));
    const canvas = await html2canvas(node, {
      backgroundColor: '#ffffff', scale: 2, useCORS: true,
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    return blob;
  } finally {
    node.remove();
  }
}

export async function exportSchedule(opts) {
  const blob = await exportScheduleBlob(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
