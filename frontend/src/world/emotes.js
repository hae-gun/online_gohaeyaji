import * as THREE from 'three';

/**
 * Emotes (protocol section 16): short gestures anyone in the corridor can see.
 *
 *   pray   두 손 모아 기도: hands together, head bowed, eyes closed
 *   cross  성호경: forehead, chest, left shoulder, right shoulder, hands together (own left and right)
 *   hooray 무릎 꿇고 만세: kneels and pumps both arms
 *   doze   꾸벅꾸벅: nods off like during a long homily, "Z z" floating up
 *
 * One at a time. Walking and turning the camera keep working: the arms and head follow the emote,
 * the legs keep walking (a kneel stands up while walking and kneels again on stopping).
 * Stepped timing on purpose, like the priest's sign of the cross: cheap 90s animation.
 */
export const EMOTES = [
  { id: 'pray', label: '기도', dur: 4.0 },
  { id: 'cross', label: '성호경', dur: 4.6 },
  { id: 'hooray', label: '만세', dur: 3.6 },
  { id: 'doze', label: '꾸벅꾸벅', dur: 5.0 },
];
export const EMOTE_IDS = EMOTES.map((e) => e.id);
const BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e]));

const DOWN = new THREE.Vector3(0, -1, 0);
const FPS = 8;   // stepped animation

function aim(fig, side, target) {
  const d = target.clone().sub(fig.userData.pose.shoulder[side]);
  const len = d.length();
  return { q: new THREE.Quaternion().setFromUnitVectors(DOWN, d.normalize()), s: len / fig.userData.ARM };
}

/** Arm keyframes for the sign of the cross: [time, right hand target, left hand target]. */
function crossKeys(P) {
  return [
    [0.0, null, null], [0.5, P.forehead, null], [1.0, P.forehead, null],
    [1.35, P.chest, null], [1.8, P.chest, null],
    [2.15, P.lShoulder, null], [2.55, P.lShoulder, null],
    [2.9, P.rShoulder, null], [3.3, P.rShoulder, null],
    [3.7, P.pray.R, P.pray.L], [4.3, P.pray.R, P.pray.L], [4.6, null, null],
  ];
}

function zzzSprite() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 32;
  const c = cv.getContext('2d');
  c.font = 'bold 22px sans-serif';
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#2a2230';
  c.lineWidth = 4;
  c.strokeText('Z', 4, 26); c.fillText('Z', 4, 26);
  c.font = 'bold 15px sans-serif';
  c.strokeText('z', 30, 18); c.fillText('z', 30, 18);
  c.strokeText('z', 46, 10); c.fillText('z', 46, 10);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.5, 0.25, 1);
  sp.visible = false;
  return sp;
}

/**
 * Plays emotes on one kid figure. Call update() every frame AFTER the walking animation,
 * so the emote wins for the arms and head.
 */
export function createEmotePlayer(fig) {
  const u = fig.userData;
  const P = u.pose;
  const rest = { R: { q: new THREE.Quaternion(), s: 1 }, L: { q: new THREE.Quaternion(), s: 1 } };
  const cache = new Map();
  const pose = (side, target) => {
    if (!target) return rest[side];
    let p = cache.get(target);
    if (!p) { p = aim(fig, side, target); cache.set(target, p); }
    return p;
  };
  const zzz = zzzSprite();
  zzz.position.set(0.3, P.headTop + 0.15, 0);
  fig.add(zzz);
  const keys = crossKeys(P);

  let id = null, t = 0;

  function setArm(side, a, b, k) {
    const pivot = u.arms[side];
    pivot.quaternion.copy(a.q).slerp(b.q, k);
    pivot.scale.set(1, a.s + (b.s - a.s) * k, 1);
  }

  function stop() {
    id = null;
    for (const side of ['R', 'L']) { u.arms[side].rotation.set(0, 0, 0); u.arms[side].scale.set(1, 1, 1); }
    u.head.rotation.set(0, 0, 0);
    u.legs.forEach((l) => { l.rotation.x = 0; });
    u.face.set({});
    zzz.visible = false;
  }

  return {
    /** @returns false if another emote is still playing or the id is unknown */
    start(next) {
      if (id || !BY_ID[next]) return false;
      id = next; t = 0;
      return true;
    },
    get playing() { return id; },
    /** 0..1 of the current emote, for the button's progress */
    get progress() { return id ? Math.min(1, t / BY_ID[id].dur) : 0; },
    stop,
    /** @param {boolean} moving walking this frame: kneeling waits until standing still */
    update(dt, moving) {
      if (!id) return;
      t += dt;
      if (t >= BY_ID[id].dur) { stop(); return; }
      const ts = Math.floor(t * FPS) / FPS;

      if (id === 'pray') {
        const p = pose('R', P.pray.R), q = pose('L', P.pray.L);
        const k = Math.min(1, ts / 0.5) * Math.min(1, (BY_ID.pray.dur - ts) / 0.5);
        setArm('R', rest.R, p, k); setArm('L', rest.L, q, k);
        u.head.rotation.x = 0.28 * k;
        u.face.set({ eyes: k > 0.5 ? 'closed' : 'open' });
      } else if (id === 'cross') {
        let a = keys[0], b = keys[keys.length - 1];
        for (let i = 0; i < keys.length - 1; i++) if (ts >= keys[i][0] && ts <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
        let k = Math.min(1, Math.max(0, (ts - a[0]) / Math.max(1e-4, b[0] - a[0])));
        k = k * k * (3 - 2 * k);
        setArm('R', pose('R', a[1]), pose('R', b[1]), k);
        setArm('L', pose('L', a[2]), pose('L', b[2]), k);
        u.head.rotation.x = ts > 3.6 ? 0.2 : 0;
        u.face.set({ eyes: ts > 3.6 ? 'closed' : 'open' });
      } else if (id === 'hooray') {
        // arms pump between half up and all the way up, twice a second
        const up = Math.floor(ts * 4) % 2 === 0;
        const r = pose('R', up ? P.up.R : P.halfUp.R), l = pose('L', up ? P.up.L : P.halfUp.L);
        setArm('R', r, r, 0); setArm('L', l, l, 0);
        u.head.rotation.x = -0.25;
        if (!moving) {
          u.legs.forEach((leg) => { leg.rotation.x = 1.45; });   // shins fold back: kneeling
          fig.position.y = -0.2;
        }
        u.face.set({ eyes: 'happy', mouth: 2 });
      } else if (id === 'doze') {
        // the head sinks slowly, then jerks back up
        const cycle = ts % 1.6;
        u.head.rotation.x = cycle < 1.3 ? (cycle / 1.3) * 0.5 : -0.15;
        const limp = pose('R', P.limp.R), limpL = pose('L', P.limp.L);
        setArm('R', limp, limp, 0); setArm('L', limpL, limpL, 0);
        zzz.visible = true;
        zzz.position.y = P.headTop + 0.15 + (ts % 1) * 0.25;
        u.face.set({ eyes: cycle < 1.3 ? 'closed' : 'wide' });
      }
    },
  };
}
