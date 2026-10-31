import * as THREE from 'three';
import { M, B } from '../core/three-utils.js';
import { makeFigure } from './figure.js';

/**
 * Inside a confessional: its own scene and camera, the priest behind a latticed window,
 * a candle, and the priest's animations (sign of the cross, nod, blink).
 */
export function buildConfessional() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0c0a);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40);

  scene.add(new THREE.HemisphereLight(0xffe7c8, 0x1a120c, 0.55));
  const candleL = new THREE.PointLight(0xffb45a, 1.4, 9); candleL.position.set(0.9, 2.4, -1.8); scene.add(candleL);
  const fillL = new THREE.DirectionalLight(0xffe0bb, 0.35); fillL.position.set(0, 3, 3); scene.add(fillL);
  // the curtain glow is behind the priest; a soft light from the penitent's side keeps his head from going dark
  const faceL = new THREE.PointLight(0xffe6c8, 0.7, 4); faceL.position.set(0, 2.3, -0.6); scene.add(faceL);

  const wood = M(0x4e3220);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 8), M(0x2c1c12)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const back = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 0.2), M(0x3a2618)); back.position.set(0, 2.5, -3.4); scene.add(back);
  const curtain = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.05), M(0x6b3f96)); curtain.position.set(0, 2.6, -3.28); scene.add(curtain);
  for (const s of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 6), wood); sw.position.set(s * 2.2, 2.5, -0.5); scene.add(sw);
  }

  // partition with a latticed window between penitent and priest
  const pz = -1.1;
  [[-1.55, 1.25, 1.3, 2.5], [1.55, 1.25, 1.3, 2.5], [0, 0.7, 1.8, 1.4], [0, 3.55, 1.8, 1.7]].forEach(([x, y, w, h]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), wood); p.position.set(x, y, pz); scene.add(p);
  });
  // the lattice only frames the window: bars across the middle would cut the priest's face in half
  const lat = M(0x2e1d12);
  for (const x of [-0.62, 0.62]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.016, 1.3, 0.02), lat); b.position.set(x, 2.05, pz); scene.add(b);
  }
  for (const y of [1.6, 2.66]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.016, 0.02), lat); b.position.set(0, y, pz); scene.add(b);
  }
  const sill = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.4), M(0x6a4428)); sill.position.set(0, 1.42, pz + 0.1); scene.add(sill);
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6), M(0xf3ead6)); candle.position.set(0.9, 1.75, -1.8); scene.add(candle);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), B(0xffc864)); flame.scale.y = 1.8; flame.position.set(0.9, 2.02, -1.8); scene.add(flame);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.55, 0.4), wood); stand.position.set(0.9, 0.77, -1.8); scene.add(stand);

  // one figure per persona; only the priest of the current booth is shown
  const crew = {};
  for (const id of ['jin', 'eom', 'yu', 'baek']) {
    const fig = makeFigure({ priest: true, look: id });
    // chibi priests are short: seat them so the window shows him from the chest up
    // (chest just above the sill at 1.42, so the sign of the cross stays visible)
    fig.position.set(0, 1.56 - fig.userData.pose.chest.y, -2.0);
    fig.visible = false;
    scene.add(fig);
    const face = createFace(fig, id);
    crew[id] = { fig, face, cross: createSignOfCross(fig, face) };
  }
  // a warm light that only comes on for the legendary priest
  const glow = new THREE.PointLight(0xffe2a0, 0, 7); glow.position.set(0, 3, -1.2); scene.add(glow);
  let active = crew.jin;
  active.fig.visible = true;
  camera.position.set(0, 2.0, 2.2);
  camera.lookAt(0, 1.95, -2.0);

  let nodT = -1;

  return {
    scene,
    camera,
    /** Shows the priest of this booth: 'jin' | 'eom' | 'yu' | 'baek'. Call before startBlessing. */
    setPriest(id) {
      const next = crew[id] || crew.jin;
      glow.intensity = id === 'baek' ? 1.6 : 0;
      if (next === active) return;
      active.face.reset(); active.cross.stop(); active.fig.userData.head.rotation.x = 0;
      active.fig.visible = false;
      active = next;
      active.fig.visible = true;
    },
    /**
     * Starts the sign of the cross (about 6 seconds). onWord(text) fires when the hand reaches
     * each point, so the spoken words follow the hand instead of running ahead of it.
     * onWord returns how long that word is spoken, in seconds. onDone fires when the hands are back
     * down; it runs on the animation clock, so a slow device never cuts the prayer short.
     */
    startBlessing(onWord, onDone) { active.face.setMood('pray'); active.cross.start(onWord, onDone); },
    /** A slow nod while the priest "listens". */
    nod() { nodT = 0; },
    /** 'neutral' | 'pray' | 'listen' | 'concern' | 'stern' | 'smile' */
    setMood(m) { active.face.setMood(m); },
    /**
     * Moves the mouth for `seconds`. script: [[fraction of the speech, mood], ...] switches the
     * expression while talking; `after` is the mood once he stops, held for `hold` seconds.
     */
    talk(seconds, opts) { active.face.talk(seconds, opts); },
    /** Leaving the booth: stop talking, reset the face and arms. */
    reset() { active.face.reset(); active.cross.stop(); nodT = -1; active.fig.userData.head.rotation.x = 0; },
    update(dt, t) {
      const { fig, face, cross } = active;
      cross.update(dt);
      face.update(dt);
      const head = fig.userData.head;
      if (nodT >= 0) {
        nodT += dt;
        head.rotation.x = Math.sin(Math.min(nodT, 2) * Math.PI * 1.5) * 0.18;
        if (nodT > 2) { nodT = -1; head.rotation.x = 0; }
      }
      fig.scale.y = 1 + Math.sin(t * 1.4) * 0.006;
      flame.scale.set(1 + Math.sin(t * 11) * 0.12, 1.8 + Math.sin(t * 7) * 0.2, 1);
      candleL.intensity = 1.3 + Math.sin(t * 9) * 0.12;
    },
  };
}

/**
 * The priest's face: a pixel face (pixel-face.js) redrawn when the expression changes.
 * Expressions snap from one to the next, no easing, to keep the cheap 90s look.
 */
const MOODS = {
  neutral: { eyes: 'open', brows: 'neutral', smile: 0 },
  pray:    { eyes: 'closed', brows: 'neutral', smile: 0 },
  listen:  { eyes: 'open', brows: 'up', smile: 0 },
  concern: { eyes: 'open', brows: 'worried', smile: -1 },
  stern:   { eyes: 'squint', brows: 'stern', smile: -1 },
  smile:   { eyes: 'squint', brows: 'neutral', smile: 1 },
};
// per priest tweaks: the scolding one goes red when stern, the funny one laughs with ^^ eyes
const LOOK_MOODS = {
  eom: { stern: { blush: true } },
  yu: { smile: { eyes: 'happy' } },
};
const MOUTH_STEP = 1 / 9;          // a new mouth shape about 9 times a second
const MOUTH_SHAPES = [0, 1, 2, 3, 1];

function createFace(priest, look) {
  const face = priest.userData.face;
  const tweaks = LOOK_MOODS[look] || {};
  let mood = 'neutral';
  let talkT = 0, talkLen = 0, script = [], after = 'neutral', hold = 0, holdT = 0;
  let stepT = 0, open = 0, lastShape = -1;
  let blinkT = 3;

  function setMood(name) { mood = MOODS[name] ? name : 'neutral'; }

  function nextShape() {
    // never the same shape twice in a row, and close fully now and then so words look separate
    let i;
    do { i = Math.floor(Math.random() * MOUTH_SHAPES.length); } while (i === lastShape);
    lastShape = i;
    return MOUTH_SHAPES[i];
  }

  function draw(blink) {
    const s = { ...MOODS[mood], ...(tweaks[mood] || {}), mouth: open };
    if (blink && s.eyes !== 'closed' && s.eyes !== 'happy') s.eyes = 'closed';
    face.set(s);
  }

  return {
    setMood,
    talk(seconds, { script: sc = [], after: af = 'neutral', hold: h = 0 } = {}) {
      talkLen = seconds; talkT = 0; script = sc; after = af; hold = h; holdT = 0; stepT = 0;
      if (script.length) setMood(script[0][1]);
    },
    reset() { talkLen = 0; holdT = 0; open = 0; setMood('neutral'); draw(false); },
    update(dt) {
      if (talkLen > 0) {
        talkT += dt;
        const f = talkT / talkLen;
        for (const [at, m] of script) if (f >= at) setMood(m);
        stepT -= dt;
        if (stepT <= 0) { stepT = MOUTH_STEP; open = nextShape(); }
        if (talkT >= talkLen) {
          talkLen = 0; open = 0;
          setMood(after);
          if (hold > 0) holdT = hold;
        }
      } else if (holdT > 0) {
        holdT -= dt;
        if (holdT <= 0) setMood('neutral');
      }
      blinkT -= dt;
      const blink = blinkT < 0.12;
      if (blinkT < 0) blinkT = 2.5 + Math.random() * 3;
      draw(blink);
    },
  };
}

/**
 * Sign of the cross: right hand to forehead (Father), chest (Son),
 * left shoulder then right shoulder (Holy Spirit), then hands joined (Amen).
 *
 * Each pose is the point the hand should reach in the priest's own space;
 * the arm rotates toward it and stretches to reach it. Each move eases in and out
 * so the hand glides between points instead of jumping.
 */
function createSignOfCross(priest, face) {
  const DOWN = new THREE.Vector3(0, -1, 0);
  // targets come from the figure itself (figure.js userData.pose), so every body shape works.
  // The short arms stretch to reach the forehead: that is part of the joke.
  const P = priest.userData.pose;
  const SHOULDER = P.shoulder;
  const TARGETS = {
    restR: ['R', P.rest.R],
    restL: ['L', P.rest.L],
    forehead: ['R', P.forehead],
    chest: ['R', P.chest],
    lShoulder: ['R', P.lShoulder],
    rShoulder: ['R', P.rShoulder],
    prayR: ['R', P.pray.R],
    prayL: ['L', P.pray.L],
  };
  // [time in seconds, right hand pose, left hand pose]
  const KEYS = [
    [0.0, 'restR', 'restL'], [0.5, 'forehead', 'restL'], [1.1, 'forehead', 'restL'],
    [1.5, 'chest', 'restL'], [2.0, 'chest', 'restL'],
    [2.4, 'lShoulder', 'restL'], [2.85, 'lShoulder', 'restL'],
    [3.25, 'rShoulder', 'restL'], [3.65, 'rShoulder', 'restL'],
    [4.1, 'prayR', 'prayL'], [5.3, 'prayR', 'prayL'], [5.9, 'restR', 'restL'],
  ];
  const END = 6.2;
  // spoken when the hand arrives at each point
  const WORDS = [[0.5, '성부와'], [1.5, '성자와'], [2.4, '성령의'], [3.25, '이름으로.'], [4.1, '아멘.']];

  const poses = {};
  for (const [name, [side, target]] of Object.entries(TARGETS)) {
    const d = target.clone().sub(SHOULDER[side]);
    const len = d.length();
    poses[name] = { q: new THREE.Quaternion().setFromUnitVectors(DOWN, d.normalize()), s: len / priest.userData.ARM };
  }

  function apply(t) {
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i][0] && t <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    let u = Math.min(1, Math.max(0, (t - a[0]) / Math.max(0.0001, b[0] - a[0])));
    // ease in and out of every point instead of jumping between them
    u = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
    for (const [idx, side] of [[1, 'R'], [2, 'L']]) {
      const pa = poses[a[idx]], pb = poses[b[idx]], pivot = priest.userData.arms[side];
      pivot.quaternion.copy(pa.q).slerp(pb.q, u);
      pivot.scale.set(1, pa.s + (pb.s - pa.s) * u, 1);
    }
  }

  let t = -1, nextWord = 0, onWord = null, onDone = null;
  apply(0);
  return {
    start(cb, done) { t = 0; nextWord = 0; onWord = cb || null; onDone = done || null; apply(0); },
    stop() { t = -1; onDone = null; apply(0); },
    update(dt) {
      if (t < 0) return;
      t += dt;
      apply(t);
      while (nextWord < WORDS.length && t >= WORDS[nextWord][0]) {
        const [, word] = WORDS[nextWord++];
        const sec = onWord ? onWord(word) : 0.6;
        face.talk(sec || 0.6, { after: 'pray' });
      }
      if (t > END) {
        t = -1;
        face.setMood('neutral');
        const done = onDone; onDone = null;
        if (done) done();
      }
    },
  };
}
