import { $, toast } from './hud.js';
import { paintFace, FACE_SIZE } from '../net/faces.js';

/**
 * "보속 카드": after a confession, one picture to keep or post (Instagram story size, 1080x1920).
 * The priest as he looks right now, the sin (a dictionary keyword, never what the person typed),
 * the penance, my saint name and face, and the site address.
 *
 * Drawn in the browser on a canvas: no server, no upload. The confession text itself is never
 * on the card, so sharing it gives nothing private away.
 */
const W = 1080, H = 1920;
const DISPLAY = "'Jua', 'Gowun Dodum', sans-serif";
const BODY = "'Gowun Dodum', sans-serif";
const INK = '#2a1d16', PAPER = '#f6efe2', GOLD = '#d4ad55', CREAM = '#f3ece0';

/** "새벽 4시 35분" style; the hour word is half the joke (a 4 a.m. confession about shorts). */
export function whenText(d) {
  const h = d.getHours(), m = d.getMinutes();
  const part = h < 5 ? '새벽' : h < 9 ? '아침' : h < 12 ? '오전' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${part} ${h12}시 ${m}분`;
}

/** Breaks Korean text into lines that fit `max` px: at spaces first, inside a word only when it must. */
export function wrapLines(ctx, text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= max) { line = tryLine; continue; }
    if (line) lines.push(line);
    line = '';
    // a single word wider than the box: cut it by characters
    let part = '';
    for (const ch of word) {
      if (ctx.measureText(part + ch).width > max && part) { lines.push(part); part = ''; }
      part += ch;
    }
    line = part;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** An arched window (round top), the shape of the stained glass in the church. */
function archPath(ctx, x, y, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

/**
 * Draws `img` to cover the box (like CSS object-fit: cover), centred on (fx, fy) of the source,
 * `zoom` times closer than a plain cover.
 */
function cover(ctx, img, x, y, w, h, fx = 0.5, fy = 0.5, zoom = 1) {
  const iw = img.width, ih = img.height;
  const s = Math.max(w / iw, h / ih) * zoom;
  const sw = w / s, sh = h / s;
  const sx = Math.min(iw - sw, Math.max(0, iw * fx - sw / 2));
  const sy = Math.min(ih - sh, Math.max(0, ih * fy - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** Text that shrinks until it fits `max` px wide, from `size` down to `min`. */
function fitFont(ctx, text, family, weight, size, min, max) {
  let s = size;
  for (; s > min; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= max) break;
  }
  return s;
}

/**
 * @param {{
 *   priestImage?: CanvasImageSource & {width:number,height:number}, priestName: string, legend?: boolean,
 *   sin: string, nth: number, penance: string, name: string, face?: string|null,
 *   when: Date, site: string }} d
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function drawPenanceCard(d) {
  // the web fonts load per character range; ask for exactly the characters on this card
  const chars = `고해야지보속카드죄목번째첫${d.sin}${d.penance}${d.name}${d.priestName}${d.site}0123456789년월일시분새벽아침오전오후저녁밤나도하러가기실제성사가아닌패러디입니다전설의오늘이로`;
  try {
    await Promise.all([document.fonts.load(`80px Jua`, chars), document.fonts.load(`40px 'Gowun Dodum'`, chars)]);
  } catch (_) { /* system font then */ }

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const gold = d.legend ? '#f3d27a' : GOLD;

  // night sky behind a church window
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, d.legend ? '#3b2a12' : '#1d1630');
  bg.addColorStop(0.55, d.legend ? '#4a3418' : '#2c1d3d');
  bg.addColorStop(1, d.legend ? '#24190b' : '#15121a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // little stars
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,240,210,${0.15 + rnd() * 0.45})`;
    g.beginPath(); g.arc(rnd() * W, rnd() * H * 0.5, 1 + rnd() * 2.2, 0, Math.PI * 2); g.fill();
  }
  // frame
  g.strokeStyle = gold; g.lineWidth = 6;
  roundRect(g, 36, 36, W - 72, H - 72, 44); g.stroke();
  g.globalAlpha = 0.45; g.lineWidth = 2;
  roundRect(g, 54, 54, W - 108, H - 108, 34); g.stroke();
  g.globalAlpha = 1;

  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // title
  g.fillStyle = gold;
  g.font = `400 96px ${DISPLAY}`;
  g.fillText('고해야지', W / 2, 168);
  g.fillStyle = 'rgba(243,236,224,.75)';
  g.font = `400 34px ${BODY}`;
  g.fillText(whenText(d.when), W / 2, 222);

  // the priest in an arched window
  const ax = 200, ay = 262, aw = 680, ah = 520;
  g.save();
  archPath(g, ax, ay, aw, ah); g.clip();
  if (d.priestImage) {
    // the booth camera shows the whole window; come closer to the priest
    // (a wide screen shows the whole booth window around him; a phone's tall screen is already close)
    const wide = d.priestImage.width > d.priestImage.height;
    cover(g, d.priestImage, ax, ay, aw, ah, 0.5, wide ? 0.44 : 0.47, wide ? 1.7 : 1.05);
  } else {
    g.fillStyle = '#3a2a4a'; g.fillRect(ax, ay, aw, ah);
  }
  // soft light from the top of the window
  const glow = g.createLinearGradient(0, ay, 0, ay + ah);
  glow.addColorStop(0, 'rgba(255,230,170,.18)'); glow.addColorStop(0.5, 'rgba(255,230,170,0)');
  g.fillStyle = glow; g.fillRect(ax, ay, aw, ah);
  g.restore();
  g.strokeStyle = gold; g.lineWidth = 10;
  archPath(g, ax, ay, aw, ah); g.stroke();
  // name plate across the bottom of the window
  g.font = `400 46px ${DISPLAY}`;
  const plateW = Math.max(300, g.measureText(d.priestName).width + 90);
  g.fillStyle = gold;
  roundRect(g, W / 2 - plateW / 2, ay + ah - 40, plateW, 82, 41); g.fill();
  g.fillStyle = INK;
  g.fillText(d.priestName, W / 2, ay + ah + 17);

  // me: face and saint name, one line under the window
  const meY = ay + ah + 110;
  g.font = `400 46px ${DISPLAY}`;
  const nameW = Math.min(420, g.measureText(d.name).width);
  g.font = `400 32px ${BODY}`;
  const labelW = g.measureText('고해자').width;
  const fr = 40, rowW = fr * 2 + 24 + labelW + 16 + nameW;
  const fx = W / 2 - rowW / 2 + fr;
  g.fillStyle = '#efc39b';
  g.beginPath(); g.arc(fx, meY, fr, 0, Math.PI * 2); g.fill();
  if (d.face) {
    g.save();
    g.beginPath(); g.arc(fx, meY, fr, 0, Math.PI * 2); g.clip();
    paintFace(g, d.face, (fr * 2) / FACE_SIZE, fx - fr, meY - fr);
    g.restore();
  } else {
    // the default smile
    g.fillStyle = INK;
    g.beginPath(); g.arc(fx - 14, meY - 6, 5, 0, Math.PI * 2); g.arc(fx + 14, meY - 6, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4;
    g.beginPath(); g.arc(fx, meY + 4, 13, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }
  g.strokeStyle = gold; g.lineWidth = 3;
  g.beginPath(); g.arc(fx, meY, fr, 0, Math.PI * 2); g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'middle';
  let tx = fx + fr + 24;
  g.fillStyle = 'rgba(243,236,224,.7)';
  g.font = `400 32px ${BODY}`;
  g.fillText('고해자', tx, meY + 2);
  tx += labelW + 16;
  g.fillStyle = CREAM;
  fitFont(g, d.name, DISPLAY, 400, 46, 28, 420);
  g.fillText(d.name, tx, meY + 2);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';

  // the sin
  const sinY = meY + 90;
  g.fillStyle = 'rgba(243,236,224,.7)';
  g.font = `400 36px ${BODY}`;
  g.fillText('죄목', W / 2, sinY);
  g.fillStyle = CREAM;
  fitFont(g, d.sin, DISPLAY, 400, 116, 60, W - 260);
  g.fillText(d.sin, W / 2, sinY + 112);
  g.fillStyle = gold;
  g.font = `400 36px ${BODY}`;
  g.fillText(d.nth > 1 ? `이 죄로 ${d.nth}번째 고해` : '이 죄로 첫 고해', W / 2, sinY + 168);

  // the penance on paper, centred in the space left above the footer
  const px = 120, pw = W - 240, top = sinY + 210, bottom = H - 250;
  g.font = `400 58px ${DISPLAY}`;
  let size = 58, lines = wrapLines(g, d.penance, pw - 110);
  while (lines.length > 4 && size > 40) {
    size -= 4;
    g.font = `400 ${size}px ${DISPLAY}`;
    lines = wrapLines(g, d.penance, pw - 110);
  }
  lines = lines.slice(0, 5);
  const lh = size * 1.38;
  const ph = 112 + lines.length * lh + 34;
  const py = top + Math.max(0, (bottom - top - ph) / 2);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.fillStyle = PAPER;
  roundRect(g, px, py, pw, ph, 32); g.fill();
  g.restore();
  g.fillStyle = d.legend ? '#a8781c' : '#8a5cc0';
  g.font = `400 34px ${BODY}`;
  g.fillText(d.legend ? '전설의 보속' : '오늘의 보속', W / 2, py + 66);
  g.fillStyle = INK;
  g.font = `400 ${size}px ${DISPLAY}`;
  lines.forEach((l, i) => g.fillText(l, W / 2, py + 112 + lh * (i + 0.72)));

  // footer
  g.textAlign = 'center';
  g.fillStyle = gold;
  g.font = `400 44px ${DISPLAY}`;
  g.fillText('나도 고해하러 가기', W / 2, H - 178);
  g.fillStyle = CREAM;
  fitFont(g, d.site, BODY, 400, 38, 24, W - 220);
  g.fillText(d.site, W / 2, H - 126);
  g.fillStyle = 'rgba(243,236,224,.45)';
  g.font = `400 26px ${BODY}`;
  g.fillText('실제 고해성사가 아닌 패러디입니다', W / 2, H - 86);
  return c;
}

/**
 * The preview panel: shows the card, then share (phones: straight to Instagram and the like),
 * save, or close.
 * @param {{ onOpen?: () => void, onClose?: () => void }} hooks
 */
export function createCardPanel({ onOpen, onClose } = {}) {
  const panel = $('#cardPanel');
  const img = $('#cardImg');
  let blob = null, url = '';
  const fileName = () => `gohaeyaji-${new Date().toISOString().slice(0, 10)}.png`;

  const close = () => {
    panel.hidden = true;
    if (url) URL.revokeObjectURL(url);
    url = ''; blob = null;
    onClose && onClose();
  };
  $('#cardClose').onclick = close;
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });

  $('#cardSave').onclick = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
  };
  $('#cardShare').onclick = async () => {
    if (!blob) return;
    const file = new File([blob], fileName(), { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: '고해야지', text: '오늘의 보속을 받았습니다. 나도 고해하러 가기' });
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // closed the share sheet
      toast('공유하지 못했습니다. 이미지 저장으로 받아 주세요');
    }
  };

  return {
    /** @param {HTMLCanvasElement} canvas */
    async show(canvas) {
      blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) { toast('카드를 만들지 못했습니다'); return; }
      url = URL.createObjectURL(blob);
      img.src = url;
      // sharing a file works on phones (and some desktop browsers); elsewhere only saving
      const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], 'card.png', { type: 'image/png' })] }));
      $('#cardShare').hidden = !canShareFile;
      panel.hidden = false;
      onOpen && onOpen();
      $('#cardSave').focus({ preventScroll: true });
    },
    isOpen: () => !panel.hidden,
  };
}
