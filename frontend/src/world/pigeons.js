import * as THREE from 'three';
import { M } from '../core/three-utils.js';

/**
 * Pigeons in the plaza. Each one now and then flies in from the sky, lands on the tiles or the
 * fountain rim, walks around pecking with that jerky pigeon head, and flies off again after a while
 * or when someone walks up to it.
 *
 * Only for this viewer: pigeons are scenery, not shared state, so two people do not see the same
 * birds. That keeps them off the network entirely.
 */
const COUNT = 7;
const SCARE_DISTANCE = 2.3;
const FLY_SPEED = 7;

const rand = (a, b) => a + Math.random() * (b - a);
/** Wings swept back along the body, as a pigeon walking around holds them. */
const fold = (u) => u.wings.forEach((w) => { w.rotation.set(0, w.userData.side * 1.35, -w.userData.side * 0.25); });

function makePigeon() {
  const g = new THREE.Group();
  const grey = M(0x8f95a3), dark = M(0x5b6170), neck = M(0x5f8a7a, { shininess: 80 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), grey);
  body.scale.set(0.85, 0.8, 1.35); body.position.y = 0.15; g.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.14), dark);
  tail.position.set(0, 0.17, -0.2); tail.rotation.x = -0.25; g.add(tail);
  // head on a pivot so it can bob back and forth
  const head = new THREE.Group(); head.position.set(0, 0.24, 0.12); g.add(head);
  const nk = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 4), neck); nk.position.set(0, -0.02, 0); head.add(nk);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), grey); hd.position.set(0, 0.04, 0.03); head.add(hd);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 4), M(0xe0b35a));
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.035, 0.1); head.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), M(0xe2582c)); eye.position.set(s * 0.04, 0.055, 0.06); head.add(eye);
  }
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.09, 0.2, 0); g.add(pivot);
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.2), dark);
    w.position.set(s * 0.12, 0, -0.02); pivot.add(w);
    pivot.userData.side = s;
    wings.push(pivot);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 3), M(0xd0605a)); leg.position.set(s * 0.04, 0.035, 0.02); g.add(leg);
  }
  g.userData = { head, wings, body };
  return g;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ spots: () => THREE.Vector3, sky: () => THREE.Vector3 }} where landing spots and sky points
 */
export function createPigeons(scene, where) {
  const birds = [];
  for (let i = 0; i < COUNT; i++) {
    const mesh = makePigeon();
    mesh.visible = false;
    scene.add(mesh);
    // stagger the first arrivals so they do not all come at once
    birds.push({ mesh, state: 'away', timer: rand(2, 14) + i * 1.5, flap: Math.random() * 6 });
  }

  const tmp = new THREE.Vector3();
  function bezier(b, k, out) {
    const u = 1 - k;
    return out.set(0, 0, 0)
      .addScaledVector(b.p0, u * u).addScaledVector(b.p1, 2 * u * k).addScaledVector(b.p2, k * k);
  }

  function takeOff(b) {
    b.state = 'leaving';
    b.p0 = b.mesh.position.clone();
    b.p2 = where.sky();
    b.p1 = b.p0.clone().lerp(b.p2, 0.3); b.p1.y = b.p0.y + 2.2;
    b.k = 0; b.len = b.p0.distanceTo(b.p2);
  }

  function update(dt, t, people) {
    for (const b of birds) {
      const m = b.mesh, u = m.userData;
      if (b.state === 'away') {
        b.timer -= dt;
        if (b.timer > 0) continue;
        b.state = 'arriving';
        b.p0 = where.sky();
        b.p2 = where.spot();
        b.p1 = b.p0.clone().lerp(b.p2, 0.65); b.p1.y = b.p2.y + 4;
        b.k = 0; b.len = b.p0.distanceTo(b.p2);
        m.position.copy(b.p0);
        m.visible = true;
      }

      if (b.state === 'arriving' || b.state === 'leaving') {
        const before = m.position.clone();
        b.k = Math.min(1, b.k + (FLY_SPEED * dt) / b.len);
        // slow down for the landing
        const k = b.state === 'arriving' ? 1 - (1 - b.k) ** 2 : b.k * b.k * 0.6 + b.k * 0.4;
        bezier(b, k, m.position);
        tmp.subVectors(m.position, before);
        if (tmp.lengthSq() > 1e-6) {
          m.rotation.y = Math.atan2(tmp.x, tmp.z);
          m.rotation.x = -Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)) * 0.6;
        }
        b.flap += dt * (b.state === 'arriving' && b.k > 0.85 ? 34 : 22);
        const a = Math.sin(b.flap) * 1.1;
        u.wings.forEach((w) => { w.rotation.set(0, 0, a * w.userData.side); });
        if (b.k >= 1) {
          if (b.state === 'arriving') {
            b.state = 'ground';
            b.groundY = b.p2.y;
            b.timer = rand(15, 32);
            b.step = 0; b.target = null; b.peck = 0;
            m.rotation.x = 0;
            fold(u);
          } else {
            b.state = 'away';
            b.timer = rand(14, 34);
            m.visible = false;
          }
        }
        continue;
      }

      // on the ground: wander in short hops, peck, and keep an eye on people
      b.timer -= dt;
      let scared = false;
      for (const p of people) if (Math.hypot(p.x - m.position.x, p.z - m.position.z) < SCARE_DISTANCE) { scared = true; break; }
      if (scared || b.timer <= 0) { takeOff(b); continue; }

      b.step -= dt;
      if (b.target) {
        tmp.subVectors(b.target, m.position); tmp.y = 0;
        const d = tmp.length();
        if (d < 0.03) b.target = null;
        else {
          const s = Math.min(d, 0.55 * dt);
          m.position.addScaledVector(tmp.normalize(), s);
          m.rotation.y = Math.atan2(tmp.x, tmp.z);
          // the famous pigeon walk: head thrusts forward each step
          u.head.position.z = 0.12 + Math.max(0, Math.sin(t * 16)) * 0.045;
          m.position.y = b.groundY + Math.abs(Math.sin(t * 16)) * 0.01;
        }
      } else if (b.step <= 0) {
        b.step = rand(0.6, 2.2);
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2, r = rand(0.2, 0.7);
          b.target = new THREE.Vector3(m.position.x + Math.cos(a) * r, b.groundY, m.position.z + Math.sin(a) * r);
          if (!where.ok(b.target)) b.target = null;
        } else b.peck = 0.5;
      }
      if (b.peck > 0) {
        b.peck -= dt;
        u.head.rotation.x = Math.max(0, Math.sin((0.5 - b.peck) * Math.PI * 6)) * 0.9;
        u.head.position.y = 0.24 - u.head.rotation.x * 0.06;
      } else {
        u.head.rotation.x *= 0.8;
        u.head.position.y = 0.24;
      }
    }
  }

  return {
    update,
    /** for tests: how many are visible right now */
    get visible() { return birds.filter((b) => b.mesh.visible).length; },
    _birds: birds,
  };
}

/** Hooks the plaza into the flock: where pigeons may land, where they come from and go to. */
export function plazaPigeonSpots(fountain, obstacles) {
  const sky = () => {
    const a = rand(-Math.PI * 0.9, Math.PI * 0.9);
    return new THREE.Vector3(Math.sin(a) * 40, rand(14, 22), fountain.z + Math.cos(a) * 40);
  };
  const ok = (v) => {
    if (Math.abs(v.x) > 12.5 || v.z < 12 || v.z > 34) return false;
    if (v.y > 0.1) return true;   // on the rim
    for (const o of obstacles) if (Math.hypot(v.x - o.x, v.z - o.z) < o.r + 0.1) return false;
    return true;
  };
  const spot = () => {
    for (let i = 0; i < 30; i++) {
      let v;
      if (Math.random() < 0.3) {
        // on the fountain rim
        const a = Math.random() * Math.PI * 2;
        v = new THREE.Vector3(fountain.x + Math.cos(a) * 3.05, 0.78, fountain.z + Math.sin(a) * 3.05);
      } else {
        v = new THREE.Vector3(rand(-10, 10), 0, rand(14, 32));
      }
      if (ok(v)) return v;
    }
    return new THREE.Vector3(5, 0, 26);
  };
  // ground height under the bird is remembered at landing (rim or tiles)
  return {
    sky,
    ok: (v) => {
      // a rim pigeon walks along the rim only
      const r = Math.hypot(v.x - fountain.x, v.z - fountain.z);
      if (v.y > 0.1) return Math.abs(r - 3.05) < 0.12;
      return ok(v);
    },
    spot,
  };
}
