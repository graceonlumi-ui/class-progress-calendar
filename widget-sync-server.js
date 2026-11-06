const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 38472;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'timetable_progress.json');
const FB_CFG_FILE = path.join(DATA_DIR, 'firebase_config.json');
const HTML_FILE = path.join(__dirname, '수업진도현황_시간표달력.html');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readExistingData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

function extractSnapshotsFromBuffer(buf) {
  const results = [];
  const decodeModes = [
    buf.toString('utf16le'),
    buf.length > 1 ? buf.subarray(1).toString('utf16le') : '',
    buf.toString('utf8')
  ];
  for (const str of decodeModes) {
    let pos = 0;
    while (true) {
      const idx = str.indexOf('{"syllabus":', pos);
      if (idx === -1) break;
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = idx; i < str.length; i++) {
        const ch = str[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
      }
      if (end !== -1) {
        const sub = str.slice(idx, end + 1);
        try {
          const parsed = JSON.parse(sub);
          if (parsed && parsed.records) {
            results.push(parsed);
          }
        } catch (e) {}
        pos = end + 1;
      } else {
        pos = idx + 12;
      }
    }
  }
  return results;
}

function syncFromBrowserLocalStorage() {
  try {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return;
    const chromeUserData = path.join(localAppData, 'Google', 'Chrome', 'User Data');
    if (!fs.existsSync(chromeUserData)) return;

    const dirs = fs.readdirSync(chromeUserData, { withFileTypes: true })
      .filter(d => d.isDirectory() && (d.name === 'Default' || d.name.startsWith('Profile ')))
      .map(d => path.join(chromeUserData, d.name, 'Local Storage', 'leveldb'))
      .filter(p => fs.existsSync(p));

    let current = readExistingData() || {
      syllabus: { 1: [], 2: [] },
      records: {},
      classMemos: {},
      holidays: {},
      scheduleOverrides: {},
      addedLessons: [],
      updatedAt: 1
    };
    const beforeStr = JSON.stringify(current.records || {});
    const beforeSyl = JSON.stringify(current.syllabus || {});

    for (const ldbDir of dirs) {
      const files = fs.readdirSync(ldbDir)
        .filter(f => f.endsWith('.log') || f.endsWith('.ldb'))
        .map(f => ({ name: f, full: path.join(ldbDir, f), mtime: fs.statSync(path.join(ldbDir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);

      for (const fileInfo of files) {
        try {
          const buf = fs.readFileSync(fileInfo.full);
          if (!buf.includes(Buffer.from('hyejeong_timetable', 'utf8')) && !buf.includes(Buffer.from('2026-10-', 'utf16le'))) {
            continue;
          }
          const snaps = extractSnapshotsFromBuffer(buf);
          for (const snap of snaps) {
            current = mergeAppState(current, snap);
          }
        } catch (e) {}
      }
    }

    const afterStr = JSON.stringify(current.records || {});
    const afterSyl = JSON.stringify(current.syllabus || {});
    if (beforeStr !== afterStr || beforeSyl !== afterSyl) {
      current.updatedAt = Date.now();
      fs.writeFileSync(DATA_FILE, JSON.stringify(current, null, 2), 'utf8');
    }
  } catch (e) {}
}

function hasMeaningfulContent(rec) {
  if (!rec) return false;
  return Boolean(
    (rec.topic && String(rec.topic).trim()) ||
    (rec.content && String(rec.content).trim()) ||
    (rec.absent && String(rec.absent).trim()) ||
    (rec.note && String(rec.note).trim()) ||
    rec.done ||
    rec.skip
  );
}

function mergeAppState(existing, incoming) {
  if (!existing || existing.empty) return incoming;
  if (!incoming) return existing;

  const merged = {
    semesterConfig: incoming.semesterConfig || existing.semesterConfig,
    semesterArchives: Array.isArray(incoming.semesterArchives) && incoming.semesterArchives.length >= (existing.semesterArchives || []).length
      ? incoming.semesterArchives
      : (existing.semesterArchives || incoming.semesterArchives || []),
    collapsedWeeks: { ...(existing.collapsedWeeks || {}), ...(incoming.collapsedWeeks || {}) },
    keepCurrentWeekOnTop: incoming.keepCurrentWeekOnTop !== undefined ? incoming.keepCurrentWeekOnTop : (existing.keepCurrentWeekOnTop !== undefined ? existing.keepCurrentWeekOnTop : true),
    syllabus: incoming.syllabus || existing.syllabus || { 1: [], 2: [] },
    records: {},
    classMemos: { ...(existing.classMemos || {}), ...(incoming.classMemos || {}) },
    holidays: { ...(incoming.holidays || existing.holidays || {}) },
    scheduleOverrides: { ...(existing.scheduleOverrides || {}), ...(incoming.scheduleOverrides || {}) },
    addedLessons: Array.isArray(incoming.addedLessons) && incoming.addedLessons.length >= (existing.addedLessons || []).length
      ? incoming.addedLessons
      : (incoming.addedLessons || existing.addedLessons || []),
    seatingData: incoming.seatingData || existing.seatingData || { classes: {}, attendance: {}, assignments: {}, showPhotos: true, showGroupBadges: false },
    updatedAt: Date.now()
  };

  const exRecs = existing.records || {};
  const inRecs = incoming.records || {};
  const allKeys = new Set([...Object.keys(exRecs), ...Object.keys(inRecs)]);

  for (const k of allKeys) {
    const ex = exRecs[k];
    const inc = inRecs[k];
    if (ex && !inc) {
      merged.records[k] = ex;
    } else if (!ex && inc) {
      merged.records[k] = inc;
    } else {
      const exTime = ex._updatedAt || 0;
      const inTime = inc._updatedAt || 0;
      if (inTime > exTime) {
        merged.records[k] = inc;
      } else if (exTime > inTime) {
        merged.records[k] = ex;
      } else {
        // If timestamps are equal or missing, prefer the one with meaningful content
        if (hasMeaningfulContent(inc) && !hasMeaningfulContent(ex)) {
          merged.records[k] = inc;
        } else if (hasMeaningfulContent(ex) && !hasMeaningfulContent(inc)) {
          merged.records[k] = ex;
        } else {
          merged.records[k] = {
            ...ex,
            ...inc,
            topic: (inc.topic && String(inc.topic).trim()) ? inc.topic : (ex.topic || ''),
            content: (inc.content && String(inc.content).trim()) ? inc.content : (ex.content || ''),
            absent: (inc.absent && String(inc.absent).trim()) ? inc.absent : (ex.absent || ''),
            note: (inc.note && String(inc.note).trim()) ? inc.note : (ex.note || '')
          };
        }
      }
    }
  }

  return merged;
}

const server = http.createServer((req, res) => {
  // Enable full CORS + Chrome Private Network Access (PNA) for file:// origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url.startsWith('/api/state') && req.method === 'GET') {
    try {
      const data = readExistingData();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data || { empty: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url.startsWith('/api/state') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const existing = readExistingData();
        const merged = mergeAppState(existing, incoming);
        fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, updatedAt: merged.updatedAt, state: merged }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (req.url.startsWith('/api/firebase-config') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        fs.writeFileSync(FB_CFG_FILE, JSON.stringify({ endpoint: parsed.endpoint || '' }, null, 2), 'utf8');
        syncWithFirebaseCloud();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // Launch native frameless smartphone widget if requested from web calendar
  if (req.url === '/api/launch-widget' && (req.method === 'POST' || req.method === 'GET')) {
    const { spawn } = require('child_process');
    const psScript = path.join(__dirname, 'desktop-widget.ps1');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Sta', '-File', psScript], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Serve the main HTML calendar if visited via http://127.0.0.1:38472/
  if (req.url === '/' || req.url.startsWith('/index')) {
    if (fs.existsSync(HTML_FILE)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_FILE, 'utf8'));
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.exit(0);
  }
});

let lastPushedMtime = 0;

async function syncWithFirebaseCloud() {
  try {
    if (!fs.existsSync(FB_CFG_FILE)) return;
    const cfg = JSON.parse(fs.readFileSync(FB_CFG_FILE, 'utf8'));
    const ep = (cfg.endpoint || '').trim();
    if (!ep) return;

    const localData = readExistingData();
    let cloudData = null;

    if (ep.startsWith('http://') || ep.startsWith('https://')) {
      const cleanUrl = ep.replace(/\/+$/, '').replace(/\/timetable_progress\.json$/, '');
      const res = await fetch(`${cleanUrl}/timetable_progress.json`);
      if (res.ok) cloudData = await res.json();
    } else {
      const fsUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(ep)}/databases/(default)/documents/hyejeong_planner/main_state`;
      try {
        const fsRes = await fetch(fsUrl);
        if (fsRes.ok) {
          const doc = await fsRes.json();
          if (doc && doc.fields && doc.fields.payload && doc.fields.payload.stringValue) {
            cloudData = JSON.parse(doc.fields.payload.stringValue);
          }
        }
      } catch (e) {}
      if (!cloudData) {
        const rtUrl = `https://${ep}-default-rtdb.firebaseio.com/timetable_progress.json`;
        try {
          const rtRes = await fetch(rtUrl);
          if (rtRes.ok) cloudData = await rtRes.json();
        } catch (e) {}
      }
    }

    if (cloudData && cloudData.records) {
      const beforeStr = JSON.stringify((localData && localData.records) || {});
      const merged = mergeAppState(localData, cloudData);
      const afterStr = JSON.stringify(merged.records || {});
      if (beforeStr !== afterStr) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf8');
      }
    }

    // 로컬 파일이 변경되었으면 파이어베이스 클라우드로도 업로드
    if (fs.existsSync(DATA_FILE)) {
      const mtime = fs.statSync(DATA_FILE).mtimeMs;
      if (mtime > lastPushedMtime) {
        lastPushedMtime = mtime;
        const latestLocal = readExistingData();
        if (latestLocal) {
          if (ep.startsWith('http://') || ep.startsWith('https://')) {
            const cleanUrl = ep.replace(/\/+$/, '').replace(/\/timetable_progress\.json$/, '');
            await fetch(`${cleanUrl}/timetable_progress.json`, { method: 'PUT', body: JSON.stringify(latestLocal) });
          } else {
            const fsUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(ep)}/databases/(default)/documents/hyejeong_planner/main_state`;
            const fsBody = {
              fields: {
                payload: { stringValue: JSON.stringify(latestLocal) },
                updatedAt: { integerValue: String(latestLocal.updatedAt || Date.now()) }
              }
            };
            const fsRes = await fetch(fsUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fsBody)
            });
            if (!fsRes.ok) {
              const rtUrl = `https://${ep}-default-rtdb.firebaseio.com/timetable_progress.json`;
              await fetch(rtUrl, { method: 'PUT', body: JSON.stringify(latestLocal) });
            }
          }
        }
      }
    }
  } catch (e) {}
}

// 초기 시작 시 및 주기적으로 브라우저 LocalStorage(Chrome) 스냅샷 + Firebase 자동 병합
syncFromBrowserLocalStorage();
syncWithFirebaseCloud();
setInterval(syncFromBrowserLocalStorage, 2500);
setInterval(syncWithFirebaseCloud, 4000);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Widget sync server listening on http://127.0.0.1:${PORT}`);
});
