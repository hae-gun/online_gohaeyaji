import * as THREE from 'three';
import { FACADE_Z } from '../world/exterior.js';

/**
 * Where feet may go: the corridor, the doorway, and the yard minus round obstacles.
 * Kept as plain math instead of physics; the world is small and flat.
 */
export function createNavigation(obstacles) {
  function walkable(x, z) {
    if (z <= 10.2) return z >= -38.5 && Math.abs(x) <= 2.1;   // corridor
    if (z < 11.5) return Math.abs(x) <= 1.1;                  // doorway
    if (x < -12 || x > 12 || z > 44) return false;             // yard bounds
    if (Math.abs(x) > 6.4 && z < 12) return false;             // facade buttresses
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r) return false;
    return true;
  }

  /** Waypoints from `from` to `to`, routed through the main doors when crossing the facade. */
  function planPath(from, to) {
    let x = to.x, z = to.z;
    if (z < 10.3) { x = clamp(x, -2.1, 2.1); z = Math.max(-38.5, z); }
    else { x = clamp(x, -12, 12); z = clamp(z, 11.6, 44); }
    const path = [];
    const insideNow = from.z < FACADE_Z, insideAfter = z < FACADE_Z;
    if (insideNow && !insideAfter) path.push(new THREE.Vector3(0, 0, 9.4), new THREE.Vector3(0, 0, 12.2));
    if (!insideNow && insideAfter) path.push(new THREE.Vector3(0, 0, 12.2), new THREE.Vector3(0, 0, 9.4));
    path.push(new THREE.Vector3(x, 0, z));
    return path;
  }

  /**
   * Moves from (ox, oz) by (dx, dz), sliding along walls instead of stopping dead,
   * and drifting toward the doors when the player walks into the facade near them.
   */
  function step(ox, oz, dx, dz, maxStep) {
    let nx = ox + dx, nz = oz + dz;
    if (!walkable(nx, nz) && oz > 10 && oz < 13.5 && Math.abs(ox) < 4 && Math.abs(ox) > 0.05) {
      const sx = ox - Math.sign(ox) * Math.min(Math.abs(ox), maxStep);
      if (walkable(sx, oz)) { nx = sx; nz = walkable(sx, nz) ? nz : oz; }
    }
    if (!walkable(nx, nz)) {
      if (walkable(nx, oz)) nz = oz;
      else if (walkable(ox, nz)) nx = ox;
      else { nx = ox; nz = oz; }
    }
    return [nx, nz];
  }

  return { walkable, planPath, step };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
