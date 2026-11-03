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
 * Fits a picture of any size onto the FACE_SIZE x FACE_SIZE grid.
 *
 * - removeBackground: the colour that fills the edges of the picture, and everything of that colour
 *   connected to the edges, becomes transparent (a dot drawing on a plain or dark backdrop). Inner
 *   parts of the same colour that the backdrop does not reach (the white of an eye) stay.
 * - The picture is cropped to what is left and centred, keeping its shape.
 * - Each cell takes the most common colour of its block, not the average: dot edges stay sharp
 *   instead of blending into greys, and thin grid lines of a screenshot drop out.
 *
 * @param {Uint8ClampedArray} px RGBA, w x h
 * @returns {Uint8ClampedArray} RGBA, FACE_SIZE x FACE_SIZE
 */
export function sampleToGrid(px, w, h, { removeBackground = true } = {}) {
  const n = w * h;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
  const at = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];

  if (removeBackground) {
    // the backdrop: the most common colour along the edges (if the edges are mostly opaque)
    const edge = [];
    for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
    const groups = new Map();
    let opaqueEdge = 0;
    for (const i of edge) {
      if (!alpha[i]) continue;
      opaqueEdge++;
      const c = at(i), key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const g = groups.get(key) || { n: 0, s: [0, 0, 0] };
      g.n++; g.s[0] += c[0]; g.s[1] += c[1]; g.s[2] += c[2];
      groups.set(key, g);
    }
    let top = null;
    for (const g of groups.values()) if (!top || g.n > top.n) top = g;
    if (top && opaqueEdge > edge.length / 2 && top.n > opaqueEdge * 0.3) {
      const bg = top.s.map((v) => v / top.n);
      // close to the backdrop: its noise and JPEG blur, but not a near-black outline drawn on a
      // near-black backdrop (those differ by only ~15 per channel)
      const TOL = 900;
      const stack = [];
      for (const i of edge) if (alpha[i] && dist2(at(i), bg) < TOL) { alpha[i] = 0; stack.push(i); }
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i - x) / w;
        const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
        for (const j of next) if (j >= 0 && alpha[j] && dist2(at(j), bg) < TOL) { alpha[j] = 0; stack.push(j); }
      }
      // grid lines of a screenshot across the backdrop: runs of up to 3 px, still darkish like the
      // backdrop, with cleared backdrop on both sides. An outline has the drawing on one side, so stays
      const LOOSE = 60 * 60 * 3;
      const thin = (len, idx) => {
        let run = [];
        for (let k = 0; k <= len; k++) {
          const i = k < len ? idx(k) : -1;
          if (i >= 0 && alpha[i] && dist2(at(i), bg) < LOOSE) { run.push(k); continue; }
          if (run.length && run.length <= 3) {
            const before = run[0] - 1, after = run[run.length - 1] + 1;
            // the picture's own edge counts as cleared backdrop
            const open = (k) => k < 0 || k >= len || !alpha[idx(k)];
            if (open(before) && open(after)) for (const r of run) alpha[idx(r)] = 0;
          }
          run = [];
        }
      };
      for (let y = 0; y < h; y++) thin(w, (k) => y * w + k);
      for (let x = 0; x < w; x++) thin(h, (k) => k * w + x);
    }
  }

  // crop to what is left, as a centred square
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    if (!alpha[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const out = new Uint8ClampedArray(FACE_CELLS * 4);
  if (x1 < 0) return out;   // nothing left
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const ox = x0 - (side - (x1 - x0 + 1)) / 2, oy = y0 - (side - (y1 - y0 + 1)) / 2;
  const cell = side / FACE_SIZE;

  for (let cy = 0; cy < FACE_SIZE; cy++) {
    for (let cx = 0; cx < FACE_SIZE; cx++) {
      // the block, trimmed a little at its sides so neighbours and grid lines weigh less
      const sx0 = Math.floor(ox + (cx + 0.1) * cell), sx1 = Math.ceil(ox + (cx + 0.9) * cell);
      const sy0 = Math.floor(oy + (cy + 0.1) * cell), sy1 = Math.ceil(oy + (cy + 0.9) * cell);
      const groups = new Map();
      let total = 0, clear = 0;
      for (let y = Math.max(0, sy0); y < Math.min(h, Math.max(sy1, sy0 + 1)); y++) {
        for (let x = Math.max(0, sx0); x < Math.min(w, Math.max(sx1, sx0 + 1)); x++) {
          const i = y * w + x;
          total++;
          if (!alpha[i]) { clear++; continue; }
          const c = at(i), key = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
          const g = groups.get(key) || { n: 0, s: [0, 0, 0] };
          g.n++; g.s[0] += c[0]; g.s[1] += c[1]; g.s[2] += c[2];
          groups.set(key, g);
        }
      }
      const o = (cy * FACE_SIZE + cx) * 4;
      if (!total || clear * 2 > total) continue;   // mostly empty: an empty cell
      // thin dark lines (outlines, whiskers) cover less than half a block once shrunk, so dark
      // colours count double: otherwise they vanish into the fill around them
      let top = null, topScore = -1;
      for (const g of groups.values()) {
        const luma = (0.3 * g.s[0] + 0.59 * g.s[1] + 0.11 * g.s[2]) / g.n;
        const score = g.n * (luma < 70 ? 2 : 1);
        if (score > topScore) { topScore = score; top = g; }
      }
      out[o] = top.s[0] / top.n; out[o + 1] = top.s[1] / top.n; out[o + 2] = top.s[2] / top.n; out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Reads an image file and turns it into a face code (sampleToGrid, then pixelsToFace).
 * Big pictures are first brought down to at most 1024 px on the long side.
 * @returns {Promise<string>} a face code
 */
export async function fileToFace(file, opts = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('NOT_IMAGE');
  if (file.size > IMPORT_MAX_BYTES) throw new Error('TOO_BIG');
  let img;
  try {
    img = await createImageBitmap(file);
  } catch (_) {
    throw new Error('NOT_IMAGE');
  }
  if (!img.width || !img.height) throw new Error('NOT_IMAGE');
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = k < 1;
  g.drawImage(img, 0, 0, w, h);
  img.close?.();
  return pixelsToFace(sampleToGrid(g.getImageData(0, 0, w, h).data, w, h, opts));
}
