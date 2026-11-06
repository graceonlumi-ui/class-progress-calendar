const axios = require('axios');

const ALLERGY_MAP = {
  1: '난류', 2: '우유', 3: '메밀', 4: '땅콩', 5: '대두',
  6: '밀', 7: '고등어', 8: '게', 9: '새우', 10: '돼지고기',
  11: '복숭아', 12: '토마토', 13: '아황산류', 14: '호두', 15: '닭고기',
  16: '쇠고기', 17: '오징어', 18: '조개류', 19: '잣'
};

class NeisService {
  constructor() {
    this.baseUrl = 'https://open.neis.go.kr/hub';
    this.apiKey = process.env.NEIS_KEY || ''; // 무료 샘플키 사용 가능
  }

  // 나이스 학교 검색
  async searchSchool(schoolName) {
    if (!schoolName || schoolName.trim().length < 2) return [];
    try {
      const params = {
        Type: 'json',
        pIndex: 1,
        pSize: 10,
        SCHUL_NM: schoolName.trim()
      };
      if (this.apiKey) params.KEY = this.apiKey;

      const res = await axios.get(`${this.baseUrl}/schoolInfo`, { params, timeout: 5000 });
      const rows = res.data?.schoolInfo?.[1]?.row || [];

      return rows.map(r => ({
        schoolName: r.SCHUL_NM,
        officeCode: r.ATPT_OFCDC_SC_CODE,
        officeName: r.ATPT_OFCDC_SC_NM,
        schoolCode: r.SD_SCHUL_CODE,
        schoolType: r.SCHUL_KND_SC_NM,
        address: r.ORG_RDNMA
      }));
    } catch (err) {
      console.error('[NEIS] searchSchool error:', err.message);
      return [];
    }
  }

  // 날짜별 급식 조회 (dateStr: YYYYMMDD 또는 YYYY-MM-DD)
  async getMeal(officeCode, schoolCode, dateStr = null) {
    try {
      let ymd = dateStr;
      if (!ymd) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        ymd = `${y}${m}${d}`;
      } else {
        ymd = ymd.replace(/[^0-9]/g, '');
      }

      const params = {
        Type: 'json',
        pIndex: 1,
        pSize: 5,
        ATPT_OFCDC_SC_CODE: officeCode,
        SD_SCHUL_CODE: schoolCode,
        MLSV_YMD: ymd
      };
      if (this.apiKey) params.KEY = this.apiKey;

      const res = await axios.get(`${this.baseUrl}/mealServiceDietInfo`, { params, timeout: 5000 });
      const rows = res.data?.mealServiceDietInfo?.[1]?.row || [];

      if (rows.length === 0) {
        return {
          success: true,
          date: ymd,
          hasMeal: false,
          message: '오늘의 급식 정보가 없습니다. (주말, 공휴일 또는 미등록)'
        };
      }

      // 기본적으로 중식(MMEAL_SC_CODE: 2) 우선, 없으면 첫번째
      const lunch = rows.find(r => r.MMEAL_SC_CODE === '2') || rows[0];

      // 메뉴 파싱 및 알레르기 번호 분리
      // 예: "보쌈*쌈장 (5.6.10)<br/>꽃맛살샐러드 (1.2.5.6.8.13.18)"
      const menuRawList = lunch.DDISH_NM.split('<br/>');
      const menuItems = menuRawList.map(item => {
        const clean = item.trim();
        const match = clean.match(/^(.*?)(?:\s*\(([\d\.]+)\))?$/);
        const name = match ? match[1].replace(/[*\.]/g, '').trim() : clean;
        const allergyNums = match && match[2] ? match[2].split('.').map(Number) : [];
        const allergyNames = allergyNums.map(n => ALLERGY_MAP[n]).filter(Boolean);
        return {
          name,
          allergyNums,
          allergyNames
        };
      });

      // 칼로리 정제
      const calories = lunch.CAL_INFO || '';

      // 영양 정보
      const nutrition = (lunch.NTR_INFO || '').split('<br/>').map(s => s.trim()).filter(Boolean);

      return {
        success: true,
        date: ymd,
        hasMeal: true,
        mealType: lunch.MMEAL_SC_NM || '중식',
        calories,
        menuItems,
        nutrition
      };
    } catch (err) {
      console.error('[NEIS] getMeal error:', err.message);
      return {
        success: false,
        error: err.message,
        hasMeal: false,
        message: '급식 정보를 불러오는 중 오류가 발생했습니다.'
      };
    }
  }
}

module.exports = new NeisService();
