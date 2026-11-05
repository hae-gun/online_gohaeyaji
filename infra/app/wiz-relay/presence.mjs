// Temporary presence server for the Magic Wiz Park page. Delete after the series.
// One shared park of up to 2000 people. Each client hears only its nearest neighbours, twice a second,
// so traffic grows with the audience instead of with its square. No free text is ever accepted.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

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
const BENCH_NEED = Number(process.env.BENCH_NEED || 5);
const BENCH_GATHER_MS = 45_000;
const BENCH_FIGHT_MS = 12_000;
const BENCH_SHAKE_MS = 7_000;
const BENCH_COOLDOWN_MS = Number(process.env.BENCH_COOLDOWN_MS || 180_000);
const bench = { phase: 0, joined: new Set(), until: 0, ready: 0 }; // 0 idle, 1 gathering, 2 brawl, 3 handshake

const channels = Object.fromEntries(CHANNELS.map((c) => [c, new Map()]));
let nextId = 1;

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
    c.yaw = Math.round(m[3] * 100) / 100; c.cheer = m[4] ? 1 : 0; c.placed = true;
  } else if (m[0] === 'u' && ID_RE.test(m[1]) && ID_RE.test(m[2])) {
    c.look = [m[1], m[2]]; c.rev += 1;
  } else if (m[0] === 'b' && bench.phase < 2 && c.seen >= bench.ready) {
    if (bench.phase === 0) { bench.phase = 1; bench.until = c.seen + BENCH_GATHER_MS; bench.joined.clear(); }
    bench.joined.add(c.id);
    if (bench.joined.size >= BENCH_NEED) { bench.phase = 2; bench.until = c.seen + BENCH_FIGHT_MS; }
  } else if (m[0] === 's' && Number.isInteger(m[1]) && m[1] >= 0 && m[1] < MESSAGE_COUNT && c.seen - c.lastMsg >= MSG_GAP_MS) {
    c.lastMsg = c.seen;
    c.bubble = m[1];
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
  if (bench.phase === 3 && now >= bench.until) { bench.phase = 0; bench.joined.clear(); bench.ready = now + BENCH_COOLDOWN_MS; }
}

export function tick() {
  stepBench(Date.now());
  const benchState = (c) => [bench.phase, bench.joined.size, BENCH_NEED, Math.max(0, Math.ceil((bench.until - Date.now()) / 1000)), bench.joined.has(c.id) ? 1 : 0];
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
  const server = createServer((_, res) => { res.writeHead(404); res.end(); });
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
  server.on('close', () => clearInterval(timer));
  return new Promise((r) => server.listen(port, () => r(server)));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) start();
