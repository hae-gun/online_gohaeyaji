import * as THREE from 'three';

/**
 * Emotes (protocol section 16): short gestures anyone in the corridor can see.
 *
 *   pray   두 손 모아 기도: hands together, head bowed, eyes closed
 *   cross  성호경: forehead, chest, left shoulder, right shoulder, hands together (own left and right)
 *   hooray 무릎 꿇고 만세: kneels and pumps both arms
 *   doze   꾸벅꾸벅: nods off like during a long homily, "Z z" floating up
 *   sit    벤치에 앉기: not in the emote bar; started with E next to a plaza bench. It has no fixed
 *          end and lasts until the sitter walks (then they stand up). Others see it too.
 *
 * One at a time. Walking and turning the camera keep working: the arms and head follow the emote,
 * the legs keep walking (a kneel stands up while walking and kneels again on stopping).
 * Motion is smooth: every emote eases in from the resting pose and eases back out at the end,
 * and poses in between are blended, never snapped.
 */
export const EMOTES = [
  { id: 'pray', label: '기도', dur: 4.0 },
  { id: 'cross', label: '성호경', dur: 4.6 },
  { id: 'hooray', label: '만세', dur: 3.6 },
  { id: 'doze', label: '꾸벅꾸벅', dur: 5.0 },
];
export const EMOTE_IDS = EMOTES.map((e) => e.id);
const SIT = { id: 'sit', label: '앉기', dur: Infinity };
const BY_ID = Object.fromEntries([...EMOTES, SIT].map((e) => [e.id, e]));
/** How high the hips go when sitting, so the seat (0.47) is under them. */
const SIT_RISE = 0.17;

const DOWN = new THREE.Vector3(0, -1, 0);
const EASE_IN = 0.35;   // seconds to blend from rest into the emote
const EASE_OUT = 0.4;   // and back to rest at the end
const smooth = (x) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
const easeInOut = (x) => { const k = Math.min(1, Math.max(0, x)); return k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2; };

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
  let kneel = 0;   // 0 standing .. 1 kneeling, eased so getting up and down is not a jump
  const tmpQ = new THREE.Quaternion();

  /** Arm between poses a and b (k 0..1), then blended from rest by w (0..1). */
  function setArm(side, a, b, k, w = 1) {
    const pivot = u.arms[side];
    tmpQ.copy(a.q).slerp(b.q, k);
    pivot.quaternion.identity().slerp(tmpQ, w);
    const s = a.s + (b.s - a.s) * k;
    pivot.scale.set(1, 1 + (s - 1) * w, 1);
  }

  function stop() {
    for (const side of ['R', 'L']) { u.arms[side].rotation.set(0, 0, 0); u.arms[side].scale.set(1, 1, 1); }
    u.head.rotation.set(0, 0, 0);
    if (id === 'sit') fig.position.y = 0;
    u.legs.forEach((l) => { l.rotation.x = 0; });
    u.face.set({});
    zzz.visible = false;
    kneel = 0;
    id = null;
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
    get progress() { return id && id !== 'sit' ? Math.min(1, t / BY_ID[id].dur) : 0; },
    stop,
    /** @param {boolean} moving walking this frame: kneeling waits until standing still */
    update(dt, moving) {
      if (!id) return;
      t += dt;
      if (id === 'sit') {
        // walking away is standing up
        if (moving) { stop(); return; }
        const w = smooth(t / 0.45);
        u.legs.forEach((leg) => { leg.rotation.x = leg.rotation.x * (1 - w) - 1.5 * w; });
        fig.position.y += SIT_RISE * w;
        fig.rotation.z *= 1 - w;
        const lap = pose('R', P.lap.R), lapL = pose('L', P.lap.L);
        setArm('R', lap, lap, 0, w); setArm('L', lapL, lapL, 0, w);
        // now and then a slow look around the plaza
        u.head.rotation.y = Math.sin(t * 0.4) * 0.35 * smooth((t - 2) / 2) * w;
        return;
      }
      const dur = BY_ID[id].dur;
      if (t >= dur) { stop(); return; }
      // weight of the whole emote: eases in at the start and out at the end
      const w = smooth(t / EASE_IN) * smooth((dur - t) / EASE_OUT);
      let kneelGoal = 0;

      if (id === 'pray') {
        const p = pose('R', P.pray.R), q = pose('L', P.pray.L);
        setArm('R', p, p, 0, w); setArm('L', q, q, 0, w);
        u.head.rotation.x = 0.28 * w;
        u.face.set({ eyes: w > 0.6 ? 'closed' : 'open' });
      } else if (id === 'cross') {
        // keyframes start and end at rest, so the cross blends in and out by itself
        let a = keys[0], b = keys[keys.length - 1];
        for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i][0] && t <= keys[i + 1][0]) { a = keys[i]; b = keys[i + 1]; break; }
        const k = easeInOut((t - a[0]) / Math.max(1e-4, b[0] - a[0]));
        setArm('R', pose('R', a[1]), pose('R', b[1]), k);
        setArm('L', pose('L', a[2]), pose('L', b[2]), k);
        const bow = smooth((t - 3.5) / 0.3) * smooth((dur - t) / EASE_OUT);
        u.head.rotation.x = 0.2 * bow;
        u.face.set({ eyes: bow > 0.6 ? 'closed' : 'open' });
      } else if (id === 'hooray') {
        // arms swing smoothly between half up and all the way up, twice a second
        const swing = 0.5 + 0.5 * Math.sin(t * Math.PI * 4 - Math.PI / 2);
        setArm('R', pose('R', P.halfUp.R), pose('R', P.up.R), swing, w);
        setArm('L', pose('L', P.halfUp.L), pose('L', P.up.L), swing, w);
        u.head.rotation.x = -0.25 * w;
        kneelGoal = moving ? 0 : w;
        u.face.set(w > 0.4 ? { eyes: 'happy', mouth: 2 } : {});
      } else if (id === 'doze') {
        // the head sinks slowly, jerks up, settles, and sinks again
        const c = t % 1.6;
        let nod;
        if (c < 1.25) nod = 0.5 * easeInOut(c / 1.25);
        else if (c < 1.37) nod = 0.5 + (-0.18 - 0.5) * smooth((c - 1.25) / 0.12);
        else nod = -0.18 * (1 - smooth((c - 1.37) / 0.23));
        u.head.rotation.x = nod * w;
        const limp = pose('R', P.limp.R), limpL = pose('L', P.limp.L);
        setArm('R', limp, limp, 0, w); setArm('L', limpL, limpL, 0, w);
        zzz.visible = true;
        zzz.material.opacity = w;
        zzz.position.y = P.headTop + 0.15 + (t % 1.2) * 0.22;
        u.face.set({ eyes: c >= 1.25 && c < 1.5 ? 'wide' : 'closed' });
      }

      // kneeling eases down and up; walking stands up, stopping kneels again
      kneel += (kneelGoal - kneel) * Math.min(1, dt * 8);
      if (kneel > 0.001) {
        u.legs.forEach((leg) => { leg.rotation.x = leg.rotation.x * (1 - kneel) + 1.45 * kneel; });
        fig.position.y -= 0.2 * kneel;
      }
    },
  };
}
