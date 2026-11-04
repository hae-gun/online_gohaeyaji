import * as THREE from 'three';
import './styles.css';
import { makeGlassTexture } from './core/three-utils.js';
import { buildHall } from './world/hall.js';
import { buildExterior, FACADE_Z, FOUNTAIN } from './world/exterior.js';
import { createPigeons, plazaPigeonSpots } from './world/pigeons.js';
import { createWalkMarker } from './world/walk-marker.js';
import { buildBooths, BOOTH_COUNT, CONFESSION_HALL } from './world/booths.js';
import { makeFigure, parishioner, walkPose } from './world/figure.js';
import { storedLook, validLook, parseLook, makeLook } from './net/looks.js';
import { createOtherPlayers } from './world/others.js';
import { buildConfessional } from './world/confessional.js';
import { createKeyboard } from './controls/keyboard.js';
import { createNavigation, placeOf } from './controls/navigation.js';
import { createCameraRig } from './controls/camera-rig.js';
import { loadAnswerData, createAnswerEngine } from './answer/engine.js';
import { pickPersona, testPersona } from './answer/pick-persona.js';
import { createAmbient } from './audio/ambient.js';
import { createVoice } from './audio/voice.js';
import { createLocalRoomClient } from './net/room-client.js';
import { createWsRoomClient } from './net/ws-room-client.js';
import { createMoveSender } from './net/move-sender.js';
import { checkName, normalizeName, randomSaintName, NAME_REASON } from './net/names.js';
import { createFaceEditor } from './ui/face-editor.js';
import { hiddenFaces } from './net/faces.js';
import { maskContact } from './net/feedback.js';
import { EMOTES, createEmotePlayer } from './world/emotes.js';
import { history } from './storage/history.js';
import { $, toast, fade, createBubble, initHistoryPanel } from './ui/hud.js';
import { drawPenanceCard, createCardPanel } from './ui/penance-card.js';
import { cardUrl } from './card/link.js';

/*
 * Flow:  intro -> hall (yard, nave, confession hall) -> opening (door animation) -> room -> hall
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
world.fog = new THREE.Fog(0x5a4560, 40, 130);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 220);

const glassTex = makeGlassTexture();
const hall = buildHall(world, glassTex);
const colliders = hall.colliders;   // the orbit camera stays in front of these
const outside = buildExterior(world, { glassTex, colliders });
const booths = buildBooths(world, colliders);
// booths stand on the floor like any other obstacle
const nav = createNavigation([...outside.obstacles, ...hall.obstacles, ...booths.map((b) => ({ box: true, ...b.box }))]);
const pigeons = createPigeons(world, plazaPigeonSpots(FOUNTAIN, outside.obstacles));
const confessional = buildConfessional();

// 형제님 or 자매님 (net/looks.js); null until chosen on the entry card the first time
let myLook = storedLook.load();
const MY_SEED = 7;   // picks my clothes colours
let player = makeFigure(parishioner(myLook || 'm', MY_SEED, { face: 'derpy' }));
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
// VITE_REALTIME_URL set (npm run dev:server, or the GitHub Pages build: wss://api.gohaeyaji.com/ws,
// see .github/workflows/deploy-pages.yml) -> real server. Not set (npm run dev) -> in-browser simulation.
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
let priest = null;             // persona of the priest in that booth ({ id, name })
let nearBooth = null;
let place = 'yard';            // 'yard' | 'around' | 'trail' | 'event' | 'nave' | 'booths' (placeOf)
let path = [];                 // tap-to-walk waypoints
let walkBooth = null;          // booth to face when the path ends
let stuck = 0;
let walkPhase = 0;
let walkAmp = 0;               // 0..1, eases the gait in and out
let nearBench = null;          // plaza bench close enough to sit on
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
  if (s.channelNo) { channelNo = s.channelNo; $('#chanNo').textContent = channelNo; }
  const banner = $('#netStatus');
  banner.hidden = s.state === 'ready';
  banner.textContent = NET_MESSAGE[s.state] || '';
  showPlace();
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

/* ---------- other players (protocol v0.3) ---------- */
const others = createOtherPlayers(world, $('#nameTags'), (e) => openPlayerMenu(e));
const moveSender = createMoveSender(rooms);
rooms.onPresence((e) => {
  others.handle(e);
  // after a (re)connect or a channel switch the server does not know where I am; show myself again
  if (e.kind === 'reset' && state === 'hall') {
    moveSender.now(player.position, player.rotation.y);
    if (myEmote.seated) rooms.sendEmote('sit', { x: player.position.x, z: player.position.z, ry: player.rotation.y });
  }
});
if (rooms.sharesPresence) $('#peopleWrap').hidden = false;

/* ---------- switching channel (protocol v0.10) ---------- */
const chanPanel = $('#chanPanel'), chanList = $('#chanList'), chanError = $('#chanError');
const SWITCH_REASON = {
  FULL: '그 채널은 가득 찼습니다. 다른 채널을 골라 주세요.',
  NO_CHANNEL: '그 채널은 사람이 없어 닫혔습니다. 목록을 새로고침해 주세요.',
  IN_BOOTH: '고해소 안에서는 채널을 옮길 수 없습니다.',
  TOO_SOON: '채널은 3초에 한 번 옮길 수 있습니다.',
  SAME: '이미 이 채널에 있습니다.',
  OFFLINE: '서버와 연결되어 있지 않습니다.',
  TIMEOUT: '서버가 답하지 않습니다. 잠시 후 다시 시도해 주세요.',
};
if (rooms.canSwitchChannel) $('#chanBtn').hidden = false;
async function loadChannels() {
  chanError.hidden = true;
  const r = await rooms.listChannels();
  if (!r.ok) { chanError.textContent = SWITCH_REASON[r.reason] || SWITCH_REASON.TIMEOUT; chanError.hidden = false; return; }
  chanList.textContent = '';
  for (const c of r.channels) {
    const here = c.no === r.current, full = c.members >= r.capacity;
    const row = document.createElement('div');
    row.className = `chanRow${here ? ' here' : ''}`;
    row.setAttribute('role', 'listitem');
    const name = document.createElement('b');
    name.textContent = `${c.no}채널`;
    const info = document.createElement('div');
    const meter = document.createElement('div'); meter.className = 'meter';
    const fill = document.createElement('i'); fill.style.width = `${Math.min(100, (c.members / r.capacity) * 100)}%`; meter.appendChild(fill);
    const count = document.createElement('small'); count.textContent = `${c.members} / ${r.capacity}명${here ? ', 지금 여기' : ''}`;
    info.append(meter, count);
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = here ? '여기 있음' : full ? '가득 참' : '옮기기';
    go.disabled = here || full;
    go.onclick = () => switchTo(c.no);
    row.append(name, info, go);
    chanList.appendChild(row);
  }
}
async function switchTo(no) {
  if (state !== 'hall') { chanError.textContent = SWITCH_REASON.IN_BOOTH; chanError.hidden = false; return; }
  chanList.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  const r = await rooms.switchChannel(no);
  if (!r.ok) {
    chanError.textContent = SWITCH_REASON[r.reason] || SWITCH_REASON.TIMEOUT;
    chanError.hidden = false;
    loadChannels();
    return;
  }
  chanPanel.hidden = true;
  toast(`${no}채널로 옮겼습니다`);
}
$('#chanBtn').onclick = () => { chanPanel.hidden = false; chanList.textContent = ''; loadChannels(); };
$('#chanRefresh').onclick = loadChannels;
$('#chanClose').onclick = () => { chanPanel.hidden = true; };
chanPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') chanPanel.hidden = true; });

/* ---------- my baptismal name (protocol v0.4) ---------- */
rooms.onName((name) => { $('#myName').textContent = name; });
const namePanel = $('#namePanel'), nameInput = $('#nameInput'), nameError = $('#nameError');
function showNameError(reason) {
  nameError.textContent = NAME_REASON[reason] || NAME_REASON.INVALID;
  nameError.hidden = false;
}
function closeNamePanel() { namePanel.hidden = true; }
$('#nameBtn').onclick = () => {
  nameInput.value = rooms.myName || '';
  nameError.hidden = true;
  namePanel.hidden = false;
  try { nameInput.focus(); nameInput.select(); } catch (_) { /* ignore */ }
};
$('#nameRandom').onclick = () => {
  let next;
  do { next = randomSaintName(); } while (next === nameInput.value);
  nameInput.value = next;
  nameError.hidden = true;
};
$('#nameCancel').onclick = closeNamePanel;
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNamePanel(); });
nameInput.addEventListener('input', () => { nameError.hidden = true; });
/* ---------- my hand-drawn face (protocol v0.5) ---------- */
player.userData.face.setCustom(rooms.myFace);
const faceEditor = createFaceEditor({
  getFace: () => rooms.myFace,
  getLook: () => myLook || 'm',
  previewLook: (code) => wearLook(code),
  commitLook: (code) => { setMyLook(code); toast('모습을 바꿨습니다'); },
  async apply(face) {
    const r = await rooms.setFace(face);
    if (r.ok) {
      player.userData.face.setCustom(face);
      toast(face ? '새 얼굴로 바꿨습니다' : '기본 얼굴로 돌아갔습니다');
      if (face && state === 'hall') showMyFace(false);   // show the new face right away
    }
    return r;
  },
});
$('#faceBtn').onclick = () => faceEditor.open();

/* top-right menu on phones (styles.css hides the row behind one 메뉴 button under 900px wide) */
const menuItems = $('#menuItems'), menuBtn = $('#menuBtn');
const setMenu = (open) => { menuItems.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
menuBtn.onclick = () => setMenu(!menuItems.classList.contains('open'));
// choosing an item closes the list (each item's own handler still runs)
menuItems.addEventListener('click', (e) => { if (e.target.closest('button')) setMenu(false); });
// a tap anywhere else closes it too
addEventListener('pointerdown', (e) => { if (menuItems.classList.contains('open') && !e.target.closest('.btns')) setMenu(false); }, true);
const SHOW_DRAWN_KEY = 'gohaeyaji-show-drawn';
let showDrawn = true;
try { showDrawn = localStorage.getItem(SHOW_DRAWN_KEY) !== '0'; } catch (_) { /* storage blocked */ }
$('#faceShowOthers').checked = showDrawn;
others.setShowDrawn(showDrawn);

/* ---------- emotes (protocol v0.7) ---------- */
// one at a time: every button is locked until the current emote ends; walking and the camera stay free
let myEmote = createEmotePlayer(player);
const emoteButtons = EMOTES.map((e, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.innerHTML = `<kbd>${i + 1}</kbd>`;
  b.append(e.label);
  const fill = document.createElement('span');
  fill.className = 'fill';
  b.appendChild(fill);
  b.onclick = () => playEmote(e.id);
  $('#emoteBar').appendChild(b);
  return { id: e.id, b, fill };
});
function playEmote(id) {
  if (state !== 'hall' || myEmote.playing) return;
  if (!myEmote.start(id)) return;
  rooms.sendEmote(id);
  // someone who has not moved yet is invisible to others; show up first so the emote is seen
  moveSender.now(player.position, player.rotation.y);
}
/** Sit on the bench or pew next to me (protocol section 16, emote 'sit'). Walking stands up again. */
let mySeat = null;   // the bench or pew I sit on
function sitDown(bench) {
  if (state !== 'hall' || myEmote.seated) return;
  if (others.sitterAt(bench.seat.x, bench.seat.z) !== null) { toast('이미 누가 앉아 있는 자리입니다'); return; }
  mySeat = bench;
  path = []; walkBooth = null;
  player.position.set(bench.seat.x, 0, bench.seat.z);
  player.rotation.y = bench.rot;
  rig.yaw = bench.rot + Math.PI;   // camera behind, looking out over the plaza with the sitter
  myEmote.start('sit');
  // the seat travels with the sit, so others put me exactly there (a separate move could be
  // dropped by the server's rate limit right after walking)
  rooms.sendEmote('sit', { x: player.position.x, z: player.position.z, ry: player.rotation.y });
}
/* ---------- things to do in the nave and the confession hall ---------- */
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const CANDLE_LINES = [
  '초를 켰습니다. 3분 동안 조용히 타오릅니다',
  '초를 켰습니다. 소원은 마음속으로만 말해 주세요',
  '초를 켰습니다. 다이어트 성공을 빌었다면 초콜릿은 내려놓으세요',
  '초를 켰습니다. 불은 3분 뒤 알아서 꺼집니다',
];
const OFFER_LINES = [
  '봉헌 감사합니다. 실제로 돈은 나가지 않습니다',
  '짤랑. 마음만 받겠습니다',
  '봉헌 감사합니다. 오늘 하루 지갑이 평안하길',
  '짤랑. 액수는 하늘만 압니다',
];
let offerings = 0;
const FEED_LINES = [
  '모이를 뿌렸습니다. 비둘기들이 눈치를 봅니다',
  '모이를 뿌렸습니다. 오늘은 비둘기에게 먼저 베풀었습니다',
  '모이를 뿌렸습니다. 천천히 다가가면 도망가지 않습니다',
  '모이를 뿌렸습니다. 비둘기 사이에도 새치기는 있습니다',
];
let fedAt = -Infinity;
/** Places outside the buildings: the yard, the path round the cathedral, the trails, the event field. */
const OUTDOORS = new Set(['yard', 'around', 'trail', 'event']);
/** What E does where I stand: { label, run } or null. Booth doors are handled separately. */
function nearAction() {
  const p = player.position;
  const near = (v, r) => Math.hypot(v.x - p.x, v.z - p.z) < r;
  if (place === 'nave') {
    if (near(hall.places.candles, 1.6)) {
      return {
        label: '초 켜기',
        run() {
          if (!hall.lightCandle()) { toast('초가 모두 켜져 있습니다. 하나가 꺼질 때까지 기다려 주세요'); return; }
          ambient.chime();
          toast(pick(CANDLE_LINES));
        },
      };
    }
    if (near(hall.places.offering, 1.2)) {
      return {
        label: '봉헌하기',
        run() {
          offerings++;
          hall.dropCoin();
          ambient.coin();
          toast(offerings === 7 ? '일곱 번째 봉헌입니다. 하늘이 슬슬 부담스러워합니다' : pick(OFFER_LINES));
        },
      };
    }
    if (hall.places.fonts.some((f) => near(f, 1.3))) {
      return {
        label: '성수 찍고 성호 긋기',
        run() {
          if (myEmote.playing) return;
          playEmote('cross');
          toast('성수를 찍고 성호를 그었습니다');
        },
      };
    }
  }
  if (place === 'booths' && near(hall.places.inquiry, 2.1)) {
    return { label: '신께 알리기', run: openInquiry };
  }
  if (nearBench) return { label: place === 'nave' ? '장의자에 앉기' : '벤치에 앉기', run: () => sitDown(nearBench) };
  // pigeon feed: anywhere on the fountain plaza
  if (place === 'yard' && p.z < 33.5 && Math.abs(p.x) < 12.3 && Math.hypot(p.x - FOUNTAIN.x, p.z - FOUNTAIN.z) > 3.4) {
    return {
      label: '비둘기 모이 주기',
      run() {
        const wait = 8 - (clock.elapsedTime - fedAt);
        if (wait > 0) { toast(`모이는 ${Math.ceil(wait)}초 뒤에 다시 줄 수 있습니다`); return; }
        const ry = player.rotation.y;
        const ahead = { x: p.x + Math.sin(ry) * 1.4, z: p.z + Math.cos(ry) * 1.4 };
        if (!pigeons.feed(ahead) && !pigeons.feed(p)) { toast('여기에는 모이를 뿌릴 수 없습니다'); return; }
        fedAt = clock.elapsedTime;
        toast(pick(FEED_LINES));
      },
    };
  }
  return null;
}
let nearDo = null;
function act() {
  if (nearBooth) tryEnter();
  else if (nearDo) nearDo.run();
}

/* ---------- inquiry box "신께 알리기" (protocol v0.8) ---------- */
const inquiryPanel = $('#inquiryPanel'), inquiryText = $('#inquiryText'), inquiryError = $('#inquiryError');
const INQUIRY_REASON = {
  INVALID: '5자 이상 500자 이하로 적어 주세요.',
  TOO_SOON: '1분에 한 번 보낼 수 있습니다. 조금 뒤에 다시 보내 주세요.',
  TOO_MANY: '이 연결에서 보낸 문의가 많습니다. 한 시간 뒤에 다시 보내 주세요.',
  OFFLINE: '서버와 연결되어 있을 때만 보낼 수 있습니다.',
  TIMEOUT: '서버가 답하지 않았습니다. 잠시 후 다시 보내 주세요.',
};
function openInquiry() {
  inquiryError.hidden = true;
  inquiryPanel.hidden = false;
  $('#inquiryCount').textContent = String([...inquiryText.value].length);
  focusAfterKey(inquiryText);
}
/**
 * Focuses a text box opened with a key (E). Focusing it right away lets the same key press land
 * in the box: with the Korean IME on, E types 'ㄷ'. So wait until the key is released.
 */
function focusAfterKey(el) {
  const focus = () => { try { el.focus(); } catch (_) { /* ignore */ } };
  if (!keys.e) { focus(); return; }
  const onUp = (ev) => {
    if (ev.code !== 'KeyE') return;
    removeEventListener('keyup', onUp, true);
    setTimeout(focus, 0);
  };
  addEventListener('keyup', onUp, true);
}
const closeInquiry = () => { inquiryPanel.hidden = true; };
$('#inquiryCancel').onclick = closeInquiry;
inquiryPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInquiry(); });
inquiryText.addEventListener('input', () => {
  inquiryError.hidden = true;
  $('#inquiryCount').textContent = String([...inquiryText.value].length);
});
$('#inquiryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inquiryText.value.trim();
  const kind = $('#inquiryForm').querySelector('input[name="kind"]:checked')?.value || 'question';
  if ([...text].length < 5) { inquiryError.textContent = INQUIRY_REASON.INVALID; inquiryError.hidden = false; return; }
  $('#inquirySend').disabled = true;
  const r = await rooms.sendInquiry(kind, text);
  $('#inquirySend').disabled = false;
  if (!r.ok) { inquiryError.textContent = INQUIRY_REASON[r.reason] || INQUIRY_REASON.INVALID; inquiryError.hidden = false; return; }
  inquiryText.value = '';
  closeInquiry();
  hall.sendLetter();
  ambient.chime();
  toast('하늘로 보냈습니다. 운영자가 꼭 읽겠습니다');
});
let shownEmote = null;
function updateEmoteBar() {
  const playing = myEmote.playing;
  if (playing !== shownEmote) {
    shownEmote = playing;
    for (const { id, b, fill } of emoteButtons) {
      b.disabled = !!playing;
      b.classList.toggle('active', id === playing);
      if (!playing) fill.style.width = '0';
    }
  }
  const cur = playing && emoteButtons.find((x) => x.id === playing);
  if (cur) {
    cur.fill.style.width = `${Math.round(myEmote.progress * 100)}%`;
  }
}

/* ---------- hide or report someone's drawn face (protocol v0.6) ---------- */
const playerMenu = $('#playerMenu');
let menuTarget = null;
function openPlayerMenu({ pid, name, face, rect }) {
  menuTarget = { pid, face };
  $('#playerMenuName').textContent = name || '이름 없는 교우';
  $('#pmHide').textContent = hiddenFaces.has(face) ? '이 얼굴 다시 보기' : '이 얼굴 숨기기';
  playerMenu.hidden = false;
  const w = playerMenu.offsetWidth, h = playerMenu.offsetHeight;
  playerMenu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`;
  playerMenu.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, rect.bottom + 6))}px`;
}
function closePlayerMenu() { playerMenu.hidden = true; menuTarget = null; }
$('#pmClose').onclick = closePlayerMenu;
$('#pmHide').onclick = () => {
  if (!menuTarget) return;
  if (hiddenFaces.has(menuTarget.face)) { hiddenFaces.remove(menuTarget.face); toast('이 얼굴을 다시 보입니다'); }
  else { hiddenFaces.add(menuTarget.face); toast('이 얼굴을 숨겼습니다. 다음에 들어와도 숨겨집니다'); }
  others.refreshFaces();
  updateUnhideButton();
  closePlayerMenu();
};
const REPORT_REASON = {
  ALREADY: '이미 신고한 그림입니다.',
  TOO_MANY: '신고가 너무 잦습니다. 잠시 후 다시 해 주세요.',
  NO_FACE: '그 사람은 지금 그린 얼굴을 쓰고 있지 않습니다.',
  OFFLINE: '서버와 연결되지 않아 신고하지 못했습니다.',
  TIMEOUT: '서버가 답하지 않아 신고하지 못했습니다.',
};
$('#pmReport').onclick = async () => {
  if (!menuTarget) return;
  const { pid, face } = menuTarget;
  closePlayerMenu();
  const r = await rooms.report(pid);
  // whatever the server says, the reporter should not have to keep looking at it
  hiddenFaces.add(face);
  others.refreshFaces();
  updateUnhideButton();
  toast(r.ok ? '신고했습니다. 이 그림은 내 화면에서 숨깁니다' : (REPORT_REASON[r.reason] || '신고하지 못했습니다.'));
};
addEventListener('pointerdown', (e) => { if (!playerMenu.hidden && !playerMenu.contains(e.target) && !e.target.closest('.nameTag')) closePlayerMenu(); });
function updateUnhideButton() { $('#faceUnhide').hidden = !hiddenFaces.list().length; }
$('#faceUnhide').onclick = () => { hiddenFaces.clear(); others.refreshFaces(); updateUnhideButton(); toast('숨긴 그림을 모두 다시 보입니다'); };
updateUnhideButton();
rooms.onFaceRemoved(({ blockedMs }) => {
  player.userData.face.setCustom(null);
  toast(`여러 분이 신고해서 내 그림이 내려갔습니다. ${Math.round(blockedMs / 60000)}분 뒤에 다시 그릴 수 있습니다`);
});

$('#faceShowOthers').addEventListener('change', (e) => {
  others.setShowDrawn(e.target.checked);
  try { localStorage.setItem(SHOW_DRAWN_KEY, e.target.checked ? '1' : '0'); } catch (_) { /* storage blocked */ }
});

$('#nameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = normalizeName(nameInput.value);
  if (name === rooms.myName) { closeNamePanel(); return; }
  const verdict = checkName(name);           // quick answer for the obvious cases
  if (verdict !== 'OK') { showNameError(verdict); return; }
  $('#nameSave').disabled = true;
  const r = await rooms.rename(name);        // the server has the final say
  $('#nameSave').disabled = false;
  if (!r.ok) { showNameError(r.reason); return; }
  closeNamePanel();
  toast(`이제 ${r.name}(으)로 불립니다`);
});
let shownPeople = -1;


/* ---------- input ---------- */
const keys = createKeyboard((k) => {
  if (!namePanel.hidden || faceEditor.isOpen() || !inquiryPanel.hidden || !chanPanel.hidden || !fbPanel.hidden) return;   // a dialog is open: buttons inside it may hold focus
  if (k === 'e' && state === 'hall') act();
  if (state === 'hall' && /^[1-9]$/.test(k) && EMOTES[Number(k) - 1]) playEmote(EMOTES[Number(k) - 1].id);
  if (k === 'v' && state === 'hall') toggleView();
  if (k === 'f' && state === 'hall') showMyFace();
  if (k === 'escape' && state === 'room') leaveRoom();
});

const rig = createCameraRig({
  canvas: renderer.domElement,
  camera,
  isActive: () => state === 'hall',
  onTap: tapAt,
});

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
// where a tap is taking me: ring on the spot, dots on the way (world/walk-marker.js)
const walkMarker = createWalkMarker(world);
function tapAt(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const doorHits = ray.intersectObjects(booths.map((b) => b.group), true).filter((h) => h.object.userData.booth !== undefined);
  const groundHits = ray.intersectObjects([...hall.floors, ...outside.groundMeshes]);
  if (doorHits.length && (!groundHits.length || doorHits[0].distance <= groundHits[0].distance + 0.5)) {
    const b = booths[doorHits[0].object.userData.booth];
    path = nav.planPath(player.position, b.spot);
    walkBooth = b;
    walkMarker.tapped(path, b.spot);
  } else if (groundHits.length) {
    path = nav.planPath(player.position, groundHits[0].point);
    walkBooth = null;
    walkMarker.tapped(path, groundHits[0].point);
  }
  stuck = 0;
}

function toggleView() {
  const fp = rig.toggleFirstPerson();
  $('#viewBtn').textContent = fp ? '3인칭 시점' : '1인칭 시점';
  $('#selfieBtn').textContent = '내 얼굴 보기';
}
/** Camera to the front of me at face height (and back again): to see the face I drew. */
function showMyFace(back) {
  const front = rig.showFace(player.rotation.y, back);
  $('#selfieBtn').textContent = front ? '뒤에서 보기' : '내 얼굴 보기';
  $('#viewBtn').textContent = '1인칭 시점';
}
$('#selfieBtn').onclick = () => { if (state === 'hall') showMyFace(); };

/* ---------- 이동하기: straight to the plaza, the nave or a free booth ---------- */
// the cathedral is big: walking from the plaza to the confession hall takes a while, so one tap
// moves there behind a short fade. 고해소 goes to the middle of the hall, where every booth and
// its LED can be seen; picking a booth is still the person's own choice. Others see a jump (others.js snaps anything over 3 m).
const HALL_MID = { x: (CONFESSION_HALL.x0 + CONFESSION_HALL.x1) / 2, z: (CONFESSION_HALL.z0 + CONFESSION_HALL.z1) / 2 };
const TRAVEL = {
  yard: { at: [[0, 27.5], [3, 27.5]], facing: Math.PI },                                   // in front of the fountain
  nave: { at: [[0, 4], [1.5, 4], [0, 0]], facing: Math.PI },                               // the aisle, looking at the altar
  // the middle of the confession hall, a few steps short of the inquiry box, looking at it
  booths: { at: [[HALL_MID.x - 3.2, HALL_MID.z], [HALL_MID.x - 4.5, HALL_MID.z], [HALL_MID.x, HALL_MID.z + 3.2]], facing: Math.PI / 2 },
};
const travelBtn = $('#travelBtn'), travelList = $('#travelList');
const setTravel = (open) => { travelList.hidden = !open; travelBtn.setAttribute('aria-expanded', String(open)); };
travelBtn.onclick = () => setTravel(travelList.hidden);
travelList.addEventListener('click', (e) => { const b = e.target.closest('button[data-go]'); if (b) { setTravel(false); travelTo(b.dataset.go); } });
addEventListener('pointerdown', (e) => { if (!travelList.hidden && !e.target.closest('.travel')) setTravel(false); }, true);

let travelling = false;
function travelTo(where) {
  if (state !== 'hall' || travelling) return;
  const t = TRAVEL[where];
  const spot = t.at.find(([x, z]) => nav.walkable(x, z)) || t.at[0];
  travelling = true;
  fade(true);
  setTimeout(() => {
    if (state === 'hall') {
      if (myEmote.seated) { myEmote.stop(); mySeat = null; }
      path = []; walkBooth = null;
      player.position.set(spot[0], 0, spot[1]);
      player.rotation.y = t.facing;
      rig.yaw = player.rotation.y - Math.PI;   // camera behind me, looking where I look
      moveSender.now(player.position, player.rotation.y);
    }
    fade(false);
    travelling = false;
  }, 380);
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
  player.rotation.y = b.facing;
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
  myEmote.stop();   // nobody sees me inside; the gesture ends at the door
  ambient.setPlace('room');
  ambient.setMusic(false);
  $('#hallUi').hidden = true;
  $('#roomUi').hidden = false;
  // drawn on entry, not tied to the door: 1/3 each, or a rare priest's own chance (pick-persona.js)
  // dev builds only: booth 20 always has the rare priest, for testing (testPersona)
  priest = engine ? testPersona(engine.personas, current.id) || pickPersona(engine.personas) : null;
  const legend = !!(priest && priest.chance);
  if (legend) ambient.peal(3);
  $('#roomUi').classList.toggle('legend', legend);
  voice.setTone(priest && priest.id);
  confessional.setPriest(priest ? priest.id : 'jin');
  $('#roomName').textContent = `${current.id + 1}번 고해소, ${priest ? priest.name : '신부님'}`;
  $('#bubble').hidden = true;
  $('#penance').hidden = true;
  lastCard = null;
  setInputEnabled(false);
  $('#confess').value = '';
  $('#guide').textContent = '신부님이 기도를 시작합니다';
  fade(false);
  idle.pause();   // the priest is praying; nobody gets kicked out during the blessing
  // each word is spoken when the hand reaches its point (forehead, chest, shoulders, joined hands)
  confessional.startBlessing((word) => (state === 'room' ? bubble.append(word) : 0), readyForConfession);
}

function readyForConfession() {
  if (state !== 'room') return;
  // a rare priest greets after the blessing
  if (priest && priest.greeting && priest.greeting.length) {
    const hello = priest.greeting[Math.floor(Math.random() * priest.greeting.length)];
    confessional.talk(bubble.say(hello), { script: [[0, 'smile']], after: 'smile', hold: 2 });
  }
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

/* ---------- answer feedback, only with consent (protocol v0.11) ---------- */
let lastAnswer = null;
// small talk about how someone feels: answered gently, but never offered for collection
const NO_FEEDBACK_CHAT = new Set(['sad', 'lonely', 'cry', 'help', 'advice']);
const fbPanel = $('#fbPanel'), fbError = $('#fbError');
const FB_REASON = {
  INVALID: '보낼 수 없는 내용입니다. 고해를 1~200자로 적어 주세요.',
  TOO_SOON: '조금 뒤에 다시 보내 주세요.',
  TOO_MANY: '이 연결에서 보낸 것이 많습니다. 한 시간 뒤에 다시 보내 주세요.',
  OFFLINE: '서버와 연결되어 있을 때만 보낼 수 있습니다.',
  TIMEOUT: '서버가 답하지 않았습니다. 잠시 후 다시 보내 주세요.',
};
$('#fbBtn').onclick = () => {
  if (!lastAnswer) return;
  fbError.hidden = true;
  $('#fbText').value = maskContact(lastAnswer.text);
  $('#fbAnswer').textContent = lastAnswer.answer;
  fbPanel.hidden = false;
  idle.pause();   // reading and deciding is not being idle
};
const closeFb = () => { fbPanel.hidden = true; if (state === 'room') idle.start(); };
$('#fbCancel').onclick = closeFb;
fbPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFb(); });
$('#fbForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!lastAnswer) return;
  const text = maskContact($('#fbText').value.trim());
  const reason = $('#fbForm').querySelector('input[name="fbReason"]:checked')?.value || 'wrong';
  $('#fbSend').disabled = true;
  const r = await rooms.sendFeedback({ reason, text, persona: lastAnswer.persona, category: lastAnswer.category, answer: lastAnswer.answer });
  $('#fbSend').disabled = false;
  if (!r.ok) { fbError.textContent = FB_REASON[r.reason] || FB_REASON.INVALID; fbError.hidden = false; return; }
  lastAnswer = null;
  $('#fbBtn').hidden = true;
  closeFb();
  toast('보내 주셔서 감사합니다. 신부님이 더 잘 알아듣도록 고치겠습니다');
});

/* ---------- 보속 카드 ---------- */
// The address printed on the card: the page people should land on (VITE_SITE_URL, or where this page is)
const SITE = (import.meta.env.VITE_SITE_URL || `${location.host}${location.pathname}`).replace(/^https?:\/\//, '').replace(/\/(index\.html)?$/, '');
let lastCard = null;
const cardPanel = createCardPanel({
  onOpen: () => idle.pause(),
  onClose: () => { if (state === 'room') idle.start(); },
});
/** The priest as he is on screen right now, without the speech bubble (that is HTML, not in the canvas). */
function snapshotPriest() {
  try {
    renderer.render(confessional.scene, confessional.camera);
    // copied in the same task as the render, so the WebGL buffer is still there
    const c = document.createElement('canvas');
    c.width = renderer.domElement.width; c.height = renderer.domElement.height;
    c.getContext('2d').drawImage(renderer.domElement, 0, 0);
    return c;
  } catch (_) { return null; }
}
$('#cardBtn').onclick = async () => {
  if (!lastCard || state !== 'room') return;
  const btn = $('#cardBtn');
  btn.disabled = true;
  try {
    const canvas = await drawPenanceCard({
      ...lastCard,
      priestImage: snapshotPriest(),
      priestName: priest ? priest.name : '신부님',
      name: rooms.myName || '익명의 고해자',
      face: rooms.myFace,
      site: SITE,
    });
    const link = lastCard.ref ? cardUrl({ ref: lastCard.ref, name: rooms.myName || '', when: lastCard.when, nth: lastCard.nth, look: myLook, face: rooms.myFace }) : '';
    await cardPanel.show(canvas, link);
  } catch (_) {
    toast('카드를 만들지 못했습니다');
  } finally {
    btn.disabled = false;
  }
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
  $('#fbBtn').hidden = true;
  lastAnswer = null;
  $('#guide').textContent = '신부님이 듣고 계십니다';
  bubble.say('……', { silent: true });
  confessional.setMood('listen');
  confessional.nod();

  const r = engine.answer(text, priest && priest.id);
  setTimeout(() => {
    if (state !== 'room') return;
    // a crisis reply is read in the same calm voice by every priest, never in the joking one
    voice.setTone(r.kind === 'safety' ? 'serious' : priest && priest.id);
    const sec = bubble.say(r.line, { safety: r.kind === 'safety' });
    confessional.talk(sec, faceFor(r));
    if (r.kind === 'answer') {
      $('#penanceText').textContent = r.penance;
      $('#penance small').textContent = r.persona === 'baek' ? '전설의 보속' : '오늘의 보속';
      $('#penance').hidden = false;
      history.add({ t: Date.now(), q: text, c: r.category, p: r.penance, pr: r.persona });
      // for the card: how many times this sin was confessed in this browser, this one included
      const nth = history.load().filter((h) => h.c === r.category).length;
      lastCard = { sin: r.keyword || r.category, penance: r.penance, legend: !!(priest && priest.chance), nth, when: new Date(), ref: r.ref };
    } else {
      $('#penance').hidden = true;
      lastCard = null;
    }
    // "답이 엉뚱해요": only where a real answer was given, and only with a server. Never for crisis
    // replies, risky-sounding messages (caution) or heavy small talk, so those are not collected
    if ((r.kind === 'answer' || r.kind === 'chat') && !r.caution && !NO_FEEDBACK_CHAT.has(r.category) && rooms.sendFeedback) {
      lastAnswer = { text, persona: r.persona, category: r.category || 'generic', answer: r.line };
      $('#fbBtn').hidden = false;
    }
    $('#guide').textContent = '더 고해하실 것이 있으면 작성하세요';
    setInputEnabled(true);
    idle.start();
  }, 2200);
});

/**
 * Expression while the priest answers. A normal answer goes empathy (worried brows),
 * penance (stern), closing line (a small smile that stays a moment). Crisis replies never smile.
 */
function faceFor(r) {
  if (r.kind === 'safety') return { script: [[0, 'concern']], after: 'concern', hold: 4 };
  if (r.kind === 'blocked') return { script: [[0, 'stern']], after: 'stern', hold: 1.5 };
  // something may be wrong (caution): a worried, kind face the whole time, no grin
  if (r.caution) return { script: [[0, 'concern']], after: 'listen', hold: 2 };
  if (r.kind === 'chat') {
    const mood = { jin: 'neutral', eom: 'stern', yu: 'smile', baek: 'smile' }[r.persona] || 'neutral';
    return { script: [[0, mood]], after: r.persona === 'eom' ? 'neutral' : 'smile', hold: 1.2 };
  }
  if (r.kind !== 'answer') return { script: [[0, r.persona === 'eom' ? 'stern' : 'neutral']] };
  const len = r.line.length;
  const pen = (r.penanceAt || 0) / len, close = Math.min(0.95, (r.closingAt || len) / len);
  // jin: worried, stern, warm smile / eom: stern all the way, softens at the very end / yu: grins through it
  const faces = {
    jin: [[0, 'concern'], [pen, 'stern'], [close, 'smile']],
    eom: [[0, 'stern'], [close, 'neutral']],
    yu: [[0, 'smile'], [pen, 'neutral'], [close, 'smile']],
    // baek: a calm smile the whole time, eyes softening for the penance
    baek: [[0, 'smile'], [pen, 'listen'], [close, 'smile']],
  };
  return { script: faces[r.persona] || faces.jin, after: r.persona === 'eom' ? 'neutral' : 'smile', hold: 1.5 };
}

/**
 * @param {{ reason?: 'USER'|'IDLE', notifyServer?: boolean, message?: string }} opts
 *   notifyServer=false when the server already took the booth away
 */
function leaveRoom({ reason = 'USER', notifyServer = true, message = '' } = {}) {
  if (state !== 'room') return;
  // the legendary priest says goodbye when you walk out on your own
  if (reason === 'USER' && !message && priest && priest.farewell && priest.farewell.length) {
    message = `${priest.name}: ${priest.farewell[Math.floor(Math.random() * priest.farewell.length)]}`;
  }
  idle.pause();
  bubble.stop();
  confessional.reset();
  $('#fbBtn').hidden = true;
  fbPanel.hidden = true;
  lastAnswer = null;
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
    // a step out from the door, turned toward the room
    player.position.copy(b.spot).addScaledVector(b.normal, 0.3);
    player.rotation.y = b.facing + Math.PI;
    rig.yaw = b.facing + Math.PI * 2;
    path = [];
    b.doorTarget = 0;
    current = null;
    moveSender.now(player.position, player.rotation.y);   // reappear in front of the door
    fade(false);
    if (message) toast(message);
  }, 380);
}

$('#exitBtn').onclick = () => leaveRoom();
$('#actBtn').onclick = act;
$('#viewBtn').onclick = toggleView;
$('#sndBtn').onclick = () => {
  muted = !muted;
  $('#sndBtn').textContent = muted ? '소리 켜기' : '소리 끄기';
  ambient.setMuted(muted);
  voice.setMuted(muted);
};
/* ---------- 형제님 / 자매님 ---------- */
function markLook() {
  const clothes = myLook ? parseLook(myLook).clothes : null;
  document.querySelectorAll('.lookPick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === clothes)));
}
/**
 * Puts a look (clothes, skin tone, hair: net/looks.js) on my character where I stand, keeping the
 * drawn face, the seat and the camera. Local only: the face editor uses it to try looks on.
 */
function wearLook(look) {
  if (!validLook(look) || player.userData.lookCode === look) return;
  {
    const fig = makeFigure(parishioner(look, MY_SEED, { face: 'derpy' }));
    fig.position.copy(player.position);
    fig.rotation.y = player.rotation.y;
    fig.visible = player.visible;
    const seated = myEmote.seated;
    world.remove(player);
    world.add(fig);
    player = fig;
    player.userData.face.setCustom(rooms.myFace);
    myEmote = createEmotePlayer(player);
    if (seated) myEmote.start('sit');
  }
}
/** Wears a look and tells the server, so everyone sees it (protocol v0.17). */
function setMyLook(look) {
  if (!validLook(look)) return;
  myLook = look;
  markLook();
  wearLook(look);
  rooms.setLook(look);
}
// the entry card picks the clothes; skin tone and hair style chosen before are kept
document.querySelectorAll('.lookPick button').forEach((b) => {
  b.onclick = () => {
    const now = parseLook(myLook || 'm');
    setMyLook(makeLook(b.dataset.look, now.skin, now.hair));
    $('#lookError').hidden = true;
  };
});
markLook();

$('#startBtn').onclick = () => {
  // the first time, 형제님 or 자매님 has to be picked; after that it is remembered
  if (!myLook) { $('#lookError').hidden = false; return; }
  setMyLook(myLook);
  ambient.start();
  voice.unlock();   // Safari speaks only after a first phrase inside a click
  $('#intro').hidden = true;
  $('#hallUi').hidden = false;
  state = 'hall';
  rig.yaw = 0;   // the intro sweep leaves yaw rotated; start behind the player facing the doors
  moveSender.now(player.position, player.rotation.y);   // others start seeing me from here
  if ('ontouchstart' in window) $('#moveHint').textContent = '탭해서 이동, 드래그로 시점 회전, 두 손가락으로 확대';
};

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();

function updatePlayer(dt) {
  let vx = 0, vz = 0;
  if (state === 'hall' && namePanel.hidden && !faceEditor.isOpen() && inquiryPanel.hidden && chanPanel.hidden) {
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
        if (!path.length && walkBooth) { player.rotation.y = walkBooth.facing; walkBooth = null; }
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

  walkAmp += ((moving ? 1 : 0) - walkAmp) * Math.min(1, dt * 10);
  walkPose(player, walkPhase, walkAmp);
  myEmote.update(dt, moving);
  return moving;
}

function updateSurroundings(dt) {
  // the music box plays in the nave only (not in the confession hall, not inside a booth)
  ambient.setMusic(state === 'hall' && place === 'nave');
  // main doors open for whoever is near
  const near = Math.hypot(player.position.x, player.position.z - FACADE_Z) < 4.5 ? 1 : 0;
  outside.leafL.rotation.y += (near * 1.35 - outside.leafL.rotation.y) * Math.min(1, dt * 5);
  outside.leafR.rotation.y += (-near * 1.35 - outside.leafR.rotation.y) * Math.min(1, dt * 5);

  const now = placeOf(player.position.x, player.position.z);
  if (now !== place) {
    place = now;
    if (state === 'hall') ambient.setPlace(OUTDOORS.has(place) ? 'yard' : 'hall');
    showPlace();
  }

  // which booth door the player stands at
  let nb = null, nd = 1.35;
  if (place === 'booths') {
    for (const b of booths) {
      const d = Math.hypot(b.spot.x - player.position.x, b.spot.z - player.position.z);
      if (d < nd) { nd = d; nb = b; }
    }
  }
  nearBooth = nb;
  // a free bench or pew next to me (not while something else is playing); a seat someone is
  // already sitting on is skipped, and only mentioned when there is no free one nearby
  let bench = null, taken = false;
  if (!nb && !myEmote.seated && place !== 'booths') {
    let bd = 1.0;
    for (const b of OUTDOORS.has(place) ? outside.benches : hall.seats) {
      const d = Math.min(Math.hypot(b.front.x - player.position.x, b.front.z - player.position.z),
        Math.hypot(b.seat.x - player.position.x, b.seat.z - player.position.z));
      if (d >= bd) continue;
      if (others.sitterAt(b.seat.x, b.seat.z) !== null) { if (d < 0.8) taken = true; continue; }
      bd = d; bench = b;
    }
  }
  nearBench = bench;
  // two people sat on the same seat at the same moment: the smaller pid keeps it (both browsers
  // see both sits and apply the same rule), the other stands up in front of it
  if (myEmote.seated && mySeat) {
    const other = others.sitterAt(mySeat.seat.x, mySeat.seat.z, 0.3);
    if (other !== null && others.myPid !== null && other < others.myPid) {
      myEmote.stop();
      player.position.set(mySeat.front.x, 0, mySeat.front.z);
      moveSender.now(player.position, player.rotation.y);   // moving is standing up for the server too
      mySeat = null;
      toast('같은 자리에 먼저 앉은 분이 있어 일어났습니다');
    }
  }
  nearDo = nb || myEmote.seated ? null : nearAction();
  const prompt = $('#prompt'), act = $('#actBtn');
  if (state === 'hall' && myEmote.seated) {
    prompt.hidden = false;
    prompt.textContent = '앉아 있습니다. 앉은 채로 동작을 할 수 있고, 움직이면 일어납니다';
    act.hidden = true;
  } else if (state === 'hall' && nearDo) {
    prompt.hidden = false;
    prompt.innerHTML = '<kbd>E</kbd>';
    prompt.append(nearDo.label);
    act.textContent = nearDo.label;
    act.hidden = false;
  } else if (state === 'hall' && taken && !nb) {
    prompt.hidden = false;
    prompt.textContent = '이미 누가 앉아 있는 자리입니다';
    act.hidden = true;
  } else if (state === 'hall' && nb) {
    prompt.hidden = false;
    if (nb.occupied) {
      prompt.textContent = `${nb.id + 1}번 고해소: 고해성사가 진행중입니다`;
      act.hidden = true;
    } else {
      prompt.innerHTML = `<kbd>E</kbd>${nb.id + 1}번 고해소 문 열기`;
      act.textContent = '문 열기';
      act.hidden = false;
    }
  } else {
    prompt.hidden = true;
    act.hidden = true;
  }
}

function showPlace() {
  $('#placeName').textContent = {
    yard: '성당 앞마당', around: '성당 둘레길', trail: '산책로', event: '이벤트 광장',
    nave: '성당 안', booths: `고해소 ${channelNo}채널`,
  }[place] || '성당 앞마당';
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  booths.forEach((b) => { b.hinge.rotation.y += (b.doorTarget - b.hinge.rotation.y) * Math.min(1, dt * 8); });

  if (state === 'room' || state === 'leaving') {
    others.updateTags(camera, player.position, innerWidth, innerHeight, false);
    confessional.update(dt, t);
    renderer.render(confessional.scene, confessional.camera);
    return;
  }
  others.update(dt);
  outside.update(dt, t);
  hall.update(dt, t);
  pigeons.update(dt, t, [player.position, ...others.positions()]);
  if (state === 'hall' || state === 'intro') {
    const moving = updatePlayer(dt);
    if (state === 'hall') moveSender.update(player.position, player.rotation.y, moving);
    updateEmoteBar();
    updateSurroundings(dt);
    walkMarker.update(dt, path, player.position, state === 'hall');
    const people = others.count() + 1;
    if (people !== shownPeople) { shownPeople = people; $('#people').textContent = people; }
    others.updateTags(camera, player.position, innerWidth, innerHeight, state === 'hall');
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
