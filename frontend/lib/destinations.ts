// 한국어 초성 리스트 (유니코드 순서)
const CHOSUNG_LIST = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 문자열에서 각 글자의 초성만 추출 (예: "제주도" → "ㅈㅈㄷ")
function extractChosung(str: string): string {
  return str
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        return CHOSUNG_LIST[Math.floor((code - 0xac00) / 588)];
      }
      return char;
    })
    .join('');
}

// 쿼리가 자음(초성)으로만 구성되어 있는지 확인
function isChosungOnly(str: string): boolean {
  return str.split('').every((c) => CHOSUNG_LIST.includes(c));
}

// 한국 주요 여행지 목록 (가나다 순)
export const DESTINATIONS: string[] = [
  '가평',
  '강릉',
  '강화도',
  '거제도',
  '경주',
  '고성',
  '공주',
  '광주',
  '군산',
  '남해',
  '남양주',
  '단양',
  '대구',
  '대전',
  '동해',
  '보령',
  '보성',
  '부산',
  '부여',
  '서울',
  '속초',
  '순천',
  '안동',
  '양양',
  '여수',
  '영월',
  '영주',
  '인제',
  '인천',
  '전주',
  '정선',
  '제주도',
  '진주',
  '창원',
  '천안',
  '청주',
  '춘천',
  '충주',
  '태안',
  '통영',
  '포항',
  '평창',
  '평택',
  '하동',
  '홍성',
  '홍천',
  '화천',
];

// 인기 여행지 상위 8개
export const POPULAR_DESTINATIONS: string[] = [
  '제주도',
  '부산',
  '경주',
  '강릉',
  '여수',
  '전주',
  '속초',
  '서울',
];

// 초성 검색 포함 여행지 검색 (최대 8개 반환)
// - 초성만 입력 시 (예: "ㅈㅈ"): 초성 추출 후 포함 여부 비교
// - 일반 입력 시 (예: "부산"): 포함 여부 비교
export function searchDestinations(query: string): string[] {
  const q = query.trim();
  if (!q) return [];

  return DESTINATIONS.filter((d) => {
    if (isChosungOnly(q)) {
      return extractChosung(d).includes(q);
    }
    return d.includes(q);
  }).slice(0, 8);
}
