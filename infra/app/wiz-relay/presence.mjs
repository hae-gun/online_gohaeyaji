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
const newBench = () => ({ phase: 0, joined: new Set(), until: 0, ready: 0 }); // 0 idle, 1 gathering, 2 brawl, 3 handshake

const channels = {}, benches = {};
for (let n = 1; n <= MAX_CHANNELS; n += 1) { channels[n] = new Map(); benches[n] = newBench(); }
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
    if (!c.placed) noteEnter(c);
    c.placed = true;
  } else if (m[0] === 'u' && ID_RE.test(m[1]) && ID_RE.test(m[2])) {
    c.look = [m[1], m[2], typeof m[3] === 'string' && /^\d{1,2}$/.test(m[3]) ? m[3] : '', JERSEY_NAMES.has(m[4]) ? m[4] : '']; c.rev += 1;
  } else if (m[0] === 'b' && bench.phase < 2 && c.seen >= bench.ready) {
    if (bench.phase === 0) { bench.phase = 1; bench.until = c.seen + config.gatherSec * 1000; bench.joined.clear(); }
    if (!bench.joined.has(c.id)) today().bench += 1;
    bench.joined.add(c.id);
    if (bench.joined.size >= config.need) { bench.phase = 2; bench.until = c.seen + BENCH_FIGHT_MS; }
  } else if (m[0] === 's' && Number.isInteger(m[1]) && m[1] >= 0 && m[1] < MESSAGE_COUNT && c.seen - c.lastMsg >= MSG_GAP_MS) {
    c.lastMsg = c.seen;
    c.bubble = m[1];
    today()[m[1] >= 16 ? 'acts' : 'msgs'] += 1;
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
  for (const id of bench.joined) if (!list.has(id)) bench.joined.delete(id);
  if (bench.phase === 1 && (now >= bench.until || bench.joined.size === 0)) { bench.phase = 0; bench.joined.clear(); }
  if (bench.phase === 2 && now >= bench.until) { bench.phase = 3; bench.until = now + BENCH_SHAKE_MS; }
  if (bench.phase === 3 && now >= bench.until) { bench.phase = 0; bench.joined.clear(); bench.ready = now + config.cooldownSec * 1000; }
}

export function tick() {
  const benchState = (bench, c) => [bench.phase, bench.joined.size, config.need, Math.max(0, Math.ceil(((bench.phase ? bench.until : bench.ready) - Date.now()) / 1000)), [...bench.joined].indexOf(c.id) + 1, bench.phase >= 2 ? [...bench.joined].slice(0, 200) : []];
  for (const [n, list] of Object.entries(channels)) {
    const bench = benches[n];
    stepBench(bench, list, Date.now());
    const placed = [...list.values()].filter((c) => c.placed);
    const grid = new Map();
    for (const c of placed) {
      const key = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(c);
    }
    for (const c of placed) {
      const near = neighbours(list, grid, c);
      const looks = near.filter((o) => c.known.get(o.id) !== o.rev);
      for (const o of looks) c.known.set(o.id, o.rev);
      if (c.known.size > NEAR * 6) c.known = new Map(near.map((o) => [o.id, o.rev]));
      send(c, ['p', list.size, near.map((o) => [o.id, o.x, o.z, o.yaw, o.cheer, o.bubble ?? -1]),
        looks.map((o) => [o.id, o.look[0], o.look[1], o.look[2], o.look[3]]), benchState(bench, c)]);
    }
    for (const c of placed) c.bubble = undefined;
  }
  notePeak(onlineTotal());
  const now = Date.now();
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
    send(c, ['hi', c.id, list.size, name]);
  });
  const timer = setInterval(tick, TICK_MS);
  const save = () => { try { saveJson('stats.json', stats); } catch (e) { console.error('stats write failed', e.message); } };
  const saver = setInterval(save, 60_000);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { save(); process.exit(0); });
  server.on('close', () => { clearInterval(timer); clearInterval(saver); });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) start();
