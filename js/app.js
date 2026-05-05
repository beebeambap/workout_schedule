import { Store } from './store.js';
import { parseCSV, parseXLSX, parseFreeText } from './parser.js';
import { renderWeek, renderMonth, computeEndTime } from './calendar.js';
import { exportSchedule, exportScheduleBlob } from './exporter.js';
import { sbReady, status as sbStatus } from './supabase.js';
import { getSession, sendMagicLink, signOut, onAuthChange, updateUserMetadata } from './auth.js';
import { preloadHolidays, ensureYearLoaded } from './holidays.js';
import * as Pin from './pin.js';

// Register service worker (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('SW register failed', e));
  });
}

const COLOR_PALETTE = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#06b6d4'];

const state = {
  view: 'calendar',
  mode: 'week',
  anchor: new Date(),
  filter: '',
  pending: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ---------- color palette ----------
function buildColorPalettes() {
  document.querySelectorAll('.color-palette').forEach(palette => {
    const target = document.getElementById(palette.dataset.target);
    if (!palette.children.length) {
      palette.innerHTML = COLOR_PALETTE.map(c =>
        `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`
      ).join('');
    }
    palette.querySelectorAll('.color-swatch').forEach(s => {
      s.addEventListener('click', () => {
        target.value = s.dataset.color;
        palette.querySelectorAll('.color-swatch').forEach(x =>
          x.classList.toggle('selected', x.dataset.color === s.dataset.color));
      });
    });
    syncPaletteSelection(palette, target.value);
  });
}
function syncPaletteSelection(palette, value) {
  palette.querySelectorAll('.color-swatch').forEach(x =>
    x.classList.toggle('selected', x.dataset.color === value));
}
buildColorPalettes();

// ---------- view switching ----------
$$('.topbar nav button').forEach(b => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});
function switchView(name) {
  state.view = name;
  $$('.topbar nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('main .view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'calendar') renderCalendar();
  if (name === 'members') renderMembers();
}

// ---------- import tabs ----------
$$('.tabs button').forEach(b => {
  b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $$('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
  });
});

// ---------- typing form: accumulate into preview, commit via 확정 ----------
$('#form-typing').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const session = {
    name: String(fd.get('name')).trim(),
    date: fd.get('date'),
    startTime: fd.get('start'),
    durationMin: parseInt(fd.get('duration'), 10) || 50
  };
  if (!session.name || !session.date || !session.startTime) return;
  appendToPreview([session]);
  flash('미리보기에 추가되었습니다. 모두 입력 후 확정을 누르세요.');
  // Reset name only — keep date/duration for fast multi-entry
  e.target.elements.name.value = '';
  e.target.elements.name.focus();
});

// ---------- file inputs ----------
$('#file-csv').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { showPreview(await parseCSV(f)); }
  catch (err) { alert('CSV 파싱 오류: ' + err.message); }
  e.target.value = '';
});

$('#file-xlsx').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { showPreview(await parseXLSX(f)); }
  catch (err) { alert('Excel 파싱 오류: ' + err.message); }
  e.target.value = '';
});

$('#btn-sample-csv').addEventListener('click', () => {
  const today = new Date();
  const t1 = ymd(today);
  const t2 = ymd(new Date(today.getTime() + 1 * 86400000));
  const t3 = ymd(new Date(today.getTime() + 2 * 86400000));
  const lines = [
    'member_name,date,start_time,duration_min',
    `김민수,${t1},09:00,50`,
    `박지영,${t1},10:30,50`,
    `이도윤,${t2},18:00,50`,
    `김민수,${t3},09:00,50`,
  ];
  // UTF-8 BOM so Excel opens Korean correctly
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'pt_schedule_sample.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// ---------- preview ----------
function showPreview({ sessions, warnings }) {
  state.pending = sessions.map(s => ({ ...s }));
  renderPreviewTable(warnings || []);
  $('#preview').classList.remove('hidden');
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function appendToPreview(sessions) {
  if (!Array.isArray(state.pending)) state.pending = [];
  state.pending.push(...sessions.map(s => ({ ...s })));
  renderPreviewTable([]);
  $('#preview').classList.remove('hidden');
}

function renderPreviewTable(warnings) {
  const tbl = $('#preview-table');
  const cnt = $('#preview-count');
  if (cnt) cnt.textContent = `(${(state.pending || []).length}건)`;
  let html = '<thead><tr><th>회원</th><th>날짜</th><th>시작</th><th>분</th><th></th></tr></thead><tbody>';
  state.pending.forEach((s, i) => {
    html += `<tr data-idx="${i}">
      <td><input data-k="name" value="${esc(s.name)}"></td>
      <td><input data-k="date" type="date" value="${esc(s.date)}"></td>
      <td><input data-k="startTime" type="time" value="${esc(s.startTime)}"></td>
      <td><input data-k="durationMin" type="number" min="10" step="5" value="${s.durationMin}"></td>
      <td><button class="row-del" data-idx="${i}">삭제</button></td>
    </tr>`;
  });
  if (!state.pending.length) html += '<tr><td colspan="5" style="color:#9ca3af">추출된 행이 없습니다.</td></tr>';
  html += '</tbody>';
  if (warnings.length) {
    html += `<tfoot><tr><td colspan="5">경고 ${warnings.length}건: ${warnings.map(w => `행 ${w.row} ${w.msg}`).join(', ')}</td></tr></tfoot>`;
  }
  tbl.innerHTML = html;

  tbl.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const tr = e.target.closest('tr');
      const idx = parseInt(tr.dataset.idx, 10);
      const k = e.target.dataset.k;
      let v = e.target.value;
      if (k === 'durationMin') v = parseInt(v, 10) || 50;
      state.pending[idx][k] = v;
    });
  });
  tbl.querySelectorAll('.row-del').forEach(b => {
    b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.idx, 10);
      state.pending.splice(idx, 1);
      renderPreviewTable([]);
    });
  });
}

let confirmBusy = false;
$('#btn-confirm').addEventListener('click', async () => {
  if (confirmBusy) return;
  if (!state.pending || !state.pending.length) {
    alert('확정할 항목이 없습니다. 먼저 텍스트/CSV/타이핑으로 미리보기에 행을 추가하세요.');
    return;
  }
  const btn = $('#btn-confirm');
  confirmBusy = true;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '저장 중...';
  try {
    await commitSessions(state.pending);
    state.pending = null;
    $('#preview').classList.add('hidden');
    flash('확정되었습니다.');
    switchView('calendar');
  } catch (err) {
    console.error('[confirm] error:', err);
    alert('저장 오류: ' + (err?.message || err) +
      '\n\n브라우저 개발자 도구(F12)의 Console 탭에 자세한 내용이 있습니다.');
  } finally {
    confirmBusy = false;
    btn.disabled = false;
    btn.textContent = orig;
  }
});

$('#btn-cancel').addEventListener('click', () => {
  state.pending = null;
  $('#preview').classList.add('hidden');
});

async function commitSessions(arr) {
  const valid = arr.filter(s => s.name && s.date && s.startTime);
  // Resolve members first (insert any new ones), then bulk-insert sessions.
  const enriched = [];
  for (const s of valid) {
    const m = await Store.ensureMember(s.name);
    enriched.push({
      memberId: m.id,
      date: s.date,
      startTime: s.startTime,
      durationMin: parseInt(s.durationMin, 10) || 50,
    });
  }
  await Store.addSessions(enriched);
}

// ---------- members ----------
$('#form-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = String(fd.get('name')).trim();
  if (!name) return;
  try {
    await Store.ensureMember(name, fd.get('color'), String(fd.get('memo') || '').trim());
    e.target.reset();
    const c = $('#form-member-color');
    c.value = '#3b82f6';
    syncPaletteSelection(document.querySelector('.color-palette[data-target="form-member-color"]'), c.value);
  } catch (err) {
    alert('저장 오류: ' + err.message);
  }
});

function renderMembers() {
  const ul = $('#member-list');
  const ms = Store.members();
  const counts = Store.countByMember();
  if (!ms.length) {
    ul.innerHTML = '<li class="ml-empty">등록된 회원이 없습니다. 가져오기에서 일정을 등록하면 자동으로 생성됩니다.</li>';
    return;
  }
  ul.innerHTML = ms.map(m => {
    const memoPreview = (m.memo || '').replace(/\s+/g, ' ').trim();
    return `<li class="member-card" data-id="${m.id}">
      <div class="mc-head">
        <span class="mc-color" style="background:${m.color}"></span>
        <button class="mc-edit" data-id="${m.id}" title="정보 편집" aria-label="정보 편집">✎</button>
      </div>
      <div class="mc-name">${esc(m.name)}</div>
      <div class="mc-count">수업 ${counts[m.id] || 0}건</div>
      ${memoPreview ? `<div class="mc-memo">${esc(memoPreview)}</div>` : '<div class="mc-memo mc-memo-empty">메모 없음</div>'}
    </li>`;
  }).join('');
  ul.querySelectorAll('.mc-edit').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openMemberModal(b.dataset.id);
    });
  });
  ul.querySelectorAll('li.member-card').forEach(li => {
    li.addEventListener('click', () => openMemberDetail(li.dataset.id));
  });
}

// ---------- calendar ----------
$('#btn-prev').addEventListener('click', () => {
  state.anchor = state.mode === 'week'
    ? new Date(state.anchor.getTime() - 7 * 86400000)
    : new Date(state.anchor.getFullYear(), state.anchor.getMonth() - 1, 1);
  renderCalendar();
});

$('#btn-next').addEventListener('click', () => {
  state.anchor = state.mode === 'week'
    ? new Date(state.anchor.getTime() + 7 * 86400000)
    : new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1);
  renderCalendar();
});

$('#btn-today').addEventListener('click', () => {
  state.anchor = new Date();
  renderCalendar();
});

$('#view-mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  renderCalendar();
});

$('#member-filter').addEventListener('change', (e) => {
  state.filter = e.target.value;
  renderCalendar();
});

$('#btn-export').addEventListener('click', async () => {
  const member = state.filter ? Store.members().find(m => m.id === state.filter) : null;
  const tag = member ? member.name : 'all';
  const fname = `${tag}_${ymd(state.anchor)}_${state.mode}.jpg`;
  await exportSchedule({
    member,
    anchor: state.anchor,
    mode: state.mode,
    sessions: Store.sessions(),
    members: Store.members(),
    filename: fname,
  });
});

$('#btn-export-all').addEventListener('click', async () => {
  const ms = Store.members();
  if (!ms.length) { alert('회원이 없습니다.'); return; }
  if (!confirm(`${ms.length}명의 회원 캘린더를 ZIP 한 파일로 묶어 다운로드합니다. 계속할까요?`)) return;
  const btn = $('#btn-export-all');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '생성 중...';

  try {
    const sessions = Store.sessions();
    const members = Store.members();
    const zip = new JSZip();
    let i = 0;
    for (const m of ms) {
      i++;
      btn.textContent = `생성 중 ${i}/${ms.length}`;
      const blob = await exportScheduleBlob({
        member: m,
        anchor: state.anchor,
        mode: state.mode,
        sessions,
        members,
      });
      zip.file(`${m.name}_${ymd(state.anchor)}_${state.mode}.jpg`, blob);
    }
    btn.textContent = '압축 중...';
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pt_schedules_${ymd(state.anchor)}_${state.mode}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash('ZIP 다운로드 완료');
  } catch (err) {
    console.error(err);
    alert('ZIP 생성 오류: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

function refreshFilter() {
  const sel = $('#member-filter');
  const cur = sel.value;
  const ms = Store.members();
  sel.innerHTML = '<option value="">전체 회원</option>'
    + ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  state.filter = sel.value;
}

let _renderingForYear = null;
function renderCalendar() {
  const cont = $('#calendar');
  let sessions = Store.sessions();
  if (state.filter) sessions = sessions.filter(s => s.memberId === state.filter);
  const members = Store.members();
  const fit = !!state.filter;
  const label = state.mode === 'week'
    ? renderWeek(cont, state.anchor, sessions, members, fit)
    : renderMonth(cont, state.anchor, sessions, members);
  $('#period-label').textContent = label;
  // If holidays for this year aren't loaded yet, load and re-render once.
  const y = state.anchor.getFullYear();
  if (_renderingForYear !== y) {
    _renderingForYear = y;
    ensureYearLoaded(y).then(() => {
      if (state.view === 'calendar' && state.anchor.getFullYear() === y) {
        const cont2 = $('#calendar');
        if (state.mode === 'week') renderWeek(cont2, state.anchor, sessions, members, fit);
        else renderMonth(cont2, state.anchor, sessions, members);
      }
    });
  }
}

// ---------- trainer's personal events ----------
$('#btn-add-personal').addEventListener('click', () => {
  $('#pe-title').value = '';
  $('#pe-date').value = ymd(state.anchor || new Date());
  $('#pe-start').value = '';
  $('#pe-duration').value = 60;
  $('#modal-personal').showModal();
  setTimeout(() => $('#pe-title').focus(), 50);
});

let peSaveBusy = false;
$('#pe-save').addEventListener('click', async () => {
  if (peSaveBusy) return;
  const title = $('#pe-title').value.trim();
  const date = $('#pe-date').value;
  const start = $('#pe-start').value;
  const duration = parseInt($('#pe-duration').value, 10);
  if (!date || !start) { alert('날짜와 시작 시간을 입력하세요.'); return; }
  peSaveBusy = true;
  const btn = $('#pe-save'); btn.disabled = true;
  try {
    await Store.addSessions([{
      memberId: null,
      title: title || '내 일정',
      date,
      startTime: start,
      durationMin: Number.isFinite(duration) ? duration : 60,
    }]);
    $('#modal-personal').close();
    flash('일정이 추가되었습니다.');
  } catch (err) {
    console.error(err);
    alert('저장 오류: ' + (err?.message || err) +
      '\n\nSupabase 스키마 마이그레이션이 필요할 수 있습니다. docs/SUPABASE_SETUP.md 참고.');
  } finally {
    peSaveBusy = false;
    btn.disabled = false;
  }
});

// ---------- click on a calendar event opens session modal ----------
$('#calendar').addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-session-id]');
  if (!target) return;
  const sid = target.dataset.sessionId;
  if (sid) openSessionModal(sid);
});

function openSessionModal(sessionId) {
  const s = Store.sessions().find(x => x.id === sessionId);
  if (!s) return;
  const m = s.memberId ? Store.members().find(x => x.id === s.memberId) : null;
  const isPersonal = !m;

  const endTime = computeEndTime(s.startTime, s.durationMin);
  $('#ms-title').textContent = isPersonal ? (s.title || '내 일정') : `${m.name}님 수업`;

  if (isPersonal) {
    $('#ms-body').innerHTML = `
      <div class="modal-row"><span class="modal-label">제목</span><span class="modal-value">${esc(s.title || '내 일정')}</span></div>
      <div class="modal-row"><span class="modal-label">날짜</span><span class="modal-value">${esc(s.date)}</span></div>
      <div class="modal-row"><span class="modal-label">시간</span><span class="modal-value">${esc(s.startTime)} ~ ${esc(endTime)} <span class="hint">(${s.durationMin}분)</span></span></div>
    `;
    $('#ms-edit-member').hidden = true;
  } else {
    const memoLine = m.memo
      ? `<div class="modal-row"><span class="modal-label">메모</span><span class="modal-value">${esc(m.memo)}</span></div>`
      : '';
    $('#ms-body').innerHTML = `
      <div class="modal-row"><span class="modal-label">회원</span>
        <span class="modal-value"><span class="swatch" style="background:${m.color}"></span> ${esc(m.name)}</span>
      </div>
      <div class="modal-row"><span class="modal-label">날짜</span><span class="modal-value">${esc(s.date)}</span></div>
      <div class="modal-row"><span class="modal-label">시간</span><span class="modal-value">${esc(s.startTime)} ~ ${esc(endTime)} <span class="hint">(${s.durationMin}분)</span></span></div>
      ${memoLine}
    `;
    $('#ms-edit-member').hidden = false;
    $('#ms-edit-member').onclick = () => {
      $('#modal-session').close();
      openMemberModal(m.id);
    };
  }

  $('#ms-delete').onclick = async () => {
    if (!confirm('이 일정을 삭제할까요?')) return;
    try {
      await Store.removeSession(s.id);
      $('#modal-session').close();
      flash('삭제되었습니다.');
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  };

  $('#modal-session').showModal();
}

function openMemberModal(memberId) {
  const m = Store.members().find(x => x.id === memberId);
  if (!m) return;
  $('#mm-name').value = m.name;
  $('#mm-color').value = m.color;
  syncPaletteSelection(document.querySelector('.color-palette[data-target="mm-color"]'), m.color);
  $('#mm-memo').value = m.memo || '';
  const statusSel = $('#mm-status');
  if (statusSel) statusSel.value = m.status || 'active';
  const cnt = Store.countByMember()[m.id] || 0;
  const statusInfo = m.status && m.status !== 'active'
    ? ` · ${statusLabel(m.status)}${m.statusAt ? ` (${m.statusAt})` : ''}`
    : '';
  $('#mm-stats').textContent = `등록된 수업 ${cnt}건${statusInfo}`;

  $('#mm-save').onclick = async () => {
    try {
      await Store.updateMember(m.id, {
        name: $('#mm-name').value,
        color: $('#mm-color').value,
        memo: $('#mm-memo').value,
        status: $('#mm-status')?.value || 'active',
      });
      $('#modal-member').close();
      flash('저장되었습니다.');
    } catch (err) {
      alert(err.message);
    }
  };
  $('#mm-delete').onclick = async () => {
    if (!confirm(`${m.name} 회원과 모든 수업을 삭제할까요?`)) return;
    try {
      await Store.removeMember(m.id);
      $('#modal-member').close();
      flash('삭제되었습니다.');
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  };

  $('#modal-member').showModal();
}

// ---------- member detail modal (calendar + info) ----------
const detailState = { memberId: null, anchor: new Date(), mode: 'week' };

function openMemberDetail(memberId) {
  detailState.memberId = memberId;
  detailState.anchor = new Date();
  detailState.mode = 'week';
  $('#md-mode').value = 'week';
  renderMemberDetail();
  $('#modal-member-detail').showModal();
}

function renderMemberDetail() {
  const m = Store.members().find(x => x.id === detailState.memberId);
  if (!m) return;
  const sessions = Store.sessions().filter(s => s.memberId === m.id);

  $('#md-title').textContent = `${m.name}님 스케줄`;
  $('#md-color').style.background = m.color;
  $('#md-name').textContent = m.name;
  $('#md-stats').textContent = `등록된 수업 ${sessions.length}건`;
  const memoEl = $('#md-memo');
  if (m.memo) {
    memoEl.textContent = m.memo;
    memoEl.classList.remove('mc-memo-empty');
  } else {
    memoEl.textContent = '메모 없음';
    memoEl.classList.add('mc-memo-empty');
  }

  const cont = $('#md-calendar');
  const label = detailState.mode === 'week'
    ? renderWeek(cont, detailState.anchor, sessions, [m], true, { hideMemberName: true })
    : renderMonth(cont, detailState.anchor, sessions, [m], { hideMemberName: true });
  $('#md-period').textContent = label;
}

$('#md-prev').addEventListener('click', () => {
  detailState.anchor = detailState.mode === 'week'
    ? new Date(detailState.anchor.getTime() - 7 * 86400000)
    : new Date(detailState.anchor.getFullYear(), detailState.anchor.getMonth() - 1, 1);
  renderMemberDetail();
});
$('#md-next').addEventListener('click', () => {
  detailState.anchor = detailState.mode === 'week'
    ? new Date(detailState.anchor.getTime() + 7 * 86400000)
    : new Date(detailState.anchor.getFullYear(), detailState.anchor.getMonth() + 1, 1);
  renderMemberDetail();
});
$('#md-today').addEventListener('click', () => {
  detailState.anchor = new Date();
  renderMemberDetail();
});
$('#md-mode').addEventListener('change', (e) => {
  detailState.mode = e.target.value;
  renderMemberDetail();
});
$('#md-edit').addEventListener('click', () => {
  $('#modal-member-detail').close();
  if (detailState.memberId) openMemberModal(detailState.memberId);
});
$('#md-calendar').addEventListener('click', (ev) => {
  const target = ev.target.closest('[data-session-id]');
  if (!target) return;
  if (target.dataset.sessionId) openSessionModal(target.dataset.sessionId);
});

// ---------- trainer profile (nickname stored in user_metadata) ----------
let currentSession = null;

function applyAccountChip(session) {
  currentSession = session;
  const nick = session?.user?.user_metadata?.nickname || '';
  const email = session?.user?.email || '';
  $('#btn-profile').textContent = nick ? `${nick} 코치님` : email;
  $('#btn-profile').title = email + (nick ? '' : ' (별명 설정하기)');
}

$('#btn-profile').addEventListener('click', () => {
  if (!currentSession) return;
  const nick = currentSession.user?.user_metadata?.nickname || '';
  $('#pf-nickname').value = nick;
  $('#modal-profile').showModal();
});

let pfSaveBusy = false;
$('#pf-save').onclick = async () => {
  if (pfSaveBusy) return;
  pfSaveBusy = true;
  const btn = $('#pf-save');
  btn.disabled = true;
  const nick = $('#pf-nickname').value.trim();
  try {
    const user = await updateUserMetadata({ nickname: nick });
    currentSession = { ...currentSession, user };
    applyAccountChip(currentSession);
    $('#modal-profile').close();
    flash('저장되었습니다.');
  } catch (err) {
    alert('저장 오류: ' + err.message);
  } finally {
    pfSaveBusy = false;
    btn.disabled = false;
  }
};

// ---------- text-input tab ----------
$('#btn-text-parse').addEventListener('click', () => {
  const text = $('#text-input').value;
  if (!text.trim()) { alert('텍스트가 비어 있습니다.'); return; }
  const parsed = parseFreeText(text);
  if (!parsed.sessions.length) {
    alert('일정을 찾지 못했습니다.\n\n예시:\n260504\n김민수 09:00\n박지영 10:30');
    return;
  }
  appendToPreview(parsed.sessions);
  flash(`${parsed.sessions.length}건이 미리보기에 추가되었습니다.`);
});

// ---------- XLSX stats export ----------
const SESSION_MIN = 50; // 1 세션 = 50분
const toSessions = (min) => +(min / SESSION_MIN).toFixed(2);

$('#btn-stats-xlsx').addEventListener('click', () => {
  const sessions = Store.sessions().filter(s => s.memberId); // PT 세션만 (트레이너 개인 일정 제외)
  if (!sessions.length) { alert('수업 데이터가 없습니다.'); return; }
  const members = Store.members();
  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  // member.firstDate / member.lastDate
  const firstByMember = {}, lastByMember = {};
  for (const s of sessions) {
    if (!firstByMember[s.memberId] || s.date < firstByMember[s.memberId]) firstByMember[s.memberId] = s.date;
    if (!lastByMember[s.memberId] || s.date > lastByMember[s.memberId]) lastByMember[s.memberId] = s.date;
  }

  // Per-month aggregation
  const monthly = {};
  for (const s of sessions) {
    const ym = (s.date || '').slice(0, 7);
    if (!ym) continue;
    if (!monthly[ym]) monthly[ym] = { sessions: 0, members: new Set() };
    monthly[ym].sessions += toSessions(s.durationMin || 0);
    monthly[ym].members.add(s.memberId);
  }
  const months = Object.keys(monthly).sort();

  // 신규 회원: first session is in this month
  const newPerMonth = {};
  for (const mid in firstByMember) {
    const ym = firstByMember[mid].slice(0, 7);
    newPerMonth[ym] = (newPerMonth[ym] || 0) + 1;
  }

  // 종료/연장 회원: from member.status_at (if schema migrated)
  const endedPerMonth = {}, extendedPerMonth = {};
  for (const m of members) {
    if (!m.status || !m.statusAt || m.status === 'active') continue;
    const ym = (m.statusAt || '').slice(0, 7);
    if (!ym) continue;
    if (m.status === 'ended') endedPerMonth[ym] = (endedPerMonth[ym] || 0) + 1;
    if (m.status === 'extended') extendedPerMonth[ym] = (extendedPerMonth[ym] || 0) + 1;
  }

  // 휴면: had sessions but none in current/last 30 days (compute per month: had session in prior months but 0 this month)
  const sessionDatesByMember = {};
  for (const s of sessions) {
    if (!sessionDatesByMember[s.memberId]) sessionDatesByMember[s.memberId] = new Set();
    sessionDatesByMember[s.memberId].add(s.date.slice(0, 7));
  }

  // ---- Sheet 1: 월별 요약 ----
  const summaryRows = months.map((ym, i) => {
    const prev = i > 0 ? monthly[months[i - 1]].sessions : null;
    const sess = +monthly[ym].sessions.toFixed(2);
    const delta = prev != null ? +(sess - prev).toFixed(2) : null;
    const deltaPct = prev != null && prev > 0 ? +(((sess - prev) / prev) * 100).toFixed(1) : null;
    const active = monthly[ym].members.size;

    // 휴면: had sessions before ym but none in ym
    let dormant = 0;
    for (const mid in sessionDatesByMember) {
      const months_ = sessionDatesByMember[mid];
      const hadBefore = [...months_].some(x => x < ym);
      const hadThis = months_.has(ym);
      if (hadBefore && !hadThis) dormant++;
    }

    return {
      '월': ym,
      '세션': sess,
      '전월 대비': delta,
      '전월 대비(%)': deltaPct,
      '활성 회원': active,
      '신규 회원': newPerMonth[ym] || 0,
      '연장 회원': extendedPerMonth[ym] || 0,
      '종료 회원': endedPerMonth[ym] || 0,
      '휴면 회원': dormant,
    };
  });

  // ---- Sheet 2: 회원별 월별 (세션 단위) ----
  const memberMonthly = {};
  for (const s of sessions) {
    const ym = (s.date || '').slice(0, 7);
    if (!ym) continue;
    if (!memberMonthly[s.memberId]) memberMonthly[s.memberId] = {};
    memberMonthly[s.memberId][ym] = (memberMonthly[s.memberId][ym] || 0) + toSessions(s.durationMin || 0);
  }
  const memberRows = members.map(m => {
    const row = {
      '회원': m.name,
      '상태': statusLabel(m.status),
      '시작일': firstByMember[m.id] || '-',
      '최근 수업': lastByMember[m.id] || '-',
    };
    let total = 0;
    for (const ym of months) {
      const v = +(((memberMonthly[m.id] || {})[ym] || 0)).toFixed(2);
      row[ym] = v;
      total += v;
    }
    row['총 세션'] = +total.toFixed(2);
    return row;
  });

  // ---- Sheet 3: 회원 상세 (특이사항) ----
  const memberDetail = members.map(m => ({
    '회원': m.name,
    '상태': statusLabel(m.status),
    '상태 변경일': m.statusAt || '-',
    '시작일': firstByMember[m.id] || '-',
    '최근 수업': lastByMember[m.id] || '-',
    '총 세션': +Object.values(memberMonthly[m.id] || {}).reduce((a, b) => a + b, 0).toFixed(2),
    '메모': m.memo || '',
  }));

  // ---- Sheet 4: 전체 수업 목록 ----
  const allRows = [...sessions]
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .map(s => ({
      '회원': memberMap[s.memberId]?.name || '?',
      '날짜': s.date,
      '시작': s.startTime,
      '종료': computeEndTime(s.startTime, s.durationMin),
      '세션': toSessions(s.durationMin || 0),
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), '월별 요약');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memberRows), '회원별 월별');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memberDetail), '회원 상세');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), '전체 수업');

  // 파일명: 가장 최근 수업의 YYYY-MM 기준
  const latestYm = months[months.length - 1] || ymd(new Date()).slice(0, 7);
  XLSX.writeFile(wb, `pt_stats_${latestYm}.xlsx`);
  flash('XLSX 다운로드');
});

function statusLabel(s) {
  return s === 'extended' ? 'PT 연장' : s === 'ended' ? 'PT 종료' : '활성';
}

// ---------- PIN lock ----------
function showPinScreen(userId) {
  $('#pin-screen').hidden = false;
  $('#pin-input').value = '';
  $('#pin-screen-error').textContent = '';
  setTimeout(() => $('#pin-input').focus(), 50);
  renderPinDots(0);
}

function hidePinScreen() {
  $('#pin-screen').hidden = true;
  Pin.markUnlocked();
  Pin.noteVisibleNow();
}

function renderPinDots(filled) {
  const total = parseInt($('#pin-input').maxLength, 10) || 6;
  const max = Math.max(filled, 4);
  const dots = $('#pin-dots');
  dots.innerHTML = '';
  for (let i = 0; i < max; i++) {
    const d = document.createElement('span');
    d.className = 'pin-dot' + (i < filled ? ' filled' : '');
    dots.appendChild(d);
  }
}

$('#pin-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^\d]/g, '');
  renderPinDots(e.target.value.length);
});
$('#pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#pin-submit').click();
});

$('#pin-submit').addEventListener('click', async () => {
  const uid = currentSession?.user?.id;
  if (!uid) return;
  const pin = $('#pin-input').value;
  if (!pin) return;
  const ok = await Pin.verifyPin(uid, pin);
  if (ok) {
    hidePinScreen();
  } else {
    $('#pin-screen-error').textContent = 'PIN이 일치하지 않습니다.';
    $('#pin-input').value = '';
    renderPinDots(0);
    $('#pin-input').focus();
  }
});

$('#pin-forgot').addEventListener('click', async () => {
  if (!confirm('PIN을 재설정하려면 로그아웃 후 이메일 매직 링크로 다시 로그인해야 합니다. 진행할까요?')) return;
  const uid = currentSession?.user?.id;
  if (uid) Pin.clearPin(uid);
  Pin.lockNow();
  await signOut();
  // After signOut, onAuthChange will show auth screen.
  $('#pin-screen').hidden = true;
  alert('로그아웃 되었습니다. 이메일로 다시 로그인 후 PIN을 새로 설정하세요.');
});

// Background re-lock: if PIN is set and user goes away for >30s, lock on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    Pin.noteVisibleNow();
  } else {
    const uid = currentSession?.user?.id;
    if (uid && Pin.isPinSet(uid) && Pin.shouldRelockOnReturn()) {
      Pin.lockNow();
      showPinScreen(uid);
    }
  }
});

// ---------- PIN settings (in profile modal) ----------
function refreshPinUI() {
  const uid = currentSession?.user?.id;
  const has = uid && Pin.isPinSet(uid);
  $('#pf-pin-set').hidden = !!has;
  $('#pf-pin-change').hidden = !has;
  $('#pf-pin-clear').hidden = !has;
  $('#pf-pin-status').textContent = has
    ? '잠금 사용 중 (이 기기에 한정).'
    : '이 기기에서 잠금이 비활성화 되어 있습니다.';
}

function openPinSetup(mode) {
  $('#pin-setup-title').textContent = mode === 'change' ? 'PIN 변경' : 'PIN 설정';
  $('#pin-new').value = '';
  $('#pin-confirm').value = '';
  $('#pin-setup-error').textContent = '';
  $('#modal-pin-setup').showModal();
  setTimeout(() => $('#pin-new').focus(), 50);
}

$('#pf-pin-set').addEventListener('click', () => openPinSetup('set'));
$('#pf-pin-change').addEventListener('click', () => openPinSetup('change'));

$('#pf-pin-clear').addEventListener('click', () => {
  if (!confirm('이 기기의 잠금을 해제할까요? 다른 기기는 영향받지 않습니다.')) return;
  const uid = currentSession?.user?.id;
  if (!uid) return;
  Pin.clearPin(uid);
  refreshPinUI();
  flash('잠금이 해제되었습니다.');
});

$('#pin-setup-save').addEventListener('click', async () => {
  const uid = currentSession?.user?.id;
  if (!uid) return;
  const a = $('#pin-new').value;
  const b = $('#pin-confirm').value;
  if (!/^\d{4,6}$/.test(a)) {
    $('#pin-setup-error').textContent = 'PIN은 숫자 4~6자리여야 합니다.';
    return;
  }
  if (a !== b) {
    $('#pin-setup-error').textContent = '두 입력이 일치하지 않습니다.';
    return;
  }
  try {
    await Pin.setPin(uid, a);
    Pin.markUnlocked();
    $('#modal-pin-setup').close();
    refreshPinUI();
    flash('PIN이 저장되었습니다.');
  } catch (err) {
    $('#pin-setup-error').textContent = err.message || '저장 실패';
  }
});

// Update PIN UI whenever profile modal opens
const _origProfileClick = $('#btn-profile').onclick;
$('#btn-profile').addEventListener('click', () => setTimeout(refreshPinUI, 50));

// ---------- footer: last update from GitHub ----------
async function loadLastUpdate() {
  const el = document.getElementById('last-update');
  if (!el) return;
  try {
    const res = await fetch('https://api.github.com/repos/beebeambap/workout_schedule/commits?per_page=1', {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(res.status);
    const commits = await res.json();
    const d = new Date(commits[0].commit.committer.date);
    el.textContent = d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    el.textContent = '—';
  }
}
loadLastUpdate();

// Generic modal close
document.querySelectorAll('[data-close]').forEach(b => {
  b.addEventListener('click', () => b.closest('dialog')?.close());
});

// ---------- toast ----------
let flashTimer = null;
function flash(msg) {
  let n = document.getElementById('toast');
  if (!n) {
    n = document.createElement('div');
    n.id = 'toast';
    Object.assign(n.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#111827', color: '#fff', padding: '10px 16px', borderRadius: '6px',
      fontSize: '14px', zIndex: 100, opacity: '0', transition: 'opacity .2s'
    });
    document.body.appendChild(n);
  }
  n.textContent = msg;
  n.style.opacity = '1';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { n.style.opacity = '0'; }, 1800);
}

// ---------- auth + bootstrap ----------
function show(id) { document.getElementById(id).hidden = false; }
function hide(id) { document.getElementById(id).hidden = true; }

function pinToday() {
  const dateInput = $('#form-typing input[name="date"]');
  if (dateInput && !dateInput.value) dateInput.value = ymd(new Date());
  state.anchor = new Date();
}

function showAuthScreen() {
  hide('app-topbar');
  hide('app-main');
  show('auth-screen');
}
function showApp(session) {
  hide('auth-screen');
  show('app-topbar');
  show('app-main');
  applyAccountChip(session);
  // First-time prompt for nickname if missing
  if (!session?.user?.user_metadata?.nickname && !sessionStorage.getItem('promptedNickname')) {
    sessionStorage.setItem('promptedNickname', '1');
    setTimeout(() => $('#btn-profile').click(), 500);
  }
}

async function maybeMigrateLocal() {
  const oldM = localStorage.getItem('pt_members');
  const oldS = localStorage.getItem('pt_sessions');
  if (!oldM && !oldS) return;
  const choice = confirm(
    '브라우저에 저장된 이전 로컬 데이터가 있습니다.\n\n' +
    '확인: 클라우드 계정으로 옮깁니다.\n' +
    '취소: 그대로 두고 다음에 다시 묻습니다.'
  );
  if (!choice) return;
  try {
    const oldMembers = JSON.parse(oldM || '[]');
    const oldSessions = JSON.parse(oldS || '[]');
    const idMap = {};
    for (const om of oldMembers) {
      const m = await Store.ensureMember(om.name, om.color, om.memo || '');
      idMap[om.id] = m.id;
    }
    const newSessions = oldSessions
      .filter(s => idMap[s.memberId])
      .map(s => ({
        memberId: idMap[s.memberId],
        date: s.date,
        startTime: s.startTime,
        durationMin: s.durationMin,
      }));
    if (newSessions.length) await Store.addSessions(newSessions);
    localStorage.removeItem('pt_members');
    localStorage.removeItem('pt_sessions');
    flash(`이전 완료: 회원 ${oldMembers.length}명, 수업 ${newSessions.length}건`);
  } catch (err) {
    alert('이전 중 오류: ' + err.message + '\n로컬 데이터는 보존되었습니다.');
  }
}

async function onSignedIn(session) {
  showApp(session);
  pinToday();
  Store.onUpdate(() => {
    refreshFilter();
    if (state.view === 'calendar') renderCalendar();
    if (state.view === 'members') renderMembers();
  });
  try {
    await Store.init();
  } catch (err) {
    alert('데이터 로드 오류: ' + err.message);
    return;
  }
  await maybeMigrateLocal();
  refreshFilter();
  renderCalendar();
  renderMembers();

  // PIN gate: lock the UI if a PIN is set and we're not already unlocked.
  const uid = session?.user?.id;
  if (uid && Pin.isPinSet(uid) && !Pin.isUnlocked()) {
    showPinScreen(uid);
  }
}

async function onSignedOut() {
  await Store.teardown();
  showAuthScreen();
}

// Magic link form
$('#form-magic').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#auth-email').value.trim();
  if (!email) return;
  const status = $('#auth-status');
  status.textContent = '전송 중...';
  try {
    await sendMagicLink(email);
    status.textContent = `${email} 으로 로그인 링크를 보냈습니다. 이메일에서 링크를 클릭하면 자동으로 로그인됩니다.`;
  } catch (err) {
    status.textContent = '오류: ' + err.message;
  }
});

$('#btn-signout').addEventListener('click', async () => {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  await signOut();
});

// Preload holidays on bootstrap (no auth needed, just network).
preloadHolidays().then(() => {
  if (state.view === 'calendar') renderCalendar();
});

async function bootstrap() {
  if (!sbReady) {
    const ul = document.getElementById('config-status');
    if (ul) {
      const ok = (b) => b ? '<span style="color:#059669">✓ 설정됨</span>'
                          : '<span style="color:#dc2626">✗ 누락</span>';
      ul.innerHTML = `
        <li><b>SUPABASE_URL</b>: ${ok(sbStatus.url)}</li>
        <li><b>SUPABASE_ANON_KEY</b>: ${ok(sbStatus.key)}</li>
        <li><b>Supabase 라이브러리(CDN)</b>: ${ok(sbStatus.lib)}</li>
      `;
    }
    show('config-screen');
    return;
  }
  const session = await getSession();
  if (session) await onSignedIn(session);
  else showAuthScreen();
  onAuthChange(async (newSession) => {
    if (newSession) await onSignedIn(newSession);
    else await onSignedOut();
  });
}

bootstrap();

// Refresh week view every minute so the red "now" line tracks current time.
setInterval(() => {
  if (state.view === 'calendar' && state.mode === 'week') renderCalendar();
}, 60_000);
