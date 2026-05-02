import { Store } from './store.js';
import { parseCSV, parseXLSX, parseFreeText } from './parser.js';
import { ocrImage } from './ocr.js';
import { renderWeek, renderMonth } from './calendar.js';
import { exportSchedule } from './exporter.js';

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

$('#file-image').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const prog = $('#ocr-progress');
  const out = $('#ocr-text');
  prog.textContent = 'OCR 준비중... (최초 실행은 한국어 데이터 다운로드로 시간이 걸릴 수 있습니다)';
  try {
    const text = await ocrImage(f, (m) => {
      if (m.status === 'recognizing text') {
        prog.textContent = `인식중 ${(m.progress * 100).toFixed(0)}%`;
      } else if (m.status) {
        prog.textContent = m.status;
      }
    });
    out.textContent = text;
    const parsed = parseFreeText(text);
    prog.textContent = `완료. ${parsed.sessions.length}건 추출. 미리보기에서 보정 후 확정하세요.`;
    showPreview(parsed);
  } catch (err) {
    prog.textContent = 'OCR 오류: ' + err.message;
  }
  e.target.value = '';
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
      if (k === 'durationMin') v = parseInt(v, 10) || 60;
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

$('#btn-confirm').addEventListener('click', () => {
  if (!state.pending || !state.pending.length) {
    alert('확정할 항목이 없습니다.');
    return;
  }
  commitSessions(state.pending);
  state.pending = null;
  $('#preview').classList.add('hidden');
  flash('확정되었습니다.');
  switchView('calendar');
});

$('#btn-cancel').addEventListener('click', () => {
  state.pending = null;
  $('#preview').classList.add('hidden');
});

function commitSessions(arr) {
  const enriched = arr.filter(s => s.name && s.date && s.startTime).map(s => {
    const m = Store.ensureMember(s.name);
    return {
      memberId: m.id,
      date: s.date,
      startTime: s.startTime,
      durationMin: parseInt(s.durationMin, 10) || 60
    };
  });
  Store.addSessions(enriched);
  refreshFilter();
  if (state.view === 'calendar') renderCalendar();
}

// ---------- members ----------
$('#form-member').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = String(fd.get('name')).trim();
  if (!name) return;
  Store.ensureMember(name, fd.get('color'));
  e.target.reset();
  renderMembers();
  refreshFilter();
});

function renderMembers() {
  const ul = $('#member-list');
  const ms = Store.members();
  const counts = Store.countByMember();
  if (!ms.length) {
    ul.innerHTML = '<li>등록된 회원이 없습니다. 가져오기에서 일정을 등록하면 자동으로 생성됩니다.</li>';
    return;
  }
  ul.innerHTML = ms.map(m =>
    `<li>
      <span class="swatch" style="background:${m.color}"></span>
      <span>${esc(m.name)}</span>
      <span class="count">수업 ${counts[m.id] || 0}건</span>
      <button data-id="${m.id}">삭제</button>
    </li>`
  ).join('');
  ul.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      if (confirm('회원과 모든 수업을 삭제할까요?')) {
        Store.removeMember(b.dataset.id);
        renderMembers();
        refreshFilter();
        if (state.view === 'calendar') renderCalendar();
      }
    });
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

// ---------- init ----------
function pinToday() {
  // Lock typing form date to current real date on load
  const dateInput = $('#form-typing input[name="date"]');
  if (dateInput && !dateInput.value) dateInput.value = ymd(new Date());
  // Anchor calendar to today (real-time)
  state.anchor = new Date();
}

pinToday();
refreshFilter();
renderCalendar();
renderMembers();

// Refresh week view every minute so the red "now" line tracks current time.
setInterval(() => {
  if (state.view === 'calendar' && state.mode === 'week') renderCalendar();
}, 60_000);
