import * as THREE from 'three';

/**
 * Surfaces of the cathedral, painted on canvases (the project keeps no image files): polished
 * marble floors, cut stone walls, a ribbed vault, wood grain, and the light falling through the
 * coloured windows. Each texture is drawn once and shared by every surface that uses it; how
 * often it repeats is set on the geometry (tileUV), so the GPU holds each picture only once.
 */
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

/** Fine grain over everything, so no surface is a flat colour. */
function grain(g, w, h, amount, alpha) {
  for (let i = 0; i < amount; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
}

/** A marble vein: a wandering line, thick and faint, then thin and sharper on top. */
function vein(g, x, y, len, ang, col) {
  const pts = [[x, y]];
  for (let i = 0; i < 24; i++) {
    ang += (rnd() - 0.5) * 0.7;
    x += Math.cos(ang) * len / 24; y += Math.sin(ang) * len / 24;
    pts.push([x, y]);
  }
  for (const [lw, a] of [[5, 0.06], [2, 0.16], [0.8, 0.35]]) {
    g.strokeStyle = col.replace('A', a); g.lineWidth = lw;
    g.beginPath(); g.moveTo(...pts[0]); pts.forEach((p) => g.lineTo(...p)); g.stroke();
  }
}

/**
 * Marble slabs, 2 x 2 to a tile: `colors` alternate like a chessboard (two colours for the
 * confession hall, near ones for the nave), with veins and dark joints.
 */
function marbleCanvas(colors, veinCol, joint) {
  return canvas(512, 512, (g, w) => {
    const s = w / 2;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const base = colors[(i + j) % colors.length];
      const gr = g.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s);
      gr.addColorStop(0, base[0]); gr.addColorStop(1, base[1]);
      g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
      g.save(); g.beginPath(); g.rect(i * s, j * s, s, s); g.clip();
      // soft clouds in the stone
      for (let k = 0; k < 6; k++) {
        const cx = i * s + rnd() * s, cy = j * s + rnd() * s, r = s * (0.2 + rnd() * 0.4);
        const cl = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        cl.addColorStop(0, rnd() < 0.5 ? 'rgba(255,255,255,.12)' : 'rgba(90,70,60,.08)');
        cl.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = cl; g.fillRect(i * s, j * s, s, s);
      }
      for (let k = 0; k < 4; k++) vein(g, i * s + rnd() * s, j * s + rnd() * s, s * (0.6 + rnd()), rnd() * 6.28, veinCol);
      g.restore();
    }
    grain(g, w, w, 5000, 0.05);
    g.strokeStyle = joint; g.lineWidth = 2;
    for (const p of [1, s, w - 1]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    // a little shine along the top and left of each slab
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5;
    for (const p of [3, s + 2]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, w); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
  });
}

/** Cut stone: courses of blocks, each a little different, with mortar and chipped edges. */
function stoneCanvas(tint) {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#6e604f'; g.fillRect(0, 0, w, h);   // mortar
    const rows = 6, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const cols = r % 2 ? 3 : 4, off = r % 2 ? w / 8 : 0;
      for (let c = -1; c < cols + 1; c++) {
        const bw = w / cols, x = off + c * bw, y = r * rh;
        const l = 0.86 + rnd() * 0.22;
        const col = tint.map((v) => Math.min(255, Math.round(v * l)));
        const gr = g.createLinearGradient(x, y, x, y + rh);
        gr.addColorStop(0, `rgb(${col.map((v) => Math.min(255, v + 14)).join(',')})`);
        gr.addColorStop(1, `rgb(${col.map((v) => v - 12).join(',')})`);
        g.fillStyle = gr;
        g.fillRect(x + 2, y + 2, bw - 4, rh - 4);
        // weathering
        for (let k = 0; k < 3; k++) {
          const cx = x + rnd() * bw, cy = y + rnd() * rh, rr = 10 + rnd() * 30;
          const cl = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
          cl.addColorStop(0, rnd() < 0.6 ? 'rgba(60,45,30,.10)' : 'rgba(255,250,235,.10)');
          cl.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = cl; g.fillRect(x, y, bw, rh);
        }
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 2, y + 2, bw - 4, 2);
        g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x + 2, y + rh - 4, bw - 4, 2);
      }
    }
    grain(g, w, h, 9000, 0.07);
  });
}

/** The vault over a bay: pale stone between gilded ribs, a sunburst boss in the middle. */
function vaultCanvas() {
  return canvas(512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const bg = g.createRadialGradient(cx, cy, 10, cx, cy, w * 0.75);
    bg.addColorStop(0, '#f3e6c8'); bg.addColorStop(0.45, '#cdbb98'); bg.addColorStop(1, '#6f5f50');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // ribs from the corners and edges to the boss
    g.lineCap = 'round';
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [cx, 0], [cx, h], [0, cy], [w, cy]]) {
      for (const [lw, c] of [[16, 'rgba(70,52,36,.35)'], [9, '#b89a62'], [3, '#f2d98f']]) {
        g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); g.lineTo(cx, cy); g.stroke();
      }
    }
    // sunburst boss
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, r0 = 26, r1 = k % 2 ? 70 : 96;
      g.fillStyle = k % 2 ? '#e7c46a' : '#f6dc8e';
      g.beginPath(); g.moveTo(cx + Math.cos(a - 0.1) * r0, cy + Math.sin(a - 0.1) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a + 0.1) * r0, cy + Math.sin(a + 0.1) * r0); g.fill();
    }
    const boss = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 30);
    boss.addColorStop(0, '#fff6d0'); boss.addColorStop(1, '#b8862b');
    g.fillStyle = boss; g.beginPath(); g.arc(cx, cy, 28, 0, Math.PI * 2); g.fill();
    // little stars painted in the webs
    g.fillStyle = 'rgba(255,240,190,.75)';
    for (let k = 0; k < 40; k++) { const x = rnd() * w, y = rnd() * h; g.beginPath(); g.arc(x, y, 1 + rnd() * 1.6, 0, Math.PI * 2); g.fill(); }
    grain(g, w, h, 4000, 0.05);
  });
}

/** Wood with long grain, for the pews. */
function woodCanvas() {
  return canvas(512, 128, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#8a5530'); bg.addColorStop(0.5, '#74431f'); bg.addColorStop(1, '#8a5530');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      let y = rnd() * h;
      g.strokeStyle = rnd() < 0.5 ? 'rgba(40,20,8,.25)' : 'rgba(255,210,150,.10)';
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) { y += (rnd() - 0.5) * 2.2; g.lineTo(x, y); }
      g.stroke();
    }
    for (let k = 0; k < 3; k++) {   // knots
      const x = rnd() * w, y = rnd() * h;
      g.strokeStyle = 'rgba(40,20,8,.35)';
      for (let r = 2; r < 12; r += 3) { g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, r * 2.4, r, 0, 0, Math.PI * 2); g.stroke(); }
    }
    grain(g, w, h, 2000, 0.06);
  });
}

/** The red carpet: deep red with a gold border and a small repeating figure. */
function carpetCanvas() {
  return canvas(128, 256, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, 0);
    bg.addColorStop(0, '#5e1414'); bg.addColorStop(0.5, '#8e2420'); bg.addColorStop(1, '#5e1414');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c99a45'; g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
    g.fillStyle = '#3e0d0d'; g.fillRect(14, 0, 3, h); g.fillRect(w - 17, 0, 3, h);
    g.strokeStyle = 'rgba(214,170,90,.55)'; g.lineWidth = 2;
    for (const y of [64, 192]) {
      g.beginPath(); g.moveTo(w / 2, y - 30); g.lineTo(w / 2 + 26, y); g.lineTo(w / 2, y + 30); g.lineTo(w / 2 - 26, y); g.closePath(); g.stroke();
      g.beginPath(); g.arc(w / 2, y, 7, 0, Math.PI * 2); g.stroke();
    }
    grain(g, w, h, 3000, 0.08);
  });
}

/** Light falling from a window: bright at the glass, fading to nothing on the floor, with streaks. */
function shaftCanvas() {
  return canvas(64, 256, (g, w, h) => {
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,.95)'); v.addColorStop(0.5, 'rgba(255,255,255,.35)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    // soft side edges
    g.globalCompositeOperation = 'destination-in';
    const s = g.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, 'rgba(0,0,0,0)'); s.addColorStop(0.25, 'rgba(0,0,0,1)'); s.addColorStop(0.75, 'rgba(0,0,0,1)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + rnd() * 0.3})`; g.fillRect(rnd() * w, 0, 2 + rnd() * 5, h); }
  });
}

/** A round pool of soft light, white, to be tinted by the material colour. */
function poolCanvas() {
  return canvas(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
}

const cache = {};
function tex(name, make) {
  if (!cache[name]) {
    const t = new THREE.CanvasTexture(make());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    cache[name] = t;
  }
  return cache[name];
}
/** Repeats a texture rx by ry times over a geometry (multiplies its uv). */
export function tileUV(geo, rx, ry) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rx, uv.getY(i) * ry);
  return geo;
}

export const surfaces = {
  /** Cream and rose marble for the nave, one tile = 4 m. */
  naveMarble: () => tex('naveMarble', () => marbleCanvas([['#e6dccb', '#cfc2ab'], ['#d8b9a6', '#c39f8a']], 'rgba(110,90,80,A)', '#6d5a48')),
  /** Black and white marble for the confession hall. */
  checkMarble: () => tex('checkMarble', () => marbleCanvas([['#efe7da', '#d9cfbe'], ['#3a2f2c', '#241c1a']], 'rgba(150,140,130,A)', '#1d1512')),
  /** Pale cut stone for the walls (one tile = 4 m). */
  stone: () => tex('stone', () => stoneCanvas([214, 196, 164])),
  /** Darker stone for the confession hall. */
  darkStone: () => tex('darkStone', () => stoneCanvas([150, 128, 110])),
  vault: () => tex('vault', vaultCanvas),
  wood: () => tex('wood', woodCanvas),
  carpet: () => tex('carpet', carpetCanvas),
  shaft: () => tex('shaft', shaftCanvas),
  pool: () => tex('pool', poolCanvas),
};

/**
 * Darker toward the top, warmer near the floor: vertex colours on a wall, so tall walls fade
 * into the vault instead of ending in a flat line. Use with a material that has vertexColors.
 */
export function heightShade(geo, h, bottom = 1.0, top = 0.55) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(1, Math.max(0, pos.getY(i) / h + 0.5));
    const v = bottom + (top - bottom) * k;
    col[i * 3] = v * 1.02; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.97;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Leaded glass: pieces of coloured glass in a medallion pattern, lit from behind. */
export function makeLeadedGlass() {
  const c = canvas(256, 512, (g, w, h) => {
    const cols = ['#c0392b', '#2e6fd8', '#e7b52f', '#27ae60', '#8e44ad', '#2fb3c7', '#e67e22', '#d24d8a'];
    const pick = () => cols[Math.floor(rnd() * cols.length)];
    const piece = (path, col) => {
      g.save(); path(); g.clip();
      const b = g.createRadialGradient(w * 0.5, h * 0.35, 10, w * 0.5, h * 0.5, h * 0.7);
      b.addColorStop(0, '#ffffff'); b.addColorStop(0.08, col); b.addColorStop(1, shade(col, 0.45));
      g.fillStyle = b; g.fillRect(0, 0, w, h);
      // streaks in the glass
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.08})`; g.fillRect(rnd() * w, 0, 1 + rnd() * 3, h); }
      g.restore();
    };
    // background: small quarries
    const qw = 32, qh = 40;
    for (let y = 0; y < h; y += qh) for (let x = (y / qh) % 2 ? -qw / 2 : 0; x < w; x += qw) {
      const col = rnd() < 0.7 ? (rnd() < 0.5 ? '#2a4fa8' : '#3a2f8c') : pick();
      piece(() => { g.beginPath(); g.rect(x, y, qw, qh); }, col);
    }
    // three medallions down the window
    for (const [my, r] of [[h * 0.2, 70], [h * 0.5, 84], [h * 0.8, 70]]) {
      const cx = w / 2;
      piece(() => { g.beginPath(); g.arc(cx, my, r, 0, Math.PI * 2); }, '#e7b52f');
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2, col = k % 2 ? '#c0392b' : '#27ae60';
        piece(() => { g.beginPath(); g.moveTo(cx, my); g.arc(cx, my, r * 0.82, a0, a1); g.closePath(); }, col);
      }
      piece(() => { g.beginPath(); g.arc(cx, my, r * 0.36, 0, Math.PI * 2); }, '#f6e7b0');
      g.strokeStyle = '#17110c'; g.lineWidth = 4;
      g.beginPath(); g.arc(cx, my, r, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, my, r * 0.82, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx, my, r * 0.36, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.36, my + Math.sin(a) * r * 0.36); g.lineTo(cx + Math.cos(a) * r * 0.82, my + Math.sin(a) * r * 0.82); g.stroke(); }
    }
    // leading of the quarries
    g.strokeStyle = 'rgba(23,17,12,.9)'; g.lineWidth = 3;
    for (let y = 0; y <= h; y += qh) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let y = 0; y < h; y += qh) for (let x = (y / qh) % 2 ? -qw / 2 : 0; x <= w; x += qw) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + qh); g.stroke(); }
    // border
    g.strokeStyle = '#17110c'; g.lineWidth = 10; g.strokeRect(0, 0, w, h);
    g.strokeStyle = '#d4ad55'; g.lineWidth = 3; g.strokeRect(7, 7, w - 14, h - 14);
  });
  return new THREE.CanvasTexture(c);
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}
