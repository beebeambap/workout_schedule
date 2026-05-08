import { Store } from './store.js';
import { parseCSV, parseXLSX, parseFreeText } from './parser.js';
import { renderWeek, renderMonth, computeEndTime, HOUR_HEIGHT } from './calendar.js';
import { exportSchedule, exportScheduleBlob } from './exporter.js';
import { buildICS } from './ics.js';
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

// Curated 10-color palette: WCAG AA (≥4.5:1) with white text, perceptually
// balanced lightness, avoids reds (danger/Sunday) and primary blue (Saturday/CTA).
const COLOR_PALETTE = [
  { hex: '#e11d48', name: '산호' },
  { hex: '#ea580c', name: '귤' },
  { hex: '#a16207', name: '머스터드' },
  { hex: '#15803d', name: '숲' },
  { hex: '#0d9488', name: '민트' },
  { hex: '#0284c7', name: '하늘' },
  { hex: '#4f46e5', name: '청보라' },
  { hex: '#7c3aed', name: '라벤더' },
  { hex: '#c026d3', name: '자두' },
  { hex: '#475569', name: '그라파이트' },
];
const COLOR_DEFAULT = '#0284c7';
const COLOR_MIGRATION_KEY = 'lf_color_migration_v1';

const VIEW_STATE_KEY = 'lf_view_state';
const state = {
  view: 'calendar',
  mode: 'week',
  anchor: new Date(),
  filter: '',
  pending: null
};

function saveViewState() {
  try {
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
      view: state.view,
      mode: state.mode,
    }));
  } catch (e) {}
}
function loadViewState() {
  try {
    const s = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || '{}');
    if (s.view && ['calendar', 'import', 'members'].includes(s.view)) state.view = s.view;
    if (s.mode && ['week', 'month'].includes(s.mode)) state.mode = s.mode;
  } catch (e) {}
}
loadViewState();

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
  saveViewState();
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

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error(`${label} 응답 없음 (${ms / 1000}s 타임아웃). 네트워크 또는 Supabase 상태를 확인해주세요.`)),
      ms
    )),
  ]);
}

async function commitSessions(arr) {
  const valid = arr.filter(s => s.name && s.date && s.startTime);
  console.log('[commit] start —', valid.length, '건');
  if (!valid.length) throw new Error('유효한 행이 없습니다 (회원·날짜·시간 모두 필요).');
  const enriched = [];
  for (let i = 0; i < valid.length; i++) {
    const s = valid[i];
    console.log(`[commit] (${i + 1}/${valid.length}) ensureMember`, s.name);
    const m = await withTimeout(Store.ensureMember(s.name), 15_000, `회원 등록 (${s.name})`);
    enriched.push({
      memberId: m.id,
      date: s.date,
      startTime: s.startTime,
      durationMin: parseInt(s.durationMin, 10) || 50,
    });
  }
  console.log('[commit] addSessions', enriched.length);
  await withTimeout(Store.addSessions(enriched), 15_000, '세션 등록');
  console.log('[commit] done');
}

// ---------- members ----------
function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function nearestPaletteColor(hex) {
  const target = hexToRgb(hex);
  if (!target) return COLOR_DEFAULT;
  let best = COLOR_PALETTE[0].hex;
  let bestDist = Infinity;
  for (const c of COLOR_PALETTE) {
    const rgb = hexToRgb(c.hex);
    const d = (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (d < bestDist) { bestDist = d; best = c.hex; }
  }
  return best;
}
async function migrateMemberColors() {
  if (localStorage.getItem(COLOR_MIGRATION_KEY)) return;
  const paletteSet = new Set(COLOR_PALETTE.map(c => c.hex.toLowerCase()));
  const members = Store.members();
  const toMigrate = members.filter(m => m.color && !paletteSet.has(m.color.toLowerCase()));
  if (!toMigrate.length) {
    localStorage.setItem(COLOR_MIGRATION_KEY, '1');
    return;
  }
  console.log('[color-migration] migrating', toMigrate.length, '명');
  const results = await Promise.all(toMigrate.map(m => {
    const newColor = nearestPaletteColor(m.color);
    return Store.updateMember(m.id, {
      name: m.name,
      color: newColor,
      memo: m.memo || '',
      status: m.status || 'active',
    }).then(() => true).catch(err => {
      console.warn('[color-migration] failed for', m.name, err);
      return false;
    });
  }));
  if (results.every(Boolean)) {
    localStorage.setItem(COLOR_MIGRATION_KEY, '1');
  }
}

function initColorPicker(inputEl, paletteEl) {
  const customBtn = inputEl.closest('.color-custom-btn');
  function sync() {
    const v = (inputEl.value || '').toLowerCase();
    let inPalette = false;
    paletteEl.querySelectorAll('.color-swatch').forEach(b => {
      const match = b.dataset.color.toLowerCase() === v;
      b.classList.toggle('selected', match);
      if (match) inPalette = true;
    });
    if (customBtn) {
      customBtn.classList.toggle('custom-active', !inPalette && !!v);
      customBtn.style.background = (!inPalette && v) ? v : '';
    }
  }
  paletteEl.innerHTML = COLOR_PALETTE.map(c =>
    `<button type="button" class="color-swatch" data-color="${c.hex}" style="background:${c.hex}" title="${c.name}" aria-label="${c.name}"></button>`
  ).join('');
  paletteEl.querySelectorAll('.color-swatch').forEach(b => {
    b.addEventListener('click', () => {
      inputEl.value = b.dataset.color;
      sync();
    });
  });
  if (inputEl._cpSync) inputEl.removeEventListener('input', inputEl._cpSync);
  inputEl._cpSync = sync;
  inputEl.addEventListener('input', sync);
  sync();
}

initColorPicker($('#form-member-color'), $('#form-color-palette'));

$('#form-member').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = String(fd.get('name')).trim();
  if (!name) return;
  try {
    await Store.ensureMember(name, fd.get('color'), String(fd.get('memo') || '').trim());
    e.target.reset();
    $('#form-member-color').value = COLOR_DEFAULT;
    initColorPicker($('#form-member-color'), $('#form-color-palette'));
  } catch (err) {
    alert('저장 오류: ' + err.message);
  }
});

const memberFilters = { search: '', status: '' };
$('#member-search')?.addEventListener('input', (e) => {
  memberFilters.search = e.target.value.trim().toLowerCase();
  renderMembers();
});
$('#member-status-filter')?.addEventListener('change', (e) => {
  memberFilters.status = e.target.value;
  renderMembers();
});

function renderMembers() {
  const ul = $('#member-list');
  let ms = Store.members();
  const total = ms.length;
  if (memberFilters.search) {
    ms = ms.filter(m => m.name.toLowerCase().includes(memberFilters.search));
  }
  if (memberFilters.status) {
    ms = ms.filter(m => (m.status || 'active') === memberFilters.status);
  }
  const counts = Store.countByMember();
  if (!total) {
    ul.innerHTML = '<li class="ml-empty">등록된 회원이 없습니다. 가져오기에서 일정을 등록하면 자동으로 생성됩니다.</li>';
    return;
  }
  if (!ms.length) {
    ul.innerHTML = '<li class="ml-empty">검색 결과가 없습니다.</li>';
    return;
  }
  ul.innerHTML = ms.map(m => {
    const memoPreview = (m.memo || '').replace(/\s+/g, ' ').trim();
    const status = m.status && m.status !== 'active'
      ? `<span class="mr-status mr-status-${esc(m.status)}">${statusLabel(m.status)}</span>`
      : '';
    const memo = memoPreview
      ? `<span class="mr-memo">${esc(memoPreview)}</span>`
      : `<span class="mr-memo mr-memo-empty">메모 없음</span>`;
    return `<li class="member-row" data-id="${m.id}" style="--accent:${m.color}">
      <span class="mr-color" style="background:${m.color}"></span>
      <span class="mr-name">${esc(m.name)}</span>
      ${status}
      <span class="mr-count">${counts[m.id] || 0}건</span>
      ${memo}
      <button class="mr-edit" data-id="${m.id}" title="정보 편집" aria-label="정보 편집">✎</button>
    </li>`;
  }).join('');
  ul.querySelectorAll('.mr-edit').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openMemberModal(b.dataset.id);
    });
  });
  ul.querySelectorAll('li.member-row').forEach(li => {
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
  renderCalendar({ scrollToNow: true });
});

$('#view-mode').addEventListener('change', (e) => {
  state.mode = e.target.value;
  saveViewState();
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
let _calendarFirstRender = true;
function renderCalendar({ scrollToNow = false } = {}) {
  const cont = $('#calendar');
  const prevScroll = cont.scrollTop;
  let sessions = Store.sessions();
  if (state.filter) sessions = sessions.filter(s => s.memberId === state.filter);
  const members = Store.members();
  const fit = !!state.filter;
  const label = state.mode === 'week'
    ? renderWeek(cont, state.anchor, sessions, members, fit)
    : renderMonth(cont, state.anchor, sessions, members);
  $('#period-label').textContent = label;

  // Scroll: preserve user position; on first render or explicit request, jump to current hour.
  if (state.mode === 'week') {
    if (_calendarFirstRender || scrollToNow || prevScroll === 0) {
      const headerH = cont.querySelector('.wg-header')?.offsetHeight || 0;
      const desiredHour = Math.max(0, new Date().getHours() - 2);
      cont.scrollTop = desiredHour * HOUR_HEIGHT;
      _calendarFirstRender = false;
    } else {
      cont.scrollTop = prevScroll;
    }
  }

  // If holidays for this year aren't loaded yet, load and re-render once.
  const y = state.anchor.getFullYear();
  if (_renderingForYear !== y) {
    _renderingForYear = y;
    ensureYearLoaded(y).then(() => {
      if (state.view === 'calendar' && state.anchor.getFullYear() === y) {
        const cont2 = $('#calendar');
        const before = cont2.scrollTop;
        if (state.mode === 'week') renderWeek(cont2, state.anchor, sessions, members, fit);
        else renderMonth(cont2, state.anchor, sessions, members);
        cont2.scrollTop = before;
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

// ---------- click on calendar: existing event → detail; empty slot → quick-add ----------
$('#calendar').addEventListener('click', (ev) => {
  const evTarget = ev.target.closest('[data-session-id]');
  if (evTarget && evTarget.dataset.sessionId) {
    openSessionModal(evTarget.dataset.sessionId);
    return;
  }
  // Week view: click on .wg-day-col → infer time from Y position
  const dayCol = ev.target.closest('.wg-day-col');
  if (dayCol && dayCol.dataset.date) {
    const rect = dayCol.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const totalMin = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / HOUR_HEIGHT * 60 / 30) * 30));
    const h = Math.floor(totalMin / 60);
    const mi = totalMin % 60;
    const time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
    openQuickAdd({ date: dayCol.dataset.date, time });
    return;
  }
  // Month view: click on .day cell
  const day = ev.target.closest('.month-grid .day');
  if (day && day.dataset.date) {
    openQuickAdd({ date: day.dataset.date });
  }
});

// ---------- quick-add modal ----------
function openQuickAdd({ date, time } = {}) {
  const sel = $('#qa-member-select');
  sel.innerHTML = '<option value="">회원 선택...</option>'
    + Store.members().map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('')
    + '<option value="__new__">+ 신규 회원 직접 입력</option>';
  $('#qa-new-name-row').hidden = true;
  $('#qa-name').value = '';
  $('#qa-date').value = date || ymd(state.anchor || new Date());
  $('#qa-start').value = time || '';
  $('#qa-duration').value = 50;
  $('#modal-quick-add').showModal();
  setTimeout(() => sel.focus(), 50);
}

$('#qa-member-select').addEventListener('change', () => {
  const isNew = $('#qa-member-select').value === '__new__';
  $('#qa-new-name-row').hidden = !isNew;
  if (isNew) setTimeout(() => $('#qa-name').focus(), 50);
});

$('#btn-quick-add').addEventListener('click', () => openQuickAdd());

let qaSaveBusy = false;
$('#qa-save').addEventListener('click', async () => {
  if (qaSaveBusy) return;
  const selVal = $('#qa-member-select').value;
  const name = selVal === '__new__'
    ? $('#qa-name').value.trim()
    : selVal;
  const date = $('#qa-date').value;
  const start = $('#qa-start').value;
  const duration = parseInt($('#qa-duration').value, 10) || 50;
  if (!name || !date || !start) {
    alert('회원, 날짜, 시작 시간을 모두 입력하세요.');
    return;
  }
  qaSaveBusy = true;
  const btn = $('#qa-save');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    const m = await withTimeout(Store.ensureMember(name), 15_000, '회원 등록');
    await withTimeout(
      Store.addSessions([{ memberId: m.id, date, startTime: start, durationMin: duration }]),
      15_000,
      '세션 등록'
    );
    $('#modal-quick-add').close();
    flash('등록되었습니다.');
  } catch (err) {
    console.error('[quick-add] error:', err);
    alert('저장 오류: ' + (err?.message || err));
  } finally {
    qaSaveBusy = false;
    btn.disabled = false;
    btn.textContent = orig;
  }
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
  initColorPicker($('#mm-color'), $('#mm-color-palette'));
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

// ---------- ICS export (for Google/Apple Calendar import) ----------
$('#btn-export-ics').addEventListener('click', () => {
  const all = Store.sessions();
  const sessions = state.filter ? all.filter(s => s.memberId === state.filter) : all;
  if (!sessions.length) { alert('내보낼 일정이 없습니다.'); return; }
  const member = state.filter ? Store.members().find(m => m.id === state.filter) : null;
  const calName = member ? `레슨핏 - ${member.name}` : '레슨핏';
  const ics = buildICS(sessions, Store.members(), { calendarName: calName });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${member ? member.name : 'lessonfit'}_${ymd(new Date())}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  alert(
    'ICS 파일이 다운로드되었어요.\n\n' +
    '구글 캘린더 가져오기 방법:\n' +
    '1) 구글 캘린더 열기\n' +
    '2) 좌측 "다른 캘린더" 옆 + 버튼 → "가져오기"\n' +
    '3) 받은 .ics 파일 선택 → 가져올 캘린더 고르기 → 가져오기\n\n' +
    '※ 같은 일정을 여러 번 가져오면 중복될 수 있습니다.'
  );
});

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
  await migrateMemberColors();
  refreshFilter();
  $('#view-mode').value = state.mode;
  switchView(state.view);

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
