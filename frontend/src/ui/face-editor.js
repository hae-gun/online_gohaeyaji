import { $ } from './hud.js';
import {
  FACE_SIZE, PALETTE, PALETTE_NAMES, EMPTY_FACE, STARTER_FACE,
  paintFace, normalizeFace, storedFace,
} from '../net/faces.js';

/**
 * "얼굴 그리기": a 32x32 dot grid over a blank skin-coloured head. Click or drag to place dots,
 * pick one of five colours (eraser, black, red, white, pink) and a 1x1 or 2x2 brush.
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
  const errorEl = $('#faceError');
  const galleryEl = $('#faceGallery');
  const CELL = grid.width / FACE_SIZE;
  const SKIN = '#efc39b';

  let cells = EMPTY_FACE.split('');
  let colour = 1;
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

  // colour buttons
  const swatches = $('#faceSwatches');
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (i === 0 ? ' eraser' : '');
    b.style.setProperty('--c', c || 'transparent');
    b.title = PALETTE_NAMES[i];
    b.setAttribute('aria-label', PALETTE_NAMES[i]);
    b.onclick = () => { colour = i; markSwatch(); };
    swatches.appendChild(b);
  });
  function markSwatch() {
    [...swatches.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === colour)));
  }

  function render() {
    const code = cells.join('');
    // the head: skin circle, so people see where the face sits
    ctx.fillStyle = '#1d1823';
    ctx.fillRect(0, 0, grid.width, grid.height);
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(grid.width / 2, grid.height / 2, grid.width / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    paintFace(ctx, code, CELL);
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
    paintFace(preview, code, pv.width / FACE_SIZE);
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
    cells = (normalizeFace(face) || EMPTY_FACE).split('');
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
    const face = normalizeFace(cells.join(''));
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

