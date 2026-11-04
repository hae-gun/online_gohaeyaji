/**
 * Anonymous usage statistics (protocol section 20, docs/analytics.md).
 *
 * Small events ("entered a booth", "travelled to the nave") go to the server in batches over the
 * WebSocket that is already open, and the rest with navigator.sendBeacon when the page is hidden
 * or closed. Each event carries:
 *   vid  a random id made once and kept in this browser (tells returning visitors apart)
 *   sid  a random id for this visit
 * Never an IP, a confession, a name or a drawing: only short ids and numbers, and the server keeps
 * only the keys it knows (TrackSchema).
 *
 * "이용 통계 보내지 않기" (opt-out) is remembered in this browser; then nothing is sent at all.
 */
const VID_KEY = 'gohaeyaji-vid';
const OFF_KEY = 'gohaeyaji-no-track';
const MAX_BATCH = 15;          // same as gohaeyaji.track.max-batch
const MAX_QUEUE = 60;          // offline for long: the oldest are dropped
const FLUSH_MS = 5000;
const MAX_BYTES = 1800;        // a message must stay under the server's 2 KB limit

function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function storage(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

/** Where people came from, as one short id (never the full address). */
export function sourceOf(referrer = document.referrer, ua = navigator.userAgent, search = location.search) {
  const utm = new URLSearchParams(search).get('utm_source');
  if (utm) {
    const id = utm.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
    if (id) return id;
  }
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/FBAN|FBAV/i.test(ua)) return 'facebook';
  if (/Threads/i.test(ua)) return 'threads';
  if (/NAVER/i.test(ua)) return 'naver';
  let host = '';
  try { host = referrer ? new URL(referrer).hostname : ''; } catch (_) { host = ''; }
  if (!host) return 'direct';
  if (typeof location !== 'undefined' && host === location.hostname) return 'self';
  const known = [['instagram', 'instagram'], ['threads', 'threads'], ['facebook', 'facebook'], ['kakao', 'kakao'],
    ['naver', 'naver'], ['google', 'google'], ['daum', 'daum'], ['youtube', 'youtube'], ['t.co', 'x'], ['twitter', 'x'], ['x.com', 'x']];
  const hit = known.find(([k]) => host.includes(k));
  return hit ? hit[1] : 'other';
}

export function deviceOf(ua = navigator.userAgent) {
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  return /Mobi|Android|iPhone/i.test(ua) ? 'mobile' : 'pc';
}

export const inAppOf = (ua = navigator.userAgent) => /Instagram|FBAN|FBAV|KAKAOTALK|Line\/|NAVER|Threads/i.test(ua);

/**
 * @param {{ send(payload: object): boolean, beaconUrl?: string|null }} opts
 *   send: hands a batch to the open WebSocket; false when not connected (kept for later)
 */
export function createTracker({ send, beaconUrl = null }) {
  let off = storage(() => localStorage.getItem(OFF_KEY) === '1', false);
  let first = false;
  const vid = storage(() => {
    let v = localStorage.getItem(VID_KEY);
    if (!/^[0-9a-f]{32}$/.test(v || '')) {
      v = randomId();
      localStorage.setItem(VID_KEY, v);
      first = true;
    }
    return v;
  }, null) || randomId();   // storage blocked: a new id each visit
  const sid = randomId();
  const started = Date.now();
  let queue = [];
  let lastPlace = '';

  /** Cuts the queue into payloads that fit one message. */
  function takeBatch() {
    const events = [];
    while (queue.length && events.length < MAX_BATCH) {
      events.push(queue[0]);
      if (JSON.stringify({ type: 'track', vid, sid, events }).length > MAX_BYTES) { events.pop(); break; }
      queue.shift();
    }
    return events;
  }

  function flush() {
    if (off) { queue = []; return; }
    while (queue.length) {
      const before = queue.slice();
      const events = takeBatch();
      if (!events.length) { queue.shift(); continue; }   // one event too big on its own: drop it
      if (!send({ vid, sid, events })) { queue = before; return; }   // not connected: try again later
    }
  }

  /** The page is going away (or to the background): what is left goes by beacon. */
  function beacon() {
    if (off || !queue.length) return;
    if (!beaconUrl || !navigator.sendBeacon) { flush(); return; }
    while (queue.length) {
      const events = takeBatch();
      if (!events.length) { queue.shift(); continue; }
      // text/plain: a simple request, so no CORS preflight (TrackController)
      try { navigator.sendBeacon(beaconUrl, JSON.stringify({ vid, sid, events })); } catch (_) { return; }
    }
  }

  setInterval(flush, FLUSH_MS);
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    api.track('session_end', { sec: Math.min(86400, Math.round((Date.now() - started) / 1000)), place: lastPlace || 'intro' });
    beacon();
  });
  addEventListener('pagehide', beacon);

  const api = {
    vid, sid, first,
    get off() { return off; },
    /** Turns statistics off or on for this browser. */
    setOff(v) {
      off = !!v;
      storage(() => (off ? localStorage.setItem(OFF_KEY, '1') : localStorage.removeItem(OFF_KEY)), null);
      if (off) queue = [];
    },
    /** @param {string} type  @param {Record<string, string|number|boolean>} [p] */
    track(type, p = {}) {
      if (off) return;
      if (import.meta.env && import.meta.env.DEV) console.debug('[track]', type, JSON.stringify(p));   // npm run dev only
      if (p.place) lastPlace = p.place;
      queue.push({ type, p });
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      if (queue.length >= MAX_BATCH) flush();
    },
    /** Seconds since the page opened. */
    since() { return Math.round((Date.now() - started) / 1000); },
    flush,
  };
  return api;
}

/** wss://host/ws -> https://host/api/track (null without a server). */
export function beaconUrlFor(realtimeUrl) {
  if (!realtimeUrl) return null;
  try {
    const u = new URL(realtimeUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/api/track';
    u.search = '';
    return u.toString();
  } catch (_) {
    return null;
  }
}
