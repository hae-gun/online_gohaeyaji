import * as THREE from 'three';

/**
 * Chunky 90s shading: flat facets with a plastic shine.
 * Every lit surface in the world goes through this helper so the look stays consistent.
 */
export const M = (color, opts = {}) =>
  new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 38, specular: 0x333333, ...opts });

/** Unlit material for things that glow or must keep their exact color (eyes, LEDs, lamps). */
export const B = (color) => new THREE.MeshBasicMaterial({ color });

/** Draws into a canvas and returns it as a texture. Keeps the project free of image files. */
export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}

/** Stained glass pattern shared by the corridor window and the facade. */
export function makeGlassTexture() {
  return canvasTex(256, 320, (g, w, h) => {
    const cols = ['#c0392b', '#2e6fd8', '#e7b52f', '#27ae60', '#8e44ad', '#2fb3c7', '#e67e22'];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < h; y += 40) for (let x = 0; x < w; x += 32) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(x, y, 32, 40);
    }
    g.strokeStyle = '#1a1410'; g.lineWidth = 5;
    for (let y = 0; y <= h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.lineWidth = 10; g.strokeStyle = '#f6e7b0';
    g.beginPath(); g.arc(w / 2, h * 0.42, 62, 0, Math.PI * 2); g.stroke();
  });
}
