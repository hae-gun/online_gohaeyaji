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
 *
 * Priests come in three looks that match their persona (o.look). All keep the cassock, collar
 * and purple stole, which is what any priest wears for confession; only body and face differ.
 *   jin  serious:  round glasses, neatly combed grey hair, plain brows
 *   eom  scolding: older, long narrow face, thick black brows, white moustache, square glasses
 *   yu   humorous: young, round chubby face, curly hair, rosy cheeks, no glasses
 *   baek hidden legend (1%): very old, white hair and brows, long white beard, gold-edged stole
 */
const LOOKS = {
  jin: { skin: 0xe8b994, body: [0.33, 0.46], skull: [1, 1, 1], brow: [0.12, 0.025, 0x55504a, 0], glasses: 'round', side: 0xb9b4ad, combed: 0x8f8a84 },
  eom: { skin: 0xdba88a, body: [0.31, 0.44], skull: [0.92, 1.12, 0.96], brow: [0.15, 0.05, 0x1c1916, -0.01], glasses: 'square', side: 0xe8e4dc, moustache: 0xe8e4dc },
  // baek: the hidden legendary priest. White hair, bushy white brows, a long white beard and a
  // gold-edged stole (still purple: it is what a priest wears for confession)
  baek: { skin: 0xf0cbae, body: [0.34, 0.5], skull: [1, 1.04, 1], brow: [0.16, 0.045, 0xf4f1ea, 0.015], glasses: null, side: 0xf4f1ea, combed: 0xf4f1ea, moustache: 0xf4f1ea, beard: 0xf4f1ea, trim: 0xe8c45a },
  yu:  { skin: 0xf2c6a0, body: [0.39, 0.52], skull: [1.13, 0.96, 1.05], brow: [0.1, 0.02, 0x4a2e1c, 0.01], glasses: null, curls: 0x3a2416, cheeks: 0xf08a8a },
};

export function makeFigure(o) {
  const g = new THREE.Group();
  const look = o.priest ? (LOOKS[o.look] || LOOKS.jin) : null;
  const skin = M(look ? look.skin : (o.skin || 0xefc39b));
  const legs = [];

  if (o.priest) {
    const cassock = new THREE.Mesh(new THREE.CylinderGeometry(look.body[0], look.body[1], 1.8, 7), M(0x161419)); cassock.position.y = 0.92; g.add(cassock);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.04), B(0xffffff)); collar.position.set(0, 1.76, 0.21); g.add(collar);
    // the stole lies on the front face of the cassock, which slopes outward toward the hem
    const [rTop, rBot] = look.body, slope = (rBot - rTop) / 1.8;
    const front = (y) => (rTop + (1.82 - y) * slope) * Math.cos(Math.PI / 7) + 0.025;
    for (const s of [-1, 1]) {
      const stole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.15, 0.03), M(0x8a5cc0, { shininess: 70 }));
      stole.position.set(s * 0.14, 1.18, front(1.18)); stole.rotation.set(-Math.atan(slope), 0, s * 0.08); g.add(stole);
      if (look.trim) {
        for (const e of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.018, 1.15, 0.035), B(look.trim)); edge.position.x = e * 0.052; stole.add(edge);
        }
      }
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
  if (look) skull.scale.set(...look.skull);

  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * 0.11, 0.34, 0.25);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), B(0xffffff)));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 5), B(0x111111)); pupil.position.z = 0.06; e.add(pupil);
    head.add(e); eyes.push(e);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.17, 5), skin); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.27, 0.33); head.add(nose);
  // mouth = a lip line plus a dark opening behind it; the priest's face animates both (confessional.js)
  const mouth = new THREE.Group(); mouth.position.set(0, 0.16, 0.28); head.add(mouth);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(o.priest ? 0.14 : 0.17, 0.025, 0.03), B(o.priest ? 0x5a2b22 : 0xc0392b));
  mouth.add(lip);
  const opening = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.02), B(0x7a1a14));
  opening.position.set(0, -0.012, 0.004); opening.scale.y = 0.01; opening.visible = false; mouth.add(opening);
  // lower lip drops with the jaw so open and closed read clearly from a distance
  const lowerLip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.022, 0.03), B(o.priest ? 0x5a2b22 : 0xc0392b));
  lowerLip.visible = false; mouth.add(lowerLip);
  const corners = [];
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 0.03), B(o.priest ? 0x5a2b22 : 0xc0392b));
    c.position.set(s * 0.078, 0, 0); mouth.add(c); corners.push(c);
  }
  const brows = [];

  if (o.priest) {
    const [bw, bh, bc, bdy] = look.brow;
    const sx = look.skull[0];
    for (const s of [-1, 1]) {
      // brows: mood sets y and tilt (confessional.js); dy shifts them per look
      const brow = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.03), B(bc)); brow.position.set(s * 0.11, 0.45 + bdy, 0.29); brow.rotation.z = -s * 0.12; head.add(brow);
      brow.userData.side = s; brow.userData.dy = bdy; brows.push(brow);
      if (look.glasses === 'round') {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 4, 10), B(0x222222)); rim.position.set(s * 0.11, 0.34, 0.31); head.add(rim);
      } else if (look.glasses === 'square') {
        // four bars instead of a torus: a heavy, old-fashioned square frame
        const fr = B(0x3a2a1a);
        for (const [w, h, x, y] of [[0.17, 0.018, 0, 0.065], [0.17, 0.018, 0, -0.06], [0.018, 0.14, -0.085, 0], [0.018, 0.14, 0.085, 0]]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.015), fr); bar.position.set(s * 0.11 + x, 0.34 + y, 0.31); head.add(bar);
        }
      }
      if (look.side) {
        const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.26), M(look.side)); tuft.position.set(s * 0.29 * sx, 0.32, -0.02); head.add(tuft);
      }
      if (look.cheeks) {
        const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.05, 6), B(look.cheeks)); cheek.position.set(s * 0.2, 0.21, 0.27 * sx); cheek.rotation.y = s * 0.55; head.add(cheek);
      }
    }
    if (look.glasses) {
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), B(0x222222)); bridge.position.set(0, 0.35, 0.32); head.add(bridge);
    }
    if (look.combed) {
      // short side-parted cap of hair
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.315, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), M(look.combed));
      cap.position.y = 0.31; cap.rotation.set(-0.3, 0, 0.12); head.add(cap);
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.22), B(0x6a655f)); part.position.set(0.1, 0.6, 0.06); part.rotation.z = -0.35; head.add(part);
    }
    if (look.moustache) {
      // two angled blocks, drooping at the ends: makes every line sound like a reprimand
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.05), M(look.moustache)); m.position.set(s * 0.055, 0.2, 0.3); m.rotation.z = s * -0.3; head.add(m);
      }
    }
    if (look.beard) {
      // a long blocky beard hanging below the mouth, wider at the chin, narrowing to a point
      const bm = M(look.beard);
      const chin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.2), bm); chin.position.set(0, -0.02, 0.2); head.add(chin);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 6), bm); tip.rotation.x = Math.PI; tip.position.set(0, -0.35, 0.2); head.add(tip);
      for (const s of [-1, 1]) {
        const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.22), bm); cheek.position.set(s * 0.26, 0.16, 0.1); head.add(cheek);
      }
    }
    if (look.curls) {
      // a crude mop of curls: a dozen low-poly balls around the top of the head
      const hm = M(look.curls);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, ring = i % 2 ? 0.2 : 0.26;
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), hm);
        c.position.set(Math.cos(a) * ring * sx, 0.5 + (i % 3) * 0.03, Math.sin(a) * ring - 0.04);
        if (c.position.z > 0.14) c.position.y += 0.04;   // keep the fringe above the brows
        head.add(c);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), hm); top.position.set(0, 0.6, -0.04); head.add(top);
    }
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

  g.userData = { legs, arms, head, eyes, ARM, face: { lip, opening, lowerLip, corners, brows } };
  return g;
}
