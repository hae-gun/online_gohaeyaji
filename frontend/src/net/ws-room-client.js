import { DEFAULT_IDLE } from './room-client.js';
import { storedName } from './names.js';
import { storedLook } from './looks.js';
import { storedFace, normalizeFace } from './faces.js';

/**
 * RoomClient over WebSocket. Follows docs/realtime-protocol.md v0.7.
 *
 * Handles: hello/welcome, ping every heartbeatMs, claim/release with reqId,
 * booth events ordered by seq (resync on a gap), server-forced releases,
 * reconnect with exponential backoff and jitter, positions (move, presence), names (rename)
 * hand-drawn faces (setFace, report, faceRemoved), emotes (emote) and the inquiry box (inquiry).
 */
const PROTOCOL_VERSION = 1;
const CLAIM_TIMEOUT_MS = 5_000;
const RENAME_TIMEOUT_MS = 5_000;
const FACE_TIMEOUT_MS = 5_000;
const REPORT_TIMEOUT_MS = 5_000;
const ACTIVITY_MIN_GAP_MS = 5_000;   // protocol: at most one activity message per 5 s
const NO_RECONNECT = new Set([1000, 4001, 4003, 4006]);

/** @returns {import('./room-client.js').RoomClient} */
export function createWsRoomClient({ url, appVersion = '0.2.0' }) {
  const changeListeners = [];
  const statusListeners = [];
  const releaseListeners = [];
  const presenceListeners = [];
  const nameListeners = [];

  let ws = null;
  let ready = false;
  let status = { state: 'connecting', channelNo: 0 };
  let occupied = new Set();
  let lastSeq = 0;
  let channel = 0;                    // the channel the last welcome was for
  const pendingChannels = new Map();   // reqId -> resolve (list or switch)
  let heartbeat = null;
  let heartbeatMs = 10_000;
  let attempt = 0;
  let reqCounter = 0;
  let myBooth = null;
  let lastActivitySent = 0;
  const pendingClaims = new Map();   // reqId -> resolve
  const pendingRenames = new Map();  // reqId -> resolve
  const pendingFaces = new Map();    // reqId -> { resolve, face }
  const pendingReports = new Map();  // reqId -> resolve
  const pendingInquiries = new Map(); // reqId -> resolve
  const faceRemovedListeners = [];
  const client = { idle: { ...DEFAULT_IDLE }, myName: storedName.load() || '', myFace: storedFace.load(), myLook: storedLook.load() || 'm' };
  const setMyName = (name) => {
    if (!name) return;
    client.myName = name;
    storedName.save(name);   // the same name comes back after a reload or reconnect
    nameListeners.forEach((fn) => fn(name));
  };

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
  /** Sends a request and resolves with its answer, or OFFLINE / TIMEOUT. */
  function ask(msg) {
    if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
    const reqId = nextReq();
    return new Promise((resolve) => {
      pendingChannels.set(reqId, resolve);
      send({ ...msg, reqId });
      setTimeout(() => {
        if (pendingChannels.delete(reqId)) resolve({ ok: false, reason: 'TIMEOUT' });
      }, 5000);
    });
  }

  function connect() {
    ready = false;
    ws = new WebSocket(url);
    ws.onopen = () => send({
      type: 'hello', v: PROTOCOL_VERSION, client: { app: 'web', version: appVersion },
      // the server keeps it if it passes its checks, otherwise hands out a random baptismal name
      ...(client.myName ? { name: client.myName } : {}),
      // the face drawn in this browser before (protocol section 15)
      ...(client.myFace ? { face: client.myFace } : {}),
      look: client.myLook,   // look code: clothes, skin tone, hair (v0.17)
    });
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
        channel = msg.channelNo;
        attempt = 0;
        heartbeatMs = msg.heartbeatMs || heartbeatMs;
        if (msg.idle) Object.assign(client.idle, msg.idle);
        applySnapshot(msg.booths, msg.seq);
        clearInterval(heartbeat);
        heartbeat = setInterval(() => send({ type: 'ping', t: Date.now() }), heartbeatMs);
        setStatus({ state: 'ready', channelNo: msg.channelNo });
        setMyName(msg.you?.name);
        emitPresence({ kind: 'reset', you: msg.you?.pid ?? null, players: msg.players || [], names: msg.names || [], faces: msg.faces || [], sitting: msg.sitting || [] });
        break;
      }
      case 'presence':
        // a late batch of the channel I just left (v0.10)
        if (msg.ch && msg.ch !== channel) return;
        if (ready) emitPresence({ kind: 'batch', moved: msg.moved || [], left: msg.left || [], named: msg.named || [], faced: msg.faced || [], emoted: msg.emoted || [] });
        break;
      case 'snapshot':
        applySnapshot(msg.booths, msg.seq);
        break;
      case 'booth': {
        if (msg.ch && msg.ch !== channel) return;
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
      case 'renameResult': {
        const resolve = pendingRenames.get(msg.reqId);
        if (!resolve) return;
        pendingRenames.delete(msg.reqId);
        if (msg.ok) setMyName(msg.name);
        resolve(msg.ok ? { ok: true, name: msg.name } : { ok: false, reason: msg.reason });
        break;
      }
      case 'faceResult': {
        const p = pendingFaces.get(msg.reqId);
        if (!p) return;
        pendingFaces.delete(msg.reqId);
        if (msg.ok) { client.myFace = p.face; storedFace.save(p.face); }
        p.resolve(msg.ok ? { ok: true } : { ok: false, reason: msg.reason });
        break;
      }
      case 'channelList':
      case 'feedbackResult':
      case 'switchResult': {
        const resolve = pendingChannels.get(msg.reqId);
        if (!resolve) return;
        pendingChannels.delete(msg.reqId);
        resolve(msg.type === 'channelList'
          ? { ok: true, current: msg.current, capacity: msg.capacity, channels: msg.channels || [] }
          : (msg.ok ? { ok: true, channelNo: msg.channelNo } : { ok: false, reason: msg.reason }));   // switchResult, feedbackResult
        break;
      }
      case 'inquiryResult': {
        const resolve = pendingInquiries.get(msg.reqId);
        if (!resolve) return;
        pendingInquiries.delete(msg.reqId);
        resolve(msg.ok ? { ok: true } : { ok: false, reason: msg.reason });
        break;
      }
      case 'reportResult': {
        const resolve = pendingReports.get(msg.reqId);
        if (!resolve) return;
        pendingReports.delete(msg.reqId);
        resolve(msg.ok ? { ok: true } : { ok: false, reason: msg.reason });
        break;
      }
      case 'faceRemoved':
        // our drawing was reported by several people and taken down
        client.myFace = null;
        storedFace.save(null);
        faceRemovedListeners.forEach((fn) => fn({ reason: msg.reason, blockedMs: msg.blockedMs }));
        break;
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
    pendingRenames.forEach((resolve) => resolve({ ok: false, reason: 'OFFLINE' }));
    pendingRenames.clear();
    pendingFaces.forEach((p) => p.resolve({ ok: false, reason: 'OFFLINE' }));
    pendingFaces.clear();
    pendingReports.forEach((resolve) => resolve({ ok: false, reason: 'OFFLINE' }));
    pendingReports.clear();
    pendingInquiries.forEach((resolve) => resolve({ ok: false, reason: 'OFFLINE' }));
    pendingInquiries.clear();
    pendingChannels.forEach((resolve) => resolve({ ok: false, reason: 'OFFLINE' }));
    pendingChannels.clear();
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
    onName(fn) { nameListeners.push(fn); if (client.myName) fn(client.myName); },

    /** Wear a hand-drawn face (null or an empty drawing = default face). */
    setFace(face) {
      const f = normalizeFace(face);
      if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
      const reqId = nextReq();
      return new Promise((resolve) => {
        pendingFaces.set(reqId, { resolve, face: f });
        send({ type: 'setFace', reqId, face: f });
        setTimeout(() => {
          const p = pendingFaces.get(reqId);
          if (p) { pendingFaces.delete(reqId); resolve({ ok: false, reason: 'TIMEOUT' }); }
        }, FACE_TIMEOUT_MS);
      });
    },

    /** Tell the channel I started an emote (protocol section 16). No answer comes back. */
    sendEmote(id, at) {
      // sitting carries the seat (x, z, ry) so the server places me exactly there (v0.9)
      if (ready) send({ type: 'emote', id, ...(at || {}) });
    },

    /** Report the drawing another player (pid) wears. */
    report(pid) {
      if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
      const reqId = nextReq();
      return new Promise((resolve) => {
        pendingReports.set(reqId, resolve);
        send({ type: 'report', reqId, pid });
        setTimeout(() => {
          if (pendingReports.delete(reqId)) resolve({ ok: false, reason: 'TIMEOUT' });
        }, REPORT_TIMEOUT_MS);
      });
    },
    onFaceRemoved(fn) { faceRemovedListeners.push(fn); },

    /** Open channels and how many people are in each (protocol section 18). */
    listChannels() {
      return ask({ type: 'channels' });
    },
    /** Move to another open channel. A fresh welcome (reset) follows on success. */
    switchChannel(channelNo) {
      return ask({ type: 'switchChannel', channelNo });
    },
    canSwitchChannel: true,

    /**
     * A confession the person agreed to send after an answer that missed (protocol section 19).
     * @param {{ reason: string, text: string, persona: string, category: string, answer: string }} f
     */
    sendFeedback(f) {
      return ask({ type: 'feedback', ...f });
    },

    /** A message for the site's admins from the box in the confession hall (protocol section 17). */
    sendInquiry(kind, text) {
      if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
      const reqId = nextReq();
      return new Promise((resolve) => {
        pendingInquiries.set(reqId, resolve);
        send({ type: 'inquiry', reqId, kind, text });
        setTimeout(() => {
          if (pendingInquiries.delete(reqId)) resolve({ ok: false, reason: 'TIMEOUT' });
        }, REPORT_TIMEOUT_MS);
      });
    },

    /** Usage statistics (protocol section 20, net/track.js). @returns false when not connected (kept for later) */
    sendTrack(payload) {
      if (!ready) return false;
      send({ type: 'track', ...payload });
      return true;
    },

    /** 형제님 'm' or 자매님 'f'. Applied here at once; the server passes it on (no reply). */
    setLook(look) {
      client.myLook = look;
      storedLook.save(look);
      if (ready) send({ type: 'setLook', look });
    },

    /** Ask the server for a new display name. Resolves with the name it accepted, or why not. */
    rename(name) {
      if (!ready) return Promise.resolve({ ok: false, reason: 'OFFLINE' });
      const reqId = nextReq();
      return new Promise((resolve) => {
        pendingRenames.set(reqId, resolve);
        send({ type: 'rename', reqId, name });
        setTimeout(() => {
          if (pendingRenames.delete(reqId)) resolve({ ok: false, reason: 'TIMEOUT' });
        }, RENAME_TIMEOUT_MS);
      });
    },
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
