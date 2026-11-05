/**
 * Example confessions under the booth's input: people who do not know what to write tap one and
 * it is sent as their confession. Every line here is checked to reach a category of the answer
 * data (not the generic answer), so a tap always gets a fitting reply. Shown 3 at a time, a new
 * set after each answer.
 */
export const SAMPLES = [
  '시험 전날인데 쇼츠만 3시간 봤어요',
  '다이어트 중인데 야식으로 치킨 시켰어요',
  '운동 간다고 해놓고 또 안 갔어요',
  '새벽 3시까지 유튜브 봤어요',
  '알람 다섯 개 다 끄고 지각했어요',
  '이번 달 카드값이 월급보다 많아요',
  '전남친 인스타 몰래 봤어요',
  '과제 마감 전날 밤에 시작했어요',
  '엄마한테 괜히 짜증 냈어요',
  '설거지 일주일째 안 했어요',
  '금연 3일 만에 담배 피웠어요',
  '장바구니에 있던 거 또 질렀어요',
  '오늘도 회사 가기 싫어요',
  '친구 카톡 사흘째 읽씹했어요',
  '최애 굿즈에 용돈 다 썼어요',
  '야구 져서 화났어요',
  '계획만 세우고 하나도 안 했어요',
  '책 사놓고 한 장도 안 읽었어요',
  '커피 하루에 다섯 잔 마셨어요',
  '게임하다 밤새웠어요',
  '중간고사 벼락치기했어요',
  '수업 시간에 졸다가 걸렸어요',
  '방 청소 미루고 침대에 누워만 있었어요',
];

/** n different samples, avoiding the ones shown last time when there are enough. */
export function pickSamples(n = 3, avoid = [], random = Math.random) {
  const pool = SAMPLES.filter((s) => !avoid.includes(s));
  const from = pool.length >= n ? pool : SAMPLES.slice();
  for (let i = from.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [from[i], from[j]] = [from[j], from[i]]; }
  return from.slice(0, n);
}
