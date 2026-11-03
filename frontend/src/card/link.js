import { normalizeFace } from '../net/faces.js';

/**
 * The link of a shared 보속 카드: card.html?d=<data>.
 *
 * The data names where the penance came from (category, priest, which penance, which keyword:
 * answer engine `ref`), not its text: the card page rebuilds the words from the site's own answer
 * data, so nobody can make a card on our address say something we never wrote. The name is checked
 * again on the card page. The confession itself is never in the link.
 *
 * { v: 1, r: { c, p, pi, ki }, n: name, t: minutes since 1970 (when), x: nth, l: 'm'|'f', f: face (run-length) }
 */

/** Hand-drawn face grids are mostly empty: "0" x 700 becomes "0700_". */
export function packFace(face) {
  const f = normalizeFace(face);
  if (!f) return '';
  const [grid, colours] = f.split(':');
  let out = '';
  for (let i = 0; i < grid.length;) {
    let j = i;
    while (j < grid.length && grid[j] === grid[i]) j++;
    out += grid[i] + (j - i) + '_';
    i = j;
  }
  return colours ? `${out}:${colours}` : out;
}

export function unpackFace(packed) {
  if (typeof packed !== 'string' || !packed) return null;
  const [runs, colours] = packed.split(':');
  let grid = '';
  for (const m of runs.matchAll(/([0-9a-c])(\d+)_/g)) {
    grid += m[1].repeat(Math.min(1024, Number(m[2])));
    if (grid.length > 1024) return null;
  }
  return normalizeFace(colours ? `${grid}:${colours}` : grid);
}

const toB64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** @param {{ ref:{c:string,p:string,pi:number,ki:number}, name:string, when:Date, nth:number, look?:string, face?:string|null }} d */
export function encodeCard(d) {
  return toB64(JSON.stringify({
    v: 1, r: d.ref, n: d.name, t: Math.round(d.when.getTime() / 60000), x: d.nth | 0,
    l: (d.look || 'm')[0] === 'f' ? 'f' : 'm', ...(d.face ? { f: packFace(d.face) } : {}),
  }));
}

/** @returns the card data, or null when the link is broken */
export function decodeCard(s) {
  try {
    const o = JSON.parse(fromB64(s));
    if (!o || o.v !== 1 || !o.r || typeof o.r.c !== 'string' || typeof o.r.p !== 'string') return null;
    return {
      ref: { c: o.r.c, p: o.r.p, pi: Number(o.r.pi) | 0, ki: Number.isInteger(o.r.ki) ? o.r.ki : -1 },
      name: typeof o.n === 'string' ? o.n.slice(0, 20) : '',
      when: new Date((Number(o.t) || 0) * 60000),
      nth: Math.max(1, Math.min(999, Number(o.x) | 0)),
      look: o.l === 'f' ? 'f' : 'm',
      face: unpackFace(o.f),
    };
  } catch (_) {
    return null;
  }
}

/** The full address to share, next to the page this runs on (works under any base path). */
export function cardUrl(d) {
  return new URL(`card.html?d=${encodeCard(d)}`, location.href).href;
}
