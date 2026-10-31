/**
 * Hand-drawn faces (protocol section 15).
 *
 * A face is a 32x32 grid written row by row as 1024 digits: 0 empty (skin shows through),
 * 1 black, 2 red, 3 white, 4 pink. (v0.5 used 16x16; old drawings in this browser are doubled.) Only colours for eyes, a nose, a mouth and cheeks, and only
 * the front of the head: people draw a face, not a picture. The server checks the same rules
 * (FaceRules.java).
 *
 * This browser keeps the face in use and up to GALLERY_MAX earlier drawings, so they can be
 * loaded again on the next visit. Nothing else stores them.
 */
export const FACE_SIZE = 32;
export const FACE_CELLS = FACE_SIZE * FACE_SIZE;
export const PALETTE = [null, '#151010', '#a3231b', '#ffffff', '#f07a8a'];
export const PALETTE_NAMES = ['지우개', '검정', '빨강', '흰색', '분홍'];
export const EMPTY_FACE = '0'.repeat(FACE_CELLS);
const VALID = /^[0-4]{1024}$/;
const OLD = /^[0-4]{256}$/;
const GALLERY_MAX = 12;

export const validFace = (f) => typeof f === 'string' && VALID.test(f);

/** A 16x16 drawing from v0.5, each cell doubled into 2x2. Anything else is returned as is. */
export function upgradeFace(f) {
  if (typeof f !== 'string' || !OLD.test(f)) return f;
  let out = '';
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) out += f[(y >> 1) * 16 + (x >> 1)];
  return out;
}
/** null means "default face": an erased drawing is not sent around as 256 zeros. */
export const normalizeFace = (f) => (validFace(f) && /[1-4]/.test(f) ? f : null);

/** A starting point for people who do not want a blank grid. */
export const STARTER_FACE = (() => {
  const g = Array(FACE_CELLS).fill('0');
  const dot = (x, y, c) => { g[y * FACE_SIZE + x] = String(c); };
  const block = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dot(x + i, y + j, c); };
  block(8, 11, 4, 4, 3); block(20, 11, 4, 4, 3);       // whites of the eyes
  block(9, 12, 2, 2, 1); block(21, 12, 2, 2, 1);       // pupils
  block(15, 18, 2, 2, 1);                              // nose
  block(11, 24, 10, 1, 2); dot(10, 23, 2); dot(21, 23, 2);   // mouth
  block(5, 19, 3, 2, 4); block(24, 19, 3, 2, 4);       // cheeks
  return g.join('');
})();

/** Draws a face code onto a 2D context, `cell` pixels per grid cell, on a transparent background. */
export function paintFace(ctx, face, cell, ox = 0, oy = 0) {
  if (!validFace(face)) return;
  for (let i = 0; i < FACE_CELLS; i++) {
    const c = PALETTE[face.charCodeAt(i) - 48];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(ox + (i % FACE_SIZE) * cell, oy + Math.floor(i / FACE_SIZE) * cell, cell, cell);
  }
}

const KEY = 'gohaeyaji-face';
const GALLERY_KEY = 'gohaeyaji-face-gallery';
const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } };

export const storedFace = {
  /** @returns {string|null} the face in use, or null for the default face */
  load() { return normalizeFace(upgradeFace(read(KEY))); },
  save(face) { write(KEY, normalizeFace(face)); },

  /** @returns {{ face: string, t: number }[]} newest first */
  gallery() {
    try {
      const list = JSON.parse(read(GALLERY_KEY) || '[]');
      return Array.isArray(list)
        ? list.map((e) => e && { ...e, face: upgradeFace(e.face) }).filter((e) => e && normalizeFace(e.face))
        : [];
    } catch (_) { return []; }
  },
  /** Keeps a drawing in the gallery (the same drawing is kept once, moved to the front). */
  remember(face) {
    const f = normalizeFace(face);
    if (!f) return;
    const list = storedFace.gallery().filter((e) => e.face !== f);
    list.unshift({ face: f, t: Date.now() });
    write(GALLERY_KEY, JSON.stringify(list.slice(0, GALLERY_MAX)));
  },
  forget(face) {
    write(GALLERY_KEY, JSON.stringify(storedFace.gallery().filter((e) => e.face !== face)));
  },
};

/**
 * Drawings this viewer chose not to see. Kept by content (a short hash), so the same picture
 * stays hidden on the next visit even though the person gets a new pid.
 */
const HIDDEN_KEY = 'gohaeyaji-face-hidden';
const HIDDEN_MAX = 200;
export function faceHash(face) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < face.length; i++) {
    const c = face.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
export const hiddenFaces = {
  list() {
    try { const l = JSON.parse(read(HIDDEN_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; }
  },
  has(face) { return !!face && hiddenFaces.list().includes(faceHash(face)); },
  add(face) {
    if (!face) return;
    const h = faceHash(face);
    const l = hiddenFaces.list().filter((x) => x !== h);
    l.push(h);
    write(HIDDEN_KEY, JSON.stringify(l.slice(-HIDDEN_MAX)));
  },
  remove(face) {
    if (!face) return;
    const h = faceHash(face);
    write(HIDDEN_KEY, JSON.stringify(hiddenFaces.list().filter((x) => x !== h)));
  },
  clear() { write(HIDDEN_KEY, null); },
};
