import * as THREE from 'three';
import { makeFigure } from './figure.js';

/**
 * Other players in my channel (protocol v0.3). No names, only a shirt color picked from the pid,
 * so everyone sees the same person in the same color.
 *
 * Positions arrive in batches every ~200 ms. Each avatar walks toward its latest known position
 * at a little above walking speed, which hides the gaps between batches; a big jump (reconnect,
 * leaving a booth) snaps instead.
 *
 * Names (protocol v0.4) are shown only for people close by, as plain DOM labels over the canvas:
 * sixty floating names at once would bury the corridor.
 */
const SHIRTS = [0x3a7bd5, 0x2fa36b, 0xe0a526, 0x8e5cc2, 0x1fb2b8, 0xd35d9c, 0x6d8a2e, 0xe0703a, 0x4a5bdc, 0x9a6b3f];
const PANTS = [0x2e3a52, 0x3b3b3b, 0x4a3426, 0x1f3d3a];
const WALK_SPEED = 3.4;            // same as the local player
const CATCH_UP = 1.35;             // a bit faster so they never lag a whole batch behind
const SNAP_DISTANCE = 3;
const NAME_DISTANCE = 3;           // metres; farther than this the name is hidden
const NAME_HEIGHT = 2.45;          // just above the head

export function createOtherPlayers(scene, tagLayer) {
  const players = new Map();       // pid -> { fig, tx, tz, try, inBooth, phase, tag }
  const boothOwner = new Map();    // boothId -> pid
  const names = new Map();         // pid -> name (may arrive before the first move)
  const v = new THREE.Vector3();
  let me = null;

  function setName(pid, name) {
    names.set(pid, name);
    const p = players.get(pid);
    if (p && p.tag) p.tag.textContent = name;
  }

  function ensure(pid, x, z, ry) {
    let p = players.get(pid);
    if (!p) {
      const fig = makeFigure({ shirt: SHIRTS[pid % SHIRTS.length], pants: PANTS[pid % PANTS.length], hair: 0x2b1d14 });
      fig.position.set(x, 0, z);
      fig.rotation.y = ry;
      scene.add(fig);
      const tag = document.createElement('div');
      tag.className = 'nameTag';
      tag.hidden = true;
      tag.textContent = names.get(pid) || '';
      tagLayer.appendChild(tag);
      p = { fig, tx: x, tz: z, try: ry, inBooth: false, phase: Math.random() * 6, tag };
      players.set(pid, p);
    }
    return p;
  }

  function remove(pid) {
    const p = players.get(pid);
    names.delete(pid);
    if (!p) return;
    scene.remove(p.fig);
    p.tag.remove();
    players.delete(pid);
  }

  function setInBooth(pid, inBooth) {
    const p = players.get(pid);
    if (!p) return;
    p.inBooth = inBooth;
    p.fig.visible = !inBooth;
  }

  return {
    /** @param {import('../net/room-client.js').PresenceEvent} e */
    handle(e) {
      if (e.kind === 'reset') {
        for (const pid of [...players.keys()]) remove(pid);
        boothOwner.clear();
        names.clear();
        me = e.you;
        for (const [pid, name] of e.names || []) names.set(pid, name);
        for (const [pid, x, z, ry, boothId] of e.players) {
          if (pid === me) continue;
          ensure(pid, x, z, ry);
          if (boothId >= 0) { boothOwner.set(boothId, pid); setInBooth(pid, true); }
        }
      } else if (e.kind === 'batch') {
        for (const [pid, name] of e.named || []) setName(pid, name);
        for (const [pid, x, z, ry] of e.moved) {
          if (pid === me) continue;
          const p = ensure(pid, x, z, ry);
          p.tx = x; p.tz = z; p.try = ry;
        }
        for (const pid of e.left) {
          remove(pid);
          for (const [b, owner] of boothOwner) if (owner === pid) boothOwner.delete(b);
        }
      } else if (e.kind === 'booth') {
        if (e.pid !== null) {
          boothOwner.set(e.boothId, e.pid);
          if (e.pid !== me) setInBooth(e.pid, true);
        } else {
          const owner = boothOwner.get(e.boothId);
          boothOwner.delete(e.boothId);
          if (owner !== undefined) setInBooth(owner, false);
        }
      }
    },

    /** Visible people in the channel, not counting me. */
    count() {
      let n = 0;
      for (const p of players.values()) if (!p.inBooth) n++;
      return n;
    },

    /**
     * Places the name labels of people within NAME_DISTANCE of me.
     * @param {THREE.Camera} camera @param {{x:number,z:number}} mePos @param {number} w @param {number} h
     */
    updateTags(camera, mePos, w, h, show = true) {
      for (const p of players.values()) {
        const f = p.fig;
        const near = show && !p.inBooth && Math.hypot(f.position.x - mePos.x, f.position.z - mePos.z) < NAME_DISTANCE;
        if (near) {
          v.set(f.position.x, NAME_HEIGHT, f.position.z).project(camera);
          if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
            p.tag.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
            p.tag.hidden = !p.tag.textContent;
            continue;
          }
        }
        p.tag.hidden = true;
      }
    },

    update(dt) {
      for (const p of players.values()) {
        if (p.inBooth) continue;
        const f = p.fig, dx = p.tx - f.position.x, dz = p.tz - f.position.z, d = Math.hypot(dx, dz);
        let moving = false;
        if (d > SNAP_DISTANCE) {
          f.position.x = p.tx; f.position.z = p.tz;
        } else if (d > 0.02) {
          const step = Math.min(d, WALK_SPEED * CATCH_UP * dt);
          f.position.x += (dx / d) * step;
          f.position.z += (dz / d) * step;
          moving = true;
        }
        // face where they walk, or where they said they look when standing
        const want = moving ? Math.atan2(dx, dz) : p.try;
        let diff = want - f.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        f.rotation.y += diff * Math.min(1, dt * 10);

        // same choppy gait as the local player
        if (moving) p.phase += dt * 9;
        const tq = Math.floor(p.phase * 2) / 2;
        const swing = moving ? Math.sin(tq) * 0.55 : 0;
        const u = f.userData;
        u.legs[0].rotation.x = swing; u.legs[1].rotation.x = -swing;
        u.arms.R.rotation.x = -swing * 0.8; u.arms.L.rotation.x = swing * 0.8;
        f.position.y = moving ? Math.abs(Math.sin(tq)) * 0.06 : 0;
      }
    },
  };
}
