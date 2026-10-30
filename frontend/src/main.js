import * as THREE from 'three';
import './styles.css';
import { makeGlassTexture } from './core/three-utils.js';
import { buildHall } from './world/hall.js';
import { buildExterior, FACADE_Z } from './world/exterior.js';
import { buildBooths, BOOTH_COUNT } from './world/booths.js';
import { makeFigure } from './world/figure.js';
import { buildConfessional } from './world/confessional.js';
import { createKeyboard } from './controls/keyboard.js';
import { createNavigation } from './controls/navigation.js';
import { createCameraRig } from './controls/camera-rig.js';
import { loadAnswerData, createAnswerEngine } from './answer/engine.js';
import { createAmbient } from './audio/ambient.js';
import { createVoice } from './audio/voice.js';
import { createLocalRoomClient } from './net/room-client.js';
import { createWsRoomClient } from './net/ws-room-client.js';
import { history } from './storage/history.js';
import { $, toast, fade, createBubble, initHistoryPanel } from './ui/hud.js';

/*
 * Flow:  intro -> hall (yard + corridor) -> opening (door animation) -> room -> hall
 *
 * main.js only wires modules together and runs the frame loop.
 * World building lives in world/, input in controls/, the booth lock in net/.
 */

const BUSY_MESSAGE = '현재 고해성사가 진행중입니다. 다른분의 고해가 들리지 않도록 다른 장소를 이용해 주십시오.';

/* ---------- renderer ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (_) {
  $('#intro .card').innerHTML = '<h2>이 기기에서는 3D를 표시할 수 없습니다</h2><p>WebGL을 지원하는 브라우저에서 열어 주세요.</p>';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
$('#stage').appendChild(renderer.domElement);

/* ---------- world ---------- */
const world = new THREE.Scene();
world.background = new THREE.Color(0x5a4560);
world.fog = new THREE.Fog(0x5a4560, 30, 85);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);

const glassTex = makeGlassTexture();
const hall = buildHall(world, glassTex);
const colliders = hall.colliders;   // the orbit camera stays in front of these
const outside = buildExterior(world, { glassTex, colliders });
const booths = buildBooths(world, colliders);
const nav = createNavigation(outside.obstacles);
const confessional = buildConfessional();

const player = makeFigure({ shirt: 0xe5533d, pants: 0x2e3a52, hair: 0x3b2618 });
player.position.set(0, 0, 30);
player.rotation.y = Math.PI;
world.add(player);

let portrait = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  portrait = w / h < 0.85;
  camera.aspect = confessional.camera.aspect = w / h;
  camera.fov = portrait ? 70 : 55;
  confessional.camera.fov = portrait ? 66 : 48;
  camera.updateProjectionMatrix();
  confessional.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ---------- services ---------- */
// VITE_REALTIME_URL set (npm run dev:server, or a build with the variable) -> real server.
// Not set (npm run dev, GitHub Pages) -> in-browser simulation.
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL;
const params = new URLSearchParams(location.search);
const rooms = REALTIME_URL
  ? createWsRoomClient({ url: REALTIME_URL })
  // fake confessors are off by default so local testing is not confused by them; ?sim=1 turns them on
  : createLocalRoomClient({ count: BOOTH_COUNT, simulate: params.get('sim') === '1' });

rooms.onChange((occupied) => {
  booths.forEach((b) => b.setOccupied(occupied.has(b.id)));
  $('#occ').textContent = occupied.size;
});

const ambient = createAmbient();
const voice = createVoice();
const bubble = createBubble(voice);
initHistoryPanel(history);

let engine = null;
loadAnswerData()
  .then((data) => { engine = createAnswerEngine(data); })
  .catch(() => toast('답변 데이터를 불러오지 못했습니다. 새로고침해 주세요.'));

/* ---------- state ---------- */
let state = 'intro';           // 'intro' | 'hall' | 'opening' | 'room'
let current = null;            // booth the player is inside
let nearBooth = null;
let isOutside = true;
let path = [];                 // tap-to-walk waypoints
let walkBooth = null;          // booth to face when the path ends
let stuck = 0;
let walkPhase = 0;
let muted = false;

/* ---------- connection status and server-side releases ---------- */
let channelNo = 1;
const NET_MESSAGE = {
  connecting: '고해소 서버에 연결하는 중입니다',
  reconnecting: '연결이 끊겼습니다. 다시 연결하는 중입니다',
  outdated: '새 버전이 있습니다. 새로고침해 주세요',
  closed: '서버와 연결할 수 없습니다. 잠시 후 새로고침해 주세요',
};
rooms.onStatus((s) => {
  if (s.channelNo) channelNo = s.channelNo;
  const banner = $('#netStatus');
  banner.hidden = s.state === 'ready';
  banner.textContent = NET_MESSAGE[s.state] || '';
  if (!isOutside) $('#placeName').textContent = `고해소 ${channelNo}채널`;
});

// the server took our booth away (idle safety net, lease expired, connection lost)
rooms.onForcedRelease(({ boothId, reason }) => {
  if (!current || current.id !== boothId) return;
  const message = {
    IDLE: '오랫동안 입력이 없어 고해소에서 나왔습니다. 자리는 다른 분께 돌아갔습니다.',
    LEASE_EXPIRED: '연결이 불안정해 고해소 자리가 반납되었습니다.',
    DISCONNECTED: '연결이 끊겨 고해소에서 나왔습니다.',
  }[reason] || '고해소에서 나왔습니다.';
  if (state === 'room') leaveRoom({ notifyServer: false, message });
  else if (state === 'opening') abortEntering(message);
});


/* ---------- input ---------- */
const keys = createKeyboard((k) => {
  if (k === 'e' && state === 'hall') tryEnter();
  if (k === 'v' && state === 'hall') toggleView();
  if (k === 'escape' && state === 'room') leaveRoom();
});

const rig = createCameraRig({
  canvas: renderer.domElement,
  camera,
  isActive: () => state === 'hall',
  onTap: tapAt,
});

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function tapAt(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const doorHits = ray.intersectObjects(booths.map((b) => b.group), true).filter((h) => h.object.userData.booth !== undefined);
  const groundHits = ray.intersectObjects([hall.floor, ...outside.groundMeshes]);
  if (doorHits.length && (!groundHits.length || doorHits[0].distance <= groundHits[0].distance + 0.5)) {
    const b = booths[doorHits[0].object.userData.booth];
    path = nav.planPath(player.position, b.spot);
    walkBooth = b;
  } else if (groundHits.length) {
    path = nav.planPath(player.position, groundHits[0].point);
    walkBooth = null;
  }
  stuck = 0;
}

function toggleView() {
  const fp = rig.toggleFirstPerson();
  $('#viewBtn').textContent = fp ? '3인칭 시점' : '1인칭 시점';
}

/* ---------- booth flow ---------- */
const CLAIM_FAILED = {
  OCCUPIED: BUSY_MESSAGE,
  RESERVED: '줄을 선 분을 위해 비워둔 고해소입니다.',
  RATE_LIMITED: '조금 천천히 시도해 주세요.',
  OFFLINE: '서버와 연결되어 있지 않습니다. 연결되면 다시 시도해 주세요.',
  TIMEOUT: '서버 응답이 늦습니다. 잠시 후 다시 시도해 주세요.',
};

async function tryEnter() {
  const b = nearBooth;
  if (!b) return;
  if (b.occupied) { toast(BUSY_MESSAGE); return; }
  state = 'opening';   // block double presses while the claim is in flight
  // the door opens only after the server grants the booth
  const { ok, reason } = await rooms.claim(b.id);
  if (state !== 'opening') return;
  if (!ok) { state = 'hall'; toast(CLAIM_FAILED[reason] || BUSY_MESSAGE); return; }

  current = b;
  b.doorTarget = 1.3;
  $('#actBtn').hidden = true;
  $('#prompt').hidden = true;
  player.rotation.y = b.side < 0 ? -Math.PI / 2 : Math.PI / 2;
  setTimeout(() => { if (state === 'opening') fade(true); }, 450);
  setTimeout(() => { if (state === 'opening') enterRoom(); }, 850);
}

/** Lost the booth between the claim and the room opening. */
function abortEntering(message) {
  const b = current;
  current = null;
  state = 'hall';
  if (b) b.doorTarget = 0;
  fade(false);
  toast(message);
}

function enterRoom() {
  state = 'room';
  ambient.setPlace('room');
  $('#hallUi').hidden = true;
  $('#roomUi').hidden = false;
  $('#roomName').textContent = `${current.id + 1}번 고해소`;
  $('#bubble').hidden = true;
  $('#penance').hidden = true;
  setInputEnabled(false);
  $('#confess').value = '';
  $('#guide').textContent = '신부님이 기도를 시작합니다';
  fade(false);
  confessional.startBlessing();
  idle.pause();   // the priest is praying; nobody gets kicked out during the blessing
  setTimeout(() => { if (state === 'room') bubble.say('성부와 성자와 성령의 이름으로. 아멘.'); }, 300);
  setTimeout(readyForConfession, 6200);
}

function readyForConfession() {
  if (state !== 'room') return;
  $('#guide').textContent = '고해하실 내용을 작성하세요';
  setInputEnabled(true);
  idle.start();
  try { $('#confess').focus({ preventScroll: true }); } catch (_) { /* older browsers */ }
}

/*
 * Idle countdown (protocol section 7). The browser owns the 90 s limit and leaves on its own;
 * the server only has a 100 s safety net. Paused while the priest prays or answers.
 * 20 s left: yellow counter. 10 s left: red counter.
 * Driven by setInterval, not the render loop: browsers pause requestAnimationFrame in background
 * tabs, and someone who switched tabs must still give the booth back on time.
 */
const idle = {
  deadline: 0,
  running: false,
  start() {
    this.running = true;
    this.deadline = performance.now() + rooms.idle.limitMs;
    rooms.activity();
  },
  touch() {
    if (!this.running) return;
    this.deadline = performance.now() + rooms.idle.limitMs;
    rooms.activity();
  },
  pause() {
    this.running = false;
    $('#idleCounter').hidden = true;
  },
  tick() {
    if (!this.running || state !== 'room') return;
    const left = this.deadline - performance.now();
    const el = $('#idleCounter');
    if (left <= 0) {
      this.pause();
      leaveRoom({ reason: 'IDLE', message: '오랫동안 입력이 없어 고해소에서 나왔습니다. 자리는 다른 분께 돌아갔습니다.' });
      return;
    }
    if (left > rooms.idle.warnMs) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('danger', left <= rooms.idle.dangerMs);
    el.textContent = `신부님이 기다리고 계십니다. ${Math.ceil(left / 1000)}초 뒤 고해소에서 나가게 됩니다`;
  },
};

function setInputEnabled(on) {
  $('#confess').disabled = !on;
  $('#sendBtn').disabled = !on;
}

setInterval(() => idle.tick(), 250);
$('#confess').addEventListener('input', () => idle.touch());
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state !== 'room' || !engine) return;
  const text = $('#confess').value.trim();
  if (!text) return;
  idle.pause();   // waiting for the priest
  $('#confess').value = '';
  setInputEnabled(false);
  $('#guide').textContent = '신부님이 듣고 계십니다';
  bubble.say('……', { silent: true });
  confessional.nod();

  const r = engine.answer(text);
  setTimeout(() => {
    if (state !== 'room') return;
    bubble.say(r.line, { safety: r.kind === 'safety' });
    if (r.kind === 'answer') {
      $('#penanceText').textContent = r.penance;
      $('#penance').hidden = false;
      history.add({ t: Date.now(), q: text, c: r.category, p: r.penance });
    } else {
      $('#penance').hidden = true;
    }
    $('#guide').textContent = '더 고해하실 것이 있으면 작성하세요';
    setInputEnabled(true);
    idle.start();
  }, 2200);
});

/**
 * @param {{ reason?: 'USER'|'IDLE', notifyServer?: boolean, message?: string }} opts
 *   notifyServer=false when the server already took the booth away
 */
function leaveRoom({ reason = 'USER', notifyServer = true, message = '' } = {}) {
  if (state !== 'room') return;
  idle.pause();
  bubble.stop();
  const b = current;
  // free the booth right away so others see the LED go off; the door animation is local only
  if (notifyServer) rooms.release(b.id, reason);
  state = 'leaving';
  fade(true);
  setTimeout(() => {
    state = 'hall';
    ambient.setPlace('hall');
    $('#roomUi').hidden = true;
    $('#hallUi').hidden = false;
    player.position.copy(b.spot);
    player.position.x -= b.side * 0.3;
    player.rotation.y = Math.PI;
    rig.yaw = 0;
    path = [];
    b.doorTarget = 0;
    current = null;
    fade(false);
    if (message) toast(message);
  }, 380);
}

$('#exitBtn').onclick = () => leaveRoom();
$('#actBtn').onclick = tryEnter;
$('#viewBtn').onclick = toggleView;
$('#sndBtn').onclick = () => {
  muted = !muted;
  $('#sndBtn').textContent = muted ? '소리 켜기' : '소리 끄기';
  ambient.setMuted(muted);
  voice.setMuted(muted);
};
$('#startBtn').onclick = () => {
  ambient.start();
  $('#intro').hidden = true;
  $('#hallUi').hidden = false;
  state = 'hall';
  rig.yaw = 0;   // the intro sweep leaves yaw rotated; start behind the player facing the doors
  if ('ontouchstart' in window) $('#moveHint').textContent = '탭해서 이동, 드래그로 시점 회전, 두 손가락으로 확대';
};

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();

function updatePlayer(dt) {
  let vx = 0, vz = 0;
  if (state === 'hall') {
    let f = 0, r = 0;
    if (keys.w || keys.arrowup) f += 1;
    if (keys.s || keys.arrowdown) f -= 1;
    if (keys.d || keys.arrowright) r += 1;
    if (keys.a || keys.arrowleft) r -= 1;
    if (f || r) {
      // keys move relative to where the camera looks
      path = []; walkBooth = null;
      vx = -Math.sin(rig.yaw) * f + Math.cos(rig.yaw) * r;
      vz = -Math.cos(rig.yaw) * f - Math.sin(rig.yaw) * r;
    } else if (path.length) {
      const tg = path[0], dx = tg.x - player.position.x, dz = tg.z - player.position.z, d = Math.hypot(dx, dz);
      if (d < 0.15) {
        path.shift();
        if (!path.length && walkBooth) { player.rotation.y = walkBooth.side < 0 ? -Math.PI / 2 : Math.PI / 2; walkBooth = null; }
      } else { vx = dx / d; vz = dz / d; }
    }
  }

  let moving = !!(vx || vz);
  if (moving) {
    const n = Math.hypot(vx, vz), sp = 3.4 * dt, ox = player.position.x, oz = player.position.z;
    const [nx, nz] = nav.step(ox, oz, (vx / n) * sp, (vz / n) * sp, sp);
    const moved = Math.hypot(nx - ox, nz - oz);
    if (path.length && moved < sp * 0.25) {
      stuck += dt;
      if (stuck > 0.5) { path = []; walkBooth = null; stuck = 0; }
    } else stuck = 0;
    player.position.x = nx;
    player.position.z = nz;
    if (moved < 1e-4) moving = false;
    let diff = Math.atan2(vx, vz) - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 10);
    if (moving) walkPhase += dt * 9;
  }

  // choppy gait, on purpose
  const tq = Math.floor(walkPhase * 2) / 2;
  const swing = moving ? Math.sin(tq) * 0.55 : 0;
  const u = player.userData;
  u.legs[0].rotation.x = swing; u.legs[1].rotation.x = -swing;
  u.arms.R.rotation.x = -swing * 0.8; u.arms.L.rotation.x = swing * 0.8;
  player.position.y = moving ? Math.abs(Math.sin(tq)) * 0.06 : 0;
  player.rotation.z = moving ? Math.sin(tq) * 0.05 : 0;
}

function updateSurroundings(dt) {
  // main doors open for whoever is near
  const near = Math.hypot(player.position.x, player.position.z - FACADE_Z) < 4.5 ? 1 : 0;
  outside.leafL.rotation.y += (near * 1.35 - outside.leafL.rotation.y) * Math.min(1, dt * 5);
  outside.leafR.rotation.y += (-near * 1.35 - outside.leafR.rotation.y) * Math.min(1, dt * 5);

  const out = player.position.z > FACADE_Z;
  if (out !== isOutside) {
    isOutside = out;
    if (state === 'hall') ambient.setPlace(out ? 'yard' : 'hall');
    $('#placeName').textContent = out ? '성당 앞마당' : `고해소 ${channelNo}채널`;
  }

  // which booth door the player stands at
  let nb = null, nd = 1.35;
  if (!out) {
    for (const b of booths) {
      const d = Math.hypot(b.spot.x - player.position.x, b.spot.z - player.position.z);
      if (d < nd && Math.sign(player.position.x) === b.side) { nd = d; nb = b; }
    }
  }
  nearBooth = nb;
  const prompt = $('#prompt'), act = $('#actBtn');
  if (state === 'hall' && nb) {
    prompt.hidden = false;
    if (nb.occupied) {
      prompt.textContent = `${nb.id + 1}번 고해소: 고해성사가 진행중입니다`;
      act.hidden = true;
    } else {
      prompt.innerHTML = `<kbd>E</kbd>${nb.id + 1}번 고해소 문 열기`;
      act.hidden = false;
    }
  } else {
    prompt.hidden = true;
    act.hidden = true;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  booths.forEach((b) => { b.hinge.rotation.y += (b.doorTarget - b.hinge.rotation.y) * Math.min(1, dt * 8); });

  if (state === 'room' || state === 'leaving') {
    confessional.update(dt, t);
    renderer.render(confessional.scene, confessional.camera);
    return;
  }
  if (state === 'hall' || state === 'intro') {
    updatePlayer(dt);
    updateSurroundings(dt);
    if (state === 'intro') {
      rig.updateIntro(t, player.position);
      player.visible = true;
    } else {
      player.visible = rig.update(player, dt, colliders, portrait);
    }
  }
  renderer.render(world, camera);
}
animate();
