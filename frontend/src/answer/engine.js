import { fillKeyword } from './korean.js';

/**
 * Prototype of the server-side answer engine. Same three steps the backend will run:
 *  1. safety filter: a crisis (self-harm, sexual violence, abuse, bullying, eating, pregnancy,
 *     addiction, harming others) turns the joke off and shows that type's own help message
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
 *   safety.json   crisis types and rules  (fallback: safety.sample.json)
 *   blocked.json  profanity, abuse        (fallback: blocked.sample.json)
 */

// Minimal crisis net that stays on even if every data file fails to load.
// The full rules live in safety.json, outside the repo.
const BUILTIN_SAFETY = {
  id: 'selfharm',
  message: '이 말만큼은 농담으로 받을 수 없습니다. 혹시 지금 정말 힘드시다면 혼자 견디지 마시고 자살예방상담전화 109에 전화해 주세요. 24시간 누군가 듣고 있습니다. 청소년이라면 청소년상담 1388도 있습니다.',
  rules: [{ any: ['죽고싶', '자해', '살기싫'] }, { any: ['자살'], unless: ['자살골'] }],
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
const squash = (s) => s.toLowerCase().replace(/[\s.,_\-*~!?^@#'"()\[\]…]+/g, '');

/**
 * Crisis types from safety.json. v2: { types: [{ id, message, rules: [{ any, all, re, unless }] }] },
 * checked top to bottom, first match wins. A rule matches when every condition it has holds:
 *   any    one of these words appears
 *   all    one word from each group appears ("dad" + "hit me", but not "I hit my alarm")
 *   re     one of these regexes matches the text (spaces collapsed to one)
 *   unless none of these words appears ("마약김밥" is food, "모기를 죽였" is not a threat)
 * Words are compared with spaces and symbols removed, so "자 살" is still caught.
 * v1 files ({ keywords, message }) become a single type.
 *
 * "caution" ({ any, unless }) is the step below a crisis: words that hint at something serious
 * ("맞았", "무서워", "숨어") without a rule matching. The engine then skips joke categories and
 * small talk and gives the plain, non-joking generic answer, with no feedback button.
 */
function compileSafety(safety) {
  const words = (l) => (l || []).map(squash).filter(Boolean);
  const raw = safety && Array.isArray(safety.types) ? safety.types
    : safety && Array.isArray(safety.keywords) ? [{ id: 'general', message: safety.message, rules: [{ any: safety.keywords }] }]
    : [];
  const types = [...raw, BUILTIN_SAFETY].map((t) => ({
    id: t.id,
    message: t.message || BUILTIN_SAFETY.message,
    rules: (t.rules || []).map((r) => ({
      any: words(r.any),
      all: (r.all || []).map(words).filter((g) => g.length),
      re: (r.re || []).map((x) => new RegExp(x)),
      unless: words(r.unless),
    })),
  }));
  const ruleHits = (r, flat, spaced) => {
    if (!r.any.length && !r.all.length && !r.re.length) return false;
    if (r.any.length && !r.any.some((w) => flat.includes(w))) return false;
    if (r.all.length && !r.all.every((g) => g.some((w) => flat.includes(w)))) return false;
    if (r.re.length && !r.re.some((x) => x.test(spaced))) return false;
    return !r.unless.some((w) => flat.includes(w));
  };
  const caution = safety && safety.caution
    ? { any: words(safety.caution.any), all: [], re: [], unless: words(safety.caution.unless) }
    : null;
  return {
    /** small talk that is already gentle and may still answer a cautious message ("외로워요") */
    cautionChat: new Set((safety && safety.caution && safety.caution.allowChat) || []),
    /** @returns the first crisis type the text falls under, or null */
    crisisOf(text) {
      const flat = squash(text), spaced = text.replace(/\s+/g, ' ');
      return types.find((t) => t.rules.some((r) => ruleHits(r, flat, spaced))) || null;
    },
    /** @returns true when the text is not a crisis but should not get a joke either */
    cautious(text) {
      return !!caution && ruleHits(caution, squash(text), text);
    },
  };
}

export function createAnswerEngine({ answers, safety, blocked }, random = Math.random) {
  const { crisisOf, cautious, cautionChat } = compileSafety(safety);
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
    let best = null, bestHits = 0, keyword = '', keyIndex = -1;
    for (const c of entries) {
      let hits = 0, first = '', firstAt = -1;
      c.keys.forEach((key, i) => {
        const [match, display] = key.split('|');
        if (text.includes(match)) { hits++; if (!first) { first = display || match; firstAt = i; } }
      });
      if (hits > bestHits) { bestHits = hits; best = c; keyword = first; keyIndex = firstAt; }
    }
    return { best, keyword, keyIndex };
  }

  /**
   * Order matters: a crisis message wins even when it contains profanity.
   * @param {string} input
   * @param {string} [personaId] which priest is in this booth ('jin' | 'eom' | 'yu')
   * caution: true when a risky word was seen; the answer is then the plain generic one.
   * @returns {{kind:'safety'|'blocked'|'tooShort'|'chat'|'answer', line:string, persona:string, type?:string, caution?:boolean,
   *   category?:string, keyword?:string, penance?:string, penanceAt?:number, closingAt?:number,
   *   ref?:{c:string, p:string, pi:number, ki:number}}}
   *   penanceAt/closingAt are character offsets in line, for timing the priest's face.
   */
  function answer(input, personaId) {
    const p = personaOf(personaId);
    const text = input.trim();
    const crisis = crisisOf(text);
    if (crisis) return { kind: 'safety', type: crisis.id, line: crisis.message, persona: p.id };
    const flat = squash(text);
    if (blockedWords.some((w) => flat.includes(w))) return { kind: 'blocked', line: blockedMessage, persona: p.id };
    if (text.length < 3) return { kind: 'tooShort', line: p.tooShort || answers.messages.tooShort, persona: p.id };

    // a hint of something serious: no joke category, only gentle small talk, else the plain answer
    const careful = cautious(text);
    const { best, keyword, keyIndex } = careful ? { best: null, keyword: '', keyIndex: -1 } : bestMatch(text, categories);
    if (!best) {
      // not a confession: talk back like a person instead of handing out a random penance
      const chat = bestMatch(text, careful ? chatter.filter((c) => cautionChat.has(c.id)) : chatter).best;
      if (chat) {
        const own = p.chatter && (p.chatter[chat.id] || p.chatter.default);
        return { kind: 'chat', line: pick(own || listFor(chat.replies, p.id)), category: chat.id, persona: p.id, ...(careful ? { caution: true } : {}) };
      }
    }

    const c = best || generic;
    const k = keyword || c.word || '';
    // a rare priest (persona.lines) answers every confession with his own words
    const section = (name) => (p.lines && p.lines[name]) || listFor(c[name], p.id);
    const empathies = section('empathy');
    let empathy = pick(empathies);
    if (!k && empathy.includes('{k')) {
      empathy = empathies.find((t) => !t.includes('{k')) || listFor(generic.empathy, p.id)[0];
    }
    const penances = section('penance');
    const pi = Math.floor(random() * penances.length);
    const penance = fillKeyword(penances[pi], k);
    const head = `${fillKeyword(empathy, k)} ${p.lead} `;
    const line = `${head}${penance} ${pick(section('closing'))}`;
    return {
      kind: 'answer', line, category: c.id, keyword: k, penance, persona: p.id, ...(careful ? { caution: true } : {}),
      // where the penance came from, so a shared card can rebuild it from the same data (card/)
      ref: { c: c.id, p: p.id, pi, ki: keyword ? keyIndex : -1 },
      penanceAt: head.length - p.lead.length - 1, closingAt: head.length + penance.length,
    };
  }

  /** The priest sitting in a booth. Booths take turns: 1 jin, 2 eom, 3 yu, 4 jin, ... */
  const regulars = personas.filter((p) => !p.chance);
  const personaForBooth = (boothIndex) => regulars[boothIndex % regulars.length];

  /**
   * The penance a shared card points at (ref from answer()), rebuilt from the data, or null when
   * the data no longer has it. Only dictionary words ever come out, never text from the link.
   */
  function penanceOf(ref) {
    if (!ref) return null;
    const c = categories.find((x) => x.id === ref.c) || (generic && generic.id === ref.c ? generic : null);
    const p = personas.find((x) => x.id === ref.p);
    if (!c || !p) return null;
    const list = (p.lines && p.lines.penance) || listFor(c.penance, p.id);
    const t = list[ref.pi | 0];
    if (typeof t !== 'string' || !t) return null;
    const key = ref.ki >= 0 && c.keys ? c.keys[ref.ki | 0] : null;
    const k = key ? (key.split('|')[1] || key.split('|')[0]) : (c.word || '');
    return { penance: fillKeyword(t, k), keyword: k, persona: p, category: c };
  }

  /**
   * Other penances of the same category and priest, keyword filled in, for the verdict's slot
   * roll (ui/verdict.js). The real one is not among them; at most n, shuffled.
   */
  function penanceChoices(ref, n = 6) {
    const base = penanceOf(ref);
    if (!base) return [];
    const list = (base.persona.lines && base.persona.lines.penance) || listFor(base.category.penance, base.persona.id);
    const others = list.map((t) => fillKeyword(t, base.keyword)).filter((t) => t && t !== base.penance);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    return others.slice(0, n);
  }

  return { answer, personas, personaForBooth, penanceOf, penanceChoices };
}
