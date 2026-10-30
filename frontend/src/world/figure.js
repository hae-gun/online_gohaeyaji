import * as THREE from 'three';
import { M, B } from '../core/three-utils.js';

/**
 * Crude 90s edutainment style figures built from primitives, no model files.
 * Original designs: the player is a plain kid in a red shirt, the priest wears
 * a black cassock, white roman collar, round glasses and a purple stole
 * (the stole a priest actually wears when hearing confession).
 *
 * The figure faces +z. userData exposes legs, arms (R/L from the figure's own view),
 * head, eyes and ARM (arm length) for animation.
 */
export function makeFigure(o) {
  const g = new THREE.Group();
  const skin = M(o.skin || 0xefc39b);
  const legs = [];

  if (o.priest) {
    const cassock = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.46, 1.8, 7), M(0x161419)); cassock.position.y = 0.92; g.add(cassock);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.04), B(0xffffff)); collar.position.set(0, 1.76, 0.21); g.add(collar);
    for (const s of [-1, 1]) {
      const stole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.15, 0.03), M(0x8a5cc0, { shininess: 70 }));
      stole.position.set(s * 0.14, 1.18, 0.25); stole.rotation.z = s * 0.08; g.add(stole);
    }
  } else {
    for (const s of [-1, 1]) {
      const p = new THREE.Group(); p.position.set(s * 0.14, 0.95, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.9, 6), M(o.pants)); leg.position.y = -0.45; p.add(leg);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.28), M(0x2b2b2e)); shoe.position.set(0, -0.88, 0.05); p.add(shoe);
      g.add(p); legs.push(p);
    }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.86, 0.36), M(o.shirt)); torso.position.y = 1.37; g.add(torso);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 6), o.priest ? M(0x161419) : skin); neck.position.y = 1.82; g.add(neck);
  const head = new THREE.Group(); head.position.y = 1.84; g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 9, 7), skin); skull.position.y = 0.3; head.add(skull);

  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * 0.11, 0.34, 0.25);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), B(0xffffff)));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 5), B(0x111111)); pupil.position.z = 0.06; e.add(pupil);
    head.add(e); eyes.push(e);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.17, 5), skin); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.27, 0.33); head.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(o.priest ? 0.14 : 0.17, 0.025, 0.03), B(o.priest ? 0x5a2b22 : 0xc0392b));
  mouth.position.set(0, 0.16, 0.28); head.add(mouth);

  if (o.priest) {
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 4, 10), B(0x222222)); rim.position.set(s * 0.11, 0.34, 0.31); head.add(rim);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.03), B(0x55504a)); brow.position.set(s * 0.11, 0.45, 0.29); brow.rotation.z = -s * 0.12; head.add(brow);
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.26), M(0xb9b4ad)); tuft.position.set(s * 0.29, 0.32, -0.02); head.add(tuft);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), B(0x222222)); bridge.position.set(0, 0.35, 0.32); head.add(bridge);
  } else {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.315, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), M(o.hair || 0x3b2618));
    hair.position.y = 0.31; hair.rotation.x = -0.25; head.add(hair);
  }

  const ARM = 0.78, arms = {};
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.38, 1.7, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, ARM, 6), o.priest ? M(0x161419) : M(o.shirt)); arm.position.y = -ARM / 2; pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 7, 5), skin); hand.position.y = -ARM; pivot.add(hand);
    g.add(pivot);
    arms[s < 0 ? 'R' : 'L'] = pivot; // figure faces +z, so its right hand is on -x
  }

  g.userData = { legs, arms, head, eyes, ARM };
  return g;
}
