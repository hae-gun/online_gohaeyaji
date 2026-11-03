/**
 * Answer engine regression tests: `npm test` (Node 20+, no extra packages).
 *
 * Uses the real, git-ignored data in public/data when it is there (local machine, and the Pages
 * build after the secrets are written), otherwise the public *.sample.json files. The crisis
 * cases need the real rules, so they are skipped on sample data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnswerEngine } from '../src/answer/engine.js';
import { CASES } from './crisis-cases.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
const pickFile = (base) => (fs.existsSync(path.join(DATA, `${base}.json`)) ? `${base}.json` : `${base}.sample.json`);
const files = { answers: pickFile('answers'), safety: pickFile('safety'), blocked: pickFile('blocked') };
const real = files.safety === 'safety.json' && files.answers === 'answers.json';
const data = { answers: read(files.answers), safety: read(files.safety), blocked: read(files.blocked) };
const engine = createAnswerEngine(data, () => 0.1);
const personas = (data.answers.personas || []).map((p) => p.id);
const PERSONAS = personas.length ? personas : ['jin', 'eom', 'yu'];
console.log(`data: ${Object.values(files).join(', ')}${real ? '' : ' (samples: crisis cases skipped)'}`);

// ---------------------------------------------------------------- crisis detection

test('crisis cases: each sentence gets the expected crisis type, everyday talk gets none', { skip: !real && 'needs the real safety.json' }, () => {
  const failures = [];
  for (const [group, text, expect, opts] of CASES) {
    if (opts && opts.known) continue;
    for (const p of PERSONAS) {
      const r = engine.answer(text, p);
      const got = r.kind === 'safety' ? r.type : null;
      if (got !== expect) failures.push(`${group}: "${text}" (${p}) -> ${got ?? `${r.kind}/${r.category || '-'}`}, want ${expect}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('crisis detection rate by group, with known misses listed (report, never fails)', { skip: !real && 'needs the real safety.json' }, () => {
  const rows = {};
  const stillMissed = [];
  const nowCaught = [];
  for (const [group, text, expect, opts] of CASES) {
    const r = engine.answer(text, 'yu');
    const got = r.kind === 'safety' ? r.type : null;
    const key = opts && opts.known ? `${group} (known)` : group;
    rows[key] = rows[key] || { n: 0, ok: 0 };
    rows[key].n += 1;
    const ok = expect === null ? got === null : got !== null;
    if (ok) rows[key].ok += 1;
    if (opts && opts.known) (ok ? nowCaught : stillMissed).push(`"${text}" -> ${got ?? (r.caution ? 'careful plain answer' : `${r.kind}/${r.category || '-'}`)}`);
  }
  for (const [k, v] of Object.entries(rows)) console.log(`  ${k.padEnd(18)} ${v.ok}/${v.n}`);
  if (stillMissed.length) console.log(`  still missed:\n    ${stillMissed.join('\n    ')}`);
  if (nowCaught.length) console.log(`  now caught, drop the known flag:\n    ${nowCaught.join('\n    ')}`);
});

test('a crisis answer has no joke, no penance and names where to get help', { skip: !real && 'needs the real safety.json' }, () => {
  const types = new Map((data.safety.types || []).map((t) => [t.id, t]));
  for (const [, text, expect] of CASES) {
    if (!expect) continue;
    const r = engine.answer(text, 'yu');
    if (r.kind !== 'safety') continue;   // known misses
    assert.equal(r.penance, undefined, text);
    assert.equal(r.line, types.get(r.type).message, text);
  }
  for (const t of types.values()) {
    assert.match(t.message, /\d{3}/, `${t.id} message names a phone number`);
    assert.doesNotMatch(t.message, /보속으로|오늘의 보속|ㅋ|ㅎㅎ/, `${t.id} message has no penance or laughter`);
  }
});

test('a hint of something serious gets the plain answer, never a joke category', { skip: !real && 'needs the real safety.json' }, () => {
  const allowed = new Set((data.safety.caution && data.safety.caution.allowChat) || []);
  for (const text of ['친구한테 혼날까봐 무서워요', '체육시간에 공 맞았어요', '아빠가 소리 지르면 숨어요 ㅋㅋ']) {
    const r = engine.answer(text, 'yu');
    if (r.kind === 'safety') continue;
    assert.equal(r.caution, true, text);
    assert.ok(r.category === 'generic' || allowed.has(r.category), `${text} -> ${r.category}`);
  }
});

// ---------------------------------------------------------------- answer copy

test('the generic answer (where unknown confessions land) does not judge or joke', () => {
  const g = data.answers.generic;
  const lines = ['empathy', 'closing'].flatMap((k) => (Array.isArray(g[k]) ? g[k] : Object.values(g[k]).flat()));
  for (const line of lines) {
    assert.doesNotMatch(line, /여럿 다녀가|양호한 편|핑계는|개그 사전|경첩|다음 회차|혼내 드립니다/, line);
  }
});

test('every priest has every section, keywords fill in, face timing offsets line up', () => {
  const sections = [data.answers.generic, ...(data.answers.categories || [])];
  for (const c of sections) {
    for (const k of ['empathy', 'closing']) {
      if (Array.isArray(c[k])) continue;
      for (const p of ['jin', 'eom', 'yu']) assert.ok((c[k][p] || []).length, `${c.id}.${k}.${p}`);
    }
  }
  for (let i = 0; i < 300; i += 1) {
    const p = PERSONAS[i % PERSONAS.length];
    const r = engine.answer(['쇼츠 보다 늦잠 잤어요', '그냥 그랬어요', '과자 다 먹음', '운동 또 미뤘어요'][i % 4], p);
    assert.doesNotMatch(r.line, /[{}]/, r.line);
    if (r.kind === 'answer') assert.ok(r.line.slice(r.closingAt).startsWith(' '), r.line);
  }
});

test('no middle dot anywhere people can see', () => {
  for (const name of Object.values(files)) {
    assert.ok(!fs.readFileSync(path.join(DATA, name), 'utf8').includes('·'), name);
  }
});

// ---------------------------------------------------------------- fallbacks

test('old safety files and a missing safety file still catch the basics', () => {
  const v1 = createAnswerEngine({ answers: data.answers, safety: { keywords: ['죽고 싶'], message: 'v1' } });
  assert.equal(v1.answer('죽고 싶어요').kind, 'safety');
  const none = createAnswerEngine({ answers: data.answers, safety: null });
  assert.equal(none.answer('살기 싫어').kind, 'safety');
  assert.equal(none.answer('자 살').kind, 'safety');
  assert.notEqual(none.answer('자살골 넣었다').kind, 'safety');
});

test('the public sample files work on their own', () => {
  const e = createAnswerEngine({ answers: read('answers.sample.json'), safety: read('safety.sample.json'), blocked: read('blocked.sample.json') });
  assert.equal(e.answer('자 살 하고 싶어').kind, 'safety');
  assert.notEqual(e.answer('알람을 때렸어요').kind, 'safety');
  assert.equal(e.answer('쇼츠 봤어요').kind, 'answer');
});
