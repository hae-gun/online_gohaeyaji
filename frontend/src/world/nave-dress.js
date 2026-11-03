import * as THREE from 'three';
import { M, B, mergeStatic } from '../core/three-utils.js';
import { surfaces, tileUV } from './materials.js';

/**
 * The nave dressed as a great European cathedral (hall.js builds the room, this the grandeur):
 *
 *   arcade       clustered stone piers with gilded capitals, carrying pointed arches along both
 *                sides, and stone ribs across the vault at every bay
 *   apse         a gilded altarpiece (retablo) filling the end wall, two tiers of painted niches
 *                round a tall middle niche with the cross; a baldachin on four twisted columns
 *                over the altar
 *   chandeliers  brass rings of candles hanging down the middle
 *   entrance     a rose window over the doors, an inlaid marble star in the floor of the
 *                entrance hall, and a signpost on it: 본당 straight on, 고해소 to the right
 *   side door    a pointed stone portal with a gilded edge and its name over it
 *
 * Everything that never moves is merged (a few draw calls for the lot). Candle glows are one
 * Points object. Pictures are painted on canvases, like the rest of the world.
 *
 * @returns {{ update(t: number): void }}
 */
export function dressNave(scene, o) {
  const { N, H: NAVE_H, bays, BAY, door: D, AZ, obstacles, colliders } = o;
  const NW = N.x1 - N.x0;
  const stoneM = new THREE.MeshPhongMaterial({ map: surfaces.stone(), color: 0xf4ecdf, shininess: 8, specular: 0x1a1a1a });
  const goldM = M(0xd9b45e, { shininess: 110, specular: 0x8a7040 });
  const bronzeM = M(0x4a2c16, { shininess: 70, specular: 0x5a4020 });
  const still = new THREE.Group();
  const walls = new THREE.Group();   // the arcade walls, also colliders for the camera
  scene.add(still, walls);
  const put = (group, geo, m, x, y, z, ry = 0, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, 0, 'YXZ');
    group.add(mesh);
    return mesh;
  };

  /* ---------------------------------------------------------------- arcade */
  const PX = N.x1 - 1.6;           // pier line, both sides
  const SPRING = 7.0;              // where the arches start
  const PIER_W = 1.1;
  const span = BAY - PIER_W;
  const RISE = span * 0.72;        // pointed: taller than half the span
  /**
   * A pointed arch band as one outline: up the outer edge from `bottom`, over the top, down to
   * `bottom`, then back under the inner arch. t: thickness, at the sides and at the top.
   */
  const archBand = (a, b, y, rise, t, bottom = y) => {
    const sh = new THREE.Shape();
    const oa = a - t, ob = b + t, orise = rise + t * 1.2;
    sh.moveTo(oa, bottom); sh.lineTo(oa, y);
    sh.quadraticCurveTo(oa, y + orise * 0.78, (a + b) / 2, y + orise);
    sh.quadraticCurveTo(ob, y + orise * 0.78, ob, y);
    sh.lineTo(ob, bottom); sh.lineTo(b, bottom); sh.lineTo(b, y);
    sh.quadraticCurveTo(b, y + rise * 0.78, (a + b) / 2, y + rise);
    sh.quadraticCurveTo(a, y + rise * 0.78, a, y);
    sh.lineTo(a, bottom); sh.lineTo(oa, bottom);
    return sh;
  };
  // along the wall, u = -z (see the rotation below); the wall runs from the front to the last pier
  const u0 = -N.z1, u1 = -bays[bays.length - 1];
  for (const s of [-1, 1]) {
    // the wall over the arcade as one outline: along the top, then back along the bottom,
    // curving up over every opening (no holes, so it triangulates cleanly)
    const wall = new THREE.Shape();
    wall.moveTo(u0, NAVE_H); wall.lineTo(u1, NAVE_H); wall.lineTo(u1, SPRING);
    for (let i = bays.length - 2; i >= 0; i--) {
      const a = -bays[i] + PIER_W / 2, b = -bays[i + 1] - PIER_W / 2;
      wall.lineTo(b, SPRING);
      wall.quadraticCurveTo(b, SPRING + RISE * 0.78, (a + b) / 2, SPRING + RISE);
      wall.quadraticCurveTo(a, SPRING + RISE * 0.78, a, SPRING);
    }
    wall.lineTo(u0, SPRING); wall.lineTo(u0, NAVE_H);
    const geo = tileUV(new THREE.ExtrudeGeometry(wall, { depth: 0.5, bevelEnabled: false, curveSegments: 10 }), 0.25, 0.25);
    put(walls, geo, stoneM, s * PX - 0.25, 0, 0, Math.PI / 2);
    // gilded edge round every arch
    for (let i = 0; i < bays.length - 1; i++) {
      const a = -bays[i] + PIER_W / 2, b = -bays[i + 1] - PIER_W / 2;
      const band = archBand(a, b, SPRING, RISE, 0.22);
      put(still, new THREE.ExtrudeGeometry(band, { depth: 0.62, bevelEnabled: false, curveSegments: 10 }), goldM, s * PX - 0.31, 0, 0, Math.PI / 2);
    }
    // a gilded cornice along the top of the arcade, and a stone string course under the windows
    put(still, new THREE.BoxGeometry(0.7, 0.32, u1 - u0), goldM, s * PX, NAVE_H - 1.0, -(u0 + u1) / 2);
    put(still, new THREE.BoxGeometry(0.3, 0.22, N.z1 - N.z0), stoneM, s * (N.x1 - 0.12), 2.45, (N.z0 + N.z1) / 2);
  }
  // clustered piers: a core with four slim shafts, a moulded base and a gilded capital
  for (const s of [-1, 1]) {
    for (const z of bays) {
      const x = s * PX;
      put(still, tileUV(new THREE.CylinderGeometry(0.42, 0.42, SPRING, 16), 1, SPRING / 4), stoneM, x, SPRING / 2, z);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        put(still, new THREE.CylinderGeometry(0.15, 0.15, SPRING, 10), stoneM, x + Math.cos(a) * 0.42, SPRING / 2, z + Math.sin(a) * 0.42);
      }
      put(still, new THREE.CylinderGeometry(0.78, 0.86, 0.55, 8), stoneM, x, 0.27, z);
      put(still, new THREE.CylinderGeometry(0.72, 0.62, 0.22, 8), stoneM, x, 0.66, z);
      put(still, new THREE.CylinderGeometry(0.74, 0.5, 0.5, 16), goldM, x, SPRING - 0.3, z);
      put(still, new THREE.BoxGeometry(1.25, 0.16, 1.25), goldM, x, SPRING - 0.0, z);
      obstacles.push({ x, z, r: 0.75 });
    }
  }
  // ribs across the vault at every bay
  for (const z of bays) {
    put(still, new THREE.BoxGeometry(NW, 0.5, 0.55), stoneM, 0, NAVE_H - 0.25, z);
    put(still, new THREE.BoxGeometry(NW, 0.07, 0.6), goldM, 0, NAVE_H - 0.52, z);
  }

  /* ---------------------------------------------------------------- apse: the altarpiece */
  const RW = 15, RH = 11, RY = 0.3;   // width, height, bottom
  const retabloTex = new THREE.CanvasTexture(paintRetablo());
  retabloTex.anisotropy = 4;
  const retablo = new THREE.Mesh(new THREE.PlaneGeometry(RW, RH), new THREE.MeshBasicMaterial({ map: retabloTex, color: 0xd9ccb2, transparent: true, alphaTest: 0.5 }));
  retablo.position.set(0, RY + RH / 2, N.z0 + 0.06); scene.add(retablo);
  // gilded columns in front of the pilasters, as a real altarpiece stands out from the wall
  const COLS = [-5.25, -2.3, 2.3, 5.25];
  for (const cx of COLS) {
    put(still, new THREE.CylinderGeometry(0.2, 0.24, 5.6, 14), goldM, cx, RY + 0.4 + 2.8, N.z0 + 0.45);
    put(still, new THREE.BoxGeometry(0.62, 0.4, 0.62), goldM, cx, RY + 0.2, N.z0 + 0.45);
    put(still, new THREE.CylinderGeometry(0.17, 0.2, 3.3, 14), goldM, cx, RY + 6.45 + 1.65, N.z0 + 0.4);
  }
  put(still, new THREE.BoxGeometry(RW + 0.4, 0.28, 0.7), goldM, 0, RY + 6.3, N.z0 + 0.4);
  put(still, new THREE.BoxGeometry(RW + 0.6, 0.3, 0.8), goldM, 0, RY + 9.9, N.z0 + 0.4);

  /* ---------------------------------------------------------------- baldachin over the altar */
  const BX = 2.5, BZ = 1.7, BH = 6.2, base = 0.3;
  const helix = new (class extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const a = t * Math.PI * 2 * 3.5;
      return out.set(Math.cos(a) * 0.12, t * BH, Math.sin(a) * 0.12);
    }
  })();
  const twist = new THREE.TubeGeometry(helix, 120, 0.17, 10, false);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * BX, z = AZ + sz * BZ;
    put(still, twist, bronzeM, x, base, z);
    put(still, new THREE.CylinderGeometry(0.13, 0.13, BH, 10), bronzeM, x, base + BH / 2, z);
    put(still, new THREE.BoxGeometry(0.55, 0.4, 0.55), goldM, x, base + 0.2, z);
    put(still, new THREE.CylinderGeometry(0.34, 0.2, 0.42, 12), goldM, x, base + BH + 0.1, z);
    put(still, new THREE.SphereGeometry(0.22, 16, 10), goldM, x, base + BH + 1.15, z);
  }
  put(still, new THREE.BoxGeometry(BX * 2 + 0.9, 0.7, BZ * 2 + 0.9), goldM, 0, base + BH + 0.6, AZ);
  put(still, new THREE.BoxGeometry(BX * 2 + 0.6, 0.12, BZ * 2 + 0.6), bronzeM, 0, base + BH + 1.0, AZ);
  put(still, new THREE.ConeGeometry(1.6, 1.4, 4), goldM, 0, base + BH + 1.75, AZ, Math.PI / 4);
  put(still, new THREE.SphereGeometry(0.3, 16, 10), goldM, 0, base + BH + 2.6, AZ);
  put(still, new THREE.BoxGeometry(0.1, 0.8, 0.1), goldM, 0, base + BH + 3.15, AZ);
  put(still, new THREE.BoxGeometry(0.5, 0.1, 0.1), goldM, 0, base + BH + 3.3, AZ);
  // the scalloped valance under the canopy (painted)
  const valTex = new THREE.CanvasTexture(paintValance());
  const valM = new THREE.MeshBasicMaterial({ map: valTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0xe8d8b8 });
  for (const [w, x, z, ry] of [[BX * 2 + 0.9, 0, AZ + BZ + 0.46, 0], [BX * 2 + 0.9, 0, AZ - BZ - 0.46, 0], [BZ * 2 + 0.9, BX + 0.46, AZ, Math.PI / 2], [BZ * 2 + 0.9, -BX - 0.46, AZ, Math.PI / 2]]) {
    put(scene, new THREE.PlaneGeometry(w, 0.55), valM, x, base + BH + 0.0, z, ry);
  }

  /* ---------------------------------------------------------------- chandeliers */
  const glowPos = [];
  const brassM = M(0xc9a24e, { shininess: 100, specular: 0x6a5530 });
  const chainM = B(0x2a2014);
  const waxM = M(0xf6f0e2);
  for (const z of [-0.5, -11, -21, -31, -40]) {   // the first over the entrance hall, clear of the signpost
    const y = 8.4;
    put(still, new THREE.CylinderGeometry(0.03, 0.03, NAVE_H - y, 6), chainM, 0, y + (NAVE_H - y) / 2, z);
    put(still, new THREE.SphereGeometry(0.28, 16, 10), brassM, 0, y, z);
    put(still, new THREE.ConeGeometry(0.22, 0.5, 12), brassM, 0, y - 0.4, z, 0, Math.PI);
    for (const [r, ry, n] of [[1.25, y - 0.1, 12], [0.75, y + 0.45, 8]]) {
      put(still, new THREE.TorusGeometry(r, 0.05, 6, 32), brassM, 0, ry, z, 0, Math.PI / 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const cx = Math.cos(a) * r, cz = z + Math.sin(a) * r;
        put(still, new THREE.CylinderGeometry(0.07, 0.05, 0.06, 8), brassM, cx, ry + 0.04, cz);
        put(still, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), waxM, cx, ry + 0.17, cz);
        glowPos.push(cx, ry + 0.33, cz);
      }
    }
  }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  const glowM = new THREE.PointsMaterial({ map: surfaces.pool(), color: 0xffd38a, size: 0.42, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const glow = new THREE.Points(glowGeo, glowM);
  scene.add(glow);

  /* ---------------------------------------------------------------- entrance */
  // the inside of the front wall round the doorway (x -1.6..1.6, up to 4.3 m: exterior.js), in the
  // same cut stone as the other walls, with a gilded frame round the doors
  const FH = 10;   // the facade's half width
  for (const [w, h, x, y] of [[FH - 1.6, NAVE_H, -(FH + 1.6) / 2, NAVE_H / 2], [FH - 1.6, NAVE_H, (FH + 1.6) / 2, NAVE_H / 2], [3.2, NAVE_H - 4.3, 0, 4.3 + (NAVE_H - 4.3) / 2]]) {
    put(scene, tileUV(new THREE.PlaneGeometry(w, h), w / 4, h / 4), stoneM, x, y, N.z1 - 0.02, Math.PI);
  }
  put(still, new THREE.BoxGeometry(3.9, 0.3, 0.16), goldM, 0, 4.45, N.z1 - 0.08);
  for (const sx of [-1, 1]) put(still, new THREE.BoxGeometry(0.3, 4.45, 0.16), goldM, sx * 1.8, 2.22, N.z1 - 0.08);
  // the rose window over the doors, seen when you turn back
  const roseTex = new THREE.CanvasTexture(paintRose());
  const rose = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48), new THREE.MeshBasicMaterial({ map: roseTex }));
  rose.position.set(0, 9.0, N.z1 - 0.06); rose.rotation.y = Math.PI; scene.add(rose);
  put(still, new THREE.TorusGeometry(2.6, 0.16, 8, 48), goldM, 0, 9.0, N.z1 - 0.12);
  // an inlaid star in the floor of the entrance hall, with the signpost on it
  const SX = 0, SZ = 4.0;
  const starTex = new THREE.CanvasTexture(paintFloorStar());
  const star = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshPhongMaterial({ map: starTex, shininess: 80, specular: 0x3a342e, transparent: true }));
  star.rotation.x = -Math.PI / 2; star.position.set(SX, 0.018, SZ); scene.add(star);
  const sign = buildSignpost();
  sign.position.set(SX, 0, SZ); scene.add(sign);
  obstacles.push({ x: SX, z: SZ, r: 0.55 });

  /* ---------------------------------------------------------------- the side door */
  const DZ = (D.z0 + D.z1) / 2, DW = D.z1 - D.z0, DH = D.h;
  for (const side of [-1, 1]) {   // nave side and hall side
    const x = D.x + side * 0.33;
    const frame = archBand(-DW / 2, DW / 2, DH - 1.1, 1.1, 0.4, 0);
    put(still, new THREE.ExtrudeGeometry(frame, { depth: 0.12, bevelEnabled: false, curveSegments: 10 }), goldM, x - 0.06, 0, DZ, Math.PI / 2);
  }

  mergeStatic(still);
  mergeStatic(walls);
  walls.children.forEach((m) => colliders.push(m));

  return {
    update(t) {
      glowM.size = 0.42 + Math.sin(t * 7) * 0.015 + Math.sin(t * 11.3) * 0.01;
    },
  };
}

/* ====================================================================== paintings */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
let seed = 23;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Gold leaf: warm bands that catch the light, a little uneven. */
function gold(g, x0, y0, x1, y1, vertical = true) {
  const gr = vertical ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#6b4614'); gr.addColorStop(0.25, '#e6c06a'); gr.addColorStop(0.5, '#fff0b8');
  gr.addColorStop(0.7, '#c7963c'); gr.addColorStop(1, '#6b4614');
  return gr;
}

/** An arched niche (round top). */
function niche(g, x, y, w, h) {
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath();
}

/** A saint in a niche, simply drawn: halo, face, a robe and a mantle over it. */
function figure(g, cx, top, h, robe, mantle) {
  const head = h * 0.11;
  // halo
  const halo = g.createRadialGradient(cx, top + head, head * 0.5, cx, top + head, head * 2.1);
  halo.addColorStop(0, 'rgba(255,240,170,1)'); halo.addColorStop(0.6, 'rgba(230,180,80,.9)'); halo.addColorStop(1, 'rgba(230,180,80,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(cx, top + head, head * 2.1, 0, Math.PI * 2); g.fill();
  // robe
  const rg = g.createLinearGradient(cx - h * 0.2, 0, cx + h * 0.2, 0);
  rg.addColorStop(0, shade(robe, 0.55)); rg.addColorStop(0.45, robe); rg.addColorStop(1, shade(robe, 0.5));
  g.fillStyle = rg;
  g.beginPath(); g.moveTo(cx - h * 0.09, top + head * 2.1); g.lineTo(cx + h * 0.09, top + head * 2.1);
  g.lineTo(cx + h * 0.2, top + h); g.lineTo(cx - h * 0.2, top + h); g.closePath(); g.fill();
  // mantle across
  g.fillStyle = mantle;
  g.beginPath(); g.moveTo(cx - h * 0.11, top + head * 2.2); g.quadraticCurveTo(cx + h * 0.2, top + h * 0.45, cx + h * 0.18, top + h * 0.95);
  g.lineTo(cx + h * 0.08, top + h * 0.95); g.quadraticCurveTo(cx + h * 0.05, top + h * 0.5, cx - h * 0.13, top + h * 0.35); g.closePath(); g.fill();
  // hands together
  g.fillStyle = '#f0cfae'; g.beginPath(); g.ellipse(cx, top + h * 0.42, h * 0.03, h * 0.05, 0, 0, Math.PI * 2); g.fill();
  // face
  g.fillStyle = '#f2d2b0'; g.beginPath(); g.arc(cx, top + head, head, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(60,40,30,.6)'; g.beginPath(); g.arc(cx, top + head * 0.55, head, Math.PI, 0); g.fill();
}

/** The altarpiece: 15 x 11 m, five columns of niches in two tiers, the middle one full height. */
function paintRetablo() {
  const W = 1024, Hh = 752;   // 15 m x 11 m
  const [c, g] = canvas(W, Hh);
  const m = W / 15;           // pixels per metre
  // the gilded body
  g.fillStyle = gold(g, 0, 0, W, 0); g.fillRect(0, 0, W, Hh);
  for (let x = 0; x < W; x += 6) { g.fillStyle = `rgba(90,60,20,${0.05 + rnd() * 0.08})`; g.fillRect(x, 0, 2, Hh); }
  const cols = [[0.3, 2.3], [2.7, 4.9], [5.6, 9.4], [10.1, 12.3], [12.7, 14.7]];   // niche spans in metres
  const tiers = [[0.6, 5.7], [6.6, 9.4]];                                            // lower, upper (from the bottom)
  const yOf = (mFromBottom) => Hh - mFromBottom * m;
  const robes = [['#8e1f24', '#2b4f9a'], ['#2b4f9a', '#d7c9a6'], ['#3f6b38', '#8e1f24'], ['#5b2a6e', '#d4ad55']];
  let r = 0;
  cols.forEach(([a, b], i) => {
    const x = a * m, w = (b - a) * m;
    const spans = i === 2 ? [[0.6, 9.4]] : tiers;
    for (const [lo, hi] of spans) {
      const y = yOf(hi), h = (hi - lo) * m;
      // carved frame
      g.save(); niche(g, x - 8, y - 8, w + 16, h + 8); g.fillStyle = '#5a3a12'; g.fill(); g.restore();
      g.save(); niche(g, x - 4, y - 4, w + 8, h + 4); g.fillStyle = gold(g, x - 4, 0, x + w + 4, 0); g.fill(); g.restore();
      // the deep of the niche
      g.save(); niche(g, x, y, w, h); g.clip();
      const deep = g.createRadialGradient(x + w / 2, y + h * 0.35, 4, x + w / 2, y + h * 0.5, h * 0.8);
      if (i === 2) { deep.addColorStop(0, '#fff2c4'); deep.addColorStop(0.25, '#c9792c'); deep.addColorStop(1, '#3a0a0c'); }
      else { deep.addColorStop(0, '#3e5bb0'); deep.addColorStop(1, '#0b1030'); }
      g.fillStyle = deep; g.fillRect(x, y, w, h);
      if (i === 2) {
        // a glory of rays behind the cross
        g.globalCompositeOperation = 'lighter';
        const cx = x + w / 2, cy = y + h * 0.42;
        for (let k = 0; k < 36; k++) {
          const ang = (k / 36) * Math.PI * 2;
          g.strokeStyle = `rgba(255,210,120,${k % 2 ? 0.25 : 0.45})`; g.lineWidth = k % 2 ? 3 : 6;
          g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * h, cy + Math.sin(ang) * h); g.stroke();
        }
        g.globalCompositeOperation = 'source-over';
      } else {
        const [robe, mantle] = robes[r++ % robes.length];
        figure(g, x + w / 2, y + h * 0.16, h * 0.8, robe, mantle);
        // a little shell over the head
        g.strokeStyle = 'rgba(230,190,100,.8)'; g.lineWidth = 2;
        for (let k = 0; k < 9; k++) { const ang = Math.PI + (k / 8) * Math.PI; g.beginPath(); g.moveTo(x + w / 2, y + w / 2); g.lineTo(x + w / 2 + Math.cos(ang) * w * 0.45, y + w / 2 + Math.sin(ang) * w * 0.45); g.stroke(); }
      }
      // shade at the top and sides
      const v = g.createLinearGradient(x, 0, x + w, 0);
      v.addColorStop(0, 'rgba(0,0,0,.45)'); v.addColorStop(0.2, 'rgba(0,0,0,0)'); v.addColorStop(0.8, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
      g.fillStyle = v; g.fillRect(x, y, w, h);
      g.restore();
    }
  });
  // cornices between the tiers and at the top
  for (const mY of [0.45, 6.1, 9.7]) {
    const y = yOf(mY);
    g.fillStyle = '#4e320e'; g.fillRect(0, y - 6, W, 14);
    g.fillStyle = gold(g, 0, y - 10, 0, y + 6, false); g.fillRect(0, y - 10, W, 10);
    g.fillStyle = 'rgba(255,248,210,.7)'; g.fillRect(0, y - 10, W, 2);
    for (let x = 6; x < W; x += 18) { g.fillStyle = '#7a5218'; g.fillRect(x, y + 2, 8, 5); }   // dentils
  }
  // the crown: a half sunburst over the middle
  const cx = W / 2, cy = yOf(9.7);
  for (let k = 0; k <= 18; k++) {
    const ang = Math.PI + (k / 18) * Math.PI;
    g.strokeStyle = k % 2 ? '#c7963c' : '#ffe9a0'; g.lineWidth = k % 2 ? 4 : 8;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * 1.25 * m, cy + Math.sin(ang) * 1.25 * m); g.stroke();
  }
  g.fillStyle = '#fff1c0'; g.beginPath(); g.arc(cx, cy, 0.35 * m, Math.PI, 0); g.fill();
  // scrolls on the shoulders of the top tier
  for (const sx of [2.5, 12.5]) {
    g.strokeStyle = '#ffe9a0'; g.lineWidth = 6;
    g.beginPath(); g.arc(sx * m, yOf(10.05), 0.3 * m, 0, Math.PI * 1.7); g.stroke();
  }
  // the whole thing a little darker at the edges, lighter in the middle
  const vg = g.createRadialGradient(W / 2, Hh * 0.45, 60, W / 2, Hh * 0.5, W * 0.62);
  vg.addColorStop(0, 'rgba(255,240,200,.12)'); vg.addColorStop(1, 'rgba(30,15,5,.45)');
  g.fillStyle = vg; g.fillRect(0, 0, W, Hh);
  // transparent above the cornice, so the wall shows round the crown
  g.clearRect(0, 0, W, yOf(10.0) - 10);
  // put the crown back on (it was cut with the top): a pediment arch
  g.save();
  g.beginPath(); g.moveTo(cx - 3.2 * m, yOf(10.0)); g.quadraticCurveTo(cx, yOf(11.4), cx + 3.2 * m, yOf(10.0)); g.closePath();
  g.fillStyle = gold(g, cx - 3.2 * m, 0, cx + 3.2 * m, 0); g.fill();
  g.clip();
  for (let k = 0; k <= 18; k++) {
    const ang = Math.PI + (k / 18) * Math.PI;
    g.strokeStyle = k % 2 ? 'rgba(120,80,20,.6)' : 'rgba(255,240,180,.8)'; g.lineWidth = k % 2 ? 3 : 6;
    g.beginPath(); g.moveTo(cx, yOf(10.0)); g.lineTo(cx + Math.cos(ang) * 3.2 * m, yOf(10.0) + Math.sin(ang) * 3.2 * m); g.stroke();
  }
  g.restore();
  g.fillStyle = '#fff1c0'; g.beginPath(); g.arc(cx, yOf(10.0), 0.3 * m, Math.PI, 0); g.fill();
  return c;
}

/** Scallops with tassels, for the baldachin. */
function paintValance() {
  const [c, g] = canvas(512, 64);
  g.clearRect(0, 0, 512, 64);
  const n = 10, w = 512 / n;
  for (let i = 0; i < n; i++) {
    const x = i * w;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#f5dc8e'); gr.addColorStop(0.5, '#c9963c'); gr.addColorStop(1, '#7a5218');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w, 26); g.quadraticCurveTo(x + w / 2, 58, x, 26); g.closePath(); g.fill();
    g.fillStyle = '#8e1f24'; g.beginPath(); g.arc(x + w / 2, 30, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f5dc8e'; g.fillRect(x + w / 2 - 1.5, 36, 3, 18);
  }
  g.fillStyle = '#fff1c0'; g.fillRect(0, 0, 512, 4);
  return c;
}

/** A rose window: petals of coloured glass round a gold centre, in dark tracery. */
function paintRose() {
  const S = 512, [c, g] = canvas(S, S), cx = S / 2;
  g.fillStyle = '#120c08'; g.fillRect(0, 0, S, S);
  const ring = (r0, r1, n, cols, offset = 0) => {
    for (let k = 0; k < n; k++) {
      const a0 = ((k + offset) / n) * Math.PI * 2, a1 = ((k + 1 + offset) / n) * Math.PI * 2;
      const col = cols[k % cols.length];
      const gr = g.createRadialGradient(cx, cx, r0, cx, cx, r1);
      gr.addColorStop(0, '#fffbe8'); gr.addColorStop(0.15, col); gr.addColorStop(1, shade(col, 0.5));
      g.fillStyle = gr;
      g.beginPath(); g.arc(cx, cx, r1 - 4, a0 + 0.02, a1 - 0.02); g.arc(cx, cx, r0 + 4, a1 - 0.02, a0 + 0.02, true); g.closePath(); g.fill();
    }
  };
  ring(196, 252, 24, ['#2e6fd8', '#c0392b', '#2e6fd8', '#e7b52f']);
  ring(120, 196, 16, ['#8e44ad', '#2fb3c7', '#c0392b', '#27ae60'], 0.5);
  ring(56, 120, 12, ['#e7b52f', '#d24d8a', '#2e6fd8']);
  // petals as round lobes over the middle ring
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * Math.PI * 2, x = cx + Math.cos(a) * 158, y = cx + Math.sin(a) * 158;
    g.strokeStyle = '#120c08'; g.lineWidth = 7; g.beginPath(); g.arc(x, y, 30, 0, Math.PI * 2); g.stroke();
  }
  const mid = g.createRadialGradient(cx, cx, 4, cx, cx, 56);
  mid.addColorStop(0, '#fff6d0'); mid.addColorStop(1, '#c9963c');
  g.fillStyle = mid; g.beginPath(); g.arc(cx, cx, 52, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#120c08'; g.lineWidth = 9;
  for (const r of [56, 120, 196, 252]) { g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke(); }
  return c;
}

/** The inlaid marble star of the entrance hall: an eight-pointed star in a ring of two marbles. */
function paintFloorStar() {
  const S = 512, [c, g] = canvas(S, S), cx = S / 2;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#3a2f2c'; g.beginPath(); g.arc(cx, cx, 254, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8dccb'; g.beginPath(); g.arc(cx, cx, 236, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8e2a24'; g.beginPath(); g.arc(cx, cx, 222, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#efe7da'; g.beginPath(); g.arc(cx, cx, 200, 0, Math.PI * 2); g.fill();
  const starPts = (r0, r1, n, rot) => {
    g.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const a = rot + (k / (n * 2)) * Math.PI * 2, r = k % 2 ? r0 : r1;
      const x = cx + Math.cos(a) * r, y = cx + Math.sin(a) * r;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  };
  starPts(70, 196, 8, -Math.PI / 2); g.fillStyle = '#c9a050'; g.fill();
  starPts(60, 150, 8, -Math.PI / 2 + Math.PI / 8); g.fillStyle = '#2b4f9a'; g.fill();
  g.fillStyle = '#3a2f2c'; g.beginPath(); g.arc(cx, cx, 52, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8c56a'; g.beginPath(); g.arc(cx, cx, 40, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.06})`; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  return c;
}

/* ====================================================================== the signpost */

/**
 * A wooden signpost with gilded edges in the middle of the entrance hall. Facing the doors:
 * "본당" straight on and "고해소" to the right. Its back, for people on their way out: "나가는 문"
 * and "고해소" to the left (the same door, seen from the other side).
 */
function buildSignpost() {
  const g = new THREE.Group();
  const woodM = M(0x3e2414, { shininess: 30 }), goldM = M(0xd9b45e, { shininess: 110 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.32, 12), M(0xd8cdb8)); base.position.y = 0.16; g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.9, 12), woodM); post.position.y = 1.6; g.add(post);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), goldM); knob.position.y = 3.1; g.add(knob);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), goldM); cross.position.y = 3.35; g.add(cross);
  const crossBar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05), goldM); crossBar.position.y = 3.4; g.add(crossBar);

  const boards = [
    // y, width, height, x offset, front (to the doors) and back (to the nave)
    { y: 2.45, w: 1.9, h: 0.62, x: 0, front: ['본당', '↑', '장의자, 촛불, 봉헌'], back: ['나가는 문', '↑', '앞마당으로'] },
    { y: 1.62, w: 2.1, h: 0.62, x: 0.75, front: ['고해소', '→', '고해성사 21칸, 신께 알리기'], back: ['고해소', '←', '고해성사 21칸, 신께 알리기'], arrow: 1 },
  ];
  const textures = [];
  for (const b of boards) {
    for (const side of ['front', 'back']) {
      const flip = side === 'back';
      // the right-pointing board points left from behind: draw it flipped
      const dir = b.arrow ? (flip ? -1 : 1) : 0;
      const tex = new THREE.CanvasTexture(document.createElement('canvas'));
      const draw = () => { tex.image = paintBoard(b[side], dir); tex.needsUpdate = true; };
      draw();
      textures.push(draw);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, color: 0xf0e6d4 }));
      plane.position.set(flip ? -b.x : b.x, b.y, flip ? -0.11 : 0.11);
      plane.rotation.y = flip ? Math.PI : 0;
      g.add(plane);
    }
    const core = new THREE.Mesh(new THREE.BoxGeometry(b.w * (b.arrow ? 0.86 : 0.98), b.h * 0.92, 0.2), woodM);
    core.position.set(b.arrow ? b.x - b.w * 0.07 : b.x, b.y, 0); g.add(core);
  }
  // redraw once the site's fonts have loaded (the first drawing may use a fallback)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => textures.forEach((d) => d()));
  return g;
}

/** One face of a board: dark wood, gilded edge, the name big, a line under it. dir: arrow tip. */
function paintBoard([name, arrow, sub], dir) {
  const W = 512, Hh = 152, [c, g] = canvas(W, Hh);
  const tip = dir ? 60 : 0;
  const shape = () => {
    g.beginPath();
    if (dir > 0) { g.moveTo(6, 6); g.lineTo(W - tip, 6); g.lineTo(W - 4, Hh / 2); g.lineTo(W - tip, Hh - 6); g.lineTo(6, Hh - 6); }
    else if (dir < 0) { g.moveTo(W - 6, 6); g.lineTo(tip, 6); g.lineTo(4, Hh / 2); g.lineTo(tip, Hh - 6); g.lineTo(W - 6, Hh - 6); }
    else { g.moveTo(6, 6); g.lineTo(W - 6, 6); g.lineTo(W - 6, Hh - 6); g.lineTo(6, Hh - 6); }
    g.closePath();
  };
  shape();
  const wood = g.createLinearGradient(0, 0, 0, Hh);
  wood.addColorStop(0, '#5a3620'); wood.addColorStop(0.5, '#3e2414'); wood.addColorStop(1, '#2a180c');
  g.fillStyle = wood; g.fill();
  g.save(); shape(); g.clip();
  for (let i = 0; i < 30; i++) { g.strokeStyle = `rgba(0,0,0,${0.1 + rnd() * 0.15})`; g.lineWidth = 1; const y = rnd() * Hh; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W / 3, y + 4, W * 0.6, y - 4, W, y + 2); g.stroke(); }
  g.restore();
  shape(); g.strokeStyle = '#e2bf66'; g.lineWidth = 7; g.stroke();
  shape(); g.strokeStyle = 'rgba(255,240,190,.5)'; g.lineWidth = 2; g.stroke();
  const font = '"Jua", "Gowun Dodum", sans-serif';
  const left = dir < 0 ? tip + 16 : 24, right = dir > 0 ? W - tip - 16 : W - 24;
  const mid = (left + right) / 2;
  g.textBaseline = 'middle'; g.textAlign = 'center';
  // the arrow on the side it points to (straight on: before the name)
  g.fillStyle = '#ffe39a'; g.font = `bold 64px ${font}`;
  const ax = dir > 0 ? right - 34 : dir < 0 ? left + 34 : left + 40;
  g.fillText(arrow, ax, Hh * 0.42);
  g.fillStyle = '#fff4dc'; g.font = `60px ${font}`;
  const nameX = dir > 0 ? mid - 28 : dir < 0 ? mid + 28 : mid + 26;
  g.fillText(name, nameX, Hh * 0.4);
  g.fillStyle = 'rgba(255,228,170,.85)'; g.font = `24px ${font}`;
  g.fillText(sub, nameX, Hh * 0.78);
  return c;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}
