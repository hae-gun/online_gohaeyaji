import { fillKeyword } from './korean.js';

/**
 * Prototype of the server-side answer engine. Same three steps the backend will run:
 *  1. safety filter: crisis words turn the joke off and show where to get help
 *  2. category match: keyword dictionary (the backend swaps this for morphological analysis)
 *  3. template assembly: empathy + penance + closing line, keyword and particles filled in
 *
 * Only dictionary keywords are ever echoed back, never the user's own words,
 * so nobody can make the priest say something they typed.
 *
 * Data files (public/data). Real files are git-ignored, *.sample.json ship with the repo:
 *   answers.json  answer templates        (fallback: answers.sample.json)
 *   safety.json   crisis keywords         (fallback: safety.sample.json)
 *   blocked.json  profanity, abuse        (fallback: blocked.sample.json)
 */

// Minimal crisis net that stays on even if every data file fails to load.
// The full list lives in safety.json, outside the repo.
const BUILTIN_SAFETY = {
  keywords: ['죽고 싶', '자살', '자해'],
  message: '이 이야기는 농담으로 답할 수 없습니다. 지금 많이 힘드시다면 혼자 견디지 마시고 자살예방상담전화 109에 연락해 주세요. 24시간 누군가 듣고 있습니다. 청소년이라면 청소년상담 1388도 있습니다.',
};
const DEFAULT_BLOCKED_MESSAGE = '고해소에서는 고운 말을 써 주십시오. 다시 말씀해 주시겠습니까?';

export async function loadAnswerData() {
  const [answers, safety, blocked] = await Promise.all([
    firstJson(['data/answers.json', 'data/answers.sample.json']),
    firstJson(['data/safety.json', 'data/safety.sample.json']),
    firstJson(['data/blocked.json', 'data/blocked.sample.json']),
  ]);
  if (!answers) throw new Error('answer data not found');
  return { answers, safety, blocked };
}

async function firstJson(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) return await res.json();
    } catch (_) { /* try the next one */ }
  }
  return null;
}

/** Lowercased, spaces and common filler symbols removed, so "씨 발" or "ㅅ.ㅂ" still match. */
const squash = (s) => s.toLowerCase().replace(/[\s.,_\-*~!?^@#]+/g, '');

export function createAnswerEngine({ answers, safety, blocked }, random = Math.random) {
  const safetyWords = [...new Set([...BUILTIN_SAFETY.keywords, ...((safety && safety.keywords) || [])])];
  const safetyMessage = (safety && safety.message) || BUILTIN_SAFETY.message;
  const blockedWords = ((blocked && blocked.words) || []).map(squash).filter(Boolean);
  const blockedMessage = (blocked && blocked.message) || DEFAULT_BLOCKED_MESSAGE;
  const categories = answers.categories || [];
  const generic = answers.generic;
  const pick = (list) => list[Math.floor(random() * list.length)];

  /**
   * Order matters: a crisis message wins even when it contains profanity.
   * @returns {{kind:'safety'|'blocked'|'tooShort'|'answer', line:string, category?:string, keyword?:string, penance?:string}}
   */
  function answer(input) {
    const text = input.trim();
    if (safetyWords.some((w) => text.includes(w))) return { kind: 'safety', line: safetyMessage };
    const flat = squash(text);
    if (blockedWords.some((w) => flat.includes(w))) return { kind: 'blocked', line: blockedMessage };
    if (text.length < 3) return { kind: 'tooShort', line: answers.messages.tooShort };

    // keys are "match" or "match|display": match '숏츠' but say '쇼츠'
    let best = null, bestHits = 0, keyword = '';
    for (const c of categories) {
      let hits = 0, first = '';
      for (const key of c.keys) {
        const [match, display] = key.split('|');
        if (text.includes(match)) { hits++; if (!first) first = display || match; }
      }
      if (hits > bestHits) { bestHits = hits; best = c; keyword = first; }
    }

    const c = best || generic;
    const k = keyword || c.word || '';
    let empathy = pick(c.empathy);
    if (!k && empathy.includes('{k')) empathy = generic.empathy[0];
    const penance = fillKeyword(pick(c.penance), k);
    const line = `${fillKeyword(empathy, k)} 보속으로, ${penance} ${pick(c.closing)}`;
    return { kind: 'answer', line, category: c.id, keyword: k, penance };
  }

  return { answer };
}
