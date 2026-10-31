import * as THREE from 'three';
import { paintFace } from '../net/faces.js';

/**
 * Faces drawn like MS Paint: a 32x32 canvas stuck flat on a round 3D head. The mismatch between
 * the 3D head and the flat face is the joke, so the eyes are uneven on purpose.
 *
 * A face is redrawn only when its state changes:
 *   eyes:  'open' | 'closed' | 'squint' | 'happy' (^^) | 'wide'
 *   brows: 'neutral' | 'up' | 'worried' | 'stern'
 *   mouth: 0 (closed) .. 3 (wide open), smile: -1 (frown) | 0 | 1
 *   blush: true for the angry red cheeks
 *
 * A kid can also wear a hand-drawn face (protocol section 15): setCustom(code) shows that 16x16
 * drawing, doubled to fill the 32x32 canvas, instead of the generated one.
 */
const K = '#151010';
const LIP = '#5a2b22';
const RED = '#8a1c16';
const TONGUE = '#e46a6a';
const WHITE = '#ffffff';

/** Per-look features. Priest looks: jin, eom, yu, baek. Kids: kid (eyes vary by o.variant). */
const STYLES = {
  jin:  { brow: '#5f5a55', browW: 5, browH: 1, glasses: 'round' },
  eom:  { brow: '#141010', browW: 7, browH: 3, mono: true, moustache: '#f2eee6' },
  yu:   { brow: '#4a2e1c', browW: 4, browH: 1, cheeks: '#f07a8a', bigEyes: true, grin: true },
  baek: { brow: '#f4f1ea', browW: 7, browH: 2, droop: true, moustache: '#f4f1ea' },
  kid:  { brow: null, bigEyes: true },
};

const px = (c, col, x, y, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

function ring(c, col, cx, cy, r) {
  for (let a = 0; a < 48; a++) {
    const t = (a / 48) * Math.PI * 2;
    px(c, col, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r));
  }
}

// uneven eye positions: the left one sits a pixel lower
const EYE = [[10, 14], [21, 13]];

function brows(c, st, s) {
  if (!st.brow) return;
  // tilt: pixels the inner end moves (positive = inner end up = worried)
  const tilt = { neutral: 0, up: 0, worried: 2, stern: -2 }[s.brows] ?? 0;
  const lift = s.brows === 'up' ? -2 : 0;
  EYE.forEach(([ex, ey], i) => {
    const outer = i === 0 ? -1 : 1;   // which way is outward for this eye
    for (let k = 0; k < st.browW; k++) {
      // k=0 is the inner end
      const x = ex + outer * (k - 1) - (outer < 0 ? 1 : 0);
      const fall = st.droop ? Math.floor(k / 3) : 0;   // the old priest's brows hang at the ends
      const y = ey - 6 + lift - Math.round(tilt * (1 - k / Math.max(1, st.browW - 1))) + fall;
      px(c, st.brow, x, y, 1, st.browH);
    }
  });
  if (st.mono) {
    // join the brows over the nose: one long caterpillar
    const y = EYE[0][1] - 6 + lift - tilt;
    px(c, st.brow, 13, Math.min(y, EYE[1][1] - 6 + lift - tilt), 6, st.browH);
  }
}

function eyes(c, st, s, variant) {
  EYE.forEach(([ex, ey], i) => {
    if (s.eyes === 'closed') { px(c, K, ex - 2, ey, 5, 1); return; }
    if (s.eyes === 'happy') {
      px(c, K, ex - 2, ey + 1); px(c, K, ex - 1, ey); px(c, K, ex, ey - 1); px(c, K, ex + 1, ey); px(c, K, ex + 2, ey + 1);
      return;
    }
    if (s.eyes === 'squint') { px(c, K, ex - 2, ey, 5, 1); px(c, K, ex - 1, ey - 1, 3, 1); return; }
    if (st.bigEyes || s.eyes === 'wide') {
      const w = s.eyes === 'wide' ? 6 : 4;
      px(c, WHITE, ex - (w >> 1), ey - (w >> 1), w, w);
      // kid variant 'derpy': pupils look two different ways
      const look = variant === 'derpy' ? (i === 0 ? [-1, -1] : [1, 1]) : [0, 0];
      px(c, K, ex - 1 + look[0], ey - 1 + look[1], 2, 2);
    } else {
      px(c, K, ex - 1, ey - 1, 2, 2);
    }
  });
  if (st.glasses === 'round') {
    ring(c, K, EYE[0][0], EYE[0][1], 5); ring(c, K, EYE[1][0], EYE[1][1], 5); px(c, K, 15, 12, 2, 1);
  }
}

function mouth(c, st, s) {
  const cx = 16, y = 23, w = st.grin ? 9 : 7;
  const x0 = cx - (w >> 1);
  if (s.mouth > 0) {
    const h = 1 + s.mouth * 2;
    px(c, K, x0 - 1, y - 1, w + 2, h + 2);
    px(c, RED, x0, y, w, h);
    if (h >= 4) px(c, TONGUE, x0 + 2, y + h - 2, w - 4, 2);
    if (st.grin) px(c, WHITE, x0, y, w, 1);
  } else if (st.grin && s.smile >= 0) {
    // the humorous priest's resting face is already a D-shaped grin
    px(c, K, x0, y - 1, w, 1); px(c, RED, x0 + 1, y, w - 2, 2); px(c, K, x0 + 2, y + 2, w - 4, 1);
  } else {
    px(c, LIP, x0, y, w, 1);
    if (s.smile > 0) { px(c, LIP, x0 - 1, y - 1); px(c, LIP, x0 + w, y - 1); }
    if (s.smile < 0) { px(c, LIP, x0 - 1, y + 1); px(c, LIP, x0 + w, y + 1); }
  }
  if (st.moustache) {
    // over the mouth, drooping at both ends; it jumps up a pixel when the mouth opens
    const my = y - 4 - (s.mouth > 0 ? 1 : 0);
    px(c, st.moustache, 8, my, 16, 3); px(c, st.moustache, 6, my + 2, 4, 3); px(c, st.moustache, 22, my + 2, 4, 3);
    px(c, st.moustache, 5, my + 4, 3, 2); px(c, st.moustache, 24, my + 4, 3, 2);
  }
}

function draw(c, st, s, variant) {
  c.clearRect(0, 0, 32, 32);
  if (st.cheeks) { px(c, st.cheeks, 3, 17, 6, 4); px(c, st.cheeks, 23, 17, 6, 4); }
  if (s.blush) { px(c, '#e2453a', 3, 17, 5, 3); px(c, '#e2453a', 24, 17, 5, 3); }
  brows(c, st, s);
  eyes(c, st, s, variant);
  mouth(c, st, s);
  if (variant === 'sleepy') px(c, '#9ec8ff', 24, 17, 2, 3);   // a tear of boredom
}

/**
 * @param {'jin'|'eom'|'yu'|'baek'|'kid'} look
 * @param {number} size plane width in world units
 * @param {string} [variant] kids only: 'derpy' | 'sleepy' | 'shock' | 'plain'
 * @returns {{ mesh: THREE.Mesh, set(state: object): void }}
 */
export function createPixelFace(look, size, variant = 'plain') {
  const st = STYLES[look] || STYLES.kid;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5 }),
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
        ctx.clearRect(0, 0, 32, 32);
        paintFace(ctx, custom, 2);
      } else {
        draw(ctx, st, s, variant);
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
