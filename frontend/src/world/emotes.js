import * as THREE from 'three';

/**
 * Emotes (protocol section 16): short gestures anyone nearby can see.
 *
 *   pray   두 손 모아 기도: hands together, head bowed, eyes closed
 *   cross  성호경: forehead, chest, left shoulder, right shoulder, hands together (own left and right)
 *   hooray 무릎 꿇고 만세: kneels and pumps both arms
 *   doze   꾸벅꾸벅: nods off like during a long homily, "Z z" floating up
 *
 * Sitting (벤치, 장의자) is a separate layer, not a gesture: started with E next to a seat, it has
 * no end and lasts until the sitter walks (then they stand up). Gestures play on top of it: the
 * legs stay seated, the arms and head do the gesture, and the kneel of hooray is skipped. The
 * server remembers who sits, so people who join later see them seated (protocol v0.9).
 *
 * One gesture at a time. Walking and turning the camera keep working: the arms and head follow the
 * gesture, the legs keep walking (a kneel stands up while walking and kneels again on stopping).
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
export const SIT = 'sit';
const BY_ID = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
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
  const lap = { R: pose('R', P.lap.R), L: pose('L', P.lap.L) };

  let id = null, t = 0;    // the gesture playing, and for how long
  let seated = false;      // sitting on a bench or pew
  let seat = 0;            // 0 standing .. 1 seated, eased
  let seatT = 0;
  let kneel = 0;           // 0 standing .. 1 kneeling, eased so getting up and down is not a jump
  const tmpQ = new THREE.Quaternion(), baseQ = new THREE.Quaternion();

  /**
   * Arm between poses a and b (k 0..1), blended by w (0..1) from the resting arm. The resting arm
   * is the hands-on-knees pose as far as the figure is seated.
   */
  function setArm(side, a, b, k, w = 1) {
    const pivot = u.arms[side];
    baseQ.identity().slerp(lap[side].q, seat);
    const baseS = 1 + (lap[side].s - 1) * seat;
    tmpQ.copy(a.q).slerp(b.q, k);
    pivot.quaternion.copy(baseQ).slerp(tmpQ, w);
    const s = a.s + (b.s - a.s) * k;
    pivot.scale.set(1, baseS + (s - baseS) * w, 1);
  }

  function endGesture() {
    id = null;
    for (const side of ['R', 'L']) { u.arms[side].rotation.set(0, 0, 0); u.arms[side].scale.set(1, 1, 1); }
    u.head.rotation.set(0, 0, 0);
    u.face.set({});
    zzz.visible = false;
  }

  function stop() {
    endGesture();
    u.legs.forEach((l) => { l.rotation.x = 0; });
    kneel = 0;
    seated = false;
    seat = 0;
  }

  return {
    /**
     * 'sit' sits down (even during a gesture); anything else starts a gesture.
     * @returns false if another gesture is still playing or the id is unknown
     */
    start(next) {
      if (next === SIT) { seated = true; seatT = 0; return true; }
      if (id || !BY_ID[next]) return false;
      id = next; t = 0;
      return true;
    },
    /** The gesture playing (not sitting), or null. */
    get playing() { return id; },
    get seated() { return seated; },
    /** 0..1 of the current gesture, for the button's progress */
    get progress() { return id ? Math.min(1, t / BY_ID[id].dur) : 0; },
    stop,
    /** Ends the gesture only (stays seated). */
    cancel() { if (id) endGesture(); },
    /** @param {boolean} moving walking this frame: stands up, and kneeling waits until standing still */
    update(dt, moving) {
      if (seated && moving) seated = false;
      seat += ((seated ? 1 : 0) - seat) * Math.min(1, dt * 7);
      if (seat < 0.002) seat = 0;
      if (seated) seatT += dt;
      if (!id && !seat) return;

      let kneelGoal = 0;
      if (id) {
        t += dt;
        const dur = BY_ID[id].dur;
        if (t >= dur) {
          endGesture();
        } else {
          // weight of the whole gesture: eases in at the start and out at the end
          const w = smooth(t / EASE_IN) * smooth((dur - t) / EASE_OUT);
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
            // from and to the resting arm: a null key means "rest", which is the lap when seated
            const wa = a[1] ? 1 : 0, wb = b[1] ? 1 : 0;
            setArm('R', pose('R', a[1] || b[1]), pose('R', b[1] || a[1]), k, wa + (wb - wa) * k);
            const la = a[2] ? 1 : 0, lb = b[2] ? 1 : 0;
            setArm('L', pose('L', a[2] || b[2]), pose('L', b[2] || a[2]), k, la + (lb - la) * k);
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
        }
      }

      if (seat) {
        if (!id) {
          // hands on the knees, and now and then a slow look around
          setArm('R', rest.R, rest.R, 0, 0); setArm('L', rest.L, rest.L, 0, 0);
          u.head.rotation.y = Math.sin(seatT * 0.4) * 0.35 * smooth((seatT - 2) / 2) * seat;
        } else {
          u.head.rotation.y *= 0.9;
        }
        // nobody kneels from a pew
        kneelGoal = 0;
        u.legs.forEach((leg) => { leg.rotation.x = leg.rotation.x * (1 - seat) - 1.5 * seat; });
        fig.position.y += SIT_RISE * seat;
        fig.rotation.z *= 1 - seat;
        if (!seated && seat < 0.01) { u.head.rotation.y = 0; endArmsIfIdle(); }
      }

      // kneeling eases down and up; walking stands up, stopping kneels again
      kneel += (kneelGoal - kneel) * Math.min(1, dt * 8);
      if (kneel > 0.001) {
        u.legs.forEach((leg) => { leg.rotation.x = leg.rotation.x * (1 - kneel) + 1.45 * kneel; });
        fig.position.y -= 0.2 * kneel;
      }
    },
  };

  function endArmsIfIdle() {
    if (id) return;
    for (const side of ['R', 'L']) { u.arms[side].rotation.set(0, 0, 0); u.arms[side].scale.set(1, 1, 1); }
  }
}
