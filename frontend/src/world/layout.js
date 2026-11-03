/**
 * Where the outdoor areas are, shared by the world (exterior.js draws them), walking
 * (navigation.js) and the place name (placeOf). Indoors is in hall.js and booths.js.
 *
 *            event field (z 62..108)
 *               ^      ^      ^
 *         west trail  path  east trail
 *               \      |      /
 *          [ front yard: fountain plaza, benches ]
 *   west ------ facade + nave ---- confession hall wing ---- east
 *     |                                                        |
 *     +---------------------- back ----------------------------+
 *
 * The ring around the buildings (west, back, east and the strips along the front) lets people
 * walk all the way round the cathedral.
 */

/** Rectangles people can walk in, by area. */
export const OUTDOOR = [
  { area: 'yard', x0: -12.8, x1: 12.8, z0: 11.5, z1: 49 },        // fountain plaza and the path south
  { area: 'around', x0: -25, x1: -12.8, z0: 11.6, z1: 16.5 },     // front corner, west
  { area: 'around', x0: 12.8, x1: 51, z0: 11.6, z1: 16.5 },       // along the nave's and the confession hall's front
  { area: 'around', x0: -25, x1: -19.3, z0: -67, z1: 16.5 },      // west side of the nave
  { area: 'around', x0: -25, x1: 51, z0: -67, z1: -60.6 },        // behind the nave
  { area: 'around', x0: 18.6, x1: 51, z0: -67, z1: -17.2 },       // east of the nave, behind the confession hall
  { area: 'around', x0: 46.8, x1: 51, z0: -67, z1: 16.5 },        // east end of the hall
  { area: 'event', x0: -36, x1: 36, z0: 62, z1: 108 },            // the big event field
];

/** The event field (for events like 수능 or the year's end) and its stage at the far end. */
export const EVENT_FIELD = { x0: -36, x1: 36, z0: 62, z1: 108, stageZ: 101 };

/** Walking trails through the wood, as polylines; walkable within TRAIL_HALF of the line. */
export const TRAILS = [
  [[-12.4, 22], [-22, 24], [-29, 33], [-31, 46], [-27, 57], [-19, 64]],   // west trail
  [[12.4, 22], [22, 24], [29, 33], [31, 46], [27, 57], [19, 64]],         // east trail
  [[0, 48], [0, 64]],                                                      // the path from the plaza
];
export const TRAIL_HALF = 1.6;

/** Distance from (x, z) to the segment a-b. */
export function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
  const k = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2)) : 0;
  return Math.hypot(x - (a[0] + dx * k), z - (a[1] + dz * k));
}

export function nearTrail(x, z, margin = TRAIL_HALF) {
  for (const t of TRAILS) for (let i = 0; i < t.length - 1; i++) if (segDist(x, z, t[i], t[i + 1]) < margin) return true;
  return false;
}

/** The outdoor area at (x, z): 'yard' | 'around' | 'event' | 'trail', or null if not outdoors. */
export function outdoorArea(x, z) {
  for (const r of OUTDOOR) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.area;
  return nearTrail(x, z) ? 'trail' : null;
}

/** Whether (x, z) is clear of all walkable outdoor ground by at least `margin` (for scenery). */
export function awayFromPaths(x, z, margin) {
  for (const r of OUTDOOR) if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin) return false;
  return !nearTrail(x, z, TRAIL_HALF + margin);
}
