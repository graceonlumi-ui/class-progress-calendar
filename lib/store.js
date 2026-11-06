const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'appData.json');

const DEFAULT_DATA = {
  settings: {
    schoolName: '서운중학교',
    grade: 2,
    classNum: 2,
    comciCode: 40828,
    neisOffice: 'B10',
    neisCode: '7091432',
    adminPin: '1234',
    classGreeting: '2학년 2반 오늘도 활기차게 시작해요! ✨'
  },
  // 요일별 청소 기본 템플릿 (1:월 ~ 5:금)
  cleaningTemplates: {
    1: [ // 월
      { area: '교실 바닥 & 칠판', assigned: '1모둠 (김민준, 박서준)' },
      { area: '복도 & 신발장', assigned: '2모둠 (이도윤, 정예준)' },
      { area: '창틀 & 사물함', assigned: '3모둠 (최시우, 장하준)' },
      { area: '분리수거 & 쓰레기통', assigned: '4모둠 (강주원, 조지호)' }
    ],
    2: [ // 화
      { area: '교실 바닥 & 칠판', assigned: '2모둠 (이도윤, 정예준)' },
      { area: '복도 & 신발장', assigned: '3모둠 (최시우, 장하준)' },
      { area: '창틀 & 사물함', assigned: '4모둠 (강주원, 조지호)' },
      { area: '분리수거 & 쓰레기통', assigned: '5모둠 (윤건우, 임서진)' }
    ],
    3: [ // 수
      { area: '교실 바닥 & 칠판', assigned: '3모둠 (최시우, 장하준)' },
      { area: '복도 & 신발장', assigned: '4모둠 (강주원, 조지호)' },
      { area: '창틀 & 사물함', assigned: '5모둠 (윤건우, 임서진)' },
      { area: '분리수거 & 쓰레기통', assigned: '1모둠 (김민준, 박서준)' }
    ],
    4: [ // 목
      { area: '교실 바닥 & 칠판', assigned: '4모둠 (강주원, 조지호)' },
      { area: '복도 & 신발장', assigned: '5모둠 (윤건우, 임서진)' },
      { area: '창틀 & 사물함', assigned: '1모둠 (김민준, 박서준)' },
      { area: '분리수거 & 쓰레기통', assigned: '2모둠 (이도윤, 정예준)' }
    ],
    5: [ // 금
      { area: '교실 바닥 & 칠판', assigned: '5모둠 (윤건우, 임서진)' },
      { area: '복도 & 신발장', assigned: '1모둠 (김민준, 박서준)' },
      { area: '창틀 & 사물함', assigned: '2모둠 (이도윤, 정예준)' },
      { area: '분리수거 & 쓰레기통', assigned: '3모둠 (최시우, 장하준)' }
    ]
  },
  // 특정 날짜 직접 수정(오버라이드) 저장소: { "YYYY-MM-DD": [ { area, assigned } ] }
  cleaningOverrides: {},
  // 담임교사 전달사항
  notices: [
    {
      id: 'notice-sample-1',
      category: '중요',
      title: '내일(목) 4교시 전교생 소방대피 훈련 안내 🔥',
      content: '비상벨이 울리면 손수건이나 옷소매로 코와 입을 막고 운동장 지정 구역으로 신속히 이동합니다. 실내화 착용 금지, 운동화 착용!',
      pinned: true,
      createdAt: '2026-10-14 09:00',
      updatedAt: '2026-10-14 09:00'
    },
    {
      id: 'notice-sample-2',
      category: '과제',
      title: '정보과목 프로그래밍 수행평가 보고서 제출 💻',
      content: '이번 주 금요일 6교시까지 학급 구글 클래스룸에 과제 제출 완료하세요. 늦게 제출 시 감점 있습니다.',
      pinned: false,
      createdAt: '2026-10-14 09:30',
      updatedAt: '2026-10-14 09:30'
    },
    {
      id: 'notice-sample-3',
      category: '한마디',
      title: '오늘의 담임 한마디 🌱',
      content: '환절기 감기 조심하고, 복도에서는 우측보행하며 친구를 존중하는 2학년 2반이 됩시다!',
      pinned: false,
      createdAt: '2026-10-14 08:30',
      updatedAt: '2026-10-14 08:30'
    }
  ],
  // 디데이 목록
  ddays: [
    {
      id: 'dday-1',
      title: '2학기 2차 지필평가 ✏️',
      targetDate: '2026-12-08'
    },
    {
      id: 'dday-2',
      title: '겨울방학식 ⛄',
      targetDate: '2027-01-08'
    }
  ]
};

class Store {
  constructor() {
    this.ensureDataFile();
  }

  ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      this.saveData(DEFAULT_DATA);
    }
  }

  loadData() {
    try {
      this.ensureDataFile();
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      console.error('[Store] loadData error:', err.message);
      return DEFAULT_DATA;
    }
  }

  saveData(data) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('[Store] saveData error:', err.message);
      return false;
    }
  }

  getSettings() {
    const data = this.loadData();
    const settings = { ...data.settings };
    delete settings.adminPin; // 클라이언트에 보낼 땐 핀 숨김
    return settings;
  }

  verifyPin(pin) {
    const data = this.loadData();
    return String(data.settings?.adminPin || '1234') === String(pin);
  }

  updateSettings(newSettings) {
    const data = this.loadData();
    data.settings = { ...data.settings, ...newSettings };
    this.saveData(data);
    return data.settings;
  }

  // 오늘 청소 정보 조회 (오버라이드 우선, 없으면 요일별 기본값)
  getCleaningForDate(dateStr = null) {
    const data = this.loadData();
    const now = dateStr ? new Date(dateStr) : new Date();
    const ymd = now.toISOString().split('T')[0];
    const day = now.getDay(); // 0:일, 1:월, ..., 5:금, 6:토
    const weekday = (day >= 1 && day <= 5) ? day : 1;

    // 1. 직접 수정한 내역이 있는지 확인
    const isOverridden = Array.isArray(data.cleaningOverrides?.[ymd]) && data.cleaningOverrides[ymd].length > 0;
    const areas = isOverridden
      ? data.cleaningOverrides[ymd]
      : (data.cleaningTemplates?.[weekday] || []);

    return {
      date: ymd,
      weekday,
      weekdayName: ['일', '월', '화', '수', '목', '금', '토'][day],
      isOverridden,
      areas
    };
  }

  // 오늘 청소 직접 수정 저장 (오버라이드)
  setCleaningOverride(dateStr, areas) {
    const data = this.loadData();
    if (!data.cleaningOverrides) data.cleaningOverrides = {};
    data.cleaningOverrides[dateStr] = areas;
    this.saveData(data);
    return this.getCleaningForDate(dateStr);
  }

  // 오늘 청소 오버라이드 삭제 (요일 기본값으로 복귀)
  clearCleaningOverride(dateStr) {
    const data = this.loadData();
    if (data.cleaningOverrides && data.cleaningOverrides[dateStr]) {
      delete data.cleaningOverrides[dateStr];
      this.saveData(data);
    }
    return this.getCleaningForDate(dateStr);
  }

  // 요일별 청소 템플릿 전체 조회 및 업데이트
  getCleaningTemplates() {
    const data = this.loadData();
    return data.cleaningTemplates || {};
  }

  updateCleaningTemplates(templates) {
    const data = this.loadData();
    data.cleaningTemplates = templates;
    this.saveData(data);
    return data.cleaningTemplates;
  }

  // 전달사항 목록
  getNotices() {
    const data = this.loadData();
    // 상단고정(pinned) 우선, 최신순 정렬
    return (data.notices || []).sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  addNotice(notice) {
    const data = this.loadData();
    const id = 'notice-' + Date.now();
    const nowStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const newNotice = {
      id,
      category: notice.category || '알림',
      title: notice.title || '',
      content: notice.content || '',
      pinned: !!notice.pinned,
      createdAt: nowStr,
      updatedAt: nowStr
    };
    if (!data.notices) data.notices = [];
    data.notices.unshift(newNotice);
    this.saveData(data);
    return newNotice;
  }

  updateNotice(id, updateData) {
    const data = this.loadData();
    const idx = (data.notices || []).findIndex(n => n.id === id);
    if (idx === -1) return null;
    const nowStr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    data.notices[idx] = {
      ...data.notices[idx],
      ...updateData,
      updatedAt: nowStr
    };
    this.saveData(data);
    return data.notices[idx];
  }

  deleteNotice(id) {
    const data = this.loadData();
    const beforeLen = (data.notices || []).length;
    data.notices = (data.notices || []).filter(n => n.id !== id);
    this.saveData(data);
    return data.notices.length < beforeLen;
  }

  // D-Day
  getDdays() {
    const data = this.loadData();
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    return (data.ddays || []).map(d => {
      const target = new Date(d.targetDate);
      target.setHours(0, 0, 0, 0);
      const diffTime = target.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return {
        ...d,
        diffDays,
        ddayText: diffDays === 0 ? 'D-Day' : (diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`)
      };
    }).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));
  }

  updateDdays(ddays) {
    const data = this.loadData();
    data.ddays = ddays;
    this.saveData(data);
    return this.getDdays();
  }
}

module.exports = new Store();
