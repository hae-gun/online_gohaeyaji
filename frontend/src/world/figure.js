import * as THREE from 'three';
import { M, B } from '../core/three-utils.js';
import { createPixelFace } from './pixel-face.js';

/**
 * Cute and a bit botched ("밤티"): short chibi bodies from a handful of low-poly shapes, big round
 * heads, and a flat pixel face stuck on the front (pixel-face.js). No model or image files.
 * Things are slightly off on purpose: crooked collar, stole strips of different lengths.
 *
 * The priest's clothes stay correct whatever the body looks like: black cassock, white roman
 * collar, purple stole (what a priest wears for confession). The silliness is in the shapes,
 * never in the vestments.
 *
 * Priest looks (o.look):
 *   jin  serious:  egg head, one antenna hair, big round glasses
 *   eom  scolding: tofu box head, caterpillar monobrow, droopy moustache, the shortest of all
 *   yu   humorous: steamed-bun body, broccoli curls, heavy blush, D-shaped grin
 *   baek hidden legend (1%): white topknot, droopy white brows, long white beard, gold-edged stole
 *
 * The figure faces +z. userData:
 *   legs, arms (R/L from the figure's own view), head, ARM (arm length), face (pixel face: set(state)),
 *   pose (points the sign of the cross aims for, in the figure's own space).
 */
const LOOKS = {
  jin:  { skin: 0xe8b994, robe: [0.26, 0.5, 1.0], head: { r: 0.44, scale: [0.95, 1.12, 0.95] }, side: 0xb9b4ad, antenna: 0x3a3530 },
  eom:  { skin: 0xdca088, robe: [0.24, 0.44, 0.8], head: { box: [0.74, 0.66, 0.66] }, side: 0xefebe3, steam: true },
  yu:   { skin: 0xf2c6a0, robe: [0.36, 0.58, 0.95], head: { r: 0.46, scale: [1.12, 0.95, 1] }, curls: 0x3a2416 },
  baek: { skin: 0xf0cbae, robe: [0.28, 0.54, 1.05], head: { r: 0.44, scale: [1, 1.04, 1] }, side: 0xf4f1ea, beard: 0xf4f1ea, trim: 0xe8c45a, bun: 0xf4f1ea },
};
const KID_FACES = ['derpy', 'plain', 'sleepy', 'shock'];

const ROBE = 0x1b181e;

function headShape(g, spec, skin, y) {
  const head = new THREE.Group();
  head.position.y = y;
  g.add(head);
  let front;
  if (spec.box) {
    const [w, h, d] = spec.box;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skin));
    front = d / 2 + 0.005;
  } else {
    const sk = new THREE.Mesh(new THREE.SphereGeometry(spec.r, 7, 5), skin);
    sk.scale.set(...spec.scale);
    head.add(sk);
    front = spec.r * spec.scale[2] * 0.93;
  }
  return { head, front };
}

function mittens(g, sleeve, skin, shoulderX, shoulderY, ARM) {
  const arms = {};
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * shoulderX, shoulderY, 0);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, ARM, 5), M(sleeve));
    arm.position.y = -ARM / 2;
    pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), skin);
    hand.position.y = -ARM;
    pivot.add(hand);
    g.add(pivot);
    arms[s < 0 ? 'R' : 'L'] = pivot;   // figure faces +z, so its right hand is on -x
  }
  return arms;
}

function makePriest(o) {
  const id = o.look in LOOKS ? o.look : 'jin';
  const look = LOOKS[id];
  const g = new THREE.Group();
  const skin = M(look.skin);
  const [top, bottom, h] = look.robe;

  // bell-shaped cassock: a lathe profile with few segments so the facets show
  const profile = [[bottom, 0], [bottom * 0.96, h * 0.22], [bottom * 0.74, h * 0.6], [top * 1.08, h * 0.9], [top, h], [0.001, h]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  // LatheGeometry wants the profile from top to bottom for outward-facing sides
  g.add(new THREE.Mesh(new THREE.LatheGeometry([...profile].reverse(), 7), M(ROBE)));
  const radiusAt = (y) => {
    for (let i = 0; i < profile.length - 2; i++) {
      const a = profile[i], b = profile[i + 1];
      if (y >= a.y && y <= b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    }
    return top;
  };
  const frontAt = (y) => radiusAt(y) * Math.cos(Math.PI / 7) + 0.02;

  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.04), B(0xffffff));
  collar.position.set(0.012, h - 0.03, frontAt(h - 0.03) + 0.01);
  collar.rotation.z = 0.09;   // a little crooked
  g.add(collar);

  // stole: two purple strips down the front, one longer than the other
  [[-1, 0.62], [1, 0.54]].forEach(([s, frac]) => {
    const y1 = h - 0.06, y2 = h * (1 - frac);
    const z1 = frontAt(y1), z2 = frontAt(y2);
    const len = Math.hypot(y1 - y2, z2 - z1);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, len, 0.025), M(0x8a5cc0, { shininess: 70 }));
    strip.position.set(s * 0.085, (y1 + y2) / 2, (z1 + z2) / 2);
    strip.rotation.set(-Math.atan2(z2 - z1, y1 - y2), 0, s * 0.07);
    if (look.trim) {
      for (const e of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.014, len, 0.03), B(look.trim));
        edge.position.x = e * 0.038;
        strip.add(edge);
      }
    }
    g.add(strip);
  });

  const headR = look.head.box ? look.head.box[1] / 2 : look.head.r * look.head.scale[1];
  const headY = h + headR * 0.82;
  const { head, front } = headShape(g, look.head, skin, headY);
  const face = createPixelFace(id, look.head.box ? 0.7 : look.head.r * 1.55);
  face.mesh.position.set(0, look.head.box ? -0.01 : -0.02, front);
  head.add(face.mesh);

  const halfW = look.head.box ? look.head.box[0] / 2 : look.head.r * look.head.scale[0];
  if (look.side) {
    for (const s of [-1, 1]) {
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.32), M(look.side));
      tuft.position.set(s * (halfW + 0.01), 0.02, -0.05);
      head.add(tuft);
    }
  }
  if (look.antenna) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), B(look.antenna));
    ant.position.set(0.04, headR + 0.12, 0); ant.rotation.z = -0.25; head.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 3), B(look.antenna));
    tip.position.set(0.08, headR + 0.27, 0); head.add(tip);
  }
  if (look.curls) {
    const hm = M(look.curls);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2, r = i % 2 ? 0.26 : 0.34;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.13, 5, 4), hm);
      c.position.set(Math.cos(a) * r, 0.36 + (i % 3) * 0.04, Math.sin(a) * r * 0.8 - 0.1);
      head.add(c);
    }
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.18, 5, 4), hm);
    crown.position.set(0.02, 0.5, -0.08); head.add(crown);
  }
  if (look.bun) {
    // a little white topknot on an otherwise bald head
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), M(look.bun));
    bun.position.set(-0.03, headR + 0.04, -0.06); head.add(bun);
  }
  if (look.beard) {
    // long blocky beard from the chin almost to the waist
    const bm = M(look.beard);
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.22), bm); chin.position.set(0, -headR * 0.72, front - 0.12); head.add(chin);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 5), bm); tip.rotation.x = Math.PI; tip.position.set(0.02, -headR * 0.72 - 0.36, front - 0.1); head.add(tip);
  }
  if (look.steam) {
    // he is always slightly steaming
    [[0.18, 0.5, 0.1], [0.3, 0.64, 0.075], [0.12, 0.76, 0.055]].forEach(([x, y, r]) => {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4), B(0xf4f1ea)); p.position.set(x, y, 0); head.add(p);
    });
  }

  const ARM = 0.34;
  const shoulderX = top + 0.06, shoulderY = h - 0.1;
  const arms = mittens(g, ROBE, skin, shoulderX, shoulderY, ARM);

  const chestY = h - 0.24, chestZ = frontAt(chestY) + 0.1;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const pose = {
    shoulder: { R: v(-shoulderX, shoulderY, 0), L: v(shoulderX, shoulderY, 0) },
    rest: { R: v(-shoulderX - 0.12, shoulderY - 0.32, 0.05), L: v(shoulderX + 0.12, shoulderY - 0.32, 0.05) },
    forehead: v(0, headY + headR * 0.45, front + 0.06),
    chest: v(0, chestY, chestZ),
    lShoulder: v(top * 0.95, h - 0.02, chestZ - 0.04),
    rShoulder: v(-top * 0.95, h - 0.02, chestZ - 0.04),
    pray: { R: v(-0.035, chestY - 0.05, chestZ + 0.14), L: v(0.035, chestY - 0.05, chestZ + 0.14) },
  };

  g.userData = { legs: [], arms, head, ARM, face, pose };
  return g;
}

function makeKid(o) {
  const g = new THREE.Group();
  const skin = M(o.skin || 0xefc39b);
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * 0.13, 0.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.24, 5), M(o.pants)); leg.position.y = -0.14; p.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.26), M(0x2b2b2e)); shoe.position.set(0, -0.26, 0.04); p.add(shoe);
    g.add(p); legs.push(p);
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.33, 0.5, 6), M(o.shirt)); body.position.y = 0.54; g.add(body);
  const arms = mittens(g, o.shirt, skin, 0.3, 0.74, 0.3);

  const r = 0.42;
  const { head, front } = headShape(g, { r, scale: [1.05, 0.98, 1] }, skin, 1.16);
  // uneven hair cap, tipped a little to one side
  const hair = new THREE.Mesh(new THREE.SphereGeometry(r + 0.02, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.38), M(o.hair || 0x3b2618));
  hair.position.y = 0.02; hair.rotation.set(-0.35, 0, 0.15); head.add(hair);
  const variant = o.face || KID_FACES[Math.abs(o.seed || 0) % KID_FACES.length];
  const face = createPixelFace('kid', r * 1.55, variant);
  face.mesh.position.set(0, -0.02, front);
  head.add(face.mesh);

  // points the emotes reach for (emotes.js), in the kid's own space
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const pose = {
    shoulder: { R: v(-0.3, 0.74, 0), L: v(0.3, 0.74, 0) },
    headTop: 1.16 + r,
    forehead: v(0, 1.32, front + 0.06),
    chest: v(0, 0.6, 0.4),
    lShoulder: v(0.2, 0.8, 0.36),
    rShoulder: v(-0.2, 0.8, 0.36),
    pray: { R: v(-0.035, 0.66, 0.44), L: v(0.035, 0.66, 0.44) },
    // above the big head, not beside it, or the hands vanish behind the hair
    up: { R: v(-0.5, 1.9, 0.1), L: v(0.5, 1.9, 0.1) },
    halfUp: { R: v(-0.62, 1.45, 0.12), L: v(0.62, 1.45, 0.12) },
    limp: { R: v(-0.26, 0.42, 0.22), L: v(0.26, 0.42, 0.22) },
  };
  g.userData = { legs, arms, head, ARM: 0.3, face, pose };
  return g;
}

/**
 * @param {{ priest?: boolean, look?: 'jin'|'eom'|'yu'|'baek',
 *           shirt?: number, pants?: number, hair?: number, skin?: number,
 *           face?: 'derpy'|'plain'|'sleepy'|'shock', seed?: number }} o
 *   kids: face picks the expression; without it, seed (e.g. the pid) picks one
 */
export function makeFigure(o) {
  return o.priest ? makePriest(o) : makeKid(o);
}

/** Height where a name label sits above a kid's head. */
export const NAME_HEIGHT = 1.78;
/** First person eye height for the kid. */
export const EYE_HEIGHT = 1.2;
