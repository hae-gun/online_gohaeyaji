// Temporary presence server for the Magic Wiz Park page. Delete after the series.
// One shared park of up to 2000 people. Each client hears only its nearest neighbours, twice a second,
// so traffic grows with the audience instead of with its square. No free text is ever accepted.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8090);
const CHANNELS = ['all'];
const CAP = Number(process.env.CHANNEL_CAP || 2000);
const NEAR = Number(process.env.NEAR || 40);
const TICK_MS = 500;
const CELL = 40;
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://wiz.gohaeyaji.com,https://hae-gun.github.io,http://localhost:8000').split(','));
const ID_RE = /^[a-z0-9-]{1,16}$/;
const MAX_FRAME = 256;
const IDLE_MS = 60_000;
const MSG_GAP_MS = 2_000;
const BUFFER_LIMIT = 64 * 1024;
const MESSAGE_COUNT = 21; // 8 KT messages, 8 Samsung messages, 5 big reactions
const config = { need: Number(process.env.BENCH_NEED || 5), gatherSec: 30, cooldownSec: Number(process.env.BENCH_COOLDOWN_MS || 30_000) / 1000 };
const BENCH_FIGHT_MS = 16_000; // about 5s of that is fans running in from the stands
const BENCH_SHAKE_MS = 7_000;
const bench = { phase: 0, joined: new Set(), until: 0, ready: 0 }; // 0 idle, 1 gathering, 2 brawl, 3 handshake

const channels = Object.fromEntries(CHANNELS.map((c) => [c, new Map()]));
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
const SEED = [{"team": "KT", "name": "최원준", "videoId": "7N2QcJ6bIRU", "start": 0, "note": "2026, 등장곡 포함"}, {"team": "KT", "name": "김민혁", "videoId": "WJimV9xauKA", "start": 0, "note": "2025 치어리더 직캠"}, {"team": "KT", "name": "안현민", "videoId": "ROC9t1m_X70", "start": 0, "note": "2026 치어리더 직캠"}, {"team": "KT", "name": "힐리어드", "videoId": "2kJf0pbtajA", "start": 1785, "end": 1855, "note": "공식 전곡 29:45"}, {"team": "KT", "name": "김현수", "videoId": "2kJf0pbtajA", "start": 1523, "end": 1593, "note": "공식 전곡 25:23"}, {"team": "KT", "name": "허경민", "videoId": "Yb0UeA1Mp-c", "start": 0, "note": "2025 관중"}, {"team": "KT", "name": "김상수", "videoId": "dUAzZ4xFgh4", "start": 0, "note": "2026 치어리더 직캠"}, {"team": "SS", "name": "김지찬", "videoId": "ZgsjF9aNDK0", "start": 0, "note": "2026 쇼츠 직캠"}, {"team": "SS", "name": "박승규", "videoId": "HpI8Zb-AZ5k", "start": 0, "note": "공식"}, {"team": "SS", "name": "구자욱", "videoId": "LINJoA_Dnr4", "start": 0, "note": "2024 관중"}, {"team": "SS", "name": "디아즈", "videoId": "NxW7toGTejU", "start": 0, "note": "2024"}, {"team": "SS", "name": "김영웅", "videoId": "rf400n5awmk", "start": 0, "note": "KBO 공식, 관중 떼창"}, {"team": "SS", "name": "류지혁", "videoId": "YTSrmx6Z3Do", "start": 0, "note": "2025 현장 추정"}, {"team": "SS", "name": "이재현", "videoId": "XB3ZJY_RVWQ", "start": 0, "note": "2023 직캠"}];
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
    today(); sendJson(res, 200, { cheers, config, online: channels.all.size, benchPhase: bench.phase, stats });
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
  if (m[0] === 'm' && finite(m[1], -300, 300) && finite(m[2], -300, 300) && finite(m[3], -10, 10)) {
    c.x = Math.round(m[1] * 10) / 10; c.z = Math.round(m[2] * 10) / 10;
    c.yaw = Math.round(m[3] * 100) / 100; c.cheer = m[4] ? 1 : 0;
    if (!c.placed) noteEnter(c);
    c.placed = true;
  } else if (m[0] === 'u' && ID_RE.test(m[1]) && ID_RE.test(m[2])) {
    c.look = [m[1], m[2]]; c.rev += 1;
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

function stepBench(now) {
  for (const id of bench.joined) if (!channels.all.has(id)) bench.joined.delete(id);
  if (bench.phase === 1 && (now >= bench.until || bench.joined.size === 0)) { bench.phase = 0; bench.joined.clear(); }
  if (bench.phase === 2 && now >= bench.until) { bench.phase = 3; bench.until = now + BENCH_SHAKE_MS; }
  if (bench.phase === 3 && now >= bench.until) { bench.phase = 0; bench.joined.clear(); bench.ready = now + config.cooldownSec * 1000; }
}

export function tick() {
  stepBench(Date.now());
  const benchState = (c) => [bench.phase, bench.joined.size, config.need, Math.max(0, Math.ceil(((bench.phase ? bench.until : bench.ready) - Date.now()) / 1000)), [...bench.joined].indexOf(c.id) + 1, bench.phase >= 2 ? [...bench.joined].slice(0, 200) : []];
  for (const list of Object.values(channels)) {
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
        looks.map((o) => [o.id, o.look[0], o.look[1]]), benchState(c)]);
    }
    for (const c of placed) c.bubble = undefined;
  }
  notePeak(channels.all.size);
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
    const name = url.searchParams.get('c');
    const list = channels[name];
    const key = req.headers['sec-websocket-key'];
    if (!list || !key || !ORIGINS.has(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const now = Date.now();
    const c = { id: nextId++, channel: name, socket, buffer: Buffer.alloc(0), x: 0, z: 0, yaw: 0, cheer: 0, placed: false, look: ['home', 'none'], rev: 0, known: new Map(), seen: now, last: now, tokens: 12, lastMsg: 0 };
    socket.on('error', () => drop(c));
    socket.on('close', () => drop(c));
    if (list.size >= CAP) { send(c, ['full']); drop(c, 4001); return; }
    list.set(c.id, c);
    socket.on('data', (d) => { if (!c.gone) readFrames(c, d); });
    send(c, ['hi', c.id, list.size]);
  });
  const timer = setInterval(tick, TICK_MS);
  const save = () => { try { saveJson('stats.json', stats); } catch (e) { console.error('stats write failed', e.message); } };
  const saver = setInterval(save, 60_000);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { save(); process.exit(0); });
  server.on('close', () => { clearInterval(timer); clearInterval(saver); });
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) start();
