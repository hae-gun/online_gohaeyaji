import * as THREE from 'three';
import './card.css';
import { makeFigure } from '../world/figure.js';
import { loadAnswerData, createAnswerEngine } from '../answer/engine.js';
import { checkName, normalizeName } from '../net/names.js';
import { paintFace, FACE_SIZE } from '../net/faces.js';
import { drawPenanceCard, whenText } from '../ui/penance-card.js';
import { decodeCard } from './link.js';
import { glassBorderImage } from './glass.js';
import { gradeOf } from '../ui/verdict.js';

/**
 * card.html: a 보속 카드 someone shared, as a web page. Everything on it is rebuilt from the
 * link (card/link.js) and the site's own answer data, the priest is drawn live in 3D, and the
 * picture version can be saved from here too.
 */
const $ = (s) => document.querySelector(s);
const ANON = '익명의 고해자';
const squash = (s) => s.toLowerCase().replace(/[\s.,_\-*~!?^@#'"()\[\]…]+/g, '');

async function main() {
  const d = decodeCard(new URLSearchParams(location.search).get('d') || '');
  let data = null, engine = null;
  try {
    data = await loadAnswerData();
    engine = createAnswerEngine(data);
  } catch (_) { /* shown as missing below */ }
  const got = d && engine ? engine.penanceOf(d.ref) : null;
  if (!got) { $('#pcMissing').hidden = false; return; }

  const legend = !!got.persona.chance;
  document.body.classList.toggle('legend', legend);
  // the name comes from the link: the same rules as in the game, and the blocked words
  const blocked = ((data.blocked && data.blocked.words) || []).map(squash).filter(Boolean);
  const raw = normalizeName(d.name);
  const name = raw && checkName(raw) === 'OK' && !blocked.some((w) => squash(raw).includes(w)) ? raw : ANON;

  const card = $('#pcard');
  card.style.borderImage = `url(${glassBorderImage(24, { legend })}) 24 round`;
  $('#pcWhen').textContent = whenText(d.when);
  $('#pcPriestName').textContent = got.persona.name || '신부님';
  $('#pcName').textContent = name;
  $('#pcSin').textContent = got.keyword || got.category.word || '';
  $('#pcNth').textContent = d.nth > 1 ? `이 죄로 ${d.nth}번째 고해` : '이 죄로 첫 고해';
  { const g = gradeOf(d.nth, legend); const st = $('#pcStamp'); st.textContent = g.label; st.className = `pcStamp ${g.cls}`; }
  $('#pcLabel').textContent = legend ? '전설의 보속' : '오늘의 보속';
  $('#pcPenance').textContent = got.penance;
  document.title = `${got.keyword ? `${got.keyword}의 죄, ` : ''}오늘의 보속 | 고해야지`;
  drawMyFace($('#pcFace'), d.face);
  card.hidden = false;

  const priest = livePriest($('#pcPriest'), got.persona.id);
  const save = $('#pcSave');
  save.hidden = false;
  save.onclick = async () => {
    save.disabled = true;
    try {
      const canvas = await drawPenanceCard({
        priestImage: priest.snapshot(), priestFramed: true, priestName: got.persona.name || '신부님', legend,
        sin: got.keyword || got.category.word || '', nth: d.nth, penance: got.penance,
        name, face: d.face, when: d.when, site: location.host,
      });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `gohaeyaji-${d.when.toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } finally {
      save.disabled = false;
    }
  };
}

/** My face on the card: the drawing from the link, or the default smile. */
function drawMyFace(cv, face) {
  const g = cv.getContext('2d');
  g.fillStyle = '#efc39b';
  g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
  if (face) { paintFace(g, face, 64 / FACE_SIZE); return; }
  g.fillStyle = '#2a1d16';
  g.beginPath(); g.arc(22, 28, 3.5, 0, Math.PI * 2); g.arc(42, 28, 3.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a1d16'; g.lineWidth = 3;
  g.beginPath(); g.arc(32, 36, 9, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
}

/** The priest in the window, breathing and blinking. snapshot() gives a picture for saving. */
function livePriest(canvas, look) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3a2a3a, 0.95));
  const key = new THREE.DirectionalLight(0xffe2b8, 0.7); key.position.set(1.5, 3, 4); scene.add(key);
  const camera = new THREE.PerspectiveCamera(34, 680 / 520, 0.1, 20);
  camera.position.set(0, 1.3, 3.3);
  camera.lookAt(0, 1.12, 0);
  const fig = makeFigure({ priest: true, look });
  scene.add(fig);
  const face = fig.userData.face;
  face.set({ eyes: 'happy', smile: 1 });
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  };
  addEventListener('resize', resize);
  resize();
  let blinkAt = 2;
  const clock = new THREE.Clock();
  const loop = () => {
    const t = clock.getElapsedTime();
    fig.rotation.y = Math.sin(t * 0.6) * 0.12;
    fig.position.y = Math.sin(t * 1.4) * 0.012;
    fig.userData.head.rotation.z = Math.sin(t * 0.8) * 0.05;
    if (t > blinkAt) { face.set({ eyes: 'closed', smile: 1 }); if (t > blinkAt + 0.14) { face.set({ eyes: 'happy', smile: 1 }); blinkAt = t + 2.5 + Math.random() * 3; } }
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();
  return {
    snapshot() {
      renderer.render(scene, camera);
      const c = document.createElement('canvas');
      c.width = renderer.domElement.width; c.height = renderer.domElement.height;
      const g = c.getContext('2d');
      // the window's pink glow behind him, as on the page
      const bg = g.createRadialGradient(c.width / 2, c.height * 0.3, 10, c.width / 2, c.height * 0.3, c.width * 0.8);
      bg.addColorStop(0, '#ffd3e4'); bg.addColorStop(0.55, '#e78fb5'); bg.addColorStop(1, '#7a3f63');
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(renderer.domElement, 0, 0);
      return c;
    },
  };
}

main();
