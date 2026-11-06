const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

const comcigan = require('./lib/comcigan');
const neis = require('./lib/neis');
const store = require('./lib/store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 웹소켓 연결 관리 및 브로드캐스트 함수
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  // console.log(`[WS] Client connected. Total: ${clients.size}`);

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // 클라이언트 간 릴레이가 필요한 경우
      if (data.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      // ignore
    }
  });
});

function broadcast(event, payload = {}) {
  const msg = JSON.stringify({ event, payload, timestamp: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ----------------- API 라우트 ----------------- //

// 1. 초기 전체 데이터 번들 조회 (전자칠판 로드 속도 최적화)
app.get('/api/all-data', async (req, res) => {
  try {
    const settings = store.getSettings();
    const notices = store.getNotices();
    const cleaning = store.getCleaningForDate();
    const ddays = store.getDdays();

    // 시간표 & 급식 병렬 조회
    const [timetable, meal] = await Promise.all([
      comcigan.getTimetable(settings.comciCode, settings.grade, settings.classNum),
      neis.getMeal(settings.neisOffice, settings.neisCode)
    ]);

    res.json({
      success: true,
      settings,
      timetable,
      meal,
      notices,
      cleaning,
      ddays,
      serverTime: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching all data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. 컴시간 시간표 단독 조회
app.get('/api/timetable', async (req, res) => {
  try {
    const settings = store.getSettings();
    const day = req.query.day ? parseInt(req.query.day) : null;
    const grade = req.query.grade ? parseInt(req.query.grade) : settings.grade;
    const cls = req.query.classNum ? parseInt(req.query.classNum) : settings.classNum;
    const code = req.query.code ? parseInt(req.query.code) : settings.comciCode;

    const data = await comcigan.getTimetable(code, grade, cls, day);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. 나이스 급식 단독 조회
app.get('/api/meal', async (req, res) => {
  try {
    const settings = store.getSettings();
    const date = req.query.date || null;
    const office = req.query.office || settings.neisOffice;
    const code = req.query.code || settings.neisCode;

    const data = await neis.getMeal(office, code, date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. 담임교사 전달사항 API
app.get('/api/notices', (req, res) => {
  res.json({ success: true, notices: store.getNotices() });
});

app.post('/api/notices', (req, res) => {
  const { title, content, category, pinned } = req.body;
  if (!title) return res.status(400).json({ success: false, message: '제목을 입력해주세요.' });

  const notice = store.addNotice({ title, content, category, pinned });
  broadcast('NOTICE_ADDED', { notice, notices: store.getNotices() });
  res.json({ success: true, notice });
});

app.put('/api/notices/:id', (req, res) => {
  const { id } = req.params;
  const updated = store.updateNotice(id, req.body);
  if (!updated) return res.status(404).json({ success: false, message: '해당 공지를 찾을 수 없습니다.' });

  broadcast('NOTICE_UPDATED', { notice: updated, notices: store.getNotices() });
  res.json({ success: true, notice: updated });
});

app.delete('/api/notices/:id', (req, res) => {
  const { id } = req.params;
  const ok = store.deleteNotice(id);
  if (!ok) return res.status(404).json({ success: false, message: '해당 공지를 찾을 수 없습니다.' });

  broadcast('NOTICE_DELETED', { id, notices: store.getNotices() });
  res.json({ success: true });
});

// 5. 청소 당번 API
// 오늘 청소 조회
app.get('/api/cleaning', (req, res) => {
  const data = store.getCleaningForDate(req.query.date);
  res.json({ success: true, ...data });
});

// 오늘 청소 직접 수정 (Override)
app.post('/api/cleaning/override', (req, res) => {
  const { date, areas } = req.body;
  const targetDate = date || new Date().toISOString().split('T')[0];
  if (!Array.isArray(areas)) return res.status(400).json({ success: false, message: '구역 목록이 올바르지 않습니다.' });

  const result = store.setCleaningOverride(targetDate, areas);
  broadcast('CLEANING_UPDATED', result);
  res.json({ success: true, ...result });
});

// 오늘 청소 직접 수정 취소하고 요일별 기본값으로 복귀
app.delete('/api/cleaning/override', (req, res) => {
  const targetDate = req.query.date || new Date().toISOString().split('T')[0];
  const result = store.clearCleaningOverride(targetDate);
  broadcast('CLEANING_UPDATED', result);
  res.json({ success: true, ...result });
});

// 요일별 청소 기본 템플릿 조회 및 수정
app.get('/api/cleaning/templates', (req, res) => {
  res.json({ success: true, templates: store.getCleaningTemplates() });
});

app.post('/api/cleaning/templates', (req, res) => {
  const { templates } = req.body;
  if (!templates) return res.status(400).json({ success: false });

  const updated = store.updateCleaningTemplates(templates);
  const currentCleaning = store.getCleaningForDate();
  broadcast('CLEANING_UPDATED', currentCleaning);
  res.json({ success: true, templates: updated });
});

// 6. D-Day API
app.get('/api/ddays', (req, res) => {
  res.json({ success: true, ddays: store.getDdays() });
});

app.post('/api/ddays', (req, res) => {
  const { ddays } = req.body;
  if (!Array.isArray(ddays)) return res.status(400).json({ success: false });

  const updated = store.updateDdays(ddays);
  broadcast('DDAY_UPDATED', { ddays: updated });
  res.json({ success: true, ddays: updated });
});

// 7. 교실 타이머 원격 제어 API (선생님이 폰으로 전자칠판 타이머 작동!)
app.post('/api/timer', (req, res) => {
  const { action, seconds, label } = req.body;
  // action: 'start', 'pause', 'reset', 'stop'
  broadcast('TIMER_CONTROL', { action, seconds, label });
  res.json({ success: true });
});

// 8. 긴급 알림 팝업 브로드캐스트 (예: "지금 즉시 자리에 앉으세요", "수행평가 5분 전")
app.post('/api/alert', (req, res) => {
  const { message, subMessage, type } = req.body;
  broadcast('URGENT_ALERT', { message, subMessage, type });
  res.json({ success: true });
});

// 9. 관리자 PIN 번호 검증 및 변경
app.post('/api/auth/pin', (req, res) => {
  const { pin } = req.body;
  const valid = store.verifyPin(pin);
  res.json({ success: valid });
});

// 10. 학교 검색 API (나이스 + 컴시간 통합 검색)
app.get('/api/search/schools', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ success: true, results: [] });

  try {
    const [comciList, neisList] = await Promise.all([
      comcigan.searchSchools(query),
      neis.searchSchool(query)
    ]);

    // 통합 결과 구성
    res.json({
      success: true,
      comcigan: comciList,
      neis: neisList
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. 학급 및 학교 설정 조회 & 변경
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: store.getSettings() });
});

app.post('/api/settings', async (req, res) => {
  const updated = store.updateSettings(req.body);
  broadcast('SETTINGS_UPDATED', { settings: store.getSettings() });
  res.json({ success: true, settings: store.getSettings() });
});

// 프론트엔드 라우트
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 기동
const os = require('os');
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const localIp = getLocalIp();
  console.log(`=======================================================`);
  console.log(` 🏫 [학급알리미] 서버가 성공적으로 시작되었습니다!`);
  console.log(` 🖥️  전자칠판 화면 : http://localhost:${PORT}`);
  console.log(` 📱  선생님 관리자 : http://${localIp}:${PORT}/admin`);
  console.log(` (스마트폰이나 교사 PC에서 위 관리자 주소로 접속하세요!)`);
  console.log(`=======================================================`);
});
