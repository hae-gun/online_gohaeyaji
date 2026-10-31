/**
 * Hand-drawn faces (protocol section 15).
 *
 * A face is a 16x16 grid written row by row as 256 digits: 0 empty (skin shows through),
 * 1 black, 2 red, 3 white, 4 pink. Only colours for eyes, a nose, a mouth and cheeks, and only
 * the front of the head: people draw a face, not a picture. The server checks the same rules
 * (FaceRules.java).
 *
 * This browser keeps the face in use and up to GALLERY_MAX earlier drawings, so they can be
 * loaded again on the next visit. Nothing else stores them.
 */
export const FACE_SIZE = 16;
export const FACE_CELLS = FACE_SIZE * FACE_SIZE;
export const PALETTE = [null, '#151010', '#a3231b', '#ffffff', '#f07a8a'];
export const PALETTE_NAMES = ['지우개', '검정', '빨강', '흰색', '분홍'];
export const EMPTY_FACE = '0'.repeat(FACE_CELLS);
const VALID = /^[0-4]{256}$/;
const GALLERY_MAX = 12;

export const validFace = (f) => typeof f === 'string' && VALID.test(f);
/** null means "default face": an erased drawing is not sent around as 256 zeros. */
export const normalizeFace = (f) => (validFace(f) && /[1-4]/.test(f) ? f : null);

/** A starting point for people who do not want a blank grid. */
export const STARTER_FACE = (() => {
  const g = Array(FACE_CELLS).fill('0');
  const dot = (x, y, c) => { g[y * FACE_SIZE + x] = String(c); };
  [[4, 6], [5, 6], [4, 7], [5, 7], [10, 6], [11, 6], [10, 7], [11, 7]].forEach(([x, y]) => dot(x, y, 1));   // eyes
  dot(8, 9, 1);                                                                                        // nose
  for (let x = 5; x <= 10; x++) dot(x, 12, 2);                                                         // mouth
  dot(4, 11, 2); dot(11, 11, 2);
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
  load() { return normalizeFace(read(KEY)); },
  save(face) { write(KEY, normalizeFace(face)); },

  /** @returns {{ face: string, t: number }[]} newest first */
  gallery() {
    try {
      const list = JSON.parse(read(GALLERY_KEY) || '[]');
      return Array.isArray(list) ? list.filter((e) => e && normalizeFace(e.face)) : [];
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
