/**
 * Display names (protocol section 14).
 *
 * The server hands out a random baptismal name and checks names people pick. This file is the
 * browser side: the same list for the offline simulation and the "random" button, a copy of the
 * basic rules for instant feedback, and the name remembered in this browser.
 * The server stays the judge: a modified client can skip everything here.
 *
 * Keep SAINT_NAMES in sync with backend/realtime-server/src/main/resources/saint-names.txt.
 */
export const SAINT_NAMES = [
  '베드로',
  '바오로',
  '요한',
  '야고보',
  '안드레아',
  '필립보',
  '바르톨로메오',
  '토마스',
  '마태오',
  '시몬',
  '마르코',
  '루카',
  '스테파노',
  '미카엘',
  '가브리엘',
  '라파엘',
  '요셉',
  '다니엘',
  '다윗',
  '엘리야',
  '요아킴',
  '프란치스코',
  '안토니오',
  '도미니코',
  '베네딕토',
  '아우구스티노',
  '이냐시오',
  '레오',
  '그레고리오',
  '암브로시오',
  '히에로니모',
  '니콜라오',
  '세바스티아노',
  '크리스토포로',
  '마르티노',
  '빈첸시오',
  '알베르토',
  '로베르토',
  '라우렌시오',
  '바실리오',
  '이시도로',
  '가롤로',
  '사베리오',
  '펠릭스',
  '루도비코',
  '율리아노',
  '시메온',
  '보니파시오',
  '파트리치오',
  '알로이시오',
  '마리아',
  '안나',
  '데레사',
  '체칠리아',
  '아녜스',
  '루치아',
  '카타리나',
  '모니카',
  '엘리사벳',
  '클라라',
  '막달레나',
  '베로니카',
  '수산나',
  '아가타',
  '로사',
  '율리아',
  '비비안나',
  '스콜라스티카',
  '헬레나',
  '마르타',
  '프란치스카',
  '젬마',
  '안젤라',
  '실비아',
  '크리스티나',
  '바르바라',
  '리디아',
  '레지나',
  '마르가리타',
  '비르지타',
  '에우제니아',
  '요안나',
  '이레네',
  '아폴로니아',
  '도로테아',
  '젤뚜르다',
  '세라피나',
  '힐데가르트'
];

export const NAME_MIN = 2;
export const NAME_MAX = 10;
const ALLOWED = /^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$/;
// same list as NameService.RESERVED on the server
const RESERVED = ['신부', '사제', '주교', '교황', '추기경', '수녀', '수사', '부제',
  '하느님', '하나님', '예수', '그리스도', '성령', '성부', '성자', '사탄', '루시퍼', '악마',
  '관리자', '운영', 'admin', '고해야지', '공지', '시스템'];

export const randomSaintName = () => SAINT_NAMES[Math.floor(Math.random() * SAINT_NAMES.length)];

export const normalizeName = (s) => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ');

/**
 * Basic rules only (the blocked word list lives on the server).
 * @returns {'OK'|'INVALID'|'RESERVED'}
 */
export function checkName(raw) {
  const name = normalizeName(raw);
  const len = [...name].length;
  if (len < NAME_MIN || len > NAME_MAX || !ALLOWED.test(name)) return 'INVALID';
  const flat = name.toLowerCase().replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]/g, '');
  if (RESERVED.some((w) => flat.includes(w))) return 'RESERVED';
  return 'OK';
}

/** Why a name was refused, for people. */
export const NAME_REASON = {
  INVALID: `${NAME_MIN}~${NAME_MAX}자의 한글, 영문, 숫자만 쓸 수 있습니다. 띄어쓰기는 한 칸까지 됩니다.`,
  RESERVED: '신부님이나 운영자로 오해할 수 있는 이름은 쓸 수 없습니다.',
  BLOCKED: '쓸 수 없는 말이 들어 있습니다.',
  TOO_SOON: '이름은 10초에 한 번만 바꿀 수 있습니다. 잠시 후 다시 눌러 주세요.',
  TIMEOUT: '서버가 답하지 않아 바꾸지 못했습니다. 다시 시도해 주세요.',
  OFFLINE: '서버와 연결되지 않아 바꾸지 못했습니다.',
};

const KEY = 'gohaeyaji-name';
export const storedName = {
  load() { try { return localStorage.getItem(KEY); } catch (_) { return null; } },
  save(name) { try { localStorage.setItem(KEY, name); } catch (_) { /* storage blocked */ } },
};
