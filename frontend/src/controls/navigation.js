import * as THREE from 'three';
import { NAVE, SIDE_DOOR } from '../world/hall.js';
import { CONFESSION_HALL } from '../world/booths.js';
import { OUTDOOR, EVENT_FIELD, outdoorArea } from '../world/layout.js';

/** Front face of the facade; only the doorway lets you closer. */
const FRONT_Z = 11.5;
/** Inner face of the facade. */
const INSIDE_Z = NAVE.z1 - 0.05;
const WALL = 0.3;   // keep this far from walls

/** Indoors at (x, z): 'nave' | 'booths' (the doorway counts as nave), or null if not inside. */
function indoorArea(x, z) {
  const H = CONFESSION_HALL, N = NAVE, D = SIDE_DOOR;
  if (z > INSIDE_Z && z < FRONT_Z) return Math.abs(x) <= 1.1 ? 'nave' : null;            // main doorway
  if (x >= N.x0 + WALL && x <= N.x1 - WALL && z >= N.rail && z <= INSIDE_Z) return 'nave';
  if (x > N.x1 - WALL && x < H.x0 + WALL && z >= D.z0 + WALL && z <= D.z1 - WALL) return 'booths';   // side door
  if (x >= H.x0 + WALL && x <= H.x1 - WALL && z >= H.z0 + WALL && z <= H.z1 - WALL) return 'booths';
  return null;
}

/**
 * Where feet may go and how to get somewhere.
 *
 * Indoors: the main doorway, the nave (in front of the altar rail), the side door and the
 * confession hall. Outdoors (world/layout.js): the fountain plaza, the ring around the
 * buildings, the trails through the wood and the event field. Obstacles are circles {x, z, r}
 * or boxes {box, x0, x1, z0, z1}, kept in 4 m buckets so checks stay cheap.
 *
 * Tap-to-walk runs A* on a 0.35 m grid built once at start (the world does not move), then
 * straightens the path, so it finds its way through doors, around the fountain and the
 * buildings, between pews and around booths. Plain math instead of physics.
 */
export function createNavigation(obstacles) {
  // obstacles by 4 m bucket
  const B = 4, buckets = new Map();
  const bkey = (bx, bz) => bx * 100000 + bz;
  for (const o of obstacles) {
    const x0 = o.box ? o.x0 : o.x - o.r, x1 = o.box ? o.x1 : o.x + o.r;
    const z0 = o.box ? o.z0 : o.z - o.r, z1 = o.box ? o.z1 : o.z + o.r;
    for (let bx = Math.floor(x0 / B); bx <= Math.floor(x1 / B); bx++) {
      for (let bz = Math.floor(z0 / B); bz <= Math.floor(z1 / B); bz++) {
        const k = bkey(bx, bz);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(o);
      }
    }
  }
  function blockedBy(x, z) {
    const list = buckets.get(bkey(Math.floor(x / B), Math.floor(z / B)));
    if (!list) return null;
    for (const o of list) {
      if (o.box) { if (x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return o; }
      else if (Math.hypot(x - o.x, z - o.z) < o.r) return o;
    }
    return null;
  }

  function walkable(x, z) {
    if (!indoorArea(x, z) && !outdoorArea(x, z)) return false;
    return !blockedBy(x, z);
  }

  /* ---------------------------------------------------------------- grid */
  let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
  for (const r of [...OUTDOOR, CONFESSION_HALL, NAVE, EVENT_FIELD]) {
    gx0 = Math.min(gx0, r.x0); gx1 = Math.max(gx1, r.x1); gz0 = Math.min(gz0, r.z0); gz1 = Math.max(gz1, r.z1);
  }
  gx0 -= 1; gx1 += 1; gz0 -= 1; gz1 += 1;
  const CELL = 0.35, GX0 = gx0, GZ0 = gz0;
  const W = Math.ceil((gx1 - GX0) / CELL), Hh = Math.ceil((gz1 - GZ0) / CELL);
  const free = new Uint8Array(W * Hh);
  const cx = (i) => GX0 + (i + 0.5) * CELL, cz = (j) => GZ0 + (j + 0.5) * CELL;
  const R = 0.18;   // a little room around the body, so paths do not scrape corners
  for (let j = 0; j < Hh; j++) {
    for (let i = 0; i < W; i++) {
      const x = cx(i), z = cz(j);
      free[j * W + i] = walkable(x, z) && walkable(x + R, z) && walkable(x - R, z) && walkable(x, z + R) && walkable(x, z - R) ? 1 : 0;
    }
  }
  const cellOf = (x, z) => [Math.floor((x - GX0) / CELL), Math.floor((z - GZ0) / CELL)];
  const isFree = (i, j) => i >= 0 && j >= 0 && i < W && j < Hh && free[j * W + i] === 1;

  /** Nearest free cell to (i, j), searching outward in rings. */
  function nearestFree(i, j) {
    if (isFree(i, j)) return [i, j];
    for (let r = 1; r < 40; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !isFree(i + di, j + dj)) continue;
          const d = di * di + dj * dj;
          if (d < bd) { bd = d; best = [i + di, j + dj]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // A* with a binary heap, 8 neighbours, no cutting corners
  const gScore = new Float32Array(W * Hh), came = new Int32Array(W * Hh), seen = new Uint32Array(W * Hh), done = new Uint32Array(W * Hh);
  let stamp = 0;
  function astar(si, sj, ti, tj) {
    stamp++;
    const start = sj * W + si, goal = tj * W + ti;
    const heap = [], hf = [];
    const push = (n, f) => {
      heap.push(n); hf.push(f);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= hf[k]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const ln = heap.pop(), lf = hf.pop();
      if (heap.length) {
        heap[0] = ln; hf[0] = lf;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && hf[l] < hf[m]) m = l;
          if (r < heap.length && hf[r] < hf[m]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m;
        }
      }
      return top;
    };
    const h = (n) => {
      const dx = Math.abs((n % W) - ti), dz = Math.abs(Math.floor(n / W) - tj);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    seen[start] = stamp; gScore[start] = 0; came[start] = -1;
    push(start, h(start));
    let steps = 0;
    while (heap.length && steps < W * Hh) {
      const n = pop();
      if (done[n] === stamp) continue;   // an older, longer way to a cell already settled
      done[n] = stamp;
      steps++;
      if (n === goal) {
        const out = [];
        for (let k = n; k !== -1; k = came[k]) out.push(k);
        return out.reverse();
      }
      const i = n % W, j = Math.floor(n / W);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (!isFree(ni, nj)) continue;
          if (di && dj && (!isFree(i + di, j) || !isFree(i, j + dj))) continue;
          const m = nj * W + ni, g = gScore[n] + (di && dj ? 1.414 : 1);
          if (seen[m] === stamp && g >= gScore[m]) continue;
          seen[m] = stamp; gScore[m] = g; came[m] = n;
          push(m, g + h(m));
        }
      }
    }
    return null;
  }

  /** Whether a straight walk from a to b stays on free cells. */
  function clear(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / (CELL * 0.5));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const [i, j] = cellOf(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!isFree(i, j)) return false;
    }
    return true;
  }

  /** Waypoints from `from` to `to`: through doors, around the fountain, pews and booths. */
  function planPath(from, to) {
    const s = nearestFree(...cellOf(from.x, from.z));
    const g = nearestFree(...cellOf(to.x, to.z));
    if (!s || !g) return [];
    const cells = astar(s[0], s[1], g[0], g[1]);
    if (!cells) return [];
    const pts = cells.map((n) => new THREE.Vector3(cx(n % W), 0, cz(Math.floor(n / W))));
    // the exact spot when it can be stood on (a booth door, a bench), else the cell centre
    if (walkable(to.x, to.z)) pts[pts.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    // string pulling: from each corner jump to the farthest point still in straight sight
    const out = [];
    let cur = new THREE.Vector3(from.x, 0, from.z), k = 0;
    while (k < pts.length - 1) {
      let far = k + 1;
      for (let m = pts.length - 1; m > k + 1; m--) {
        if (clear(cur.x, cur.z, pts[m].x, pts[m].z)) { far = m; break; }
      }
      out.push(pts[far]);
      cur = pts[far]; k = far;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }

  /**
   * Moves from (ox, oz) by (dx, dz), sliding along walls and round obstacles instead of stopping
   * dead, and drifting toward the main doors when the player walks into the facade near them.
   */
  function step(ox, oz, dx, dz, maxStep) {
    let nx = ox + dx, nz = oz + dz;
    if (!walkable(nx, nz) && oz > 10 && oz < 13.5 && Math.abs(ox) < 4 && Math.abs(ox) > 0.05) {
      const sx = ox - Math.sign(ox) * Math.min(Math.abs(ox), maxStep);
      if (walkable(sx, oz)) { nx = sx; nz = walkable(sx, nz) ? nz : oz; }
    }
    if (!walkable(nx, nz)) {
      // round obstacle: keep only the part of the step that goes around it
      const o = blockedBy(nx, nz);
      if (o && !o.box) {
        let rx = ox - o.x, rz = oz - o.z;
        const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        const inward = dx * rx + dz * rz;
        const tx = dx - inward * rx, tz = dz - inward * rz;
        const tl = Math.hypot(tx, tz);
        if (tl > 1e-5) {
          const k = Math.hypot(dx, dz) / tl;   // keep the walking speed while sliding
          const sx = ox + tx * k, sz = oz + tz * k;
          if (walkable(sx, sz)) return [sx, sz];
        }
      }
      if (walkable(nx, oz)) nz = oz;
      else if (walkable(ox, nz)) nx = ox;
      else { nx = ox; nz = oz; }
    }
    return [nx, nz];
  }

  return { walkable, planPath, step };
}

/** Which part of the world a point is in, for the place name and the ambient sound. */
export function placeOf(x, z) {
  return indoorArea(x, z) || outdoorArea(x, z) || 'around';
}
