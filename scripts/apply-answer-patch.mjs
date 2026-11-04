#!/usr/bin/env node
/**
 * Applies what the AI returned from the admin page's "AI에 넘길 내용 만들기" to the private
 * answer data (frontend/public/data/answers.json, git-ignored).
 *
 *   node scripts/apply-answer-patch.mjs patch.json          # check, back up, apply
 *   node scripts/apply-answer-patch.mjs patch.json --dry    # check and show what would change
 *
 * patch.json (the format the admin page asks the AI for):
 *   { "addKeys": [{ "category": "dopamine", "keys": ["쇼츠", "숏츠|쇼츠"] }],   "A|B": match A, say B
 *     "newCategories": [{ "id": "pet", "word": "반려동물", "keys": [...],
 *                         "empathy": { "jin": [...], "eom": [...], "yu": [...] },
 *                         "penance": [...], "closing": { "jin": [...], "eom": [...], "yu": [...] } }] }
 *
 * Nothing is written when any check fails. Before writing, the current file is copied to
 * answers.v<N>.backup.json next to it (also git-ignored), and "version" goes up by one.
 * Then: scripts/set-data-secrets.sh answers --deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'frontend/public/data');
const answersPath = path.join(dataDir, 'answers.json');

const [patchPath, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry');
if (!patchPath) {
  console.error('usage: node scripts/apply-answer-patch.mjs patch.json [--dry]');
  process.exit(2);
}

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { console.error(`${p}: ${e.message}`); process.exit(1); }
};
// the AI often wraps JSON in ```json fences; take what is between the first { and the last }
const rawPatch = fs.readFileSync(patchPath, 'utf8');
let patch;
try {
  patch = JSON.parse(rawPatch.slice(rawPatch.indexOf('{'), rawPatch.lastIndexOf('}') + 1));
} catch (e) {
  console.error(`${patchPath}: not valid JSON (${e.message})`);
  process.exit(1);
}
const answers = readJson(answersPath);
const blockedFile = fs.existsSync(path.join(dataDir, 'blocked.json')) ? 'blocked.json' : 'blocked.sample.json';
const blocked = (readJson(path.join(dataDir, blockedFile)).words || []).map((w) => w.toLowerCase());

const errors = [];
const warnings = [];
const PRIESTS = ['jin', 'eom', 'yu'];
const ID = /^[a-z][a-z0-9_]{1,30}$/;
const PLACEHOLDER = /\{[^}]*\}/g;
const OK_PLACEHOLDERS = new Set(['{k}', '{k은}', '{k이}', '{k을}']);

const existing = new Map(answers.categories.map((c) => [c.id, c]));
const keyOwner = new Map();
for (const c of answers.categories) for (const k of c.keys) keyOwner.set(k, c.id);

// the engine fills {k} in empathy and penance only; in closing it would show as "{k}"
function checkText(where, s, keywordOk = true) {
  if (typeof s !== 'string' || !s.trim()) { errors.push(`${where}: 빈 문장`); return; }
  if (s.length > 200) warnings.push(`${where}: 200자가 넘습니다 (${s.length}자)`);
  for (const p of s.match(PLACEHOLDER) || []) {
    if (!keywordOk) errors.push(`${where}: closing에는 자리표시를 쓸 수 없습니다 (${p})`);
    else if (!OK_PLACEHOLDERS.has(p)) errors.push(`${where}: 쓸 수 없는 자리표시 ${p} ({k}, {k은}, {k이}, {k을}만 가능)`);
  }
  const flat = s.toLowerCase().replace(/\s+/g, '');
  for (const w of blocked) if (w && flat.includes(w)) errors.push(`${where}: 금지어가 들어 있습니다 (${w})`);
}
function checkKeys(where, keys) {
  if (!Array.isArray(keys) || !keys.length) { errors.push(`${where}: keys가 비었습니다`); return []; }
  const out = [];
  for (const k of keys) {
    if (typeof k !== 'string' || !k.trim() || k.length > 30) { errors.push(`${where}: 잘못된 키워드 ${JSON.stringify(k)}`); continue; }
    out.push(k.trim());
  }
  return out;
}
function checkLines(where, v, perPriest, keywordOk = true) {
  if (perPriest && v && !Array.isArray(v) && typeof v === 'object') {
    for (const p of PRIESTS) {
      if (!Array.isArray(v[p]) || !v[p].length) errors.push(`${where}.${p}: 문장이 없습니다`);
      else v[p].forEach((s, i) => checkText(`${where}.${p}[${i}]`, s, keywordOk));
    }
    return;
  }
  if (!Array.isArray(v) || !v.length) { errors.push(`${where}: 문장이 없습니다`); return; }
  v.forEach((s, i) => checkText(`${where}[${i}]`, s, keywordOk));
}

// --- keys for existing categories
const added = [];
for (const [i, a] of (patch.addKeys || []).entries()) {
  const where = `addKeys[${i}]`;
  const cat = existing.get(a.category);
  if (!cat) { errors.push(`${where}: 없는 카테고리 ${a.category}`); continue; }
  for (const k of checkKeys(where, a.keys)) {
    if (cat.keys.includes(k)) continue;
    if (keyOwner.has(k)) warnings.push(`${where}: "${k}"는 이미 ${keyOwner.get(k)}의 키워드입니다 (둘 다 걸리면 점수와 순서로 정해짐)`);
    added.push([cat, k]);
  }
}

// --- new categories
const fresh = [];
for (const [i, c] of (patch.newCategories || []).entries()) {
  const where = `newCategories[${i}]${c && c.id ? `(${c.id})` : ''}`;
  if (!c || typeof c !== 'object') { errors.push(`${where}: 객체가 아닙니다`); continue; }
  if (!ID.test(c.id || '')) { errors.push(`${where}: id는 영문 소문자로 시작하는 2~31자`); continue; }
  if (existing.has(c.id) || fresh.some((f) => f.id === c.id)) { errors.push(`${where}: 이미 있는 id`); continue; }
  if (typeof c.word !== 'string' || !c.word.trim()) errors.push(`${where}: word가 없습니다`);
  const keys = checkKeys(where, c.keys);
  for (const k of keys) if (keyOwner.has(k)) warnings.push(`${where}: "${k}"는 이미 ${keyOwner.get(k)}의 키워드입니다`);
  checkLines(`${where}.empathy`, c.empathy, true);
  checkLines(`${where}.penance`, c.penance, false);
  checkLines(`${where}.closing`, c.closing, true, false);
  fresh.push({ id: c.id, word: c.word, keys: [...new Set(keys)], empathy: c.empathy, penance: c.penance, closing: c.closing });
}

for (const w of warnings) console.warn(`주의  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`오류  ${e}`);
  console.error(`\n오류 ${errors.length}개. 아무것도 바꾸지 않았습니다.`);
  process.exit(1);
}

console.log(`키워드 추가 ${added.length}개, 새 카테고리 ${fresh.length}개${fresh.length ? ` (${fresh.map((c) => c.id).join(', ')})` : ''}`);
for (const [cat, k] of added) console.log(`  + ${cat.id}: ${k}`);
if (!added.length && !fresh.length) { console.log('바꿀 것이 없습니다.'); process.exit(0); }
if (dry) { console.log('\n--dry: 쓰지 않았습니다.'); process.exit(0); }

// back up, then write
let n = 1;
while (fs.existsSync(path.join(dataDir, `answers.v${n}.backup.json`))) n++;
const backup = path.join(dataDir, `answers.v${n}.backup.json`);
fs.copyFileSync(answersPath, backup);
for (const [cat, k] of added) cat.keys.push(k);
answers.categories.push(...fresh);
answers.version = (Number(answers.version) || 0) + 1;
fs.writeFileSync(answersPath, `${JSON.stringify(answers, null, 2)}\n`);
console.log(`\n저장했습니다. version ${answers.version}, 이전 파일은 ${path.basename(backup)}`);
console.log('배포: scripts/set-data-secrets.sh answers --deploy');
