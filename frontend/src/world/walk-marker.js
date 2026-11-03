import * as THREE from 'three';

/**
 * Where a tap or click is taking me: a gold ring that breathes on the spot I walk to, a row of
 * small dots along the way that disappear as I pass them, and a ripple where I tapped. When the
 * spot cannot be reached, a short red ripple instead.
 *
 * Only on my screen; nothing is sent to the server.
 */
const Y = 0.035;              // just above the floor and the carpet
const DOT_GAP = 0.55;         // metres between dots
const MAX_DOTS = 160;

export function createWalkMarker(scene) {
  const gold = new THREE.MeshBasicMaterial({ color: 0xf3d27a, transparent: true, opacity: 0.9, depthWrite: false });
  const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };

  // the destination: a ring and a dot in the middle
  // a dark rim under the gold keeps it visible on light tiles as well as on grass
  const shade = new THREE.MeshBasicMaterial({ color: 0x2a1d16, transparent: true, opacity: 0.45, depthWrite: false });
  const target = new THREE.Group();
  target.add(new THREE.Mesh(flat(new THREE.RingGeometry(0.32, 0.56, 40)), shade));
  target.add(new THREE.Mesh(flat(new THREE.RingGeometry(0.36, 0.5, 40)), gold));
  target.add(new THREE.Mesh(flat(new THREE.CircleGeometry(0.15, 24)), shade));
  target.add(new THREE.Mesh(flat(new THREE.CircleGeometry(0.11, 24)), gold));
  target.visible = false;
  target.renderOrder = 2;
  scene.add(target);

  // the dots along the way
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, depthWrite: false });
  const dots = new THREE.InstancedMesh(flat(new THREE.CircleGeometry(0.08, 14)), dotMat, MAX_DOTS);
  dots.count = 0;
  dots.frustumCulled = false;
  scene.add(dots);
  const m4 = new THREE.Matrix4();

  // the ripple where I tapped (gold) or could not go (red)
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xf3d27a, transparent: true, opacity: 0, depthWrite: false });
  const ripple = new THREE.Mesh(flat(new THREE.RingGeometry(0.4, 0.52, 40)), rippleMat);
  ripple.visible = false;
  scene.add(ripple);
  let rippleT = 1;

  let t = 0;
  return {
    /**
     * Call after a tap. path: the planned waypoints (empty when the spot cannot be reached);
     * at: where the tap hit the floor.
     */
    tapped(path, at) {
      rippleT = 0;
      ripple.visible = true;
      const end = path.length ? path[path.length - 1] : at;
      ripple.position.set(end.x, Y, end.z);
      rippleMat.color.set(path.length ? 0xf3d27a : 0xe2584c);
    },

    /** Every frame: follows what is left of the path. show=false hides everything (inside a booth). */
    update(dt, path, from, show = true) {
      t += dt;
      if (rippleT < 1) {
        rippleT = Math.min(1, rippleT + dt * 1.8);
        ripple.scale.setScalar(0.6 + rippleT * 1.4);
        rippleMat.opacity = 0.9 * (1 - rippleT);
        if (rippleT >= 1) ripple.visible = false;
      }
      if (!show || !path.length) {
        target.visible = false;
        dots.count = 0;
        return;
      }
      const end = path[path.length - 1];
      target.visible = true;
      target.position.set(end.x, Y, end.z);
      target.scale.setScalar(1 + Math.sin(t * 5) * 0.12);

      // dots from where I stand through the remaining waypoints, stopping short of the ring
      let n = 0, ax = from.x, az = from.z, carry = DOT_GAP * 0.8;
      for (let i = 0; i < path.length && n < MAX_DOTS; i++) {
        const bx = path[i].x, bz = path[i].z, len = Math.hypot(bx - ax, bz - az);
        let d = carry;
        for (; d < len && n < MAX_DOTS; d += DOT_GAP) {
          const k = d / len, x = ax + (bx - ax) * k, z = az + (bz - az) * k;
          if (Math.hypot(end.x - x, end.z - z) < 0.65) break;
          dots.setMatrixAt(n++, m4.makeTranslation(x, Y, z));
        }
        carry = d - len;
        ax = bx; az = bz;
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
    },
  };
}
