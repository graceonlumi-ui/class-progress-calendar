// ==================== 학급알리미 전자칠판 대시보드 ==================== //

let state = {
  settings: {},
  timetable: null,
  meal: null,
  notices: [],
  cleaning: null,
  ddays: [],
  ws: null,
  timerInterval: null,
  timerSeconds: 300,
  timerRunning: false
};

// 1. 초기화
document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initActions();
  await fetchAllData();
  connectWebSocket();

  // 1분마다 현재 교시 체크 & 30분마다 시간표/급식 자동 새로고침
  setInterval(highlightCurrentPeriod, 60000);
  setInterval(refreshTimetableAndMeal, 30 * 60 * 1000);
});

// 2. 시계 & 날짜 실시간 갱신
function initClock() {
  const timeElem = document.getElementById('currentTime');
  const dateElem = document.getElementById('currentDate');

  function update() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    timeElem.textContent = `${hours}:${minutes}:${seconds}`;

    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const dayName = days[now.getDay()];
    dateElem.textContent = `${y}년 ${m}월 ${d}일 (${dayName}요일)`;
  }

  update();
  setInterval(update, 1000);
}

// 3. 버튼 이벤트 핸들러
function initActions() {
  // 전체화면 토글
  const btnFs = document.getElementById('btnFullscreen');
  btnFs.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => alert(`전체화면 오류: ${err.message}`));
    } else {
      document.exitFullscreen();
    }
  });

  // QR 코드 모달
  const btnQr = document.getElementById('btnQrCode');
  const qrModal = document.getElementById('qrModal');
  const btnCloseQr = document.getElementById('btnCloseQr');

  btnQr.addEventListener('click', () => {
    const qrDiv = document.getElementById('qrcode');
    qrDiv.innerHTML = '';
    const adminUrl = window.location.origin + '/admin';
    new QRCode(qrDiv, {
      text: adminUrl,
      width: 180,
      height: 180,
      colorDark: '#0f172a',
      colorLight: '#ffffff'
    });
    document.getElementById('qrUrlText').textContent = adminUrl;
    qrModal.classList.remove('hidden');
    lucide.createIcons();
  });

  btnCloseQr.addEventListener('click', () => qrModal.classList.add('hidden'));

  // 타이머 모달 닫기
  document.getElementById('btnCloseTimer').addEventListener('click', () => {
    document.getElementById('timerModal').classList.add('hidden');
    clearInterval(state.timerInterval);
    state.timerRunning = false;
  });

  document.getElementById('btnResetTimer').addEventListener('click', () => {
    document.getElementById('timerModal').classList.add('hidden');
    clearInterval(state.timerInterval);
    state.timerRunning = false;
  });

  document.getElementById('btnPauseResumeTimer').addEventListener('click', () => {
    if (state.timerRunning) {
      clearInterval(state.timerInterval);
      state.timerRunning = false;
      document.getElementById('btnPauseResumeTimer').textContent = '다시 시작';
    } else {
      startTimerCountdown(state.timerSeconds);
      document.getElementById('btnPauseResumeTimer').textContent = '일시정지';
    }
  });

  // 긴급 알림 닫기
  document.getElementById('btnCloseUrgentAlert').addEventListener('click', () => {
    document.getElementById('urgentAlertModal').classList.add('hidden');
  });

  // 새로고침 버튼들
  document.getElementById('btnRefreshTimetable').addEventListener('click', () => refreshTimetable());
  document.getElementById('btnRefreshMeal').addEventListener('click', () => refreshMeal());
}

// 4. 전체 데이터 로드 API
async function fetchAllData() {
  try {
    const res = await fetch('/api/all-data');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    state.settings = data.settings || {};
    state.timetable = data.timetable;
    state.meal = data.meal;
    state.notices = data.notices || [];
    state.cleaning = data.cleaning;
    state.ddays = data.ddays || [];

    renderHeader();
    renderTimetable();
    renderMeal();
    renderNotices();
    renderCleaning();
    renderDdays();
    lucide.createIcons();
  } catch (err) {
    console.error('fetchAllData error:', err);
  }
}

// 5. 헤더 렌더링
function renderHeader() {
  const { schoolName, grade, classNum, classGreeting } = state.settings;
  const titleElem = document.getElementById('classTitle');
  const greetingElem = document.getElementById('classGreeting');

  if (titleElem && schoolName) {
    titleElem.innerHTML = `${schoolName} <span class="text-sky-400">${grade}학년 ${classNum}반</span>`;
  }
  if (greetingElem && classGreeting) {
    greetingElem.textContent = classGreeting;
  }
}

// 6. D-Day 렌더링
function renderDdays() {
  const container = document.getElementById('ddayContainer');
  container.innerHTML = '';

  state.ddays.forEach(d => {
    const isUrgent = d.diffDays <= 7 && d.diffDays >= 0;
    const badge = document.createElement('div');
    badge.className = `flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
      isUrgent
        ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
        : 'bg-slate-800/80 text-slate-300 border-slate-700'
    }`;
    badge.innerHTML = `
      <span>${escapeHtml(d.title)}</span>
      <span class="px-1.5 py-0.5 rounded-md ${isUrgent ? 'bg-rose-600 text-white' : 'bg-slate-700 text-sky-400'} font-extrabold font-mono">${d.ddayText}</span>
    `;
    container.appendChild(badge);
  });
}

// 7. 오늘의 시간표 (컴시간 실시간) 렌더링
function renderTimetable() {
  const grid = document.getElementById('timetableGrid');
  const dayBadge = document.getElementById('timetableDayBadge');
  grid.innerHTML = '';

  if (!state.timetable || !state.timetable.periods || state.timetable.periods.length === 0) {
    grid.innerHTML = `
      <div class="col-span-7 flex flex-col items-center justify-center text-slate-400 py-8">
        <i data-lucide="calendar-x" class="w-10 h-10 text-slate-500 mb-2"></i>
        <p class="font-semibold">오늘 등록된 시간표 정보가 없습니다.</p>
        <span class="text-xs text-slate-500 mt-1">주말, 공휴일 또는 컴시간 등록 대기 중</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  if (state.timetable.dayName) {
    dayBadge.textContent = `${state.timetable.dayName}요일`;
  }

  const periods = state.timetable.periods.slice(0, 7); // 7교시까지
  const colCount = Math.max(periods.length, 6);
  grid.className = `grid grid-cols-${colCount} gap-2 xl:gap-3 flex-1 items-stretch py-1`;

  periods.forEach(p => {
    const card = document.createElement('div');
    const isChanged = p.changed;

    card.id = `period-card-${p.period}`;
    card.className = `rounded-xl p-2.5 xl:p-3.5 flex flex-col justify-between border transition-all duration-300 relative overflow-hidden ${
      isChanged
        ? 'bg-amber-950/40 border-amber-500/80 shadow-lg shadow-amber-500/10'
        : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
    }`;

    // 시간 텍스트 정제 (예: "1(08:50)" -> "08:50")
    const cleanTime = p.time.includes('(') ? p.time.split('(')[1].replace(')', '') : p.time;

    card.innerHTML = `
      <!-- 교시 헤더 -->
      <div class="flex items-center justify-between">
        <span class="text-xs font-extrabold px-2 py-0.5 rounded-md ${
          isChanged ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
        }">
          ${p.period}교시
        </span>
        <span class="text-[11px] font-mono text-slate-400 font-medium">
          ${cleanTime}
        </span>
      </div>

      <!-- 과목 및 교사 -->
      <div class="my-auto py-2 text-center">
        ${isChanged ? `
          <div class="mb-1">
            <span class="changed-badge-anim inline-block bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-amber-500/40">
              시간표 변경
            </span>
          </div>
        ` : ''}

        <div class="text-lg xl:text-xl font-black ${isChanged ? 'text-amber-300' : 'text-white'} tracking-tight">
          ${escapeHtml(p.subject)}
        </div>

        <div class="text-xs font-semibold text-slate-400 mt-1">
          ${p.teacher ? escapeHtml(p.teacher) + ' 선생님' : '<span class="text-slate-600">-</span>'}
        </div>

        <!-- 변경 전 정보 (취소선 표시) -->
        ${isChanged && p.originalSubject ? `
          <div class="text-[10px] text-slate-500 line-through mt-1">
            원래: ${escapeHtml(p.originalSubject)} (${escapeHtml(p.originalTeacher || '')})
          </div>
        ` : ''}
      </div>

      <!-- 현재 진행 표시기 (동적 추가됨) -->
      <div class="period-status text-[11px] text-center font-bold text-sky-400 min-h-[16px]"></div>
    `;

    grid.appendChild(card);
  });

  highlightCurrentPeriod();
  lucide.createIcons();
}

// 현재 진행 중인 교시 하이라이트
function highlightCurrentPeriod() {
  if (!state.timetable || !state.timetable.periods) return;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // 일반적인 중학교 표준 일과 시간표 매핑 (시작~종료 분)
  const periodTimes = [
    { period: 1, start: 8 * 60 + 50, end: 9 * 60 + 35 },
    { period: 2, start: 9 * 60 + 45, end: 10 * 60 + 30 },
    { period: 3, start: 10 * 60 + 40, end: 11 * 60 + 25 },
    { period: 4, start: 11 * 60 + 35, end: 12 * 60 + 20 },
    { period: 5, start: 13 * 60 + 20, end: 14 * 60 + 5 },
    { period: 6, start: 14 * 60 + 15, end: 15 * 60 + 0 },
    { period: 7, start: 15 * 60 + 10, end: 15 * 60 + 55 }
  ];

  let currentPeriod = null;
  for (const pt of periodTimes) {
    if (currentMinutes >= pt.start && currentMinutes <= pt.end) {
      currentPeriod = pt.period;
      break;
    }
  }

  // 카드들 클래스 업데이트
  const indicator = document.getElementById('currentPeriodIndicator');
  for (let p = 1; p <= 7; p++) {
    const card = document.getElementById(`period-card-${p}`);
    if (!card) continue;
    const statusDiv = card.querySelector('.period-status');

    if (p === currentPeriod) {
      card.classList.add('current-period-highlight');
      if (statusDiv) statusDiv.innerHTML = '<span class="text-sky-400 font-extrabold animate-pulse">● 수업 중</span>';
      if (indicator) indicator.textContent = `현재 ${p}교시 수업 진행 중`;
    } else {
      card.classList.remove('current-period-highlight');
      if (statusDiv) statusDiv.textContent = '';
    }
  }

  if (!currentPeriod && indicator) {
    indicator.textContent = '현재 쉬는 시간 또는 일과 종료';
  }
}

// 8. 오늘의 급식 (나이스 연동) 렌더링
function renderMeal() {
  const container = document.getElementById('mealContainer');
  const calBadge = document.getElementById('mealCaloriesBadge');
  const typeBadge = document.getElementById('mealTypeBadge');
  container.innerHTML = '';

  if (!state.meal || !state.meal.hasMeal) {
    calBadge.textContent = '0 Kcal';
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center text-slate-400 py-6 text-center">
        <div class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mb-2">
          <i data-lucide="soup" class="w-6 h-6"></i>
        </div>
        <p class="font-semibold text-slate-300">오늘의 급식 정보가 없습니다.</p>
        <span class="text-xs text-slate-500 mt-1">주말, 공휴일, 방학 또는 급식 미실시일</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  typeBadge.textContent = state.meal.mealType || '중식';
  calBadge.textContent = state.meal.calories || '영양 만점';

  const menuList = state.meal.menuItems || [];
  const menuGrid = document.createElement('div');
  menuGrid.className = 'grid grid-cols-2 gap-2 xl:gap-2.5 py-1';

  menuList.forEach(m => {
    const item = document.createElement('div');
    item.className = 'bg-slate-900/60 rounded-xl p-2.5 border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition';
    item.innerHTML = `
      <div class="flex items-center space-x-2 truncate">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        <span class="text-sm xl:text-base font-bold text-slate-100 truncate">${escapeHtml(m.name)}</span>
      </div>
      ${m.allergyNums && m.allergyNums.length > 0 ? `
        <span class="text-[10px] font-mono text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/60" title="${m.allergyNames.join(', ')}">
          ${m.allergyNums.join('.')}
        </span>
      ` : ''}
    `;
    menuGrid.appendChild(item);
  });

  container.appendChild(menuGrid);
  lucide.createIcons();
}

// 9. 담임교사 전달사항 렌더링
function renderNotices() {
  const container = document.getElementById('noticeContainer');
  const countBadge = document.getElementById('noticeCountBadge');
  container.innerHTML = '';

  const notices = state.notices || [];
  countBadge.textContent = `${notices.length}건`;

  if (notices.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 flex flex-col items-center justify-center text-slate-500 py-8 text-center">
        <i data-lucide="check-check" class="w-8 h-8 mb-2 text-slate-600"></i>
        <p class="font-medium text-sm">새로운 전달사항이 없습니다.</p>
        <span class="text-xs text-slate-600 mt-0.5">선생님이 등록하면 실시간으로 표시됩니다.</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // 카테고리별 색상 매핑
  const categoryStyles = {
    '중요': 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    '과제': 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    '준비물': 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    '일정': 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    '한마디': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    '알림': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
  };

  notices.forEach(n => {
    const card = document.createElement('div');
    const catClass = categoryStyles[n.category] || categoryStyles['알림'];
    const isPinned = !!n.pinned;

    card.className = `rounded-xl p-3 xl:p-3.5 flex flex-col justify-between border transition animate-slide-in relative ${
      isPinned
        ? 'bg-gradient-to-br from-indigo-950/60 to-slate-900 border-indigo-500/50 shadow-md shadow-indigo-500/10'
        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
    }`;

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center space-x-1.5">
            <span class="text-[11px] font-bold px-2 py-0.5 rounded border ${catClass}">
              ${escapeHtml(n.category)}
            </span>
            ${isPinned ? `
              <span class="text-[10px] font-extrabold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30 flex items-center space-x-1">
                <i data-lucide="pin" class="w-3 h-3"></i>
                <span>고정</span>
              </span>
            ` : ''}
          </div>
          <span class="text-[10px] font-mono text-slate-500">${escapeHtml(n.createdAt?.slice(5) || '')}</span>
        </div>

        <h3 class="text-sm xl:text-base font-bold text-white mb-1 line-clamp-2">
          ${escapeHtml(n.title)}
        </h3>

        <p class="text-xs text-slate-300 leading-relaxed line-clamp-3">
          ${escapeHtml(n.content)}
        </p>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

// 10. 오늘의 청소 당번 렌더링
function renderCleaning() {
  const container = document.getElementById('cleaningContainer');
  const modeBadge = document.getElementById('cleaningModeBadge');
  const dayBadge = document.getElementById('cleaningDayBadge');
  container.innerHTML = '';

  if (!state.cleaning || !state.cleaning.areas || state.cleaning.areas.length === 0) {
    container.innerHTML = `
      <div class="col-span-2 text-center text-slate-500 py-6">
        <p class="text-sm">등록된 청소 구역 정보가 없습니다.</p>
      </div>
    `;
    return;
  }

  const { isOverridden, weekdayName, areas } = state.cleaning;

  if (isOverridden) {
    modeBadge.textContent = '✨ 오늘 특별 지정';
    modeBadge.className = 'text-xs px-2 py-0.5 rounded-md font-semibold bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse';
  } else {
    modeBadge.textContent = '요일 기본 순환';
    modeBadge.className = 'text-xs px-2 py-0.5 rounded-md font-semibold bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  }

  dayBadge.textContent = `${weekdayName}요일 당번`;

  areas.forEach(item => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900/60 rounded-xl p-2.5 xl:p-3 border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition';
    card.innerHTML = `
      <div class="flex items-center space-x-2 truncate">
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span class="text-xs xl:text-sm font-semibold text-slate-300 truncate">${escapeHtml(item.area)}</span>
      </div>
      <span class="text-xs xl:text-sm font-bold text-white bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700 truncate max-w-[50%]">
        ${escapeHtml(item.assigned)}
      </span>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

// 11. 교실 타이머 기능
function startTimerCountdown(durationSeconds, label = '교실 집중 활동 타이머') {
  clearInterval(state.timerInterval);
  state.timerSeconds = durationSeconds;
  state.timerRunning = true;

  const modal = document.getElementById('timerModal');
  const display = document.getElementById('timerDisplay');
  const labelElem = document.getElementById('timerLabel');

  labelElem.textContent = label;
  modal.classList.remove('hidden');

  function update() {
    const mins = Math.floor(state.timerSeconds / 60);
    const secs = state.timerSeconds % 60;
    display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      state.timerRunning = false;
      display.textContent = '종료! 🔔';
      playBeep();
    } else {
      state.timerSeconds--;
    }
  }

  update();
  state.timerInterval = setInterval(update, 1000);
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {
    // audio policy ignore
  }
}

// 12. WebSocket 실시간 연동
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    // console.log('[WS] Connected to server.');
  };

  state.ws.onmessage = (event) => {
    try {
      const { event: evt, payload } = JSON.parse(event.data);

      if (evt === 'NOTICE_ADDED' || evt === 'NOTICE_UPDATED' || evt === 'NOTICE_DELETED') {
        state.notices = payload.notices || [];
        renderNotices();
      } else if (evt === 'CLEANING_UPDATED') {
        state.cleaning = payload;
        renderCleaning();
      } else if (evt === 'DDAY_UPDATED') {
        state.ddays = payload.ddays || [];
        renderDdays();
      } else if (evt === 'SETTINGS_UPDATED') {
        state.settings = payload.settings || {};
        renderHeader();
        refreshTimetableAndMeal();
      } else if (evt === 'TIMER_CONTROL') {
        const { action, seconds, label } = payload;
        if (action === 'start') {
          startTimerCountdown(seconds || 300, label);
        } else if (action === 'pause') {
          clearInterval(state.timerInterval);
          state.timerRunning = false;
        } else if (action === 'reset' || action === 'stop') {
          clearInterval(state.timerInterval);
          state.timerRunning = false;
          document.getElementById('timerModal').classList.add('hidden');
        }
      } else if (evt === 'URGENT_ALERT') {
        const { message, subMessage } = payload;
        document.getElementById('urgentAlertTitle').textContent = message || '담임선생님 긴급 알림';
        document.getElementById('urgentAlertSub').textContent = subMessage || '모두 자리에 착석해 주세요.';
        document.getElementById('urgentAlertModal').classList.remove('hidden');
        playBeep();
      }
    } catch (err) {
      console.error('[WS] parse error:', err);
    }
  };

  state.ws.onclose = () => {
    // 3초 후 재연결 시도
    setTimeout(connectWebSocket, 3000);
  };
}

// 새로고침 함수들
async function refreshTimetable() {
  const btn = document.getElementById('btnRefreshTimetable');
  btn.classList.add('animate-spin');
  try {
    const res = await fetch('/api/timetable');
    state.timetable = await res.json();
    renderTimetable();
  } catch (e) {
    console.error(e);
  } finally {
    setTimeout(() => btn.classList.remove('animate-spin'), 600);
  }
}

async function refreshMeal() {
  const btn = document.getElementById('btnRefreshMeal');
  btn.classList.add('animate-spin');
  try {
    const res = await fetch('/api/meal');
    state.meal = await res.json();
    renderMeal();
  } catch (e) {
    console.error(e);
  } finally {
    setTimeout(() => btn.classList.remove('animate-spin'), 600);
  }
}

async function refreshTimetableAndMeal() {
  await Promise.all([refreshTimetable(), refreshMeal()]);
}

// XSS 방지 헬퍼
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
