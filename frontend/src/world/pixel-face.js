import * as THREE from 'three';
import { paintFace, FACE_SIZE } from '../net/faces.js';

/**
 * Round, soft faces. The built-in faces (priests, default kids) are drawn as smooth shapes
 * (drawVector), so there are no visible pixels at any distance. A hand-drawn face stays a dot
 * grid (FACE_SIZE, the same grid people draw on and the server checks) but is painted round:
 * every dot becomes a blob joined to its neighbours (smoothFace). Either way the face wraps onto
 * the front of a round head (faceCap). The eyes are still a little uneven on purpose.
 *
 * A face is redrawn only when its state changes:
 *   eyes:  'open' | 'closed' | 'squint' | 'happy' (^^) | 'wide'
 *   brows: 'neutral' | 'up' | 'worried' | 'stern'
 *   mouth: 0 (closed) .. 3 (wide open), smile: -1 (frown) | 0 | 1
 *   blush: true for the angry red cheeks
 *
 * A kid can also wear a hand-drawn face (protocol section 15): setCustom(code) shows that drawing,
 * smoothed, instead of the generated one.
 */
const K = '#151010';
const LIP = '#5a2b22';
const RED = '#8a1c16';
const TONGUE = '#e46a6a';
const WHITE = '#ffffff';

/** Per-look features. Priest looks: jin, eom, yu, baek. Kids: kid (eyes vary by o.variant). */
const STYLES = {
  jin:  { brow: '#5f5a55', browW: 4, browH: 1, glasses: 'round', eyeR: 1.9 },
  eom:  { brow: '#141010', browW: 6, browH: 2.6, mono: true, moustache: '#f2eee6', eyeR: 1.6 },
  yu:   { brow: '#4a2e1c', browW: 4, browH: 1, cheeks: '#f07a8a', bigEyes: true, grin: true },
  // the legend smiles with his eyes unless something else is going on
  baek: { brow: '#f4f1ea', browW: 6, browH: 2, droop: true, moustache: '#f4f1ea', eyeR: 1.6, kindEyes: true },
  kid:  { brow: null, bigEyes: true },
};
/** Soft blush everyone gets, under any style's own cheeks. */
const BLUSH = 'rgba(244,120,140,.45)';

/** Painted face resolution: 256 px, enough to stay smooth up close. */
const OUT = 256;

/**
 * Repaints a dot grid (src, usually 32x32) into dst as round, joined strokes: each dot is a circle
 * and every dot is linked to same-coloured neighbours (also diagonally) with a dot-wide round
 * line. Single dots become round dots, lines become smooth strokes, blocks get rounded corners.
 * Colours are painted in the order they first appear, so later details sit on top.
 * @param {HTMLCanvasElement} src
 * @param {HTMLCanvasElement} dst
 */
export function smoothFace(src, dst) {
  const W = src.width, H = src.height, S = dst.width / W;
  const d = src.getContext('2d').getImageData(0, 0, W, H).data;
  const g = dst.getContext('2d');
  g.clearRect(0, 0, dst.width, dst.height);
  const key = new Int32Array(W * H).fill(-1);
  const order = [], cells = new Map();
  for (let i = 0; i < W * H; i++) {
    if (d[i * 4 + 3] < 128) continue;
    const k = (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2];
    key[i] = k;
    if (!cells.has(k)) { cells.set(k, []); order.push(k); }
    cells.get(k).push(i);
  }
  g.lineCap = 'round';
  g.lineWidth = S;
  for (const k of order) {
    const col = `rgb(${k >> 16},${(k >> 8) & 255},${k & 255})`;
    g.fillStyle = g.strokeStyle = col;
    g.beginPath();
    for (const i of cells.get(k)) {
      const cx = (i % W + 0.5) * S, cy = (Math.floor(i / W) + 0.5) * S;
      g.moveTo(cx + S / 2, cy);
      g.arc(cx, cy, S / 2, 0, Math.PI * 2);
    }
    g.fill();
    g.beginPath();
    for (const i of cells.get(k)) {
      const x = i % W, y = Math.floor(i / W);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny >= H || key[ny * W + nx] !== k) continue;
        // a diagonal link only where it is not already joined by a straight path (keeps corners crisp)
        if (dx && dy && (key[y * W + nx] === k || key[ny * W + x] === k)) continue;
        g.moveTo((x + 0.5) * S, (y + 0.5) * S);
        g.lineTo((nx + 0.5) * S, (ny + 0.5) * S);
      }
    }
    g.stroke();
  }
}

/**
 * A curved patch on the front of a sphere of radius r, about `size` wide, for the face to sit on
 * so it follows the head instead of floating in front of it. Add it to the head mesh itself so it
 * takes the head's squash and stretch. dropY moves the face down by that fraction of r.
 */
export function faceCap(r, size, dropY = 0.05) {
  const span = 2 * Math.asin(Math.min(0.95, size / 2 / r));
  return new THREE.SphereGeometry(r * 1.012, 28, 28,
    Math.PI / 2 - span / 2, span, Math.PI / 2 + dropY - span / 2, span);
}

// The built-in faces are drawn as smooth shapes in a 32 x 32 design space (scaled up to OUT),
// so they stay crisp at any size. Hand-drawn faces go through smoothFace instead.
// baby-face layout: eyes low and wide apart, a small mouth close under them
const EYE = [[9.5, 16.5], [22.5, 16]];   // uneven on purpose: the left eye sits a little lower

function line(g, col, w, pts, close = false) {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
  g.stroke();
}
function curve(g, col, w, a, ctrl, b) {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(ctrl[0], ctrl[1], b[0], b[1]); g.stroke();
}
function dot(g, col, x, y, r) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function oval(g, col, x, y, rx, ry, rot = 0) { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); }
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function vBrows(g, st, s) {
  if (!st.brow) return;
  const tilt = { neutral: 0, up: 0, worried: 1.8, stern: -1.8 }[s.brows] ?? 0;
  const lift = s.brows === 'up' ? -1.8 : 0;
  const w = Math.max(1.1, st.browH * 0.9);
  const inner = [];
  EYE.forEach(([ex, ey], i) => {
    const o = i === 0 ? -1 : 1;
    const y0 = ey - 5 + lift;
    const a = [ex - o * 1.2, y0 - tilt];
    const b = [ex + o * (st.browW - 2.2), y0 + (st.droop ? st.browW / 3 : 0)];
    inner.push(a);
    // a slight arch reads friendlier than a straight bar
    curve(g, st.brow, w, a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 0.8], b);
  });
  if (st.mono) line(g, st.brow, w, [inner[0], inner[1]]);
}

function vEyes(g, st, s, variant) {
  EYE.forEach(([ex, ey], i) => {
    if (s.eyes === 'closed') { curve(g, K, 1.1, [ex - 2.2, ey], [ex, ey + 1.4], [ex + 2.2, ey]); return; }
    if (s.eyes === 'happy') { curve(g, K, 1.15, [ex - 2.3, ey + 1], [ex, ey - 2.4], [ex + 2.3, ey + 1]); return; }
    if (s.eyes === 'squint') { curve(g, K, 1.15, [ex - 2.3, ey + 0.6], [ex, ey - 1], [ex + 2.3, ey + 0.6]); return; }
    const look = variant === 'derpy' ? (i === 0 ? [-0.8, -0.8] : [0.8, 0.8]) : [0, 0];
    if (st.kindEyes && s.eyes === 'open') { curve(g, K, 1.15, [ex - 2.1, ey + 0.8], [ex, ey - 1.8], [ex + 2.1, ey + 0.8]); return; }
    if (st.bigEyes || s.eyes === 'wide') {
      // big glossy eyes: a dark iris filling most of the white, two shine dots
      const r = s.eyes === 'wide' ? 3.6 : 3;
      dot(g, K, ex, ey, r + 0.3);
      dot(g, WHITE, ex, ey, r);
      dot(g, '#2a1d18', ex + look[0], ey + look[1], r * 0.68);
      dot(g, WHITE, ex + look[0] + r * 0.25, ey + look[1] - r * 0.28, r * 0.24);
      dot(g, WHITE, ex + look[0] - r * 0.22, ey + look[1] + r * 0.25, r * 0.1);
    } else {
      // bead eyes with a shine
      const r = st.eyeR || 1.7;
      dot(g, K, ex, ey, r);
      dot(g, WHITE, ex + r * 0.3, ey - r * 0.35, r * 0.32);
    }
  });
  if (st.glasses === 'round') {
    EYE.forEach(([ex, ey]) => { g.strokeStyle = K; g.lineWidth = 0.9; g.beginPath(); g.arc(ex, ey, 4.3, 0, Math.PI * 2); g.stroke(); });
    curve(g, K, 0.9, [EYE[0][0] + 4.2, EYE[0][1] - 0.6], [16, 14.6], [EYE[1][0] - 4.2, EYE[1][1] - 0.4]);
  }
}

function vMouth(g, st, s) {
  const cx = 16, y = 21.5, w = st.grin ? 6.5 : 4.2, x0 = cx - w / 2;
  if (s.mouth > 0) {
    const h = 0.8 + s.mouth * 1.5;
    g.fillStyle = K; roundRect(g, x0 - 0.6, y - 0.6, w + 1.2, h + 1.2, (h + 1.2) / 2.2); g.fill();
    g.fillStyle = RED; roundRect(g, x0, y, w, h, h / 2.2); g.fill();
    if (h >= 4) { g.save(); roundRect(g, x0, y, w, h, h / 2.2); g.clip(); oval(g, TONGUE, cx, y + h, w * 0.32, 1.6); g.restore(); }
    if (st.grin) { g.save(); roundRect(g, x0, y, w, h, h / 2.2); g.clip(); g.fillStyle = WHITE; g.fillRect(x0, y, w, 1); g.restore(); }
  } else if (st.grin && s.smile >= 0) {
    // the humorous priest's resting face is already a D-shaped grin
    g.beginPath(); g.moveTo(x0, y - 0.6); g.lineTo(x0 + w, y - 0.6); g.quadraticCurveTo(cx, y + 4.4, x0, y - 0.6); g.closePath();
    g.fillStyle = RED; g.fill(); g.strokeStyle = K; g.lineWidth = 0.8; g.lineJoin = 'round'; g.stroke();
  } else {
    // a small soft smile by default; neutral faces still curve up a little
    const bend = s.smile > 0 ? 1.8 : s.smile < 0 ? -1.3 : 0.9;
    curve(g, LIP, 0.95, [x0, y + 0.5 - bend * 0.5], [cx, y + 0.5 + bend], [x0 + w, y + 0.5 - bend * 0.5]);
  }
  if (st.moustache) {
    // two puffy lobes drooping at the ends; it jumps up a little when the mouth opens
    const my = y - 1.6 - (s.mouth > 0 ? 0.8 : 0);
    oval(g, st.moustache, 13.2, my, 3.6, 1.7, -0.32);
    oval(g, st.moustache, 18.8, my, 3.6, 1.7, 0.32);
  }
}

function drawVector(g, st, s, variant) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, OUT, OUT);
  g.setTransform(OUT / 32, 0, 0, OUT / 32, 0, 0);
  oval(g, BLUSH, 6.2, 20.4, 2.9, 1.8); oval(g, BLUSH, 25.8, 20, 2.9, 1.8);
  if (st.cheeks) { oval(g, st.cheeks, 6.2, 20.4, 2.9, 1.9); oval(g, st.cheeks, 25.8, 20, 2.9, 1.9); }
  if (s.blush) { oval(g, 'rgba(226,69,58,.85)', 6.2, 20.2, 2.8, 1.7); oval(g, 'rgba(226,69,58,.85)', 25.8, 19.8, 2.8, 1.7); }
  vBrows(g, st, s);
  vEyes(g, st, s, variant);
  vMouth(g, st, s);
  if (variant === 'sleepy') { g.fillStyle = '#9ec8ff'; g.beginPath(); g.moveTo(26, 18.4); g.quadraticCurveTo(27.4, 21, 26, 21.8); g.quadraticCurveTo(24.6, 21, 26, 18.4); g.fill(); }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * @param {'jin'|'eom'|'yu'|'baek'|'kid'} look
 * @param {number} size plane width in world units
 * @param {string} [variant] kids only: 'derpy' | 'sleepy' | 'shock' | 'plain'
 * @returns {{ mesh: THREE.Mesh, set(state: object): void }}
 */
export function createPixelFace(look, size, variant = 'plain') {
  const st = STYLES[look] || STYLES.kid;
  // a hand-drawn face is first painted dot for dot here, then smoothed into `out`
  const cv = document.createElement('canvas');
  cv.width = cv.height = FACE_SIZE;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  // what is shown: the same face painted round at 256x256
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const outCtx = out.getContext('2d');
  const tex = new THREE.CanvasTexture(out);
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  let key = '';
  let custom = null;
  let last = {};
  const base = { eyes: 'open', brows: 'neutral', mouth: 0, smile: 0, blush: false };
  if (variant === 'sleepy') base.eyes = 'closed';
  if (variant === 'shock') { base.eyes = 'wide'; base.mouth = 2; }
  const face = {
    mesh,
    set(state) {
      last = state;
      const s = { ...base, ...state };
      const k = custom ? `custom|${custom}` : `${s.eyes}|${s.brows}|${s.mouth}|${s.smile}|${s.blush}`;
      if (k === key) return;
      key = k;
      if (custom) {
        ctx.clearRect(0, 0, FACE_SIZE, FACE_SIZE);
        paintFace(ctx, custom, 1);
        smoothFace(cv, out);
      } else {
        drawVector(outCtx, st, s, variant);
      }
      tex.needsUpdate = true;
    },
    /** A hand-drawn face code, or null to go back to the generated face. */
    setCustom(code) {
      custom = code || null;
      face.set(last);
    },
  };
  face.set({});
  return face;
}
