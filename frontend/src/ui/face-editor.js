import { $ } from './hud.js';
import {
  FACE_SIZE, PALETTE, PALETTE_NAMES, EMPTY_FACE, STARTER_FACE, PICKED_CHARS, MAX_PICKED, DEFAULT_PICKED,
  paintFace, normalizeFace, storedFace, splitFace, joinFace,
} from '../net/faces.js';
import { smoothFace } from '../world/pixel-face.js';

/**
 * "얼굴 그리기": a 32x32 dot grid over a blank skin-coloured head. Click or drag to place dots,
 * pick one of five colours (eraser, black, red, white, pink) or up to eight colours of your own
 * (any RGB; changing one recolours every dot drawn with it), and a 1x1 or 2x2 brush.
 * Only the face is drawable.
 *
 * Earlier drawings stay in this browser (storedFace.gallery) and can be loaded again.
 *
 * @param {{ getFace(): string|null, apply(face: string|null): Promise<{ok:boolean, reason?:string}> }} opts
 * @returns {{ open(): void, isOpen(): boolean }}
 */
export function createFaceEditor({ getFace, apply }) {
  const panel = $('#facePanel');
  const grid = $('#faceGrid');
  const ctx = grid.getContext('2d');
  const preview = $('#facePreview').getContext('2d');
  // the preview shows the face painted round, as it looks in the game
  const smallGrid = document.createElement('canvas'); smallGrid.width = smallGrid.height = FACE_SIZE;
  const smallRound = document.createElement('canvas'); smallRound.width = smallRound.height = 256;
  const errorEl = $('#faceError');
  const galleryEl = $('#faceGallery');
  const CELL = grid.width / FACE_SIZE;
  const SKIN = '#efc39b';

  let cells = EMPTY_FACE.split('');
  let picked = [DEFAULT_PICKED[0]];   // my colours, slot 1 first
  const code = () => joinFace(cells.join(''), picked);
  let colour = '1';                   // the grid character being painted: '0'..'4' or a picked slot
  let painting = false;
  let brush = 2;   // 2x2 by default: 1024 cells are a lot to fill one by one

  const brushes = $('#faceBrush');
  [[1, '가는 붓'], [2, '굵은 붓']].forEach(([size, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => { brush = size; markBrush(); };
    brushes.appendChild(b);
  });
  function markBrush() {
    [...brushes.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === brush)));
  }

  // colour buttons: the five fixed ones, then my own colours
  const swatches = $('#faceSwatches');
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (i === 0 ? ' eraser' : '');
    b.style.setProperty('--c', c || 'transparent');
    b.title = PALETTE_NAMES[i];
    b.setAttribute('aria-label', PALETTE_NAMES[i]);
    b.dataset.ch = String(i);
    b.onclick = () => { colour = String(i); markSwatch(); };
    swatches.appendChild(b);
  });
  const ownRow = document.createElement('div');
  ownRow.className = 'ownRow';
  ownRow.setAttribute('role', 'group');
  ownRow.setAttribute('aria-label', '내 색');
  swatches.appendChild(ownRow);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'swatch addOwn';
  add.textContent = '+';
  add.title = '내 색 추가';
  add.setAttribute('aria-label', '내 색 추가');
  const pickerLabel = document.createElement('label');
  pickerLabel.className = 'ownPick';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.setAttribute('aria-label', '고른 내 색 바꾸기');
  pickerLabel.append(picker, document.createTextNode('고른 색 바꾸기'));
  swatches.appendChild(pickerLabel);

  const selectedSlot = () => PICKED_CHARS.indexOf(colour);
  function renderOwn() {
    ownRow.textContent = '';
    picked.forEach((c, slot) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch own';
      b.style.setProperty('--c', c);
      b.title = `내 색 ${slot + 1}`;
      b.setAttribute('aria-label', `내 색 ${slot + 1}`);
      b.dataset.ch = PICKED_CHARS[slot];
      b.onclick = () => { colour = PICKED_CHARS[slot]; markSwatch(); };
      ownRow.appendChild(b);
    });
    add.hidden = picked.length >= MAX_PICKED;
    ownRow.appendChild(add);
  }
  add.onclick = () => {
    if (picked.length >= MAX_PICKED) return;
    picked.push(DEFAULT_PICKED[picked.length]);
    colour = PICKED_CHARS[picked.length - 1];
    renderOwn();
    markSwatch();
    try { picker.click(); } catch (_) { /* some browsers need a direct click on the input */ }
  };
  picker.addEventListener('input', () => {
    let slot = selectedSlot();
    if (slot < 0) {
      // a fixed colour is selected: picking a colour makes a new one of my own
      if (picked.length >= MAX_PICKED) return;
      picked.push(picker.value);
      slot = picked.length - 1;
      colour = PICKED_CHARS[slot];
    }
    picked[slot] = picker.value;
    renderOwn();
    markSwatch();
    render();
  });
  function markSwatch() {
    swatches.querySelectorAll('.swatch[data-ch]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ch === colour)));
    const slot = selectedSlot();
    picker.value = slot >= 0 ? picked[slot] : (picked[picked.length - 1] || DEFAULT_PICKED[0]);
  }

  function render() {
    const face = code();
    // the head: skin circle, so people see where the face sits
    ctx.fillStyle = '#1d1823';
    ctx.fillRect(0, 0, grid.width, grid.height);
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(grid.width / 2, grid.height / 2, grid.width / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    paintFace(ctx, face, CELL);
    ctx.lineWidth = 1;
    for (let i = 1; i < FACE_SIZE; i++) {
      // a stronger line every 4 cells helps keep both eyes level
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(0,0,0,.2)' : 'rgba(0,0,0,.07)';
      ctx.beginPath(); ctx.moveTo(i * CELL + 0.5, 0); ctx.lineTo(i * CELL + 0.5, grid.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL + 0.5); ctx.lineTo(grid.width, i * CELL + 0.5); ctx.stroke();
    }
    // small preview at the size it shows in the game
    const pv = preview.canvas;
    preview.fillStyle = '#1d1823'; preview.fillRect(0, 0, pv.width, pv.height);
    preview.fillStyle = SKIN; preview.beginPath(); preview.arc(pv.width / 2, pv.height / 2, pv.width / 2 - 1, 0, Math.PI * 2); preview.fill();
    smallGrid.getContext('2d').clearRect(0, 0, FACE_SIZE, FACE_SIZE);
    paintFace(smallGrid.getContext('2d'), face, 1);
    smoothFace(smallGrid, smallRound);
    preview.drawImage(smallRound, 0, 0, pv.width, pv.height);
  }

  function cellAt(e) {
    const r = grid.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * FACE_SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * FACE_SIZE);
    return x >= 0 && y >= 0 && x < FACE_SIZE && y < FACE_SIZE ? y * FACE_SIZE + x : -1;
  }
  // a fast drag skips cells between two pointer events, so fill the straight line in between
  let lastCell = -1;
  function paintAt(e) {
    const i = cellAt(e);
    if (i < 0) return;
    const from = lastCell < 0 ? i : lastCell;
    lastCell = i;
    let x0 = from % FACE_SIZE, y0 = Math.floor(from / FACE_SIZE);
    const x1 = i % FACE_SIZE, y1 = Math.floor(i / FACE_SIZE);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, changed = false;
    for (;;) {
      for (let by = 0; by < brush; by++) {
        for (let bx = 0; bx < brush; bx++) {
          const x = x0 + bx, y = y0 + by;
          if (x >= FACE_SIZE || y >= FACE_SIZE) continue;
          const k = y * FACE_SIZE + x;
          if (cells[k] !== String(colour)) { cells[k] = String(colour); changed = true; }
        }
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    if (!changed) return;
    errorEl.hidden = true;
    render();
  }
  grid.addEventListener('pointerdown', (e) => {
    painting = true;
    lastCell = -1;
    grid.setPointerCapture(e.pointerId);
    paintAt(e);
  });
  grid.addEventListener('pointermove', (e) => { if (painting) paintAt(e); });
  const stop = () => { painting = false; lastCell = -1; };
  grid.addEventListener('pointerup', stop);
  grid.addEventListener('pointercancel', stop);

  function load(face) {
    const f = normalizeFace(face) || EMPTY_FACE;
    const parts = splitFace(f);
    cells = parts.grid.split('');
    picked = parts.picked.length ? parts.picked.slice() : [DEFAULT_PICKED[0]];
    if (selectedSlot() >= picked.length) colour = '1';
    renderOwn();
    markSwatch();
    errorEl.hidden = true;
    render();
  }

  function renderGallery() {
    galleryEl.textContent = '';
    const list = storedFace.gallery();
    $('#faceGalleryWrap').hidden = !list.length;
    for (const { face, t } of list) {
      const item = document.createElement('div');
      item.className = 'faceThumb';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.title = `${new Date(t).toLocaleDateString('ko-KR')}에 그린 얼굴 불러오기`;
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d');
      c.fillStyle = SKIN; c.beginPath(); c.arc(32, 32, 31, 0, Math.PI * 2); c.fill();
      paintFace(c, face, 2);
      pick.appendChild(cv);
      pick.onclick = () => load(face);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '×';
      del.setAttribute('aria-label', '이 그림 지우기');
      del.onclick = () => { storedFace.forget(face); renderGallery(); };
      item.append(pick, del);
      galleryEl.appendChild(item);
    }
  }

  const REASON = {
    INVALID: '그림을 읽을 수 없습니다. 다시 그려 주세요.',
    BLOCKED: '신고가 쌓여 내려간 그림이거나, 잠시 얼굴을 바꿀 수 없는 상태입니다.',
    TOO_SOON: '얼굴은 5초에 한 번만 바꿀 수 있습니다. 잠시 후 다시 눌러 주세요.',
    TIMEOUT: '서버가 답하지 않아 바꾸지 못했습니다. 다시 시도해 주세요.',
    OFFLINE: '서버와 연결되지 않아 바꾸지 못했습니다.',
  };

  $('#faceClear').onclick = () => load(EMPTY_FACE);
  $('#faceStarter').onclick = () => load(STARTER_FACE);
  $('#faceCancel').onclick = () => { panel.hidden = true; };
  $('#faceSave').onclick = async () => {
    const face = normalizeFace(code());
    $('#faceSave').disabled = true;
    const r = await apply(face);
    $('#faceSave').disabled = false;
    if (!r.ok) {
      errorEl.textContent = REASON[r.reason] || REASON.INVALID;
      errorEl.hidden = false;
      return;
    }
    storedFace.remember(face);   // empty drawings are not kept
    panel.hidden = true;
  };
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });

  renderOwn();
  markSwatch();
  markBrush();
  return {
    open() {
      load(getFace() || EMPTY_FACE);
      renderGallery();
      panel.hidden = false;
    },
    isOpen: () => !panel.hidden,
  };
}

