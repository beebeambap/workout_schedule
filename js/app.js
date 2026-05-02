import { Store } from './store.js';
import { parseCSV, parseXLSX } from './parser.js';
import { renderWeek, renderMonth, computeEndTime } from './calendar.js';
import { exportSchedule } from './exporter.js';
import { sbReady } from './supabase.js';
import { getSession, sendMagicLink, signOut, onAuthChange } from './auth.js';

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

$('#btn-confirm').addEventListener('click', async () => {
  if (!state.pending || !state.pending.length) {
    alert('확정할 항목이 없습니다.');
    return;
  }
  try {
    await commitSessions(state.pending);
    state.pending = null;
    $('#preview').classList.add('hidden');
    flash('확정되었습니다.');
    switchView('calendar');
  } catch (err) {
    alert('저장 오류: ' + err.message);
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
    e.target.elements.color.value = '#3b82f6';
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
    return `<li data-id="${m.id}">
      <span class="swatch" style="background:${m.color}"></span>
      <div class="ml-info">
        <div class="ml-row1"><span class="ml-name">${esc(m.name)}</span><span class="count">수업 ${counts[m.id] || 0}건</span></div>
        ${memoPreview ? `<div class="ml-memo">${esc(memoPreview)}</div>` : ''}
      </div>
      <button class="ml-edit" data-id="${m.id}">편집</button>
    </li>`;
  }).join('');
  ul.querySelectorAll('.ml-edit').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openMemberModal(b.dataset.id);
    });
  });
  ul.querySelectorAll('li[data-id]').forEach(li => {
    li.addEventListener('click', () => openMemberModal(li.dataset.id));
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
  if (!confirm(`${ms.length}명의 회원 캘린더를 각각 JPG로 저장합니다. 브라우저가 다중 다운로드를 묻거나 차단할 수 있습니다. 계속할까요?`)) return;

  const sessions = Store.sessions();
  const members = Store.members();
  for (const m of ms) {
    await exportSchedule({
      member: m,
      anchor: state.anchor,
      mode: state.mode,
      sessions,
      members,
      filename: `${m.name}_${ymd(state.anchor)}_${state.mode}.jpg`,
    });
    await new Promise(r => setTimeout(r, 250));
  }
  flash('일괄 저장 완료');
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
}

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
  const m = Store.members().find(x => x.id === s.memberId);
  if (!m) return;

  const endTime = computeEndTime(s.startTime, s.durationMin);
  $('#ms-title').textContent = `${m.name}님 수업`;
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

  $('#ms-delete').onclick = async () => {
    if (!confirm('이 수업을 삭제할까요?')) return;
    try {
      await Store.removeSession(s.id);
      $('#modal-session').close();
      flash('수업이 삭제되었습니다.');
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  };
  $('#ms-edit-member').onclick = () => {
    $('#modal-session').close();
    openMemberModal(m.id);
  };

  $('#modal-session').showModal();
}

function openMemberModal(memberId) {
  const m = Store.members().find(x => x.id === memberId);
  if (!m) return;
  $('#mm-name').value = m.name;
  $('#mm-color').value = m.color;
  $('#mm-memo').value = m.memo || '';
  const cnt = Store.countByMember()[m.id] || 0;
  $('#mm-stats').textContent = `등록된 수업 ${cnt}건`;

  $('#mm-save').onclick = async () => {
    try {
      await Store.updateMember(m.id, {
        name: $('#mm-name').value,
        color: $('#mm-color').value,
        memo: $('#mm-memo').value,
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
  $('#account-email').textContent = session?.user?.email || '';
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

async function bootstrap() {
  if (!sbReady) {
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
