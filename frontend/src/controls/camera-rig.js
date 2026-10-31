import * as THREE from 'three';
import { EYE_HEIGHT } from '../world/figure.js';

/**
 * Third person orbit camera with wall collision, plus a first person mode.
 *
 * Input: one-finger or mouse drag rotates, wheel or pinch zooms, a short tap
 * (no drag) is reported through onTap so main.js can walk the player there.
 */
export function createCameraRig({ canvas, camera, isActive, onTap }) {
  const rig = {
    yaw: 0,          // 0 = camera behind the player looking down -z
    pitch: 0.38,
    dist: 6.4,
    firstPerson: false,
    fpPitch: -0.05,
  };
  let curDist = rig.dist;
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
        rig.yaw -= dx * 0.0065;
        if (rig.firstPerson) rig.fpPitch = clamp(rig.fpPitch - dy * 0.005, -1.1, 1.1);
        else rig.pitch = clamp(rig.pitch + dy * 0.005, 0.04, 1.3);
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
    camera.lookAt(0, 6.5, 14);
  };

  /** Places the camera for this frame. Returns whether the player mesh should be drawn. */
  rig.update = (player, dt, colliders, portrait) => {
    const head = new THREE.Vector3(player.position.x, 1.3, player.position.z);
    if (rig.firstPerson) {
      player.rotation.y = rig.yaw + Math.PI;
      const cp = Math.cos(rig.fpPitch);
      camera.position.set(player.position.x, EYE_HEIGHT, player.position.z);
      camera.lookAt(player.position.x - Math.sin(rig.yaw) * cp, EYE_HEIGHT + Math.sin(rig.fpPitch), player.position.z - Math.cos(rig.yaw) * cp);
      return false;
    }
    const cp = Math.cos(rig.pitch);
    const dir = new THREE.Vector3(Math.sin(rig.yaw) * cp, Math.sin(rig.pitch), Math.cos(rig.yaw) * cp);
    const want = rig.dist * (portrait ? 1.25 : 1);
    ray.set(head, dir);
    ray.far = want;
    const hits = ray.intersectObjects(colliders, false);
    const limit = hits.length ? Math.max(0.45, hits[0].distance - 0.3) : want;
    curDist += (want - curDist) * Math.min(1, dt * 4);
    if (curDist > limit) curDist = limit;
    camera.position.copy(head).addScaledVector(dir, curDist);
    camera.lookAt(head.x, head.y + 0.25, head.z);
    return curDist > 0.95;
  };

  return rig;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
