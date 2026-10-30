import { DEFAULT_IDLE } from './room-client.js';

/**
 * RoomClient over WebSocket. Follows docs/realtime-protocol.md v0.3.
 *
 * Handles: hello/welcome, ping every heartbeatMs, claim/release with reqId,
 * booth events ordered by seq (resync on a gap), server-forced releases,
 * reconnect with exponential backoff and jitter, and positions (move, presence).
 */
const PROTOCOL_VERSION = 1;
const CLAIM_TIMEOUT_MS = 5_000;
const ACTIVITY_MIN_GAP_MS = 5_000;   // protocol: at most one activity message per 5 s
const NO_RECONNECT = new Set([1000, 4001, 4003, 4006]);

/** @returns {import('./room-client.js').RoomClient} */
export function createWsRoomClient({ url, appVersion = '0.2.0' }) {
  const changeListeners = [];
  const statusListeners = [];
  const releaseListeners = [];
  const presenceListeners = [];

  let ws = null;
  let ready = false;
  let status = { state: 'connecting', channelNo: 0 };
  let occupied = new Set();
  let lastSeq = 0;
  let heartbeat = null;
  let heartbeatMs = 10_000;
  let attempt = 0;
  let reqCounter = 0;
  let myBooth = null;
  let lastActivitySent = 0;
  const pendingClaims = new Map();   // reqId -> resolve
  const client = { idle: { ...DEFAULT_IDLE } };

  const emitChange = () => changeListeners.forEach((fn) => fn(new Set(occupied)));
  const emitPresence = (event) => presenceListeners.forEach((fn) => fn(event));
  const setStatus = (patch) => {
    status = { ...status, ...patch };
    statusListeners.forEach((fn) => fn({ ...status }));
  };
  const send = (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const nextReq = () => `r${++reqCounter}`;

  function connect() {
    ready = false;
    ws = new WebSocket(url);
    ws.onopen = () => send({ type: 'hello', v: PROTOCOL_VERSION, client: { app: 'web', version: appVersion } });
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      handle(msg);
    };
    ws.onclose = (e) => onClosed(e.code);
    ws.onerror = () => { /* onclose follows */ };
  }

  function handle(msg) {
    switch (msg.type) {
      case 'welcome': {
        ready = true;
        attempt = 0;
        heartbeatMs = msg.heartbeatMs || heartbeatMs;
        if (msg.idle) Object.assign(client.idle, msg.idle);
        applySnapshot(msg.booths, msg.seq);
        clearInterval(heartbeat);
        heartbeat = setInterval(() => send({ type: 'ping', t: Date.now() }), heartbeatMs);
        setStatus({ state: 'ready', channelNo: msg.channelNo });
        emitPresence({ kind: 'reset', you: msg.you?.pid ?? null, players: msg.players || [] });
        break;
      }
      case 'presence':
        if (ready) emitPresence({ kind: 'batch', moved: msg.moved || [], left: msg.left || [] });
        break;
      case 'snapshot':
        applySnapshot(msg.booths, msg.seq);
        break;
      case 'booth': {
        if (!ready || msg.seq <= lastSeq) return;          // older than what we already have
        const gap = msg.seq > lastSeq + 1;
        lastSeq = msg.seq;
        if (msg.state === 'free') occupied.delete(msg.boothId);
        else occupied.add(msg.boothId);
        emitChange();
        emitPresence({ kind: 'booth', boothId: msg.boothId, pid: msg.state === 'free' ? null : (msg.pid ?? null) });
        if (gap) send({ type: 'resync' });                 // we missed something; ask for full state
        break;
      }
      case 'claimResult': {
        const resolve = pendingClaims.get(msg.reqId);
        if (!resolve) return;
        pendingClaims.delete(msg.reqId);
        if (msg.ok) myBooth = msg.boothId;
        resolve(msg.ok ? { ok: true } : { ok: false, reason: msg.reason });
        break;
      }
      case 'released':
        if (msg.boothId === myBooth) myBooth = null;
        // USER is the echo of our own release; only server-side releases are news to the UI
        if (msg.reason !== 'USER') forcedRelease(msg.boothId, msg.reason);
        break;
      case 'error':
        console.warn('[realtime]', msg.code, msg.message);
        break;
      default:
        break;   // pong, notice, queue messages: not used yet
    }
  }

  function applySnapshot(booths, seq) {
    occupied = new Set([...(booths?.occupied || []), ...(booths?.reserved || [])]);
    lastSeq = seq || 0;
    emitChange();
  }

  function forcedRelease(boothId, reason) {
    releaseListeners.forEach((fn) => fn({ boothId, reason }));
  }

  function onClosed(code) {
    ready = false;
    clearInterval(heartbeat);
    // a claim in flight will never be answered by this socket
    pendingClaims.forEach((resolve) => resolve({ ok: false, reason: 'OFFLINE' }));
    pendingClaims.clear();
    // the server releases our booth when the socket drops (no resume yet)
    if (myBooth !== null) {
      const b = myBooth;
      myBooth = null;
      forcedRelease(b, 'DISCONNECTED');
    }
    if (code === 4001) { setStatus({ state: 'outdated' }); return; }
    if (NO_RECONNECT.has(code)) { setStatus({ state: 'closed' }); return; }
    setStatus({ state: 'reconnecting' });
    const delay = code === 4004 ? 30_000 : Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 1000;
    attempt += 1;
    setTimeout(connect, delay);
  }

  Object.assign(client, {
    onChange(fn) { changeListeners.push(fn); fn(new Set(occupied)); },
    onStatus(fn) { statusListeners.push(fn); fn({ ...status }); },
    onForcedRelease(fn) { releaseListeners.push(fn); },
    onPresence(fn) { presenceListeners.push(fn); },
    sharesPresence: true,

    /** My position. Rate is decided by the caller (move-sender.js); the server drops anything faster. */
    sendMove(x, z, ry) {
      if (!ready) return;
      const r2 = (v) => Math.round(v * 100) / 100;
      send({ type: 'move', x: r2(x), z: r2(z), ry: r2(ry) });
    },

    claim(boothId) {
      if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
      const reqId = nextReq();
      return new Promise((resolve) => {
        pendingClaims.set(reqId, resolve);
        send({ type: 'claim', reqId, boothId });
        setTimeout(() => {
          if (pendingClaims.delete(reqId)) resolve({ ok: false, reason: 'TIMEOUT' });
        }, CLAIM_TIMEOUT_MS);
      });
    },

    release(boothId, reason = 'USER') {
      if (myBooth === boothId) myBooth = null;
      send({ type: 'release', reqId: nextReq(), boothId, reason });
    },

    /** Typing, sending a confession, or an answer finishing. Throttled per protocol. */
    activity() {
      const now = Date.now();
      if (now - lastActivitySent < ACTIVITY_MIN_GAP_MS) return;
      lastActivitySent = now;
      send({ type: 'activity' });
    },
  });

  connect();
  return client;
}
