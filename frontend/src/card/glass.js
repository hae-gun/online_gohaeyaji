/**
 * Stained glass for the 보속 카드 frame, drawn on a canvas: small panes of coloured glass in dark
 * leading, a little light on each pane. Used by the image card (ui/penance-card.js) and, as a CSS
 * border-image, by the card page (card/page.js), so both look the same.
 */
const GLASS = ['#c0392b', '#2e6fd8', '#e7b52f', '#27ae60', '#8e44ad', '#2fb3c7', '#e67e22', '#b83a6e'];
const LEGEND = ['#e7b52f', '#f3d27a', '#c98a2b', '#e9c46a', '#d4ad55', '#b07a1f', '#f6e3a1', '#c9a050'];

/** Fills the band between two rectangles (outer x, y, w, h and `band` thick) with glass panes. */
export function drawGlassBand(g, x, y, w, h, band, { legend = false, seed = 7, pane = 26 } = {}) {
  const cols = legend ? LEGEND : GLASS;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.save();
  // the band as a clip: outer rect minus inner rect
  g.beginPath();
  g.rect(x, y, w, h);
  g.rect(x + band, y + h - band, w - band * 2, -(h - band * 2));
  g.clip('evenodd');
  for (let py = y; py < y + h; py += pane) {
    for (let px = x; px < x + w; px += pane) {
      const c = cols[Math.floor(rnd() * cols.length)];
      const gr = g.createLinearGradient(px, py, px + pane, py + pane);
      gr.addColorStop(0, c);
      gr.addColorStop(0.55, shade(c, 0.78));
      gr.addColorStop(1, shade(c, 0.55));
      g.fillStyle = gr;
      g.fillRect(px, py, pane, pane);
      // a highlight on the pane, as if lit from behind
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.arc(px + pane * 0.32, py + pane * 0.3, pane * 0.18, 0, Math.PI * 2); g.fill();
    }
  }
  // leading
  g.strokeStyle = '#1a1410';
  g.lineWidth = Math.max(2, pane * 0.14);
  for (let py = y; py <= y + h; py += pane) { g.beginPath(); g.moveTo(x, py); g.lineTo(x + w, py); g.stroke(); }
  for (let px = x; px <= x + w; px += pane) { g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + h); g.stroke(); }
  g.restore();
  // gold edges of the band
  g.strokeStyle = legend ? '#f3d27a' : '#d4ad55';
  g.lineWidth = Math.max(2, band * 0.12);
  g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  g.strokeRect(x + band, y + band, w - band * 2, h - band * 2);
}

/** A tile for CSS border-image: `border-image: url(...) <band> round`. */
export function glassBorderImage(band = 24, { legend = false } = {}) {
  const size = band * 6;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawGlassBand(c.getContext('2d'), 0, 0, size, size, band, { legend, pane: band / 2 });
  return c.toDataURL('image/png');
}

/** #rrggbb times k (0..1), darker. */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), gg = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}
