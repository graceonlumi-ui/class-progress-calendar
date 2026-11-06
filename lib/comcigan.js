const axios = require('axios');
const iconv = require('iconv-lite');

// 컴시간 정규 데이터 파서
function splitData(dat) {
  if (!dat) return [0, 0];
  const m = String(dat).match(/\d{1,3}(?=(\d{3})+(?!\d))|\d{1,3}$/g);
  return m ? m.reverse().map(Number) : [0, 0];
}

function baSplit(일일자료, 원자료, 변경알림) {
  let th = 0, sb = 0, 속성 = '내용';
  if (!일일자료) return [0, 0, '내용'];
  const isChangedNotify = 변경알림 == 1;
  const str = String(일일자료);
  if (isChangedNotify && str.startsWith('>')) {
    const ma = splitData(str.substring(1));
    th = ma[0] || 0;
    sb = (ma[1] || 0) + Number(ma[2] || 0) * 1000;
    속성 = '변경';
  } else {
    const ma = splitData(str);
    th = ma[0] || 0;
    sb = (ma[1] || 0) + Number(ma[2] || 0) * 1000;
    if (원자료 != 일일자료) 속성 = '변경';
  }
  return [th, sb, 속성];
}

class ComciganService {
  constructor() {
    this.baseUrl = 'http://comci.net:4082';
  }

  // 학교 검색
  async searchSchools(keyword) {
    if (!keyword || keyword.trim().length < 2) return [];
    try {
      const encoded = iconv.encode(keyword.trim(), 'euc-kr');
      let hex = '';
      for (const b of encoded) {
        hex += '%' + b.toString(16).toUpperCase();
      }
      const url = `${this.baseUrl}/36179?17384l${hex}`;
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
      const text = res.data.toString('utf-8');
      const jsonStr = text.substring(0, text.lastIndexOf('}') + 1);
      const data = JSON.parse(jsonStr);
      
      if (!data.학교검색 || !Array.isArray(data.학교검색)) return [];
      
      // data.학교검색 항목: [지역코드, 지역명, 학교명, 학교코드]
      return data.학교검색.map(item => ({
        region: item[1],
        name: item[2],
        code: item[3]
      }));
    } catch (err) {
      console.error('[Comcigan] searchSchools error:', err.message);
      return [];
    }
  }

  // 특정 학교의 학년/반/요일 시간표 조회
  // day: 1(월) ~ 5(금) (미지정 시 오늘 요일)
  async getTimetable(schoolCode, grade = 2, cls = 2, targetDay = null) {
    try {
      const b64 = Buffer.from(`73629_${schoolCode}_0_1`).toString('base64');
      const url = `${this.baseUrl}/36179?${b64}`;
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
      const text = res.data.toString('utf-8');
      const data = JSON.parse(text.substring(0, text.lastIndexOf('}') + 1));

      // 요일 계산 (0:일, 1:월, 2:화, 3:수, 4:목, 5:금, 6:토)
      let day = targetDay;
      if (!day) {
        const now = new Date();
        const d = now.getDay();
        day = (d >= 1 && d <= 5) ? d : 1; // 주말이면 월요일 기본
      }

      const 분리 = data.분리 || 100;
      const periods = [];
      const times = data.일과시간 || [];

      // 1교시부터 8교시까지 순회
      for (let p = 1; p <= 8; p++) {
        const orig = data.자료481?.[grade]?.[cls]?.[day]?.[p];
        const daily = data.자료147?.[grade]?.[cls]?.[day]?.[p];

        // 수업이 아예 없는 교시 확인
        if (!orig && !daily) continue;

        const [th, sbRaw, 속성] = baSplit(daily, orig, data.변경알림);
        const sb = sbRaw % 분리;
        const subject = data.자료492?.[sb] || '';
        const teacher = (data.자료446?.[th] || '').replace(/\*/g, '');

        // 원래 과목/교사 정보
        let origSubject = '';
        let origTeacher = '';
        if (orig) {
          const [oth, osbRaw] = baSplit(orig, orig, 0);
          origSubject = data.자료492?.[osbRaw % 분리] || '';
          origTeacher = (data.자료446?.[oth] || '').replace(/\*/g, '');
        }

        const isChanged = (속성 === '변경') || (subject !== origSubject) || (teacher !== origTeacher);

        periods.push({
          period: p,
          time: times[p - 1] || `${p}교시`,
          subject: subject || '수업 없음',
          teacher: teacher || '',
          changed: isChanged,
          originalSubject: origSubject,
          originalTeacher: origTeacher
        });
      }

      return {
        success: true,
        schoolName: data.학교명,
        grade,
        classNum: cls,
        day,
        dayName: ['일', '월', '화', '수', '목', '금', '토'][day],
        startDate: data.시작일,
        periods
      };
    } catch (err) {
      console.error('[Comcigan] getTimetable error:', err.message);
      return {
        success: false,
        error: err.message,
        periods: []
      };
    }
  }
}

module.exports = new ComciganService();
