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
 * Three priests answer the same confession in their own voice (answers.json "personas").
 * empathy and closing can be { jin: [...], eom: [...], yu: [...] }; penance is the outcome of the
 * confession so all three usually share one list. Any section given as a plain array is shared.
 * "chatter" answers things that are not confessions (greetings, "this is fun", "the priest is ugly"),
 * and is only used when no confession category matched.
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
// used when the data file has no persona list (e.g. answers.sample.json)
const DEFAULT_PERSONAS = [
  { id: 'jin', name: '진 신부님', lead: '보속으로,' },
  { id: 'eom', name: '엄 신부님', lead: '보속입니다.' },
  { id: 'yu', name: '유 신부님', lead: '자, 오늘의 보속 나갑니다.' },
];
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
  const chatter = answers.chatter || [];
  const generic = answers.generic;
  const personas = (answers.personas && answers.personas.length) ? answers.personas : DEFAULT_PERSONAS;
  const personaOf = (id) => personas.find((p) => p.id === id) || personas[0];
  const pick = (list) => list[Math.floor(random() * list.length)];
  /** A section is one shared list or { personaId: list }. Falls back to the first persona's list. */
  const listFor = (v, id) => {
    if (Array.isArray(v)) return v;
    const l = v && (v[id] || v[personas[0].id]);
    return l && l.length ? l : [''];
  };

  /** keys are "match" or "match|display": match '숏츠' but say '쇼츠'. Most hits wins, ties go to the earlier entry. */
  function bestMatch(text, entries) {
    let best = null, bestHits = 0, keyword = '';
    for (const c of entries) {
      let hits = 0, first = '';
      for (const key of c.keys) {
        const [match, display] = key.split('|');
        if (text.includes(match)) { hits++; if (!first) first = display || match; }
      }
      if (hits > bestHits) { bestHits = hits; best = c; keyword = first; }
    }
    return { best, keyword };
  }

  /**
   * Order matters: a crisis message wins even when it contains profanity.
   * @param {string} input
   * @param {string} [personaId] which priest is in this booth ('jin' | 'eom' | 'yu')
   * @returns {{kind:'safety'|'blocked'|'tooShort'|'chat'|'answer', line:string, persona:string,
   *   category?:string, keyword?:string, penance?:string, penanceAt?:number, closingAt?:number}}
   *   penanceAt/closingAt are character offsets in line, for timing the priest's face.
   */
  function answer(input, personaId) {
    const p = personaOf(personaId);
    const text = input.trim();
    if (safetyWords.some((w) => text.includes(w))) return { kind: 'safety', line: safetyMessage, persona: p.id };
    const flat = squash(text);
    if (blockedWords.some((w) => flat.includes(w))) return { kind: 'blocked', line: blockedMessage, persona: p.id };
    if (text.length < 3) return { kind: 'tooShort', line: p.tooShort || answers.messages.tooShort, persona: p.id };

    const { best, keyword } = bestMatch(text, categories);
    if (!best) {
      // not a confession: talk back like a person instead of handing out a random penance
      const chat = bestMatch(text, chatter).best;
      if (chat) return { kind: 'chat', line: pick(listFor(chat.replies, p.id)), category: chat.id, persona: p.id };
    }

    const c = best || generic;
    const k = keyword || c.word || '';
    let empathy = pick(listFor(c.empathy, p.id));
    if (!k && empathy.includes('{k')) empathy = listFor(generic.empathy, p.id)[0];
    const penance = fillKeyword(pick(listFor(c.penance, p.id)), k);
    const head = `${fillKeyword(empathy, k)} ${p.lead} `;
    const line = `${head}${penance} ${pick(listFor(c.closing, p.id))}`;
    return {
      kind: 'answer', line, category: c.id, keyword: k, penance, persona: p.id,
      penanceAt: head.length - p.lead.length - 1, closingAt: head.length + penance.length,
    };
  }

  /** The priest sitting in a booth. Booths take turns: 1 jin, 2 eom, 3 yu, 4 jin, ... */
  const personaForBooth = (boothIndex) => personas[boothIndex % personas.length];

  return { answer, personas, personaForBooth };
}
