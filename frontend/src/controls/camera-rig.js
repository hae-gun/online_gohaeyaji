import * as THREE from 'three';
import { EYE_HEIGHT } from '../world/figure.js';

/**
 * Third person orbit camera with wall collision, plus a first person mode.
 *
 * Input: one-finger or mouse drag rotates, wheel or pinch zooms, a short tap
 * (no drag) is reported through onTap so main.js can walk the player there.
 *
 * The camera may go down below the head and look up (to see your own face), but never under
 * the floor: the floors are one-sided planes, so from below they are invisible and the world
 * looks hollow. The limit is the camera's height (MIN_Y), not a fixed angle, so a close camera
 * can go lower than a far one.
 *
 * showFace(): swings round to the front of the player at face height, and back again.
 */
const HEAD_Y = 1.3;        // the point the camera orbits around
const MIN_Y = 0.35;        // camera never lower than this above the floor
const PITCH_MIN = -0.9, PITCH_MAX = 1.3;
export function createCameraRig({ canvas, camera, isActive, onTap }) {
  const rig = {
    yaw: 0,          // 0 = camera behind the player looking down -z
    pitch: 0.3,
    dist: 6.4,
    firstPerson: false,
    fpPitch: -0.05,
  };
  let curDist = rig.dist;
  let swing = null;            // { yaw, pitch, dist }: easing toward a framing (showFace)
  let facing = false;          // the camera is in front of the player
  const ray = new THREE.Raycaster();

  const ptrs = new Map();
  let downAt = null, dragged = false, pinchD = 0;

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not supported everywhere */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { downAt = { x: e.clientX, y: e.clientY }; dragged = false; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); dragged = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev || !isActive()) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 7) dragged = true;
      if (dragged) {
        swing = null;   // a drag takes over from the swing
        rig.yaw -= dx * 0.0065;
        if (rig.firstPerson) rig.fpPitch = clamp(rig.fpPitch - dy * 0.005, -1.1, 1.1);
        else rig.pitch = clamp(Math.max(rig.pitch, lowest(curDist)) + dy * 0.005, PITCH_MIN, PITCH_MAX);
      }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0) rig.dist = clamp(rig.dist * pinchD / d, 2.2, 12);
      pinchD = d;
    }
  });
  const end = (e) => {
    if (ptrs.size === 1 && ptrs.has(e.pointerId) && !dragged && e.type === 'pointerup' && isActive()) onTap(e.clientX, e.clientY);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinchD = 0;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (isActive()) rig.dist = clamp(rig.dist * (1 + e.deltaY * 0.0012), 2.2, 12);
  }, { passive: false });

  /** The lowest pitch at this distance that keeps the camera above MIN_Y. */
  const lowest = (d) => Math.asin(clamp((MIN_Y - HEAD_Y) / Math.max(0.5, d), -1, 1));

  /**
   * In front of the player, a little below the face looking slightly up, close enough to see
   * the drawing. Called again (or with back=true), returns behind the player.
   * @param {number} faceYaw the player's rotation.y
   */
  rig.showFace = (faceYaw, back = facing) => {
    if (rig.firstPerson) rig.toggleFirstPerson();
    facing = !back;
    swing = facing ? { yaw: faceYaw, pitch: -0.08, dist: 3.0 } : { yaw: faceYaw + Math.PI, pitch: 0.3, dist: 6.4 };
    return facing;
  };
  rig.isFacing = () => facing;

  rig.toggleFirstPerson = () => {
    rig.firstPerson = !rig.firstPerson;
    if (rig.firstPerson) rig.fpPitch = -0.05;
    return rig.firstPerson;
  };

  /** Slow establishing shot of the facade behind the intro card. */
  rig.updateIntro = (t, target) => {
    rig.yaw = Math.sin(t * 0.15) * 0.45;
    const cp = Math.cos(0.18);
    camera.position.set(target.x + Math.sin(rig.yaw) * cp * 13, 1.6 + Math.sin(0.18) * 13, target.z + Math.cos(rig.yaw) * cp * 13);
    camera.lookAt(0, 13, 12);   // high enough for the towers
  };

  /** Places the camera for this frame. Returns whether the player mesh should be drawn. */
  rig.update = (player, dt, colliders, portrait) => {
    const head = new THREE.Vector3(player.position.x, HEAD_Y, player.position.z);
    if (rig.firstPerson) {
      player.rotation.y = rig.yaw + Math.PI;
      const cp = Math.cos(rig.fpPitch);
      camera.position.set(player.position.x, EYE_HEIGHT, player.position.z);
      camera.lookAt(player.position.x - Math.sin(rig.yaw) * cp, EYE_HEIGHT + Math.sin(rig.fpPitch), player.position.z - Math.cos(rig.yaw) * cp);
      return false;
    }
    if (swing) {
      const k = Math.min(1, dt * 4);
      let dy = swing.yaw - rig.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      rig.yaw += dy * k;
      rig.pitch += (swing.pitch - rig.pitch) * k;
      rig.dist += (swing.dist - rig.dist) * k;
      if (Math.abs(dy) < 0.01 && Math.abs(swing.pitch - rig.pitch) < 0.01 && Math.abs(swing.dist - rig.dist) < 0.02) swing = null;
    }
    const want = rig.dist * (portrait ? 1.25 : 1);
    const pitch = Math.max(rig.pitch, lowest(want));
    const cp = Math.cos(pitch);
    const dir = new THREE.Vector3(Math.sin(rig.yaw) * cp, Math.sin(pitch), Math.cos(rig.yaw) * cp);
    ray.set(head, dir);
    ray.far = want;
    const hits = ray.intersectObjects(colliders, false);
    const limit = hits.length ? Math.max(0.45, hits[0].distance - 0.3) : want;
    curDist += (want - curDist) * Math.min(1, dt * 4);
    if (curDist > limit) curDist = limit;
    camera.position.copy(head).addScaledVector(dir, curDist);
    if (camera.position.y < MIN_Y) camera.position.y = MIN_Y;   // a wall pulled it in while low
    // from above look a little over the head; from low down look at the face itself
    camera.lookAt(head.x, head.y + 0.25 * clamp(pitch / 0.3, 0, 1) - 0.1 * clamp(-pitch / 0.3, 0, 1), head.z);
    return curDist > 0.95;
  };

  return rig;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
