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
import { history } from './storage/history.js';
import { $, toast, fade, createBubble, initHistoryPanel } from './ui/hud.js';

/*
 * Flow:  intro -> hall (yard + corridor) -> opening (door animation) -> room -> hall
 *
 * main.js only wires modules together and runs the frame loop.
 * World building lives in world/, input in controls/, the booth lock in net/.
 */

const IDLE_MS = 90_000;
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
const params = new URLSearchParams(location.search);
const rooms = createLocalRoomClient({ count: BOOTH_COUNT, simulate: params.get('sim') !== '0' });
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
let idleTimer = null;
let path = [];                 // tap-to-walk waypoints
let walkBooth = null;          // booth to face when the path ends
let stuck = 0;
let walkPhase = 0;
let muted = false;

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
async function tryEnter() {
  const b = nearBooth;
  if (!b) return;
  if (b.occupied) { toast(BUSY_MESSAGE); return; }
  state = 'opening';   // block double presses while the claim is in flight
  const { ok } = await rooms.claim(b.id);
  if (!ok) { state = 'hall'; toast(BUSY_MESSAGE); return; }

  current = b;
  b.doorTarget = 1.3;
  $('#actBtn').hidden = true;
  $('#prompt').hidden = true;
  player.rotation.y = b.side < 0 ? -Math.PI / 2 : Math.PI / 2;
  setTimeout(() => fade(true), 450);
  setTimeout(enterRoom, 850);
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
  setTimeout(() => bubble.say('성부와 성자와 성령의 이름으로. 아멘.'), 300);
  setTimeout(readyForConfession, 6200);
  resetIdle();
}

function readyForConfession() {
  if (state !== 'room') return;
  $('#guide').textContent = '고해하실 내용을 작성하세요';
  setInputEnabled(true);
  try { $('#confess').focus({ preventScroll: true }); } catch (_) { /* older browsers */ }
}

function setInputEnabled(on) {
  $('#confess').disabled = !on;
  $('#sendBtn').disabled = !on;
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (state !== 'room') return;
    leaveRoom();
    toast('오랫동안 입력이 없어 고해소에서 나왔습니다. 자리는 다른 분께 돌아갔습니다.');
  }, IDLE_MS);
}

$('#confess').addEventListener('input', resetIdle);
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state !== 'room' || !engine) return;
  const text = $('#confess').value.trim();
  if (!text) return;
  resetIdle();
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
  }, 2200);
});

function leaveRoom() {
  if (state !== 'room') return;
  clearTimeout(idleTimer);
  bubble.stop();
  fade(true);
  setTimeout(() => {
    state = 'hall';
    ambient.setPlace('hall');
    $('#roomUi').hidden = true;
    $('#hallUi').hidden = false;
    const b = current;
    player.position.copy(b.spot);
    player.position.x -= b.side * 0.3;
    player.rotation.y = Math.PI;
    rig.yaw = 0;
    path = [];
    b.doorTarget = 0;
    setTimeout(() => rooms.release(b.id), 500);
    current = null;
    fade(false);
  }, 380);
}

$('#exitBtn').onclick = leaveRoom;
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
    $('#placeName').textContent = out ? '성당 앞마당' : '고해소 1채널';
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

  if (state === 'room') {
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
