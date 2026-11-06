// ==================== 학급알리미 선생님 원격 관리자 스크립트 ==================== //

let adminState = {
  settings: {},
  notices: [],
  cleaning: null,
  cleaningTemplates: {},
  ddays: [],
  currentTemplateDay: 1
};

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initTabs();
  initNoticeEvents();
  initCleaningEvents();
  initRemoteEvents();
  initSettingsEvents();
  lucide.createIcons();
});

// 1. PIN 인증 관리
function initAuth() {
  const pinScreen = document.getElementById('pinScreen');
  const adminContent = document.getElementById('adminContent');
  const pinForm = document.getElementById('pinForm');
  const pinInput = document.getElementById('pinInput');
  const pinError = document.getElementById('pinError');
  const btnLogout = document.getElementById('btnLogout');

  // 세션 스토리지 확인
  if (sessionStorage.getItem('classBoardAuthed') === 'true') {
    pinScreen.classList.add('hidden');
    adminContent.classList.remove('hidden');
    loadAdminData();
  }

  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    pinError.classList.add('hidden');
    const pin = pinInput.value.trim();

    try {
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem('classBoardAuthed', 'true');
        pinScreen.classList.add('hidden');
        adminContent.classList.remove('hidden');
        loadAdminData();
      } else {
        pinError.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
      }
    } catch (err) {
      alert('서버 통신 오류: ' + err.message);
    }
  });

  btnLogout.addEventListener('click', () => {
    if (confirm('관리자 모드를 로그아웃 하시겠습니까?')) {
      sessionStorage.removeItem('classBoardAuthed');
      location.reload();
    }
  });
}

// 2. 탭 전환
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;

      tabBtns.forEach(b => {
        b.classList.remove('bg-indigo-600', 'text-white', 'shadow');
        b.classList.add('text-slate-400');
      });
      btn.classList.add('bg-indigo-600', 'text-white', 'shadow');
      btn.classList.remove('text-slate-400');

      tabPanes.forEach(pane => {
        if (pane.id === targetId) {
          pane.classList.remove('hidden');
        } else {
          pane.classList.add('hidden');
        }
      });

      lucide.createIcons();
    });
  });
}

// 3. 관리자 데이터 로드
async function loadAdminData() {
  try {
    const res = await fetch('/api/all-data');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    adminState.settings = data.settings || {};
    adminState.notices = data.notices || [];
    adminState.cleaning = data.cleaning;
    adminState.ddays = data.ddays || [];

    // 청소 템플릿도 로드
    const tRes = await fetch('/api/cleaning/templates');
    const tData = await tRes.json();
    adminState.cleaningTemplates = tData.templates || {};

    updateHeader();
    renderAdminNotices();
    renderTodayCleaningInputs();
    renderTemplateCleaningInputs();
    renderSettingsForm();
    renderAdminDdays();
    lucide.createIcons();
  } catch (err) {
    console.error('loadAdminData error:', err);
  }
}

function updateHeader() {
  const { grade, classNum } = adminState.settings;
  const title = document.getElementById('adminHeaderTitle');
  if (title && grade && classNum) {
    title.textContent = `${grade}학년 ${classNum}반 관리`;
  }
}

// 4. 전달사항 이벤트
function initNoticeEvents() {
  // 카테고리 칩 선택
  const chips = document.querySelectorAll('.cat-chip');
  const catInput = document.getElementById('noticeCategory');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => {
        c.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-slate-800 text-slate-400 border-slate-700';
      });

      const cat = chip.dataset.cat;
      catInput.value = cat;

      if (cat === '중요') {
        chip.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-rose-500/20 text-rose-300 border-rose-500/40';
      } else if (cat === '과제') {
        chip.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-sky-500/20 text-sky-300 border-sky-500/40';
      } else if (cat === '준비물') {
        chip.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-amber-500/20 text-amber-300 border-amber-500/40';
      } else if (cat === '한마디') {
        chip.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      } else {
        chip.className = 'cat-chip px-3 py-1.5 rounded-xl text-xs font-bold border transition bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
      }
    });
  });

  // 새 공지 등록 폼
  const noticeForm = document.getElementById('noticeForm');
  noticeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('noticeTitle').value.trim();
    const content = document.getElementById('noticeContent').value.trim();
    const category = catInput.value;
    const pinned = document.getElementById('noticePinned').checked;

    if (!title) return alert('제목을 입력해주세요.');

    try {
      const res = await fetch('/api/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category, pinned })
      });
      const data = await res.json();
      if (data.success) {
        showToast('전달사항이 전자칠판에 등록되었습니다! 📢');
        document.getElementById('noticeTitle').value = '';
        document.getElementById('noticeContent').value = '';
        document.getElementById('noticePinned').checked = false;
        adminState.notices.unshift(data.notice);
        renderAdminNotices();
      }
    } catch (err) {
      alert('등록 실패: ' + err.message);
    }
  });
}

function renderAdminNotices() {
  const list = document.getElementById('adminNoticeList');
  const countElem = document.getElementById('adminNoticeCount');
  list.innerHTML = '';
  countElem.textContent = `총 ${adminState.notices.length}건`;

  if (adminState.notices.length === 0) {
    list.innerHTML = '<p class="text-xs text-slate-500 py-4 text-center">등록된 전달사항이 없습니다.</p>';
    return;
  }

  adminState.notices.forEach(n => {
    const item = document.createElement('div');
    item.className = 'bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 flex items-start justify-between space-x-3';
    item.innerHTML = `
      <div class="flex-1 min-w-0">
        <div class="flex items-center space-x-1.5 mb-1">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(n.category)}</span>
          ${n.pinned ? '<span class="text-[10px] text-amber-400 font-bold">📌 고정</span>' : ''}
          <span class="text-[10px] text-slate-500 font-mono">${escapeHtml(n.createdAt)}</span>
        </div>
        <h4 class="text-sm font-bold text-white truncate">${escapeHtml(n.title)}</h4>
        <p class="text-xs text-slate-400 line-clamp-2 mt-0.5">${escapeHtml(n.content)}</p>
      </div>

      <div class="flex items-center space-x-1 flex-shrink-0">
        <button class="btn-toggle-pin p-1.5 text-slate-400 hover:text-amber-400 transition" data-id="${n.id}" data-pinned="${n.pinned}" title="${n.pinned ? '고정 해제' : '상단 고정'}">
          <i data-lucide="pin" class="w-4 h-4 ${n.pinned ? 'text-amber-400 fill-amber-400' : ''}"></i>
        </button>
        <button class="btn-delete-notice p-1.5 text-slate-400 hover:text-rose-400 transition" data-id="${n.id}" title="삭제">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;
    list.appendChild(item);
  });

  // 버튼 이벤트 바인딩
  list.querySelectorAll('.btn-toggle-pin').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const pinned = btn.dataset.pinned === 'true';
      await updateNoticePinned(id, !pinned);
    });
  });

  list.querySelectorAll('.btn-delete-notice').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (confirm('이 전달사항을 삭제하시겠습니까?')) {
        await deleteNotice(id);
      }
    });
  });

  lucide.createIcons();
}

async function updateNoticePinned(id, pinned) {
  try {
    const res = await fetch(`/api/notices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned })
    });
    const data = await res.json();
    if (data.success) {
      showToast(pinned ? '상단에 고정되었습니다 📌' : '고정 해제되었습니다');
      const idx = adminState.notices.findIndex(n => n.id === id);
      if (idx !== -1) adminState.notices[idx] = data.notice;
      renderAdminNotices();
    }
  } catch (err) {
    alert('수정 실패: ' + err.message);
  }
}

async function deleteNotice(id) {
  try {
    const res = await fetch(`/api/notices/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('삭제되었습니다.');
      adminState.notices = adminState.notices.filter(n => n.id !== id);
      renderAdminNotices();
    }
  } catch (err) {
    alert('삭제 실패: ' + err.message);
  }
}

// 5. 청소 당번 관리 이벤트
function initCleaningEvents() {
  // 오늘 당번 직접 수정 폼 제출
  const todayForm = document.getElementById('todayCleaningForm');
  todayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = document.querySelectorAll('.today-cleaning-row');
    const areas = [];
    rows.forEach(r => {
      const area = r.querySelector('.input-area').value.trim();
      const assigned = r.querySelector('.input-assigned').value.trim();
      if (area) areas.push({ area, assigned });
    });

    try {
      const res = await fetch('/api/cleaning/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas })
      });
      const data = await res.json();
      if (data.success) {
        showToast('오늘 청소 당번이 즉시 적용되었습니다! ✨');
        adminState.cleaning = data;
      }
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  });

  // 오늘 당번 기본값 복귀 버튼
  document.getElementById('btnResetCleaningOverride').addEventListener('click', async () => {
    if (confirm('오늘 직접 수정한 당번을 취소하고 요일별 기본 규칙으로 되돌리시겠습니까?')) {
      try {
        const res = await fetch('/api/cleaning/override', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          showToast('요일별 기본값으로 복귀했습니다.');
          adminState.cleaning = data;
          renderTodayCleaningInputs();
        }
      } catch (err) {
        alert('초기화 실패: ' + err.message);
      }
    }
  });

  // 요일별 템플릿 탭
  const dayTabs = document.querySelectorAll('#cleaningDayTabs button');
  dayTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      dayTabs.forEach(b => {
        b.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white';
      });
      btn.className = 'flex-1 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white';
      adminState.currentTemplateDay = parseInt(btn.dataset.day);
      renderTemplateCleaningInputs();
    });
  });

  // 요일 템플릿 폼 제출
  const templateForm = document.getElementById('templateCleaningForm');
  templateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const day = adminState.currentTemplateDay;
    const rows = document.querySelectorAll('.template-cleaning-row');
    const areas = [];
    rows.forEach(r => {
      const area = r.querySelector('.tpl-input-area').value.trim();
      const assigned = r.querySelector('.tpl-input-assigned').value.trim();
      if (area) areas.push({ area, assigned });
    });

    adminState.cleaningTemplates[day] = areas;

    try {
      const res = await fetch('/api/cleaning/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: adminState.cleaningTemplates })
      });
      const data = await res.json();
      if (data.success) {
        showToast('요일별 기본 청소 템플릿이 저장되었습니다! 💾');
      }
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  });
}

function renderTodayCleaningInputs() {
  const container = document.getElementById('todayCleaningInputs');
  container.innerHTML = '';

  const areas = adminState.cleaning?.areas || [
    { area: '교실 바닥 & 칠판', assigned: '1모둠' },
    { area: '복도 & 신발장', assigned: '2모둠' },
    { area: '창틀 & 사물함', assigned: '3모둠' },
    { area: '분리수거 & 쓰레기통', assigned: '4모둠' }
  ];

  areas.forEach(item => {
    const row = document.createElement('div');
    row.className = 'today-cleaning-row grid grid-cols-5 gap-2 items-center';
    row.innerHTML = `
      <input type="text" class="input-area col-span-2 text-xs py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 font-semibold" value="${escapeHtml(item.area)}">
      <input type="text" class="input-assigned col-span-3 text-xs py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold" value="${escapeHtml(item.assigned)}" placeholder="담당 모둠 또는 학생 이름">
    `;
    container.appendChild(row);
  });
}

function renderTemplateCleaningInputs() {
  const container = document.getElementById('templateCleaningInputs');
  container.innerHTML = '';
  const day = adminState.currentTemplateDay;

  const areas = adminState.cleaningTemplates[day] || [
    { area: '교실 바닥 & 칠판', assigned: `${day}모둠` },
    { area: '복도 & 신발장', assigned: `${(day % 5) + 1}모둠` },
    { area: '창틀 & 사물함', assigned: `${((day + 1) % 5) + 1}모둠` },
    { area: '분리수거 & 쓰레기통', assigned: `${((day + 2) % 5) + 1}모둠` }
  ];

  areas.forEach(item => {
    const row = document.createElement('div');
    row.className = 'template-cleaning-row grid grid-cols-5 gap-2 items-center';
    row.innerHTML = `
      <input type="text" class="tpl-input-area col-span-2 text-xs py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 font-semibold" value="${escapeHtml(item.area)}">
      <input type="text" class="tpl-input-assigned col-span-3 text-xs py-2 px-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-bold" value="${escapeHtml(item.assigned)}" placeholder="담당 모둠">
    `;
    container.appendChild(row);
  });
}

// 6. 원격 제어 이벤트 (타이머 & 긴급 알림)
function initRemoteEvents() {
  // 타이머 프리셋 버튼
  document.querySelectorAll('.btn-timer-preset').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action || 'start';
      const seconds = parseInt(btn.dataset.sec) || 300;
      const label = btn.dataset.label || '교실 활동 타이머';

      try {
        await fetch('/api/timer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, seconds, label })
        });
        showToast(action === 'stop' ? '전자칠판 타이머가 종료되었습니다.' : `전자칠판에 [${label}]가 시작되었습니다! ⏱️`);
      } catch (err) {
        alert('원격 제어 오류: ' + err.message);
      }
    });
  });

  // 긴급 알림 폼 제출
  const alertForm = document.getElementById('urgentAlertForm');
  alertForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('alertTitle').value.trim();
    const subMessage = document.getElementById('alertSub').value.trim();

    try {
      await fetch('/api/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, subMessage })
      });
      showToast('전자칠판에 긴급 알림을 띄웠습니다! 🚨');
    } catch (err) {
      alert('알림 전송 오류: ' + err.message);
    }
  });
}

// 7. 학급 설정 & 학교 검색 이벤트
function initSettingsEvents() {
  // 학교 검색 버튼
  const btnSearch = document.getElementById('btnSearchSchool');
  const searchInput = document.getElementById('schoolSearchInput');
  const resultsDiv = document.getElementById('schoolSearchResults');

  btnSearch.addEventListener('click', async () => {
    const q = searchInput.value.trim();
    if (!q) return alert('검색할 학교 이름을 입력해 주세요.');

    btnSearch.textContent = '검색 중...';
    try {
      const res = await fetch(`/api/search/schools?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      resultsDiv.innerHTML = '';

      if (!data.comcigan || data.comcigan.length === 0) {
        resultsDiv.innerHTML = '<p class="text-xs text-slate-500 p-2">컴시간 일과진행에 등록된 학교를 찾을 수 없습니다.</p>';
      } else {
        data.comcigan.forEach(c => {
          // 일치하는 나이스 학교 매칭
          const matchedNeis = (data.neis || []).find(n => n.schoolName.includes(c.name) || c.name.includes(n.schoolName));
          const div = document.createElement('div');
          div.className = 'p-2 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer border border-slate-700 text-xs flex justify-between items-center transition';
          div.innerHTML = `
            <div>
              <span class="font-bold text-white">[${escapeHtml(c.region)}] ${escapeHtml(c.name)}</span>
              <span class="text-slate-400 block text-[10px]">컴시간: ${c.code} | 나이스: ${matchedNeis ? matchedNeis.schoolCode : '수동선택'}</span>
            </div>
            <span class="px-2 py-1 bg-indigo-600 text-white rounded font-bold text-[10px]">선택</span>
          `;

          div.addEventListener('click', () => {
            document.getElementById('settingSchoolName').value = c.name;
            document.getElementById('settingComciCode').value = c.code;
            if (matchedNeis) {
              document.getElementById('settingNeisOffice').value = matchedNeis.officeCode;
              document.getElementById('settingNeisCode').value = matchedNeis.schoolCode;
            }
            resultsDiv.classList.add('hidden');
            showToast(`[${c.name}] 정보가 적용되었습니다. '설정 저장'을 눌러주세요.`);
          });

          resultsDiv.appendChild(div);
        });
      }
      resultsDiv.classList.remove('hidden');
    } catch (err) {
      alert('검색 오류: ' + err.message);
    } finally {
      btnSearch.textContent = '검색';
    }
  });

  // 설정 저장 폼
  const settingsForm = document.getElementById('settingsForm');
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      schoolName: document.getElementById('settingSchoolName').value.trim(),
      grade: parseInt(document.getElementById('settingGrade').value),
      classNum: parseInt(document.getElementById('settingClassNum').value),
      comciCode: parseInt(document.getElementById('settingComciCode').value),
      neisOffice: document.getElementById('settingNeisOffice').value.trim(),
      neisCode: document.getElementById('settingNeisCode').value.trim(),
      classGreeting: document.getElementById('settingGreeting').value.trim()
    };

    const newPin = document.getElementById('settingAdminPin').value.trim();
    if (newPin) payload.adminPin = newPin;

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('학급 설정이 저장되었습니다! 전자칠판이 즉시 갱신됩니다.');
        adminState.settings = data.settings;
        updateHeader();
      }
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  });

  // D-Day 추가 폼
  const ddayForm = document.getElementById('ddayForm');
  ddayForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('newDdayTitle').value.trim();
    const targetDate = document.getElementById('newDdayDate').value;
    if (!title || !targetDate) return;

    const newDday = { id: 'dday-' + Date.now(), title, targetDate };
    const updatedList = [...adminState.ddays, newDday];

    try {
      const res = await fetch('/api/ddays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ddays: updatedList })
      });
      const data = await res.json();
      if (data.success) {
        showToast('새 D-Day가 등록되었습니다! 🎯');
        adminState.ddays = data.ddays;
        document.getElementById('newDdayTitle').value = '';
        document.getElementById('newDdayDate').value = '';
        renderAdminDdays();
      }
    } catch (err) {
      alert('D-Day 저장 실패: ' + err.message);
    }
  });
}

function renderSettingsForm() {
  const { schoolName, grade, classNum, comciCode, neisOffice, neisCode, classGreeting } = adminState.settings;
  if (schoolName) document.getElementById('settingSchoolName').value = schoolName;
  if (grade) document.getElementById('settingGrade').value = grade;
  if (classNum) document.getElementById('settingClassNum').value = classNum;
  if (comciCode) document.getElementById('settingComciCode').value = comciCode;
  if (neisOffice) document.getElementById('settingNeisOffice').value = neisOffice;
  if (neisCode) document.getElementById('settingNeisCode').value = neisCode;
  if (classGreeting) document.getElementById('settingGreeting').value = classGreeting;
}

function renderAdminDdays() {
  const list = document.getElementById('adminDdayList');
  list.innerHTML = '';

  adminState.ddays.forEach(d => {
    const item = document.createElement('div');
    item.className = 'flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs';
    item.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="font-bold text-white">${escapeHtml(d.title)}</span>
        <span class="text-slate-400 font-mono">(${d.targetDate})</span>
        <span class="px-2 py-0.5 rounded font-bold font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">${d.ddayText}</span>
      </div>
      <button class="btn-delete-dday text-slate-500 hover:text-rose-400 p-1" data-id="${d.id}" title="삭제">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll('.btn-delete-dday').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const updatedList = adminState.ddays.filter(d => d.id !== id);
      try {
        const res = await fetch('/api/ddays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ddays: updatedList })
        });
        const data = await res.json();
        if (data.success) {
          showToast('D-Day가 삭제되었습니다.');
          adminState.ddays = data.ddays;
          renderAdminDdays();
        }
      } catch (err) {
        alert('삭제 실패: ' + err.message);
      }
    });
  });

  lucide.createIcons();
}

// 토스트 메시지 헬퍼
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    toast.classList.add('opacity-0', 'pointer-events-none');
  }, 2500);
}

// XSS 방지
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
