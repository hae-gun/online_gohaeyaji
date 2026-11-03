import * as THREE from 'three';
import { makeFigure, parishioner, NAME_HEIGHT, walkPose } from './figure.js';
import { hiddenFaces } from '../net/faces.js';
import { createEmotePlayer, SIT } from './emotes.js';

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
 *
 * Hand-drawn faces (protocol v0.5) replace the generated face when the viewer allows it
 * (setShowDrawn: someone who does not want to see other people's drawings can turn them off).
 * A name tag of someone wearing a drawing can be clicked: onTagClick opens the hide/report menu.
 * Drawings hidden by this viewer stay hidden by content (hiddenFaces), even on the next visit.
 */
// clothes colours come from the pid (figure.js parishioner), so everyone sees the same person alike
// 형제님 or 자매님 (protocol v0.16) comes with the name, as a third element of each name entry;
// when it changes, the avatar is rebuilt in the new clothes where it stands.
const WALK_SPEED = 3.4;            // same as the local player
const CATCH_UP = 1.35;             // a bit faster so they never lag a whole batch behind
const SNAP_DISTANCE = 3;
const NAME_DISTANCE = 3;           // metres; farther than this the name is hidden

export function createOtherPlayers(scene, tagLayer, onTagClick = () => {}) {
  const players = new Map();       // pid -> { fig, tx, tz, try, inBooth, phase, tag }
  const boothOwner = new Map();    // boothId -> pid
  const names = new Map();         // pid -> name (may arrive before the first move)
  const faces = new Map();         // pid -> hand-drawn face code
  const looks = new Map();         // pid -> 'm' | 'f'
  let showDrawn = true;
  const v = new THREE.Vector3();
  let me = null;

  function applyFace(pid) {
    const p = players.get(pid);
    if (!p) return;
    const face = faces.get(pid) || null;
    p.fig.userData.face.setCustom(showDrawn && face && !hiddenFaces.has(face) ? face : null);
    p.tag.classList.toggle('withFace', !!face);
  }

  function setFace(pid, face) {
    if (face) faces.set(pid, face); else faces.delete(pid);
    applyFace(pid);
  }

  function setName(pid, name) {
    names.set(pid, name);
    const p = players.get(pid);
    if (p && p.tag) p.tag.textContent = name;
  }

  function ensure(pid, x, z, ry) {
    let p = players.get(pid);
    if (!p) {
      const fig = makeFigure(parishioner(looks.get(pid) || 'm', pid));
      fig.position.set(x, 0, z);
      fig.rotation.y = ry;
      scene.add(fig);
      const tag = document.createElement('div');
      tag.className = 'nameTag';
      tag.hidden = true;
      tag.textContent = names.get(pid) || '';
      tag.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const face = faces.get(pid);
        if (face) onTagClick({ pid, name: names.get(pid) || '', face, rect: tag.getBoundingClientRect() });
      });
      tagLayer.appendChild(tag);
      p = { fig, tx: x, tz: z, try: ry, inBooth: false, phase: Math.random() * 6, tag, emote: createEmotePlayer(fig) };
      players.set(pid, p);
      applyFace(pid);
    }
    return p;
  }

  /** Someone switched between 형제님 and 자매님: new clothes, same place, same gesture state. */
  function setLook(pid, look) {
    if (look !== 'm' && look !== 'f') return;
    const before = looks.get(pid) || 'm';
    looks.set(pid, look);
    const p = players.get(pid);
    if (!p || before === look) return;
    const old = p.fig;
    const fig = makeFigure(parishioner(look, pid));
    fig.position.copy(old.position);
    fig.rotation.y = old.rotation.y;
    fig.visible = old.visible;
    const seated = p.emote.seated;
    scene.remove(old);
    scene.add(fig);
    p.fig = fig;
    p.emote = createEmotePlayer(fig);
    if (seated) p.emote.start(SIT);
    applyFace(pid);
  }

  function remove(pid) {
    const p = players.get(pid);
    names.delete(pid);
    faces.delete(pid);
    looks.delete(pid);
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
    if (inBooth) p.emote.stop();
  }

  return {
    /** @param {import('../net/room-client.js').PresenceEvent} e */
    handle(e) {
      if (e.kind === 'reset') {
        for (const pid of [...players.keys()]) remove(pid);
        boothOwner.clear();
        names.clear();
        me = e.you;
        looks.clear();
        for (const [pid, name, look] of e.names || []) { names.set(pid, name); if (look) looks.set(pid, look); }
        faces.clear();
        for (const [pid, face] of e.faces || []) faces.set(pid, face);
        for (const [pid, x, z, ry, boothId] of e.players) {
          if (pid === me) continue;
          ensure(pid, x, z, ry);
          if (boothId >= 0) { boothOwner.set(boothId, pid); setInBooth(pid, true); }
        }
        // people already sitting on a bench or pew (v0.9)
        for (const pid of e.sitting || []) {
          const p = players.get(pid);
          if (p && !p.inBooth) p.emote.start(SIT);
        }
      } else if (e.kind === 'batch') {
        for (const [pid, name, look] of e.named || []) { setName(pid, name); if (look) setLook(pid, look); }
        for (const [pid, face] of e.faced || []) setFace(pid, face);
        for (const [pid, x, z, ry] of e.moved) {
          if (pid === me) continue;
          const p = ensure(pid, x, z, ry);
          p.tx = x; p.tz = z; p.try = ry;
        }
        // after the moves: someone sitting down is put straight onto the seat they sent
        for (const [pid, id] of e.emoted || []) {
          const p = players.get(pid);
          if (!p || pid === me) continue;
          if (id === SIT) {
            // put them straight onto the seat they sent (it came in the same batch)
            p.fig.position.x = p.tx; p.fig.position.z = p.tz; p.fig.rotation.y = p.try;
          } else {
            p.emote.cancel();   // a new gesture replaces the old one; a seated person stays seated
          }
          p.emote.start(id);
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

    /** Show or hide faces other people drew (theirs fall back to the generated face). */
    setShowDrawn(on) {
      showDrawn = on;
      for (const pid of players.keys()) applyFace(pid);
    },

    /** Re-check every face after the hidden list changed. */
    refreshFaces() {
      for (const pid of players.keys()) applyFace(pid);
    },

    /** Where the visible people stand (the pigeons keep away from them). */
    positions() {
      const out = [];
      for (const p of players.values()) if (!p.inBooth) out.push(p.fig.position);
      return out;
    },

    /**
     * Someone else sitting at (x, z), within r metres: their pid, or null. A seat already taken
     * cannot be sat on.
     */
    sitterAt(x, z, r = 0.4) {
      for (const [pid, p] of players) {
        if (p.inBooth || !p.emote.seated) continue;
        if (Math.hypot(p.tx - x, p.tz - z) < r) return pid;
      }
      return null;
    },

    /** My pid in this channel (from the welcome), or null. */
    get myPid() { return me; },

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

        // same gait as the local player, eased in and out
        if (moving) p.phase += dt * 9;
        p.amp = (p.amp || 0) + ((moving ? 1 : 0) - (p.amp || 0)) * Math.min(1, dt * 10);
        walkPose(f, p.phase, p.amp);
        p.emote.update(dt, moving);
      }
    },
  };
}
