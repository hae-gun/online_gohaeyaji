import * as THREE from 'three';

/**
 * Soft toy shading: smooth surfaces with a gentle shine, so round things look round.
 * Every lit surface in the world goes through this helper so the look stays consistent.
 */
export const M = (color, opts = {}) =>
  new THREE.MeshPhongMaterial({ color, shininess: 22, specular: 0x262626, ...opts });

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

/**
 * Merges every mesh under `root` that looks the same (same kind of material, colour, texture
 * and settings) into one mesh, so a hundred benches and lamps cost a handful of draw calls
 * instead of a thousand. Only for things that never move. `root` is emptied and filled with
 * the merged meshes (instanced meshes are kept as they are).
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const keep = [];
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (o.isInstancedMesh || (o.isMesh && Array.isArray(o.material))) { keep.push(o); return; }
    if (!o.isMesh) return;
    const m = o.material;
    const key = [m.type, m.color && m.color.getHex(), m.map && m.map.uuid, m.flatShading, m.shininess,
      m.transparent, m.opacity, m.side, m.emissive && m.emissive.getHex(), m.fog].join('|');
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material: m, parts: [] }));
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone())
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    g.parts.push(geo);
  });
  keep.forEach((o) => root.attach(o));   // instanced meshes stay as they are
  [...root.children].forEach((c) => { if (!keep.includes(c)) root.remove(c); });
  for (const { material, parts } of groups.values()) {
    const merged = mergeParts(parts);
    parts.forEach((p) => p.dispose());
    root.add(new THREE.Mesh(merged, material));
  }
}

/** Joins non-indexed geometries; keeps position, normal and uv (uv filled with 0 when missing). */
function mergeParts(parts) {
  const count = parts.reduce((n, p) => n + p.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let k = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    pos.set(p.attributes.position.array, k * 3);
    if (p.attributes.normal) nor.set(p.attributes.normal.array, k * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, k * 2);
    k += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
