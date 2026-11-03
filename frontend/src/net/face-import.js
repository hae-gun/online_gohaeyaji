/**
 * Turns a picture (a dot drawing works best) into a face code for the 32x32 face grid, so it can
 * be loaded into the face editor and touched up there before it is used. Everything happens in
 * this browser; the file itself is never sent anywhere.
 *
 * The grid has 4 fixed colours (PALETTE 1..4) and up to 8 colours of my own (PICKED_CHARS), so the
 * picture is reduced to at most 12 colours: the fixed ones are used where they fit, and the 8 own
 * colours go to the colours the fixed ones cover worst. Transparent pixels become empty cells,
 * where the skin colour shows through.
 */
import { FACE_SIZE, FACE_CELLS, PALETTE, PICKED_CHARS, MAX_PICKED, joinFace } from './faces.js';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Perceptual-ish distance ("redmean"), squared. */
function dist2(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * @param {Uint8ClampedArray} px RGBA of a FACE_SIZE x FACE_SIZE picture
 * @returns {string} a face code (faces.js), not yet normalized
 */
export function pixelsToFace(px) {
  if (px.length !== FACE_CELLS * 4) throw new Error('bad size');
  // the distinct opaque colours and how many cells use each
  const counts = new Map();
  const cellColour = new Array(FACE_CELLS).fill(null);
  for (let i = 0; i < FACE_CELLS; i++) {
    if (px[i * 4 + 3] < 128) continue;
    const key = (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2];
    cellColour[i] = key;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colours = [...counts].map(([k, n]) => ({ c: [(k >> 16) & 255, (k >> 8) & 255, k & 255], n }));

  const fixed = PALETTE.slice(1).map(rgb);   // grid characters '1'..'4'
  let own = [];
  const nearest = (c) => {
    let best = 0, bd = Infinity;
    const all = fixed.concat(own);
    for (let j = 0; j < all.length; j++) { const d = dist2(c, all[j]); if (d < bd) { bd = d; best = j; } }
    return { j: best, d: bd };
  };
  // a fixed colour this close counts as the same colour: no own slot spent on it
  const SAME = 12 * 12 * 9;
  // pick own colours one by one: the colour that the palette so far covers worst, weighted by use
  while (own.length < MAX_PICKED) {
    let pick = null, worst = SAME;
    for (const col of colours) {
      const w = nearest(col.c).d * Math.sqrt(col.n);
      if (nearest(col.c).d > SAME && w > worst) { worst = w; pick = col; }
    }
    if (!pick) break;
    own.push(pick.c.slice());
  }
  // a few rounds of k-means on the own colours only (the fixed ones never move)
  for (let round = 0; round < 6 && own.length; round++) {
    const sum = own.map(() => [0, 0, 0, 0]);
    for (const col of colours) {
      const { j } = nearest(col.c);
      if (j < fixed.length) continue;
      const s = sum[j - fixed.length];
      s[0] += col.c[0] * col.n; s[1] += col.c[1] * col.n; s[2] += col.c[2] * col.n; s[3] += col.n;
    }
    own = own.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]] : c));
  }

  const memo = new Map();
  let grid = '';
  for (let i = 0; i < FACE_CELLS; i++) {
    const key = cellColour[i];
    if (key === null) { grid += '0'; continue; }
    if (!memo.has(key)) {
      const { j } = nearest([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
      memo.set(key, j < fixed.length ? String(j + 1) : PICKED_CHARS[j - fixed.length]);
    }
    grid += memo.get(key);
  }
  return joinFace(grid, own.map(hex));
}

/**
 * Reads an image file and fits it into the grid (whole picture, centred, keeping its shape).
 * Small pictures (dot drawings) are scaled with hard edges so the dots stay sharp.
 * @returns {Promise<string>} a face code
 */
export async function fileToFace(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('NOT_IMAGE');
  if (file.size > IMPORT_MAX_BYTES) throw new Error('TOO_BIG');
  let img;
  try {
    img = await createImageBitmap(file);
  } catch (_) {
    throw new Error('NOT_IMAGE');
  }
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error('NOT_IMAGE');
  const scale = FACE_SIZE / Math.max(w, h);
  const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = FACE_SIZE; c.height = FACE_SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = Math.max(w, h) > FACE_SIZE * 3;   // dot drawings stay crisp
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, Math.floor((FACE_SIZE - dw) / 2), Math.floor((FACE_SIZE - dh) / 2), dw, dh);
  img.close?.();
  return pixelsToFace(g.getImageData(0, 0, FACE_SIZE, FACE_SIZE).data);
}
