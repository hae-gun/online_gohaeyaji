import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { M, B } from '../core/three-utils.js';
import { createPixelFace, faceCap } from './pixel-face.js';

/**
 * Round and squishy chibi figures: big round heads, short bean bodies, mitten hands, all smooth
 * shapes with no visible facets. The face is painted round (pixel-face.js) and wraps onto the
 * front of the head. No model or image files.
 * Things are still slightly off on purpose: crooked collar, stole strips of different lengths.
 *
 * The priest's clothes stay correct whatever the body looks like: black cassock, white roman
 * collar, purple stole (what a priest wears for confession). The silliness is in the shapes,
 * never in the vestments.
 *
 * Priest looks (o.look):
 *   jin  serious:  egg head, one antenna hair with a ball on top, big round glasses
 *   eom  scolding: soft tofu head (rounded box), caterpillar monobrow, droopy moustache, the shortest
 *   yu   humorous: steamed-bun body, curly hair, heavy blush, D-shaped grin
 *   baek hidden legend (1%): white topknot, droopy white brows, long fluffy white beard, gold-edged stole
 *
 * The figure faces +z. userData:
 *   legs, arms (R/L from the figure's own view), head, ARM (arm length), face (pixel face: set(state)),
 *   pose (points the sign of the cross aims for, in the figure's own space).
 */
const LOOKS = {
  jin:  { skin: 0xf0c3a0, robe: [0.26, 0.5, 1.0], head: { r: 0.44, scale: [0.95, 1.12, 0.95] }, side: 0xb9b4ad, antenna: 0x3a3530 },
  eom:  { skin: 0xe6ab92, robe: [0.24, 0.44, 0.8], head: { box: [0.74, 0.66, 0.66] }, side: 0xefebe3, steam: true },
  yu:   { skin: 0xf6cfaa, robe: [0.36, 0.58, 0.95], head: { r: 0.46, scale: [1.12, 0.95, 1] }, curls: 0x4a2e1c },
  baek: { skin: 0xf4d3b8, robe: [0.28, 0.54, 1.05], head: { r: 0.44, scale: [1, 1.04, 1] }, side: 0xf4f1ea, beard: 0xf8f6f0, trim: 0xe8c45a, bun: 0xf4f1ea },
};
const KID_FACES = ['derpy', 'plain', 'sleepy', 'shock'];

const ROBE = 0x302a38;              // still reads black, just a softer black
const ROUND = 28;                     // segments around anything round
const ball = (r) => new THREE.SphereGeometry(r, 20, 14);
const soft = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999);

/** Head at height y. Round heads get the face wrapped on the front; the tofu head gets it flat. */
function headShape(g, spec, skin, y, face, faceSize) {
  const head = new THREE.Group();
  head.position.y = y;
  g.add(head);
  let front;
  if (spec.box) {
    const [w, h, d] = spec.box;
    head.add(new THREE.Mesh(soft(w, h, d, 0.2), skin));
    front = d / 2 + 0.005;
    face.mesh.position.set(0, -0.01, front);
    head.add(face.mesh);
  } else {
    const sk = new THREE.Mesh(new THREE.SphereGeometry(spec.r, 36, 28), skin);
    sk.scale.set(...spec.scale);
    head.add(sk);
    front = spec.r * spec.scale[2] * 0.93;
    face.mesh.geometry.dispose();
    face.mesh.geometry = faceCap(spec.r, faceSize);
    sk.add(face.mesh);   // inherits the head's squash
  }
  return { head, front };
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/*
 * Arms and legs are drawn as one mesh each (vertex colours for sleeve and hand, trouser and shoe)
 * instead of five and two: with a channel full of people that is 6 draw calls per person instead of
 * 14. The shapes are a little coarser than the head, which is where people look.
 */
const flat = (geo) => (geo.index ? geo.toNonIndexed() : geo);
const ARM_BALL = flat(new THREE.SphereGeometry(1, 12, 8));        // scaled to the arm's thickness
const ARM_TUBE = flat(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true));   // scaled into each segment
const HAND = flat(new THREE.SphereGeometry(0.12, 14, 10));
/** Material for meshes coloured per vertex. */
const painted = () => M(0xffffff, { vertexColors: true });

/** Joins geometries that never move relative to each other, each with its own colour and placement. */
function joinColored(parts) {
  const geos = parts.map(([geo, color, matrix]) => {
    const g = flat(geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const count = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3]]) {
    const arr = new Float32Array(count * size);
    let k = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, k); k += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/**
 * Bendy two-part arms with round mitten hands.
 *
 * Animations only move the invisible pivot at the shoulder (rotation and scale.y, see emotes.js and
 * the sign of the cross in confessional.js): its -y axis points at where the hand goes and scale.y
 * says how far, so the short arms can still reach the forehead. The visible arm is rebuilt from
 * that every frame: shoulder, an elbow, and the hand at the target. The elbow swings forward the
 * more the hand goes up or across the body, so the arm goes around the big head and round belly
 * instead of through them, and outward when the hand goes out to the side (hands up). The hand is
 * never stretched.
 *
 * Each arm is one mesh (shoulder, upper arm, elbow, forearm, hand) whose vertices are rewritten
 * only when the hand moved, so people standing still cost nothing per frame.
 */
function mittens(g, sleeve, skin, shoulderX, shoulderY, ARM, thick = 0.09) {
  const arms = {};
  const sleeveC = new THREE.Color(sleeve), skinC = skin.color.clone();
  const S = new THREE.Vector3(), H = new THREE.Vector3(), E = new THREE.Vector3(), tmp = new THREE.Vector3();
  const q = new THREE.Quaternion(), v = new THREE.Vector3();
  const nb = ARM_BALL.attributes.position.count, nt = ARM_TUBE.attributes.position.count, nh = HAND.attributes.position.count;
  const total = nb * 2 + nt * 2 + nh;

  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * shoulderX, shoulderY, 0);
    g.add(pivot);

    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      const c = i >= total - nh ? skinC : sleeveC;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(pos, 3), norA = new THREE.BufferAttribute(nor, 3);
    posA.setUsage(THREE.DynamicDrawUsage); norA.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', posA);
    geo.setAttribute('normal', norA);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // wherever the hand goes, it stays within this sphere around the shoulder
    geo.boundingSphere = new THREE.Sphere(pivot.position.clone(), ARM * 3 + 0.4);
    const mesh = new THREE.Mesh(geo, painted());
    g.add(mesh);

    // writes one part into the arm's buffers at vertex `at`
    const ball = (src, at, center, r) => {
      const p = src.attributes.position.array, n = src.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        const o = at * 3 + i;
        pos[o] = center.x + p[i] * r; pos[o + 1] = center.y + p[i + 1] * r; pos[o + 2] = center.z + p[i + 2] * r;
        nor[o] = n[i]; nor[o + 1] = n[i + 1]; nor[o + 2] = n[i + 2];
      }
    };
    const tube = (at, A, B) => {
      tmp.subVectors(B, A);
      const len = Math.max(0.001, tmp.length());
      q.setFromUnitVectors(UP, tmp.divideScalar(len));
      const p = ARM_TUBE.attributes.position.array, n = ARM_TUBE.attributes.normal.array;
      for (let i = 0; i < p.length; i += 3) {
        const o = at * 3 + i;
        v.set(p[i] * thick, p[i + 1] * len, p[i + 2] * thick).applyQuaternion(q);
        pos[o] = v.x + (A.x + B.x) / 2; pos[o + 1] = v.y + (A.y + B.y) / 2; pos[o + 2] = v.z + (A.z + B.z) / 2;
        v.set(n[i], n[i + 1], n[i + 2]).applyQuaternion(q);
        nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
      }
    };

    let lastX = NaN, lastY = NaN, lastZ = NaN;
    const sync = () => {
      S.copy(pivot.position);
      H.set(0, -ARM * pivot.scale.y, 0).applyQuaternion(pivot.quaternion).add(S);
      if (Math.abs(H.x - lastX) < 1e-5 && Math.abs(H.y - lastY) < 1e-5 && Math.abs(H.z - lastZ) < 1e-5) return;
      lastX = H.x; lastY = H.y; lastZ = H.z;
      const up = clamp((H.y - (S.y - ARM)) / ARM, 0, 1.5) / 1.5;          // 0 hanging .. 1 well above the shoulder
      const across = clamp(((H.x - S.x) * -s) / shoulderX, 0, 2) / 2;    // 0 at the side .. 1 past the middle
      const outside = clamp(((H.x - S.x) * s) / 0.2, 0, 1);              // hand out to the side
      const fwd = (0.05 + 0.3 * up + 0.28 * across) * (1 - 0.8 * outside);
      const out = 0.04 + 0.25 * outside * up;
      E.addVectors(S, H).multiplyScalar(0.5);
      E.x += s * out; E.y -= 0.05 * up; E.z += fwd;
      // order in the buffers: shoulder, elbow, upper arm, forearm, hand
      ball(ARM_BALL, 0, S, thick);
      ball(ARM_BALL, nb, E, thick);
      tube(nb * 2, S, E);
      tube(nb * 2 + nt, E, H);
      ball(HAND, nb * 2 + nt * 2, H, 1);
      posA.needsUpdate = true; norA.needsUpdate = true;
    };
    mesh.onBeforeRender = sync;
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

  // bell-shaped cassock with a rounded hem and soft shoulders. Lathe profiles here go bottom to
  // top, which makes the surface face outward; reversed, it is hollow and you see through it
  const profile = [[0.001, 0], [bottom * 0.9, 0], [bottom, h * 0.04], [bottom * 0.97, h * 0.2], [bottom * 0.8, h * 0.5],
    [top * 1.12, h * 0.82], [top * 1.04, h * 0.95], [top * 0.75, h * 1.0], [0.001, h]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, ROUND), M(ROBE)));
  const side = profile.slice(1, -1);
  const radiusAt = (y) => {
    for (let i = 0; i < side.length - 1; i++) {
      const a = side[i], b = side[i + 1];
      if (y >= a.y && y <= b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
    }
    return top;
  };
  const frontAt = (y) => radiusAt(y) + 0.02;

  const collar = new THREE.Mesh(soft(0.14, 0.06, 0.04, 0.02), B(0xffffff));
  collar.position.set(0.012, h - 0.05, frontAt(h - 0.05) + 0.01);
  collar.rotation.z = 0.09;   // a little crooked
  g.add(collar);

  // stole: two purple strips down the front, one longer than the other
  [[-1, 0.62], [1, 0.54]].forEach(([s, frac]) => {
    const y1 = h - 0.08, y2 = h * (1 - frac);
    const z1 = frontAt(y1), z2 = frontAt(y2);
    const len = Math.hypot(y1 - y2, z2 - z1);
    const strip = new THREE.Mesh(soft(0.085, len, 0.03, 0.014), M(0x9467cc, { shininess: 50 }));
    strip.position.set(s * 0.085, (y1 + y2) / 2, (z1 + z2) / 2);
    strip.rotation.set(-Math.atan2(z2 - z1, y1 - y2), 0, s * 0.07);
    if (look.trim) {
      for (const e of [-1, 1]) {
        const edge = new THREE.Mesh(soft(0.016, len, 0.034, 0.007), B(look.trim));
        edge.position.x = e * 0.038;
        strip.add(edge);
      }
    }
    g.add(strip);
  });

  const headR = look.head.box ? look.head.box[1] / 2 : look.head.r * look.head.scale[1];
  const headY = h + headR * 0.82;
  const face = createPixelFace(id, look.head.box ? 0.7 : look.head.r * 1.55);
  const { head, front } = headShape(g, look.head, skin, headY, face, look.head.r * 1.55);

  const halfW = look.head.box ? look.head.box[0] / 2 : look.head.r * look.head.scale[0];
  if (look.side) {
    for (const s of [-1, 1]) {
      const tuft = new THREE.Mesh(ball(0.1), M(look.side));
      tuft.scale.set(0.8, 1.15, 1.5);
      tuft.position.set(s * (halfW - 0.01), 0.02, -0.05);
      head.add(tuft);
    }
  }
  if (look.antenna) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 10), M(look.antenna));
    ant.position.set(0.04, headR + 0.12, 0); ant.rotation.z = -0.25; head.add(ant);
    const tip = new THREE.Mesh(ball(0.055), M(look.antenna));
    tip.position.set(0.08, headR + 0.28, 0); head.add(tip);
  }
  if (look.curls) {
    const hm = M(look.curls);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2, r = i % 2 ? 0.26 : 0.34;
      const c = new THREE.Mesh(ball(0.14), hm);
      c.position.set(Math.cos(a) * r, 0.34 + (i % 3) * 0.04, Math.sin(a) * r * 0.8 - 0.1);
      head.add(c);
    }
    const crown = new THREE.Mesh(ball(0.2), hm);
    crown.position.set(0.02, 0.48, -0.08); head.add(crown);
  }
  if (look.bun) {
    // a little white topknot on an otherwise bald head
    const bun = new THREE.Mesh(ball(0.11), M(look.bun));
    bun.position.set(-0.03, headR + 0.04, -0.06); head.add(bun);
  }
  if (look.beard) {
    // a fluffy beard: a soft cloud under the mouth tapering to a round point near the waist
    const bm = M(look.beard);
    const chin = new THREE.Mesh(ball(0.25), bm); chin.scale.set(1, 0.6, 0.55); chin.position.set(0, -headR * 0.68, front - 0.14); head.add(chin);
    const pts = [[0.001, -0.62], [0.08, -0.56], [0.16, -0.4], [0.21, -0.18], [0.2, 0], [0.001, 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
    const tip = new THREE.Mesh(new THREE.LatheGeometry(pts, ROUND), bm); tip.scale.z = 0.6; tip.position.set(0.02, -headR * 0.72, front - 0.14); head.add(tip);
  }
  if (look.steam) {
    // he is always slightly steaming
    [[0.18, 0.5, 0.1], [0.3, 0.64, 0.075], [0.12, 0.76, 0.055]].forEach(([x, y, r]) => {
      const p = new THREE.Mesh(ball(r), B(0xf4f1ea)); p.position.set(x, y, 0); head.add(p);
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
  const skin = M(o.skin || 0xf3c9a4);
  const legs = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(s * 0.13, 0.3, 0);
    // trouser leg and round bean shoe, one mesh
    const legAt = new THREE.Matrix4().makeTranslation(0, -0.14, 0);
    const shoeAt = new THREE.Matrix4().compose(new THREE.Vector3(0, -0.26, 0.04), new THREE.Quaternion(), new THREE.Vector3(0.95, 0.6, 1.4));
    p.add(new THREE.Mesh(joinColored([
      [new THREE.CylinderGeometry(0.085, 0.085, 0.24, 12), o.pants, legAt],
      [new THREE.SphereGeometry(0.1, 14, 10), 0x2f2c33, shoeAt],
    ]), painted()));
    g.add(p); legs.push(p);
  }
  // round bean body: wider at the bottom, rounded at both ends
  const bodyPts = [[0.001, 0.29], [0.24, 0.31], [0.33, 0.4], [0.34, 0.56], [0.28, 0.74], [0.16, 0.8], [0.001, 0.81]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 20), M(o.shirt)));   // a little coarser than the head
  const arms = mittens(g, o.shirt, skin, 0.3, 0.74, 0.3);

  const r = 0.42;
  const variant = o.face || KID_FACES[Math.abs(o.seed || 0) % KID_FACES.length];
  const face = createPixelFace('kid', r * 1.55, variant);
  const { head, front } = headShape(g, { r, scale: [1.05, 0.98, 1] }, skin, 1.16, face, r * 1.55);
  // round hair cap, tipped a little to one side
  const hair = new THREE.Mesh(new THREE.SphereGeometry(r + 0.03, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.4), M(o.hair || 0x3b2618));
  hair.position.y = 0.02; hair.rotation.set(-0.35, 0, 0.15); head.add(hair);

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
    // hands resting on the knees when sitting on a bench
    lap: { R: v(-0.17, 0.5, 0.36), L: v(0.17, 0.5, 0.36) },
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

/**
 * Walking pose for a kid: legs and arms swing on a sine, the body bobs and sways a little.
 * amp (0..1) eases in when walking starts and out when it stops, so the legs never snap.
 */
export function walkPose(fig, phase, amp) {
  const u = fig.userData;
  const swing = Math.sin(phase) * 0.55 * amp;
  u.legs[0].rotation.x = swing; u.legs[1].rotation.x = -swing;
  u.arms.R.rotation.x = -swing * 0.8; u.arms.L.rotation.x = swing * 0.8;
  fig.position.y = Math.abs(Math.sin(phase)) * 0.06 * amp;
  fig.rotation.z = Math.sin(phase) * 0.05 * amp;
}
