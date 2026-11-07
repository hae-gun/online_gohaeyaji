// Temporary presence server for the Magic Wiz Park page. Delete after the series.
// Up to 10 parks of 1000 people each, filled from the first; each has its own bench-clearing. Each client hears only its nearest neighbours, twice a second,
// so traffic grows with the audience instead of with its square. No free text is ever accepted.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8090);
const MAX_CHANNELS = Number(process.env.MAX_CHANNELS || 10);
const CAP = Number(process.env.CHANNEL_CAP || 1000);
const NEAR = Number(process.env.NEAR || 40);
const TICK_MS = 500;
const CELL = 40;
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://wiz.gohaeyaji.com,https://hae-gun.github.io,http://localhost:8000').split(','));
const ID_RE = /^[a-z0-9-]{1,16}$/;
// Jersey names other people see: only the Korean Series entries, never free text
const JERSEY_NAMES = new Set('강민호 고영표 구자욱 권동진 김도환 김민혁 김상수 김상준 김성윤 김영웅 김정운 김지찬 김태훈 김헌곤 김현수 김현준 대니엘 디아즈 로건 류지혁 류현인 박계범 박승규 박영현 배정대 배제성 배찬승 사토시 소형준 손동현 스기모토 안현민 양창섭 오원석 오윤석 우규민 원태인 이승민 이승현 이재현 이재희 이정훈 임기영 장성우 장승현 장준원 장진혁 장찬희 전병우 전용주 조대현 주권 최원준 최원태 최형우 페덱 한승택 허경민 후라도 힐리어드'.split(' '));
const MAX_FRAME = 256;
const IDLE_MS = 60_000;
const MSG_GAP_MS = 2_000;
const BUFFER_LIMIT = 64 * 1024;
const MESSAGE_COUNT = 21; // 8 KT messages, 8 Samsung messages, 5 big reactions
const config = { need: Number(process.env.BENCH_NEED || 5), gatherSec: 30, cooldownSec: Number(process.env.BENCH_COOLDOWN_MS || 30_000) / 1000 };
const BENCH_FIGHT_MS = 16_000; // about 5s of that is fans running in from the stands
const BENCH_SHAKE_MS = 7_000;
const newBench = () => ({ phase: 0, joined: new Set(), until: 0, ready: 0, result: '', resultAt: 0 }); // 0 idle, 1 gathering, 2 brawl, 3 handshake

const channels = {}, benches = {};
for (let n = 1; n <= MAX_CHANNELS; n += 1) { channels[n] = new Map(); benches[n] = { ...newBench(), n }; }
const onlineTotal = () => Object.values(channels).reduce((sum, list) => sum + list.size, 0);
// Keep a reconnecting visitor in their channel when it has room, otherwise take the first channel with room
function pickChannel(wanted) {
  if (channels[wanted] && channels[wanted].size < CAP) return Number(wanted);
  for (let n = 1; n <= MAX_CHANNELS; n += 1) if (channels[n].size < CAP) return n;
  return 0;
}
let nextId = 1;

// ---- anonymous daily usage: counts only, no IP and no visitor ID is kept ----
const KEEP_DAYS = 30;
const REF_SOURCES = new Set(['direct', 'instagram', 'kakao', 'naver', 'google', 'youtube', 'other']);
let stats = {};
const kstNow = () => new Date(Date.now() + 9 * 36e5).toISOString();
function today() {
  const key = kstNow().slice(0, 10);
  if (!stats[key]) {
    stats[key] = { visits: 0, uniques: 0, returning: 0, refs: {}, enterClicks: 0, enters: 0, teams: { kt: 0, samsung: 0 }, leaves: 0, staySec: 0, stay: [0, 0, 0, 0], peak: 0, hours: {}, msgs: 0, acts: 0, bench: 0 };
    for (const old of Object.keys(stats).sort().slice(0, -KEEP_DAYS)) delete stats[old];
  }
  return stats[key];
}
// Team cheering score for the day. Points come only from actions the server already rate limits,
// and the smaller side gets up to double so a smaller crowd can still win.
const CHEER_EVERY_MS = 2_000;
const BENCH_JOIN_PT = 5, BENCH_WIN_PT = 30;
const teamOf = (c) => c.team || (c.look[0].startsWith('ss-') ? 'samsung' : 'kt');
let crowd = { kt: 0, samsung: 0 };
function score() { const d = today(); if (!d.score) d.score = { kt: 0, samsung: 0 }; return d.score; }
export function award(team, points) {
  const other = team === 'kt' ? 'samsung' : 'kt';
  const boost = Math.min(2, Math.max(1, Math.sqrt((crowd[other] || 1) / (crowd[team] || 1))));
  score()[team] += Math.round(points * boost * 10) / 10;
}

// Ambient fans so the stands never look empty. They are counted in the crowd numbers people see,
// but never in stats, the team score or who wins a bench clearing.
const NPC_COUNT = { kt: Number(process.env.NPC_KT ?? 13), samsung: Number(process.env.NPC_SAMSUNG ?? 37) };
const NPC_SEATS = {"kt":[[-36.1,6.9],[-38.6,5.1],[-41,3.4],[-43.4,1.7],[-45.9,-0.1],[-48.3,-1.8],[-50.8,-3.6],[-38.5,10.2],[-40.9,8.4],[-43.3,6.6],[-45.7,4.8],[-48.2,3],[-50.6,1.3],[-53,-0.5],[-41,13.5],[-43.4,11.7],[-45.8,9.9],[-48.2,8.1],[-50.6,6.3],[-53,4.5],[-55.4,2.7],[-44.4,18.1],[-46.8,16.3],[-49.3,14.5],[-51.7,12.8],[-54.1,11],[-56.5,9.2],[-58.9,7.4],[-48.7,24.1],[-51.2,22.4],[-53.6,20.7],[-56.1,19],[-58.6,17.3],[-61.1,15.6],[-63.6,14],[-53.5,32],[-56.2,30.7],[-58.8,29.3],[-61.5,28],[-64.2,26.6],[-66.9,25.2],[-69.5,23.9],[-57,40.5],[-59.9,39.5],[-62.7,38.5],[-65.5,37.5],[-68.4,36.5],[-71.2,35.6],[-74,34.6],[-59.5,49.7],[-62.4,49.3],[-65.4,48.9],[-68.4,48.4],[-71.3,48],[-74.3,47.6],[-77.3,47.1],[-58.7,58.4],[-61.5,59.6],[-64.3,60.7],[-67.1,61.9],[-69.8,63],[-72.6,64.1],[-75.4,65.3],[-56.2,63.9],[-58.9,65.2],[-61.6,66.5],[-64.3,67.8],[-67,69],[-69.7,70.3],[-72.4,71.6],[-53.2,69.3],[-55.8,70.9],[-58.3,72.5],[-60.9,74],[-63.4,75.6],[-66,77.2],[-68.6,78.7]],"samsung":[[53,69.6],[55.6,71.2],[58.1,72.8],[60.7,74.4],[63.2,76],[65.8,77.5],[68.3,79.1],[56,64.2],[58.7,65.5],[61.4,66.8],[64.1,68.1],[66.8,69.4],[69.5,70.7],[72.2,72.1],[58.5,58.9],[61.3,60.1],[64,61.3],[66.7,62.5],[69.5,63.8],[72.2,65],[75,66.2],[59.2,48.5],[62.2,47.9],[65.1,47.4],[68.1,46.8],[71,46.3],[74,45.7],[76.9,45.2],[57.2,40.8],[60,39.8],[62.8,38.9],[65.7,37.9],[68.5,36.9],[71.4,36],[74.2,35],[53.7,32.5],[56.4,31.1],[59.1,29.8],[61.8,28.4],[64.4,27.1],[67.1,25.8],[69.8,24.4],[48.9,24.3],[51.3,22.6],[53.8,21],[56.3,19.3],[58.8,17.6],[61.3,15.9],[63.8,14.3],[44.6,18.4],[47,16.6],[49.5,14.8],[51.9,13],[54.3,11.3],[56.7,9.5],[59.1,7.7],[41.2,13.8],[43.6,12],[46,10.2],[48.4,8.4],[50.8,6.6],[53.2,4.8],[55.6,3],[37.9,9.3],[40.3,7.5],[42.7,5.8],[45.1,4],[47.6,2.2],[50,0.4],[52.4,-1.3],[36.3,7.1],[38.7,5.4],[41.2,3.6],[43.6,1.9],[46.1,0.1],[48.5,-1.6],[50.9,-3.3]]};
const NPC_ROSTER = {kt:[["투수","1 고영표,11 스기모토,12 우규민,19 배제성,29 전용주,30 소형준,36 대니엘,38 주권,41 손동현,43 로건,47 오원석,60 박영현,61 김정운"],["포수","22 장성우,42 조대현,45 한승택"],["내야수","4 오윤석,7 김상수,9 류현인,13 허경민,34 힐리어드,52 권동진,56 장준원"],["외야수","3 최원준,10 김현수,23 안현민,27 배정대,33 이정훈,51 장진혁,53 김민혁"]],
 samsung:[["투수","17 이재희,18 원태인,20 최원태,26 이승현,57 이승현,27 김태훈,28 이승민,38 임기영,42 양창섭,55 배찬승,59 페덱,60 장찬희,74 사토시,75 후라도"],["포수","24 김도환,46 장승현,47 강민호"],["내야수","0 디아즈,7 이재현,9 박계범,16 류지혁,30 김영웅,56 김상준,61 전병우"],["외야수","5 구자욱,32 김헌곤,34 최형우,39 김성윤,44 김현준,58 김지찬,66 박승규"]]};
const NPC_LOOKS = {
  kt: { uniforms: [['jj2026', 6], ['home', 5], ['away', 3], ['mil2026', 2], ['jj2025', 1], ['found-home', 1], ['black25', 1], ['victory', 1]], gear: [['none', 4], ['wizbat', 5], ['balloon', 2], ['towel', 1], ['flag', 1], ['led', 1]] },
  samsung: { uniforms: [['ss-home', 7], ['ss-away', 4], ['ss-2014h', 1], ['ss-sanb', 1], ['ss-1985', 1], ['ss-camo', 1]], gear: [['none', 4], ['towel', 4], ['balloon', 3], ['axe', 2], ['clapper', 1], ['flag', 1]] },
};
const rnd = (a, b) => a + Math.random() * (b - a);
const weighted = (list) => { let r = Math.random() * list.reduce((t, x) => t + x[1], 0); for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
function npcLook(team) {
  const L = NPC_LOOKS[team], roll = Math.random();
  let num = '', name = '';
  if (roll < 0.6) { const rows = NPC_ROSTER[team].flatMap(([, l]) => l.split(',')); const row = rows[Math.floor(Math.random() * Math.min(rows.length, roll < 0.35 ? 12 : rows.length))].split(' '); [num, name] = row; }
  else if (roll < 0.8) num = String(Math.floor(rnd(1, 100)));
  return [weighted(L.uniforms), weighted(L.gear), num, name];
}
function makeNpc(team, now) {
  const seat = NPC_SEATS[team][Math.floor(Math.random() * NPC_SEATS[team].length)];
  const x = seat[0] + rnd(-0.6, 0.6), z = seat[1] + rnd(-0.6, 0.6);
  return { id: nextId++, npc: true, team, placed: true, x, z, home: [x, z], tx: null, tz: null, yaw: Math.atan2(-x, 18 - z), cheer: 0, look: npcLook(team), rev: 1,
    nextCheer: now + rnd(2e3, 40e3), cheerUntil: 0, nextSay: now + rnd(20e3, 120e3), nextMove: now + rnd(60e3, 300e3), leaveAt: now + rnd(10, 60) * 60e3, benchSlot: 0 };
}
const npcs = {};
function fillNpcs(n, now) {
  const list = npcs[n] || (npcs[n] = new Map());
  for (const team of ['kt', 'samsung']) {
    let have = [...list.values()].filter((o) => o.team === team).length;
    while (have < NPC_COUNT[team]) { const o = makeNpc(team, now); list.set(o.id, o); have += 1; }
  }
  return list;
}
const SPEED = 1.6;
function walk(o, dt, speed = SPEED) {
  if (o.tx == null) return true;
  const dx = o.tx - o.x, dz = o.tz - o.z, d = Math.hypot(dx, dz), step = speed * dt;
  if (d <= step) { o.x = o.tx; o.z = o.tz; o.tx = o.tz = null; return true; }
  o.x += dx / d * step; o.z += dz / d * step; o.yaw = Math.atan2(dx, dz);
  return false;
}
function stepNpcs(n, bench, now, dt, live) {
  const list = fillNpcs(n, now);
  for (const o of [...list.values()]) {
    const inBench = bench.joined.has(o.id);
    if (inBench && bench.phase === 2) { if (o.tx == null) { o.tx = rnd(-4, 4); o.tz = 18.4 + rnd(-4, 4); } walk(o, dt, 7); o.cheer = 1; continue; }
    if (inBench && bench.phase === 3) {
      const side = o.team === 'kt' ? -1 : 1, i = o.benchSlot;
      o.tx = side * (4.6 + Math.floor(i / 7) * 2.2); o.tz = 11.5 + (i % 7) * 2;
      if (walk(o, dt, 5)) { o.yaw = side * -Math.PI / 2; o.cheer = Math.random() < 0.2 ? 1 : 0; }
      continue;
    }
    if (o.benchSlot && !inBench) { o.benchSlot = 0; o.tx = o.home[0]; o.tz = o.home[1]; o.speed = 5; }
    if (o.tx != null) { if (walk(o, dt, o.speed || SPEED)) { o.speed = 0; o.yaw = Math.atan2(-o.x, 18 - o.z); } continue; }
    if (now >= o.leaveAt && !inBench) { list.delete(o.id); continue; } // someone leaves, fillNpcs brings a new face
    if (o.cheer && now >= o.cheerUntil) { o.cheer = 0; o.nextCheer = now + rnd(live ? 8e3 : 20e3, live ? 40e3 : 90e3); }
    else if (!o.cheer && now >= o.nextCheer) { o.cheer = 1; o.cheerUntil = now + rnd(2e3, 9e3); }
    if (now >= o.nextSay) { o.nextSay = now + rnd(live ? 40e3 : 90e3, live ? 150e3 : 300e3); o.bubble = Math.random() < 0.15 ? 16 + Math.floor(Math.random() * 5) : (o.team === 'kt' ? 0 : 8) + Math.floor(Math.random() * 8); }
    if (now >= o.nextMove) {
      o.nextMove = now + rnd(120e3, 600e3);
      const seat = NPC_SEATS[o.team][Math.floor(Math.random() * NPC_SEATS[o.team].length)];
      if (Math.hypot(seat[0] - o.x, seat[1] - o.z) < 25) { o.tx = seat[0] + rnd(-0.6, 0.6); o.tz = seat[1] + rnd(-0.6, 0.6); o.home = [o.tx, o.tz]; }
    }
  }
  if (bench.phase === 1 && bench.npcPlan) {
    for (const p of bench.npcPlan) if (!p.done && now >= p.at) {
      p.done = true;
      const o = list.get(p.id);
      if (!o || bench.joined.size >= config.need) continue;
      bench.joined.add(o.id); o.benchSlot = 1 + [...bench.joined].filter((id) => list.get(id)?.team === o.team).length; o.tx = null;
      if (bench.joined.size >= config.need) { bench.phase = 2; bench.until = now + BENCH_FIGHT_MS; }
    }
  }
  return list;
}
function planNpcJoin(n, bench, now) {
  const list = npcs[n]; if (!list || !list.size) return;
  const pool = [...list.values()].filter((o) => o.tx == null).sort(() => Math.random() - 0.5);
  const k = Math.floor(rnd(2, config.need)); // never enough on their own: one real fan plus a few of them
  bench.npcPlan = pool.slice(0, k).map((o) => ({ id: o.id, at: now + rnd(2e3, config.gatherSec * 700) }));
}

// ---- training minigame: a daily top list per drill. Scores are checked against play time. ----
const TRAIN_MAX = [5000, 3000, 15000];
// a drill now runs until the first miss, so the check is points per second of play instead of a fixed length
const TRAIN_RATE = [2.4, 1.5, 4]; // best possible points per second, with room to spare
const TRAIN_TOP = 20, TRAIN_SHOW = 10;
function trainBoard(g) { const d = today(); if (!d.rank) d.rank = [[], [], []]; if (!d.train) d.train = [0, 0, 0]; return d.rank[g]; }
// Rankings carry a nickname typed at the end of a run. Short, letters and digits only, and checked against a word list.
const NICK_RE = /^[가-힣A-Za-z0-9]{2,8}$/;
const NICK_BLOCK = ['시발', '씨발', '씨바', '시바', '병신', '븅신', '좆', '존나', '졸라', '개새', '새끼', '섹스', '보지', '자지', '애미', '애비', '느금', '니미', '엠창', '미친', '지랄', '꺼져', '죽어', '죽여', '닥쳐', '틀딱', '한남', '한녀', '운영', '관리자', '공식', '구단', '감독', '심판', 'admin', 'fuck', 'shit', 'sex', 'bitch', 'nigger'];
let nickBlockExtra = [];
try { nickBlockExtra = JSON.parse(readFileSync(process.env.WIZ_BLOCKED_WORDS || join(process.env.DATA_DIR || '/srv/wiz', 'blocked-words.json'), 'utf8')).map((w) => String(w).toLowerCase()); } catch { /* optional private list */ }
export function nickProblem(nick) {
  if (typeof nick !== 'string' || !NICK_RE.test(nick)) return 'INVALID';
  const n = nick.toLowerCase();
  return [...NICK_BLOCK, ...nickBlockExtra].some((w) => w && n.includes(w)) ? 'BLOCKED' : '';
}
export function trainList(g, c) {
  const list = trainBoard(g);
  const mine = c.trainNick ? list.findIndex((e) => e.nick === c.trainNick) + 1 : 0;
  return ['rk', g, list.slice(0, TRAIN_SHOW).map((e) => [e.s, e.t, e.nick || '팬', e.p]), mine > 0 && mine <= TRAIN_SHOW ? mine : 0, mine];
}
// a finished run waits here until its nickname arrives
export function trainSubmit(c, g, s, who, now) {
  const started = c.trainStart?.[g];
  if (!started || s > 5 + (now - started) / 1000 * TRAIN_RATE[g]) return false;
  c.trainStart[g] = 0;
  trainBoard(g); today().train[g] += 1;
  (c.trainDone ||= [null, null, null])[g] = s > 0 ? { s, who, at: now } : null;
  return true;
}
export function trainName(c, g, nick, now) {
  const done = c.trainDone?.[g];
  if (!done || now - done.at > 10 * 60_000) return 'EXPIRED';
  const bad = nickProblem(nick); if (bad) return bad;
  c.trainDone[g] = null; c.trainNick = nick;
  const list = trainBoard(g), old = list.find((e) => (e.nick || '').toLowerCase() === nick.toLowerCase());
  if (old && old.s >= done.s) return '';
  if (old) list.splice(list.indexOf(old), 1);
  list.push({ s: done.s, t: teamOf(c), nick, p: done.who, at: now });
  list.sort((a, b) => b.s - a.s || a.at - b.at);
  list.length = Math.min(list.length, TRAIN_TOP);
  return '';
}

function noteEnter(c) { const d = today(); d.enters += 1; d.teams[c.look[0].startsWith('ss-') ? 'samsung' : 'kt'] += 1; c.enteredAt = Date.now(); }
function noteLeave(c) {
  if (!c.enteredAt) return;
  const sec = (Date.now() - c.enteredAt) / 1000, d = today();
  d.leaves += 1; d.staySec += Math.round(sec);
  d.stay[sec < 60 ? 0 : sec < 300 ? 1 : sec < 1800 ? 2 : 3] += 1;
}
function notePeak(n) { const d = today(), h = kstNow().slice(11, 13); d.peak = Math.max(d.peak, n); d.hours[h] = Math.max(d.hours[h] || 0, n); }
export function noteHit(q) {
  const d = today(), e = q.get('e');
  if (e === 'visit') {
    d.visits += 1;
    if (q.get('d') === '1') d.uniques += 1;
    if (q.get('d') === '1' && q.get('r') === '1') d.returning += 1;
    const ref = REF_SOURCES.has(q.get('s')) ? q.get('s') : 'other';
    d.refs[ref] = (d.refs[ref] || 0) + 1;
  } else if (e === 'enter') d.enterClicks += 1;
}

// ---- admin: cheer song list and event settings ----
const DATA_DIR = process.env.DATA_DIR || '/srv/wiz';
const ADMIN_PASSWORD = process.env.WIZ_ADMIN_PASSWORD || '';
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60_000;
const fails = new Map();
const here = dirname(fileURLToPath(import.meta.url));
const SEED = [{"team": "KT", "name": "최원준", "videoId": "2kJf0pbtajA", "start": 1275, "end": 1309, "note": "위즈티비 전곡 21:15"}, {"team": "KT", "name": "오윤석", "videoId": "2kJf0pbtajA", "start": 1309, "end": 1339, "note": "위즈티비 전곡 21:49"}, {"team": "KT", "name": "이강민", "videoId": "2kJf0pbtajA", "start": 1339, "end": 1375, "note": "위즈티비 전곡 22:19"}, {"team": "KT", "name": "김상수", "videoId": "2kJf0pbtajA", "start": 1375, "end": 1452, "note": "위즈티비 전곡 22:55"}, {"team": "KT", "name": "안치영", "videoId": "2kJf0pbtajA", "start": 1452, "end": 1484, "note": "위즈티비 전곡 24:12"}, {"team": "KT", "name": "류현인", "videoId": "2kJf0pbtajA", "start": 1484, "end": 1523, "note": "위즈티비 전곡 24:44"}, {"team": "KT", "name": "김현수", "videoId": "2kJf0pbtajA", "start": 1523, "end": 1560, "note": "위즈티비 전곡 25:23"}, {"team": "KT", "name": "허경민", "videoId": "2kJf0pbtajA", "start": 1560, "end": 1601, "note": "위즈티비 전곡 26:00"}, {"team": "KT", "name": "장성우", "videoId": "2kJf0pbtajA", "start": 1601, "end": 1643, "note": "위즈티비 전곡 26:41"}, {"team": "KT", "name": "안현민", "videoId": "2kJf0pbtajA", "start": 1643, "end": 1683, "note": "위즈티비 전곡 27:23"}, {"team": "KT", "name": "배정대", "videoId": "2kJf0pbtajA", "start": 1716, "end": 1752, "note": "위즈티비 전곡 28:36"}, {"team": "KT", "name": "이정훈", "videoId": "2kJf0pbtajA", "start": 1752, "end": 1785, "note": "위즈티비 전곡 29:12"}, {"team": "KT", "name": "힐리어드", "videoId": "2kJf0pbtajA", "start": 1785, "end": 1814, "note": "위즈티비 전곡 29:45"}, {"team": "KT", "name": "조대현", "videoId": "2kJf0pbtajA", "start": 1814, "end": 1851, "note": "위즈티비 전곡 30:14"}, {"team": "KT", "name": "한승택", "videoId": "2kJf0pbtajA", "start": 1851, "end": 1891, "note": "위즈티비 전곡 30:51"}, {"team": "KT", "name": "장진혁", "videoId": "2kJf0pbtajA", "start": 1891, "end": 1924, "note": "위즈티비 전곡 31:31"}, {"team": "KT", "name": "권동진", "videoId": "2kJf0pbtajA", "start": 1924, "end": 1992, "note": "위즈티비 전곡 32:04"}, {"team": "KT", "name": "김민혁", "videoId": "2kJf0pbtajA", "start": 1992, "end": 2033, "note": "위즈티비 전곡 33:12"}, {"team": "KT", "name": "강현우", "videoId": "2kJf0pbtajA", "start": 2033, "end": 2069, "note": "위즈티비 전곡 33:53"}, {"team": "KT", "name": "임상우", "videoId": "2kJf0pbtajA", "start": 2069, "end": 0, "note": "위즈티비 전곡 34:29"}, {"team": "KT", "name": "장준원", "videoId": "w9YUv1HTqhk", "start": 0, "end": 0, "note": "2023 업로드, 비공식"}, {"team": "SS", "name": "디아즈", "videoId": "HAPsuHspHn8", "start": 116, "end": 169, "note": "LionsTV 전곡 01:56"}, {"team": "SS", "name": "김재성", "videoId": "HAPsuHspHn8", "start": 169, "end": 246, "note": "LionsTV 전곡 02:49"}, {"team": "SS", "name": "이해승", "videoId": "HAPsuHspHn8", "start": 246, "end": 302, "note": "LionsTV 전곡 04:06"}, {"team": "SS", "name": "구자욱", "videoId": "HAPsuHspHn8", "start": 302, "end": 401, "note": "LionsTV 전곡 05:02"}, {"team": "SS", "name": "심재훈", "videoId": "HAPsuHspHn8", "start": 401, "end": 449, "note": "LionsTV 전곡 06:41"}, {"team": "SS", "name": "이재현", "videoId": "HAPsuHspHn8", "start": 449, "end": 499, "note": "LionsTV 전곡 07:29"}, {"team": "SS", "name": "김재혁", "videoId": "HAPsuHspHn8", "start": 499, "end": 570, "note": "LionsTV 전곡 08:19"}, {"team": "SS", "name": "이성규", "videoId": "HAPsuHspHn8", "start": 570, "end": 634, "note": "LionsTV 전곡 09:30"}, {"team": "SS", "name": "김재상", "videoId": "HAPsuHspHn8", "start": 634, "end": 687, "note": "LionsTV 전곡 10:34"}, {"team": "SS", "name": "류지혁", "videoId": "HAPsuHspHn8", "start": 687, "end": 762, "note": "LionsTV 전곡 11:27"}, {"team": "SS", "name": "이병헌", "videoId": "HAPsuHspHn8", "start": 762, "end": 816, "note": "LionsTV 전곡 12:42"}, {"team": "SS", "name": "김도환", "videoId": "HAPsuHspHn8", "start": 816, "end": 871, "note": "LionsTV 전곡 13:36"}, {"team": "SS", "name": "김태훈", "videoId": "HAPsuHspHn8", "start": 871, "end": 926, "note": "LionsTV 전곡 14:31"}, {"team": "SS", "name": "김영웅", "videoId": "HAPsuHspHn8", "start": 926, "end": 990, "note": "LionsTV 전곡 15:26"}, {"team": "SS", "name": "윤정빈", "videoId": "HAPsuHspHn8", "start": 990, "end": 1047, "note": "LionsTV 전곡 16:30"}, {"team": "SS", "name": "김헌곤", "videoId": "HAPsuHspHn8", "start": 1047, "end": 1109, "note": "LionsTV 전곡 17:27"}, {"team": "SS", "name": "최형우", "videoId": "HAPsuHspHn8", "start": 1109, "end": 1178, "note": "LionsTV 전곡 18:29"}, {"team": "SS", "name": "김성윤", "videoId": "HAPsuHspHn8", "start": 1178, "end": 1243, "note": "LionsTV 전곡 19:38"}, {"team": "SS", "name": "함수호", "videoId": "HAPsuHspHn8", "start": 1243, "end": 1292, "note": "LionsTV 전곡 20:43"}, {"team": "SS", "name": "류승민", "videoId": "HAPsuHspHn8", "start": 1292, "end": 1348, "note": "LionsTV 전곡 21:32"}, {"team": "SS", "name": "강민호", "videoId": "HAPsuHspHn8", "start": 1348, "end": 1423, "note": "LionsTV 전곡 22:28"}, {"team": "SS", "name": "이창용", "videoId": "HAPsuHspHn8", "start": 1423, "end": 1479, "note": "LionsTV 전곡 23:43"}, {"team": "SS", "name": "박세혁", "videoId": "HAPsuHspHn8", "start": 1479, "end": 1557, "note": "LionsTV 전곡 24:39"}, {"team": "SS", "name": "양우현", "videoId": "HAPsuHspHn8", "start": 1557, "end": 1608, "note": "LionsTV 전곡 25:57"}, {"team": "SS", "name": "김지찬", "videoId": "HAPsuHspHn8", "start": 1608, "end": 1668, "note": "LionsTV 전곡 26:48"}, {"team": "SS", "name": "전병우", "videoId": "HAPsuHspHn8", "start": 1668, "end": 1749, "note": "LionsTV 전곡 27:48"}, {"team": "SS", "name": "박승규", "videoId": "HAPsuHspHn8", "start": 1749, "end": 1816, "note": "LionsTV 전곡 29:09"}, {"team": "SS", "name": "박계범", "videoId": "PRnw3G-_6pQ", "start": 0, "end": 0, "note": "LionsTV 공식"}, {"team": "SS", "name": "장승현", "videoId": "3GSIxn8rjz8", "start": 0, "end": 0, "note": "업로더 자작 팬 응원가, 구장 곡 아님"}, {"team": "SS", "name": "김현준", "videoId": "WNdIbH4kGkI", "start": 44, "end": 0, "note": "2023 업로드, 비공식"}, {"team": "SS", "name": "김상준", "videoId": "HLPGuHf_fwI", "start": 0, "end": 0, "note": "AI 제작 영상, 구장 곡 아닐 수 있음"}];
let cheers = SEED;

function saveJson(name, value) {
  const file = join(DATA_DIR, name);
  writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o644 });
  renameSync(`${file}.tmp`, file);
}
function loadData() {
  try { cheers = JSON.parse(readFileSync(join(DATA_DIR, 'cheers-admin.json'), 'utf8')); } catch { /* first run uses the seed list */ }
  try { Object.assign(config, JSON.parse(readFileSync(join(DATA_DIR, 'config.json'), 'utf8'))); } catch { /* defaults */ }
  try { stats = JSON.parse(readFileSync(join(DATA_DIR, 'stats.json'), 'utf8')); } catch { /* first run */ }
  try { publishCheers(); } catch (e) { console.error('cheers write failed', e.message); }
}
function publishCheers() {
  saveJson('cheers-admin.json', cheers);
  saveJson('cheers.json', { cheers: cheers.map(({ team, name, videoId, start, end }) => ({ team, name, videoId, start, end: end || 0 })) });
}
export function validCheers(list) {
  return Array.isArray(list) && list.length <= 200 && list.every((r) => r && ['KT', 'SS'].includes(r.team)
    && typeof r.name === 'string' && r.name.length >= 1 && r.name.length <= 16
    && /^[\w-]{11}$/.test(r.videoId) && Number.isInteger(r.start) && r.start >= 0 && r.start < 36000
    && (r.end === undefined || (Number.isInteger(r.end) && r.end >= 0 && r.end < 36000 && (r.end === 0 || r.end > r.start)))
    && (r.note === undefined || (typeof r.note === 'string' && r.note.length <= 60)));
}
export function validConfig(v) {
  return v && Number.isInteger(v.need) && v.need >= 2 && v.need <= 200
    && Number.isInteger(v.gatherSec) && v.gatherSec >= 10 && v.gatherSec <= 300
    && Number.isInteger(v.cooldownSec) && v.cooldownSec >= 0 && v.cooldownSec <= 3600;
}
function authorised(req, res) {
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress);
  const rec = fails.get(ip);
  if (rec && rec.until > Date.now()) { res.writeHead(429); res.end(); return false; }
  const given = Buffer.from(req.headers.authorization?.replace(/^Basic /, '') || '', 'base64').toString();
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(`admin:${ADMIN_PASSWORD}`).digest();
  if (timingSafeEqual(a, b)) { fails.delete(ip); return true; }
  if (given) {
    const n = (rec?.n || 0) + 1;
    fails.set(ip, { n: n >= MAX_FAILS ? 0 : n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  }
  res.writeHead(401, { 'www-authenticate': 'Basic realm="wizpark"' });
  res.end();
  return false;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (d) => { size += d.length; if (size > 128 * 1024) { reject(new Error('too large')); req.destroy(); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts).toString()));
    req.on('error', reject);
  });
}
const sendJson = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
async function adminRoute(req, res) {
  const url = new URL(req.url, 'http://x'), path = url.pathname;
  if (path === '/wiz/hit') { if (req.method === 'GET') noteHit(url.searchParams); res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return; }
  if (!ADMIN_PASSWORD || !path.startsWith('/wiz/admin')) { res.writeHead(404); res.end(); return; }
  if (!authorised(req, res)) return;
  if (req.method === 'GET' && path === '/wiz/admin/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
    res.end(readFileSync(join(here, 'admin.html')));
  } else if (req.method === 'GET' && path === '/wiz/admin') {
    res.writeHead(301, { location: '/wiz/admin/' }); res.end();
  } else if (req.method === 'GET' && path === '/wiz/admin/api/state') {
    today(); sendJson(res, 200, { cheers, seed: SEED, config, online: onlineTotal(), byChannel: Object.values(channels).map((list) => list.size), benchPhase: Math.max(...Object.values(benches).map((b) => b.phase)), stats });
  } else if (req.method === 'PUT' && (path === '/wiz/admin/api/cheers' || path === '/wiz/admin/api/config')) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: 'body' }); return; }
    if (path.endsWith('cheers')) {
      if (!validCheers(body)) { sendJson(res, 400, { error: 'invalid' }); return; }
      cheers = body; publishCheers();
    } else {
      if (!validConfig(body)) { sendJson(res, 400, { error: 'invalid' }); return; }
      Object.assign(config, body); saveJson('config.json', config);
    }
    sendJson(res, 200, { ok: true });
  } else { res.writeHead(404); res.end(); }
}

function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  if (body.length > 65535) throw new Error('frame too large');
  return Buffer.concat([head, body]);
}

function send(c, value) {
  if (!c.socket.destroyed && c.socket.writableLength < BUFFER_LIMIT) c.socket.write(frame(JSON.stringify(value)));
}

function drop(c, code) {
  if (c.gone) return;
  c.gone = true;
  noteLeave(c);
  channels[c.channel]?.delete(c.id);
  if (code && !c.socket.destroyed) c.socket.end(Buffer.from([0x88, 2, code >> 8, code & 255]));
  else c.socket.destroy();
}

function finite(v, min, max) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }

export function handle(c, raw) {
  c.seen = Date.now();
  c.tokens = Math.min(12, c.tokens + (c.seen - c.last) / 1000 * 8);
  c.last = c.seen;
  if (c.tokens < 1) return;
  c.tokens -= 1;
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(m)) return;
  const bench = benches[c.channel];
  if (m[0] === 'm' && finite(m[1], -300, 300) && finite(m[2], -300, 300) && finite(m[3], -10, 10)) {
    c.x = Math.round(m[1] * 10) / 10; c.z = Math.round(m[2] * 10) / 10;
    c.yaw = Math.round(m[3] * 100) / 100; c.cheer = m[4] ? 1 : 0;
    if (c.cheer && c.placed && c.seen - (c.lastPoint || 0) >= CHEER_EVERY_MS) { c.lastPoint = c.seen; award(teamOf(c), 1); }
    if (!c.placed) noteEnter(c);
    c.placed = true;
  } else if (m[0] === 'u' && ID_RE.test(m[1]) && ID_RE.test(m[2])) {
    c.look = [m[1], m[2], typeof m[3] === 'string' && /^\d{1,2}$/.test(m[3]) ? m[3] : '', JERSEY_NAMES.has(m[4]) ? m[4] : '']; c.rev += 1;
    if (m[5] === 'kt' || m[5] === 'samsung') c.team = m[5];
  } else if (m[0] === 'b' && bench.phase < 2 && c.seen >= bench.ready) {
    if (bench.phase === 0) { bench.phase = 1; bench.until = c.seen + config.gatherSec * 1000; bench.joined.clear(); bench.result = ''; planNpcJoin(c.channel, bench, c.seen); }
    if (!bench.joined.has(c.id)) { today().bench += 1; award(teamOf(c), BENCH_JOIN_PT); }
    bench.joined.add(c.id);
    if (bench.joined.size >= config.need) { bench.phase = 2; bench.until = c.seen + BENCH_FIGHT_MS; }
  } else if (m[0] === 'tg' && Number.isInteger(m[1]) && TRAIN_MAX[m[1]] !== undefined) {
    (c.trainStart ||= [0, 0, 0])[m[1]] = c.seen;
  } else if (m[0] === 'tq' && Number.isInteger(m[1]) && TRAIN_MAX[m[1]] !== undefined) {
    send(c, trainList(m[1], c));
  } else if (m[0] === 'tr' && Number.isInteger(m[1]) && TRAIN_MAX[m[1]] !== undefined && Number.isInteger(m[2]) && m[2] >= 0 && m[2] <= TRAIN_MAX[m[1]] && JERSEY_NAMES.has(m[3])) {
    trainSubmit(c, m[1], m[2], m[3], c.seen);
    send(c, trainList(m[1], c));
  } else if (m[0] === 'tn' && Number.isInteger(m[1]) && TRAIN_MAX[m[1]] !== undefined && c.seen - (c.lastNick || 0) >= 1_000) {
    c.lastNick = c.seen;
    const bad = trainName(c, m[1], m[2], c.seen);
    send(c, bad ? ['tne', m[1], bad] : trainList(m[1], c));
  } else if (m[0] === 's' && Number.isInteger(m[1]) && m[1] >= 0 && m[1] < MESSAGE_COUNT && c.seen - c.lastMsg >= MSG_GAP_MS) {
    c.lastMsg = c.seen;
    c.bubble = m[1];
    today()[m[1] >= 16 ? 'acts' : 'msgs'] += 1;
    if (c.placed) award(teamOf(c), m[1] >= 16 ? 3 : 1);
  }
}

function neighbours(list, grid, c) {
  const cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL), near = [];
  for (let r = 0; r <= 8 && near.length < NEAR; r += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) for (let z = cz - r; z <= cz + r; z += 1) {
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r) continue;
      for (const o of grid.get(`${x},${z}`) || []) if (o !== c) near.push(o);
    }
  }
  return near.map((o) => [o, (o.x - c.x) ** 2 + (o.z - c.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, NEAR).map((p) => p[0]);
}

function stepBench(bench, list, now) {
  if (bench.phase === 2 && !bench.result) {
    const n = { kt: 0, samsung: 0 };
    for (const id of bench.joined) { const c = list.get(id); if (c) n[teamOf(c)] += 1; }
    bench.result = n.kt > n.samsung ? 'kt' : n.samsung > n.kt ? 'samsung' : 'draw';
    bench.resultAt = now;
    if (bench.result !== 'draw') award(bench.result, BENCH_WIN_PT);
  }
  if (bench.phase === 0 && bench.result && now - bench.resultAt > 60_000) bench.result = '';
  for (const id of bench.joined) if (!list.has(id) && !npcs[bench.n]?.has(id)) bench.joined.delete(id);
  if (bench.phase === 1 && (now >= bench.until || ![...bench.joined].some((id) => list.has(id)))) { bench.phase = 0; bench.joined.clear(); }
  if (bench.phase === 2 && now >= bench.until) { bench.phase = 3; bench.until = now + BENCH_SHAKE_MS; }
  if (bench.phase === 3 && now >= bench.until) { bench.phase = 0; bench.joined.clear(); bench.ready = now + config.cooldownSec * 1000; }
}

export function tick() {
  crowd = { kt: 0, samsung: 0 };
  for (const list of Object.values(channels)) for (const c of list.values()) if (c.placed) crowd[teamOf(c)] += 1;
  const now = Date.now(), dt = TICK_MS / 1000, hour = Number(kstNow().slice(11, 13)), lively = hour >= 17 && hour <= 22;
  const shown = { ...crowd };
  for (const [n, list] of Object.entries(channels)) if (list.size) { const l = fillNpcs(n, now); for (const o of l.values()) shown[o.team] += 1; }
  const sc = score(), board = (bench) => [Math.floor(sc.kt), Math.floor(sc.samsung), shown.kt, shown.samsung, bench.result, bench.resultAt];
  const benchState = (bench, c) => [bench.phase, bench.joined.size, config.need, Math.max(0, Math.ceil(((bench.phase ? bench.until : bench.ready) - Date.now()) / 1000)), [...bench.joined].indexOf(c.id) + 1, bench.phase >= 2 ? [...bench.joined].slice(0, 200) : []];
  for (const [n, list] of Object.entries(channels)) {
    if (!list.size) continue;
    const bench = benches[n];
    stepBench(bench, list, now);
    const crowdNpcs = stepNpcs(n, bench, now, dt, lively);
    const real = [...list.values()].filter((c) => c.placed), placed = [...real, ...crowdNpcs.values()];
    const grid = new Map();
    for (const c of placed) {
      const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(c);
    }
    for (const c of real) {
      const near = neighbours(list, grid, c);
      const looks = near.filter((o) => c.known.get(o.id) !== o.rev);
      for (const o of looks) c.known.set(o.id, o.rev);
      if (c.known.size > NEAR * 6) c.known = new Map(near.map((o) => [o.id, o.rev]));
      send(c, ['p', list.size + crowdNpcs.size, near.map((o) => [o.id, o.x, o.z, o.yaw, o.cheer, o.bubble ?? -1]),
        looks.map((o) => [o.id, o.look[0], o.look[1], o.look[2], o.look[3]]), benchState(bench, c), board(bench)]);
    }
    for (const c of placed) c.bubble = undefined;
  }
  notePeak(onlineTotal());
  for (const list of Object.values(channels)) for (const c of [...list.values()]) if (now - c.seen > IDLE_MS) drop(c, 4000);
}

function readFrames(c, chunk) {
  c.buffer = Buffer.concat([c.buffer, chunk]);
  while (c.buffer.length >= 2) {
    const b = c.buffer, fin = b[0] & 0x80, op = b[0] & 15, masked = b[1] & 0x80;
    let len = b[1] & 127, at = 2;
    if (!masked || !fin) return drop(c, 1002);
    if (len === 126) { if (b.length < 4) return undefined; len = b.readUInt16BE(2); at = 4; } else if (len === 127) return drop(c, 1009);
    if (len > MAX_FRAME) return drop(c, 1009);
    if (b.length < at + 4 + len) return undefined;
    const mask = b.subarray(at, at + 4), data = Buffer.from(b.subarray(at + 4, at + 4 + len));
    for (let i = 0; i < len; i += 1) data[i] ^= mask[i % 4];
    c.buffer = b.subarray(at + 4 + len);
    if (op === 8) return drop(c, 1000);
    if (op === 9) { c.seen = Date.now(); c.socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } else if (op === 1) handle(c, data.toString());
  }
  return undefined;
}

export function start(port = PORT) {
  loadData();
  const server = createServer((req, res) => { adminRoute(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const asked = url.searchParams.get('c');
    const key = req.headers['sec-websocket-key'];
    if (!(asked === 'auto' || asked === 'all' || channels[asked]) || !key || !ORIGINS.has(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const now = Date.now();
    const name = pickChannel(asked), list = channels[name];
    const c = { id: nextId++, channel: name, socket, buffer: Buffer.alloc(0), x: 0, z: 0, yaw: 0, cheer: 0, placed: false, look: ['home', 'none', '', ''], rev: 0, known: new Map(), seen: now, last: now, tokens: 12, lastMsg: 0 };
    socket.on('error', () => drop(c));
    socket.on('close', () => drop(c));
    socket.on('end', () => drop(c));
    if (!list) { send(c, ['full']); drop(c, 4001); return; }
    list.set(c.id, c);
    socket.on('data', (d) => { if (!c.gone) readFrames(c, d); });
    send(c, ['hi', c.id, list.size + (npcs[name]?.size || 0), name]);
  });
  const timer = setInterval(tick, TICK_MS);
  const save = () => { try { saveJson('stats.json', stats); } catch (e) { console.error('stats write failed', e.message); } };
  const saver = setInterval(save, 60_000);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { save(); process.exit(0); });
  server.on('close', () => { clearInterval(timer); clearInterval(saver); });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) start();
