import * as THREE from 'three';
import { FACADE_Z } from '../world/exterior.js';

/** Yard limits: the hedges on the sides, the end of the path in the south. */
const YARD_X = 12.8, YARD_Z = 49;
/** Front face of the facade; only the doorway lets you closer. */
const FRONT_Z = 11.5;

/**
 * Where feet may go: the corridor, the doorway, and the yard minus round obstacles
 * (fountain, benches, trees, lamps, the facade's columns).
 * Kept as plain math instead of physics; the world is small and flat.
 */
export function createNavigation(obstacles) {
  function blockedBy(x, z) {
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r) return o;
    return null;
  }
  function walkable(x, z) {
    if (z <= 10.2) return z >= -38.5 && Math.abs(x) <= 2.1;   // corridor
    if (z < FRONT_Z) return Math.abs(x) <= 1.1;                // doorway
    if (Math.abs(x) > YARD_X || z > YARD_Z) return false;      // yard bounds
    return !blockedBy(x, z);
  }

  /**
   * Adds a waypoint around a big obstacle (the fountain) that lies across the straight line
   * from a to b, going round on the side that is shorter.
   */
  function detour(a, b) {
    for (const o of obstacles) {
      if (!o.big) continue;
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) continue;
      const k = clamp(((o.x - a.x) * dx + (o.z - a.z) * dz) / len2, 0, 1);
      const cx = a.x + dx * k - o.x, cz = a.z + dz * k - o.z;
      const d = Math.hypot(cx, cz);
      if (d >= o.r + 0.45) continue;
      // push the closest point out of the circle, sideways to the walking direction
      let nx = cx, nz = cz;
      if (d < 0.2) { const l = Math.sqrt(len2); nx = -dz / l; nz = dx / l; if ((a.x - o.x) * nx + (a.z - o.z) * nz < 0) { nx = -nx; nz = -nz; } }
      const l = Math.hypot(nx, nz);
      const R = o.r + 1.1;
      return new THREE.Vector3(o.x + (nx / l) * R, 0, o.z + (nz / l) * R);
    }
    return null;
  }

  /** Waypoints from `from` to `to`, routed through the main doors and around the fountain. */
  function planPath(from, to) {
    let x = to.x, z = to.z;
    if (z < 10.3) { x = clamp(x, -2.1, 2.1); z = Math.max(-38.5, z); }
    else { x = clamp(x, -YARD_X, YARD_X); z = clamp(z, FRONT_Z + 0.1, YARD_Z); }
    const pts = [];
    const insideNow = from.z < FACADE_Z, insideAfter = z < FACADE_Z;
    if (insideNow && !insideAfter) pts.push(new THREE.Vector3(0, 0, 9.4), new THREE.Vector3(0, 0, 12.2));
    if (!insideNow && insideAfter) pts.push(new THREE.Vector3(0, 0, 12.2), new THREE.Vector3(0, 0, 9.4));
    pts.push(new THREE.Vector3(x, 0, z));
    const path = [];
    let prev = new THREE.Vector3(from.x, 0, from.z);
    for (const p of pts) {
      // a long pass across the plaza may need two corners (in front of and behind the fountain)
      for (let i = 0; i < 2; i++) {
        const w = detour(prev, p);
        if (!w) break;
        path.push(w); prev = w;
      }
      path.push(p); prev = p;
    }
    return path;
  }

  /**
   * Moves from (ox, oz) by (dx, dz), sliding along walls and round obstacles instead of stopping
   * dead, and drifting toward the doors when the player walks into the facade near them.
   */
  function step(ox, oz, dx, dz, maxStep) {
    let nx = ox + dx, nz = oz + dz;
    if (!walkable(nx, nz) && oz > 10 && oz < 13.5 && Math.abs(ox) < 4 && Math.abs(ox) > 0.05) {
      const sx = ox - Math.sign(ox) * Math.min(Math.abs(ox), maxStep);
      if (walkable(sx, oz)) { nx = sx; nz = walkable(sx, nz) ? nz : oz; }
    }
    if (!walkable(nx, nz)) {
      // round obstacle: keep only the part of the step that goes around it
      const o = nz >= FRONT_Z ? blockedBy(nx, nz) : null;
      if (o) {
        let rx = ox - o.x, rz = oz - o.z;
        const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        const inward = dx * rx + dz * rz;
        const tx = dx - inward * rx, tz = dz - inward * rz;
        const tl = Math.hypot(tx, tz);
        if (tl > 1e-5) {
          const s = Math.hypot(dx, dz) / tl;   // keep the walking speed while sliding
          const sx = ox + tx * s, sz = oz + tz * s;
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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
