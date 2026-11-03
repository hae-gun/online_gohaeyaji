import * as THREE from 'three';
import { M, B, canvasTex, mergeStatic } from '../core/three-utils.js';
import { CONFESSION_HALL } from './booths.js';
import { surfaces, tileUV, heightShade, makeLeadedGlass } from './materials.js';
import { dressNave } from './nave-dress.js';

/**
 * Inside the cathedral: the nave you walk into from the main doors, and the confession hall
 * through a side door on the right.
 *
 * Nave (NAVE): first an open entrance hall (NARTHEX_Z) with holy water fonts, an inlaid star in
 * the floor and a signpost on it (본당 straight on, 고해소 to the right); then pews on both sides
 * of a red carpet, coloured windows, the altar behind a rail, a rack of votive candles and an
 * offering box. The grand dressing (arcade, altarpiece, baldachin, chandeliers, rose window,
 * the side portal) is in nave-dress.js.
 *
 * Confession hall (CONFESSION_HALL): 21 booths on three walls (booths.js) and, in the middle,
 * "신께 알리기", the box where people leave questions for the site's admins. The side door is in
 * the middle of its wall, so you come in facing the box with the booths at a distance.
 *
 * Surfaces (marble, cut stone, the vault, wood, light through the windows) come from materials.js.
 *
 * Returns floors for tap-to-walk, colliders for the camera, obstacles and seats for walking
 * and sitting, the places people can use (candles, fonts, offering box, inquiry box) and update().
 */
// a big nave: 34 m wide, 69 m long, 13 m high (about four times the first one), the facade in
// the middle of its front, the confession hall through a side door on the right
export const NAVE = { x0: -17, x1: 17, z0: -58.8, z1: 10.2, rail: -46 };
/**
 * The entrance hall: the first 14 m inside the doors are open floor (no pews), with the signpost
 * in the middle. The pews start behind it. The side door to the confession hall is at its far
 * right end, in the middle of the confession hall's wall, so neither room starts right at a door.
 */
export const NARTHEX_Z = -4.6;
// h: the top of the pointed arch over the door (the square opening is 1.1 m lower)
export const SIDE_DOOR = { x: 17.3, z0: -4.0, z1: -1.0, h: 5.0 };
const NAVE_H = 13;
const FACADE_HALF = 10;   // the facade (exterior.js) covers x -10..10 of the front
const HALL_H = 8;

export function buildHall(scene, glassTex) {
  const colliders = [];
  const obstacles = [];
  const seats = [];

  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2a2233, 0.68));
  const sun = new THREE.DirectionalLight(0xffe2b8, 0.5);
  sun.position.set(3, 8, 6);
  scene.add(sun);

  // cut stone, fading darker toward the vault (vertex colours, see stoneBox)
  const wallM = new THREE.MeshPhongMaterial({ map: surfaces.stone(), vertexColors: true, shininess: 4, specular: 0x111111 });
  const darkWoodM = M(0x4a2e1c), woodM = M(0x7a4d2c), goldM = M(0xd4ad55, { shininess: 90 });
  const add = (mesh, collide = false) => { scene.add(mesh); if (collide) colliders.push(mesh); return mesh; };
  const box = (w, h, d, m, x, y, z, collide = false) => {
    const b = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), collide);
    b.position.set(x, y, z);
    return b;
  };
  /** A wall of cut stone: the texture tiles every 4 m, the top fades into the dark of the vault. */
  const stoneBox = (w, h, d, m, x, y, z, top = 0.5) => {
    const geo = heightShade(tileUV(new THREE.BoxGeometry(w, h, d), Math.max(w, d) / 4, h / 4), h, 1.0, top);
    const b = add(new THREE.Mesh(geo, m), true);
    b.position.set(x, y, z);
    return b;
  };
  const sign = (text, sub, w, h) => canvasTex(w, h, (g) => {
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#3a2414'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(h * (sub ? 0.3 : 0.5))}px sans-serif`;
    g.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
    if (sub) { g.font = `${Math.round(h * 0.17)}px sans-serif`; g.fillText(sub, w / 2, h * 0.74); }
  });

  /* ================================================================ nave */
  const N = NAVE;
  // polished marble, a 2 m slab
  const marbleM = new THREE.MeshPhongMaterial({ map: surfaces.naveMarble(), color: 0xcfc6ba, shininess: 70, specular: 0x3a342e });
  const naveFloor = new THREE.Mesh(tileUV(new THREE.PlaneGeometry(N.x1 - N.x0, N.z1 - N.z0), (N.x1 - N.x0) / 4, (N.z1 - N.z0) / 4), marbleM);
  naveFloor.rotation.x = -Math.PI / 2;
  naveFloor.position.set(0, 0, (N.z0 + N.z1) / 2);
  scene.add(naveFloor);
  // red carpet down the middle
  const carpetLen = N.z1 - N.rail - 0.4;
  const carpet = new THREE.Mesh(tileUV(new THREE.PlaneGeometry(3, carpetLen), 1, carpetLen / 6),
    new THREE.MeshPhongMaterial({ map: surfaces.carpet(), shininess: 2, specular: 0x000000 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.01, (N.z1 + N.rail) / 2); scene.add(carpet);

  // walls and ceiling (the facade closes the front)
  stoneBox(0.4, NAVE_H, N.z1 - N.z0 + 0.4, wallM, N.x0 - 0.2, NAVE_H / 2, (N.z0 + N.z1) / 2);
  const NW = N.x1 - N.x0;
  stoneBox(NW + 0.8, NAVE_H, 0.4, wallM, 0, NAVE_H / 2, N.z0 - 0.2);
  // the vault: ribs and a gilded boss over every bay, lit softly from below (unlit material: the
  // lamps are too far down to light it, and a black ceiling made the nave feel like a box)
  const vaultGeo = tileUV(new THREE.BoxGeometry(NW + 0.8, 0.4, N.z1 - N.z0 + 0.4), (NW + 0.8) / 6.4, (N.z1 - N.z0 + 0.4) / 6.4);
  const vault = add(new THREE.Mesh(vaultGeo, new THREE.MeshBasicMaterial({ map: surfaces.vault(), color: 0xa89884 })), true);
  vault.position.set(0, NAVE_H + 0.2, (N.z0 + N.z1) / 2);
  // the front beside the facade: the nave is wider than the facade
  for (const s of [-1, 1]) {
    const w = N.x1 - FACADE_HALF + 0.4;
    stoneBox(w, NAVE_H, 0.4, wallM, s * (FACADE_HALF + w / 2 - 0.2), NAVE_H / 2, N.z1 + 0.2);
  }
  // right wall, shared with the confession hall, open at the side door
  const D = SIDE_DOOR, wallZ1 = CONFESSION_HALL.z1 + 0.4;
  stoneBox(0.6, NAVE_H, D.z0 - N.z0, wallM, D.x, NAVE_H / 2, (N.z0 + D.z0) / 2);
  stoneBox(0.6, NAVE_H, wallZ1 - D.z1, wallM, D.x, NAVE_H / 2, (D.z1 + wallZ1) / 2);
  // over the side door: shaded like the rest of the wall (its own height is shorter); the arch
  // above the square opening is solid, with the room's name in it (nave-dress.js draws the portal)
  const DOOR_TOP = D.h - 1.1;
  const lintel = stoneBox(0.6, NAVE_H - DOOR_TOP, D.z1 - D.z0, wallM, D.x, DOOR_TOP + (NAVE_H - DOOR_TOP) / 2, (D.z0 + D.z1) / 2);
  lintel.geometry = heightShade(lintel.geometry, NAVE_H - DOOR_TOP, 0.85, 0.5);
  const overDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: sign('고해소', '고해성사 21칸', 280, 70) }));
  overDoor.rotation.y = -Math.PI / 2; overDoor.position.set(D.x - 0.34, DOOR_TOP + 0.45, (D.z0 + D.z1) / 2); scene.add(overDoor);
  const backPlate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: sign('본당', '나가는 문', 280, 70) }));
  backPlate.rotation.y = Math.PI / 2; backPlate.position.set(D.x + 0.34, DOOR_TOP + 0.45, (D.z0 + D.z1) / 2); scene.add(backPlate);

  // things that never move here (windows, columns, pews) are merged into a few draw calls
  const still = new THREE.Group();
  scene.add(still);

  // tall coloured windows between the columns: blue on the left, warm on the right, as in Barcelona
  const BAY = 6.4;
  const bays = [];
  for (let z = 8; z > N.rail + 1; z -= BAY) bays.push(z);
  // pointed arches of leaded glass in a carved stone frame; the light they let in falls across
  // the floor as coloured shafts and pools (additive, no lights: cheap on phones)
  const leaded = makeLeadedGlass();
  const blueGlass = new THREE.MeshBasicMaterial({ map: leaded, color: 0xa8c2ff });
  const warmGlass = new THREE.MeshBasicMaterial({ map: leaded, color: 0xffcf9a });
  const WW = 2.2, WH = 7.4;   // window width, height (with the arch)
  const winShape = new THREE.Shape();
  winShape.moveTo(-WW / 2, 0); winShape.lineTo(WW / 2, 0); winShape.lineTo(WW / 2, WH - WW * 0.8);
  winShape.quadraticCurveTo(WW / 2, WH - 0.3, 0, WH); winShape.quadraticCurveTo(-WW / 2, WH - 0.3, -WW / 2, WH - WW * 0.8);
  winShape.lineTo(-WW / 2, 0);
  const winGeo = new THREE.ShapeGeometry(winShape, 10);
  const wuv = winGeo.attributes.uv;
  for (let i = 0; i < wuv.count; i++) wuv.setXY(i, (wuv.getX(i) + WW / 2) / WW, wuv.getY(i) / WH);
  const winFrameGeo = new THREE.ShapeGeometry(winShape, 10).scale(1.22, 1.06, 1);
  const winFrameM = M(0x9c8668, { shininess: 6 });
  const shaftM = (c) => new THREE.MeshBasicMaterial({ map: surfaces.shaft(), color: c, transparent: true, opacity: 0.3,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const poolM = (c) => new THREE.MeshBasicMaterial({ map: surfaces.pool(), color: c, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const light = new THREE.Group();   // shafts and pools, merged at the end
  /** The shaft from a window at x = wx (facing +dir in x) down to the floor, and its pool. */
  const shaft = (wx, dir, z, c) => {
    const top = 9.4, bot = 2.6, reach = 7.5;   // from the glass down and across the nave
    const geo = new THREE.PlaneGeometry(1, 1);
    const P = geo.attributes.position;
    // vertices of a PlaneGeometry: 0 top left, 1 top right, 2 bottom left, 3 bottom right
    P.setXYZ(0, wx, top, z - WW * 0.42); P.setXYZ(1, wx, top, z + WW * 0.42);
    P.setXYZ(2, wx + dir * reach, 0.02, z - WW * 0.6 - 1.2); P.setXYZ(3, wx + dir * reach, 0.02, z + WW * 0.6 - 1.2);
    geo.computeVertexNormals();
    light.add(new THREE.Mesh(geo, shaftM(c)));
    const geo2 = geo.clone(); const P2 = geo2.attributes.position;   // a second, steeper sheet for depth
    P2.setXYZ(0, wx, bot + 4, z - WW * 0.4); P2.setXYZ(1, wx, bot + 4, z + WW * 0.4);
    P2.setXYZ(2, wx + dir * reach * 0.6, 0.02, z - WW * 0.5 - 0.6); P2.setXYZ(3, wx + dir * reach * 0.6, 0.02, z + WW * 0.5 - 0.6);
    light.add(new THREE.Mesh(geo2, shaftM(c)));
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.4), poolM(c));
    pool.rotation.x = -Math.PI / 2; pool.position.set(wx + dir * reach * 0.82, 0.025, z - 1.0); light.add(pool);
  };
  for (const zc of bays.slice(0, -1)) {
    const z = zc - BAY / 2;
    const fl = new THREE.Mesh(winFrameGeo, winFrameM); fl.rotation.y = Math.PI / 2; fl.position.set(N.x0 + 0.005, 2.7 - 0.2, z); still.add(fl);
    const l = new THREE.Mesh(winGeo, blueGlass);
    l.rotation.y = Math.PI / 2; l.position.set(N.x0 + 0.015, 2.7, z); still.add(l);
    shaft(N.x0 + 0.05, 1, z, 0x7fa4ff);
    if (z < D.z0 - 1.5 || z > D.z1 + 1.5) {
      const fr = new THREE.Mesh(winFrameGeo, winFrameM); fr.rotation.y = -Math.PI / 2; fr.position.set(D.x - 0.305, 2.7 - 0.2, z); still.add(fr);
      const r = new THREE.Mesh(winGeo, warmGlass);
      r.rotation.y = -Math.PI / 2; r.position.set(D.x - 0.315, 2.7, z); still.add(r);
      shaft(D.x - 0.35, -1, z, 0xffb070);
    }
  }
  scene.add(light);
  mergeStatic(light);
  light.children.forEach((m) => { m.renderOrder = 2; });
  // dust drifting in the light: one draw call, moved in the vertex shader by time
  const DUST = 420;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = N.x0 + 1 + Math.random() * (NW - 2);
    dustPos[i * 3 + 1] = 0.5 + Math.random() * 9;
    dustPos[i * 3 + 2] = N.rail + Math.random() * (N.z1 - N.rail);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustM = new THREE.PointsMaterial({ map: surfaces.pool(), color: 0xffe9c0, size: 0.07, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  dustM.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = dustTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float ph = position.x * 1.7 + position.z * 0.9;
      transformed.y = mod(position.y + uTime * 0.05 + sin(ph) * 0.4, 9.0) + 0.5;
      transformed.x += sin(uTime * 0.21 + ph) * 0.35;
      transformed.z += cos(uTime * 0.17 + ph * 1.3) * 0.35;`);
  };
  const dustTime = { value: 0 };
  const dust = new THREE.Points(dustGeo, dustM);
  dust.frustumCulled = false;
  scene.add(dust);
  // light along the nave
  [[-9, 0, 0x8fb0ff], [9, -8, 0xffb070], [0, -20, 0xffe2b0], [-9, -31, 0x8fb0ff], [9, -40, 0xffb070]].forEach(([x, z, c]) => {
    const l = new THREE.PointLight(c, 0.7, 26); l.position.set(x, 8.5, z); scene.add(l);
  });


  const pewM = new THREE.MeshPhongMaterial({ map: surfaces.wood(), shininess: 40, specular: 0x2a1c10 });
  // pews: two blocks facing the altar, eight seats each, from behind the entrance hall to the
  // candles (15 rows, 240 seats)
  const pewKnobM = M(0xd9b45e, { shininess: 110 });
  for (let r = 0; ; r++) {
    const zr = NARTHEX_Z - 1.8 - r * 1.9;
    if (zr < N.rail + 13) break;
    for (const s of [-1, 1]) {
      const xa = s * 2.2, xb = s * 11.4, cx = (xa + xb) / 2, len = Math.abs(xb - xa);
      const seat = new THREE.Mesh(tileUV(new THREE.BoxGeometry(len, 0.08, 0.45), len / 3, 1), pewM); seat.position.set(cx, 0.45, zr + 0.02); still.add(seat);
      const back = new THREE.Mesh(tileUV(new THREE.BoxGeometry(len, 0.5, 0.07), len / 3, 1), pewM); back.position.set(cx, 0.78, zr + 0.28); still.add(back);
      for (const e of [xa, xb]) {
        const end = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.62), darkWoodM); end.position.set(e, 0.5, zr + 0.05); still.add(end);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), pewKnobM); knob.position.set(e, 1.04, zr + 0.3); still.add(knob);
      }
      obstacles.push({ box: true, x0: Math.min(xa, xb) - 0.05, x1: Math.max(xa, xb) + 0.05, z0: zr + 0.08, z1: zr + 0.34 });
      for (let i = 0; i < 8; i++) {
        const k = (i + 0.5) / 8;
        const x = xa + (xb - xa) * k;
        seats.push({ seat: new THREE.Vector3(x, 0, zr - 0.02), rot: Math.PI, front: new THREE.Vector3(x, 0, zr - 0.7) });
      }
    }
  }
  mergeStatic(still);

  // sanctuary: raised floor behind a rail, altar, canopy and cross
  add(new THREE.Mesh(tileUV(new THREE.BoxGeometry(NW, 0.3, N.rail - N.z0), NW / 4, (N.rail - N.z0) / 4), marbleM))
    .position.set(0, 0.15, (N.rail + N.z0) / 2);
  const railPosts = new THREE.Group(); scene.add(railPosts);
  for (let x = N.x0 + 0.7; x <= N.x1 - 0.69; x += 0.6) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.07), goldM); p.position.set(x, 0.4, N.rail); railPosts.add(p); }
  mergeStatic(railPosts);
  box(NW - 1.3, 0.08, 0.16, darkWoodM, 0, 0.84, N.rail);
  obstacles.push({ box: true, x0: N.x0, x1: N.x1, z0: N.z0, z1: N.rail + 0.3 });
  const AZ = N.rail - 3.3;   // the altar, 3.3 m behind the rail
  box(3.2, 1.05, 1.2, M(0xe9e2d0), 0, 0.3 + 0.52, AZ);
  box(3.3, 0.06, 1.25, M(0xf7f2e6), 0, 0.3 + 1.07, AZ);
  box(3.32, 0.35, 0.02, M(0xb02a24), 0, 0.3 + 0.9, AZ + 0.63);
  const altarFlames = [];
  for (const x of [-1.2, 1.2]) {
    box(0.1, 0.5, 0.1, M(0xfaf6ea), x, 1.65, AZ);
    const f = new THREE.Sprite(flameMaterial()); f.scale.set(0.16, 0.26, 1); f.position.set(x, 2.0, AZ); scene.add(f);
    altarFlames.push(f);
  }
  // the cross in the middle niche of the altarpiece; the altarpiece, the baldachin over the altar,
  // the arcade, the chandeliers, the rose window and the signpost are in nave-dress.js
  box(0.36, 4.6, 0.22, goldM, 0, 4.6, N.z0 + 0.3);
  box(2.4, 0.34, 0.22, goldM, 0, 5.8, N.z0 + 0.3);
  const altarL = new THREE.PointLight(0xffd59a, 1.1, 22); altarL.position.set(0, 6, AZ + 3); scene.add(altarL);
  const dressed = dressNave(scene, { N, H: NAVE_H, bays, BAY, door: D, AZ, obstacles, colliders });

  // holy water fonts by the door: a shell on a short pillar
  const fonts = [];
  for (const s of [-1, 1]) {
    const x = s * 3.2, z = 9.0;
    box(0.3, 0.9, 0.3, M(0xbcae96), x, 0.45, z);
    const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0xe9e2d6, { side: THREE.DoubleSide })));
    shell.position.set(x, 1.05, z);
    const water = add(new THREE.Mesh(new THREE.CircleGeometry(0.36, 28), M(0x7fb4e6, { shininess: 120 })));
    water.rotation.x = -Math.PI / 2; water.position.set(x, 0.98, z);
    obstacles.push({ x, z, r: 0.42 });
    fonts.push(new THREE.Vector3(x, 0, z));
  }

  // votive candles: a rack of 18 in three steps, at the left in front of the rail
  const RZ = N.rail + 1.1;   // candles and offering box stand just in front of the rail
  const rack = new THREE.Group(); rack.position.set(-5.4, 0, RZ); scene.add(rack);
  const rackM = M(0x2a2228);
  for (let row = 0; row < 3; row++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.32), rackM);
    step.position.set(0, 0.75 + row * 0.22, 0.35 - row * 0.3); rack.add(step);
  }
  const legs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.75, 0.9), rackM); legs.position.set(0, 0.37, 0.05); rack.add(legs);
  const candles = [];
  const waxM = M(0xf4efe2), cupM = M(0xb03a2c, { transparent: true, opacity: 0.85 });
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 6; k++) {
      const x = -1.05 + k * 0.42, y = 0.79 + row * 0.22, z = 0.35 - row * 0.3;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.14, 16), cupM); cup.position.set(x, y + 0.07, z); rack.add(cup);
      const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 16), waxM); wax.position.set(x, y + 0.08, z); rack.add(wax);
      const flame = new THREE.Sprite(flameMaterial()); flame.scale.set(0.12, 0.2, 1); flame.position.set(x, y + 0.24, z); flame.visible = false; rack.add(flame);
      candles.push({ flame, until: 0, born: 0, phase: Math.random() * 6 });
    }
  }
  // a few already burning
  [2, 7, 11].forEach((i) => { candles[i].until = Infinity; candles[i].flame.visible = true; });
  const candleL = new THREE.PointLight(0xffb060, 0.3, 7); candleL.position.set(-5.4, 1.8, RZ + 0.8); scene.add(candleL);
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshBasicMaterial({ map: glassTex, color: 0xffe2b0 }));
  icon.rotation.y = Math.PI / 2; icon.position.set(N.x0 + 0.02, 2.6, RZ); scene.add(icon);
  obstacles.push({ box: true, x0: -6.8, x1: -4.0, z0: RZ - 0.55, z1: RZ + 0.55 });

  // offering box on a stand, right of the candles
  const offer = new THREE.Group(); offer.position.set(-3.2, 0, RZ + 0.2); scene.add(offer);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.85, 16), darkWoodM); stand.position.y = 0.42; offer.add(stand);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.42), woodM); chest.position.y = 1.07; offer.add(chest);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), B(0x110c08)); slot.position.y = 1.3; offer.add(slot);
  const offerLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: sign('봉헌함', null, 150, 54) }));
  offerLabel.position.set(0, 1.07, 0.215); offer.add(offerLabel);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16), M(0xe8c35a, { shininess: 120 }));
  coin.rotation.x = Math.PI / 2; coin.visible = false; offer.add(coin);
  let coinT = -1;
  obstacles.push({ x: -3.2, z: RZ + 0.2, r: 0.4 });

  /* ================================================================ confession hall */
  const H = CONFESSION_HALL;
  const hcx = (H.x0 + H.x1) / 2, hcz = (H.z0 + H.z1) / 2, hw = H.x1 - H.x0, hd = H.z1 - H.z0;
  // black and white marble, a 2.4 m slab
  const hallFloor = new THREE.Mesh(tileUV(new THREE.PlaneGeometry(hw, hd), hw / 4.8, hd / 4.8),
    new THREE.MeshPhongMaterial({ map: surfaces.checkMarble(), color: 0xe6ddd2, shininess: 90, specular: 0x5a5048 }));
  hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.set(hcx, 0, hcz); scene.add(hallFloor);
  const hallWallM = new THREE.MeshPhongMaterial({ map: surfaces.darkStone(), vertexColors: true, shininess: 4, specular: 0x111111 });
  stoneBox(hw + 0.8, HALL_H, 0.4, hallWallM, hcx, HALL_H / 2, H.z0 - 0.2, 0.6);
  stoneBox(hw + 0.8, HALL_H, 0.4, hallWallM, hcx, HALL_H / 2, H.z1 + 0.2, 0.6);
  stoneBox(0.4, HALL_H, hd + 0.8, hallWallM, H.x1 + 0.2, HALL_H / 2, hcz, 0.6);
  const hallVault = add(new THREE.Mesh(tileUV(new THREE.BoxGeometry(hw + 0.8, 0.3, hd + 0.8), (hw + 0.8) / 5.8, (hd + 0.8) / 5.8),
    new THREE.MeshBasicMaterial({ map: surfaces.vault(), color: 0x7d6e60 })), true);
  hallVault.position.set(hcx, HALL_H + 0.15, hcz);
  for (let x = H.x0 + 4; x < H.x1 - 2; x += 6) {
    for (let z = H.z0 + 5; z < H.z1 - 3; z += 6.5) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 16), B(0x221a14)); cord.position.set(x, HALL_H - 0.6, z); scene.add(cord);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), B(0xffe1a0)); lamp.position.set(x, HALL_H - 1.25, z); scene.add(lamp);
    }
  }
  // a row of small round windows over the front booths
  for (let k = -3; k <= 3; k++) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.45, 28), new THREE.MeshBasicMaterial({ map: glassTex }));
    w.rotation.y = -Math.PI / 2; w.position.set(H.x1 - 0.01, 5.3, hcz + k * 2.9); scene.add(w);
  }
  const pinkL = new THREE.PointLight(0xff6aa8, 0.8, 18); pinkL.position.set(H.x1 - 3, 4.5, hcz - 6); scene.add(pinkL);
  const hallBlueL = new THREE.PointLight(0x58a6ff, 0.8, 18); hallBlueL.position.set(H.x1 - 3, 4.5, hcz + 6); scene.add(hallBlueL);

  // "신께 알리기": a box with a slot on a stone pedestal, a beam of light falling on it from above
  const ix = H.x0 + 3.4 + 2.9 * 3.5, iz = hcz;
  const inq = new THREE.Group(); inq.position.set(ix, 0, iz); scene.add(inq);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.9, 16), M(0xc9bca4)); ped.position.y = 0.45; inq.add(ped);
  const ballot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), M(0x7a4d2c)); ballot.position.y = 1.2; inq.add(ballot);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.98), goldM); lid.position.y = 1.54; inq.add(lid);
  const islot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.06), B(0x110c08)); islot.position.y = 1.585; inq.add(islot);
  const inqSignTex = sign('신께 알리기', '사이트 문의함', 300, 120);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.32), new THREE.MeshBasicMaterial({ map: inqSignTex }));
    plate.position.set(Math.sin(a) * 0.455, 1.2, Math.cos(a) * 0.455);
    plate.rotation.y = a; inq.add(plate);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, HALL_H, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = HALL_H / 2; inq.add(beam);
  const skylight = new THREE.Mesh(new THREE.CircleGeometry(0.75, 28), B(0xfff6d8)); skylight.rotation.x = Math.PI / 2; skylight.position.y = HALL_H - 0.01; inq.add(skylight);
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ color: 0xfffbef, side: THREE.DoubleSide, transparent: true }));
  letter.visible = false; inq.add(letter);
  let letterT = -1;
  obstacles.push({ x: ix, z: iz, r: 0.95 });

  /* ================================================================ outside shells */
  // seen from the yard, the nave and the hall are stone blocks behind the facade. Single sided
  // planes facing out: from inside they are invisible and the camera's ray passes through them.
  // No plane between the two rooms, so the side door stays open.
  const shellM = new THREE.MeshPhongMaterial({ map: surfaces.stone(), color: 0xd9c7a6, shininess: 6, specular: 0x111111 });
  const outside = (w, h, x, y, z, ry, rx = 0) => {
    const p = new THREE.Mesh(tileUV(new THREE.PlaneGeometry(w, h), w / 4, h / 4), shellM);
    p.position.set(x, y, z); p.rotation.set(rx, ry, 0, 'YXZ'); scene.add(p);
  };
  const HT = HALL_H + 0.8, NT = NAVE_H + 0.9;
  const hx0 = D.x, hx1 = H.x1 + 0.6, hz0 = H.z0 - 0.6, hz1 = H.z1 + 0.6;
  outside(hx1 - hx0, HT, (hx0 + hx1) / 2, HT / 2, hz1, 0);                    // hall, toward the yard
  outside(hx1 - hx0, HT, (hx0 + hx1) / 2, HT / 2, hz0, Math.PI);              // hall, back
  outside(hz1 - hz0, HT, hx1, HT / 2, (hz0 + hz1) / 2, Math.PI / 2);          // hall, far end
  outside(hx1 - hx0, hz1 - hz0, (hx0 + hx1) / 2, HT, (hz0 + hz1) / 2, 0, -Math.PI / 2);   // hall roof
  const nx = D.x + 0.3, nz0 = N.z0 - 0.6, nz1 = N.z1 - 0.1;
  outside(nz1 - nz0, NT, -nx, NT / 2, (nz0 + nz1) / 2, -Math.PI / 2);         // nave, left side
  outside(2 * nx, NT, 0, NT / 2, nz0, Math.PI);                               // nave, back
  for (const s of [-1, 1]) {                                                   // nave front beside the facade
    outside(nx - FACADE_HALF, NT, s * (nx + FACADE_HALF) / 2, NT / 2, N.z1 + 0.45, 0);
  }
  outside(nz1 - nz0, NT - HT, nx, (NT + HT) / 2, (nz0 + nz1) / 2, Math.PI / 2);   // nave, right side above the hall
  outside(hz0 - nz0, HT, nx, HT / 2, (nz0 + hz0) / 2, Math.PI / 2);          // nave, right side behind the hall
  // so the walls are not bare from the path round the cathedral: buttresses and tall arched
  // stained glass windows along every outer wall (merged into a few draw calls)
  const deco = new THREE.Group();
  const archShape = new THREE.Shape();
  archShape.moveTo(-0.6, 0); archShape.lineTo(0.6, 0); archShape.lineTo(0.6, 2.6);
  archShape.absarc(0, 2.6, 0.6, 0, Math.PI, false); archShape.lineTo(-0.6, 0);
  const archGeo = new THREE.ShapeGeometry(archShape, 8);
  // ShapeGeometry uv are in shape units; fit them to 0..1 so the glass pattern shows once
  const uvs = archGeo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, (uvs.getX(i) + 0.6) / 1.2, uvs.getY(i) / 3.2);
  const frameGeo = new THREE.ShapeGeometry(archShape, 8).scale(1.25, 1.12, 1);
  const glassOut = new THREE.MeshBasicMaterial({ map: glassTex, color: 0xb9a8d8 });
  const frameM = M(0x8a7658, { shininess: 6 }), buttM = M(0xa8916c, { shininess: 6 });
  /** Along a wall from (x0, z0) to (x1, z1), outward normal (nx, nz), wall height h. */
  const dress = (x0, z0, x1, z1, ox, oz, h, every = 4.2) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(len / every));
    const ry = Math.atan2(ox, oz);
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, h * 0.82, 0.5), buttM);
      b.position.set(x + ox * 0.25, h * 0.41, z + oz * 0.25); b.rotation.y = ry; deco.add(b);
      obstacles.push({ x: x + ox * 0.3, z: z + oz * 0.3, r: 0.4 });
      if (i === n) continue;
      const m = (i + 0.5) / n, wx = x0 + (x1 - x0) * m, wz = z0 + (z1 - z0) * m;
      const y = Math.max(1.6, h * 0.3), sc = Math.min(1, (h - y - 0.6) / 3.2);
      const f = new THREE.Mesh(frameGeo, frameM); f.position.set(wx + ox * 0.02, y - 0.15, wz + oz * 0.02); f.rotation.y = ry; f.scale.setScalar(sc); deco.add(f);
      const g = new THREE.Mesh(archGeo, glassOut); g.position.set(wx + ox * 0.04, y, wz + oz * 0.04); g.rotation.y = ry; g.scale.setScalar(sc); deco.add(g);
    }
  };
  dress(-nx, nz1 - 1.2, -nx, nz0 + 0.3, -1, 0, NT, 6.4);         // nave, left side
  for (const s of [-1, 1]) dress(s * (FACADE_HALF + 1), N.z1 + 0.45, s * (nx - 0.3), N.z1 + 0.45, 0, 1, NT, 3.4);   // front beside the facade
  dress(-nx + 0.3, nz0, nx - 0.3, nz0, 0, -1, NT, 5.7);          // nave, back
  dress(nx, nz0 + 0.3, nx, hz0 - 0.3, 1, 0, NT, 6.4);            // nave, right side behind the hall
  dress(hx0 + 0.5, hz0, hx1 - 0.3, hz0, 0, -1, HT);              // hall, back
  dress(hx1, hz0 + 0.3, hx1, hz1 - 0.3, 1, 0, HT);               // hall, far end
  dress(hx0 + 0.6, hz1, hx1 - 0.3, hz1, 0, 1, HT);               // hall, toward the yard
  scene.add(deco);
  mergeStatic(deco);
  const roofShape = new THREE.Shape(); roofShape.moveTo(-nx - 0.3, 0); roofShape.lineTo(nx + 0.3, 0); roofShape.lineTo(0, 5); roofShape.closePath();
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: nz1 - nz0, bevelEnabled: false }), M(0x7a5a48));
  roof.position.set(0, NT, nz0); scene.add(roof);

  /* ================================================================ actions */
  const CANDLE_MS = 3 * 60 * 1000;
  return {
    floors: [naveFloor, hallFloor],
    colliders,
    obstacles,
    seats,
    places: {
      candles: new THREE.Vector3(-5.4, 0, N.rail + 2.3),
      fonts,
      offering: new THREE.Vector3(-3.2, 0, N.rail + 2.0),
      inquiry: new THREE.Vector3(ix, 0, iz),
    },
    /** Lights a free candle for three minutes. @returns false if all are burning */
    lightCandle() {
      const now = performance.now();
      const free = candles.filter((c) => c.until < now);
      if (!free.length) return false;
      const c = free[Math.floor(Math.random() * free.length)];
      c.until = now + CANDLE_MS;
      c.born = now;
      c.flame.visible = true;
      return true;
    },
    /** A coin drops into the offering box. */
    dropCoin() { coinT = 0; },
    /** A letter rises from the inquiry box up the beam of light. */
    sendLetter() { letterT = 0; },
    update(dt, t) {
      const now = performance.now();
      dustTime.value = t;
      dressed.update(t);
      let lit = 0;
      for (const c of candles) {
        if (c.flame.visible && c.until < now) c.flame.visible = false;
        if (!c.flame.visible) continue;
        lit++;
        const grow = c.born ? Math.min(1, (now - c.born) / 400) : 1;
        const fl = 1 + Math.sin(t * 13 + c.phase) * 0.12 + Math.sin(t * 7.3 + c.phase * 2) * 0.08;
        c.flame.scale.set(0.12 * grow, 0.2 * fl * grow, 1);
      }
      altarFlames.forEach((f, i) => f.scale.set(0.16, 0.26 * (1 + Math.sin(t * 11 + i * 2) * 0.1), 1));
      candleL.intensity = 0.15 + lit * 0.06 + Math.sin(t * 9) * 0.02;
      if (coinT >= 0) {
        coinT += dt;
        const k = Math.min(1, coinT / 0.55);
        coin.visible = k < 1;
        coin.position.set(0, 1.75 - k * k * 0.5, 0);
        coin.rotation.z = k * 6;
        if (k >= 1) coinT = -1;
      }
      if (letterT >= 0) {
        letterT += dt;
        const k = Math.min(1, letterT / 2.4);
        letter.visible = k < 1;
        letter.position.set(Math.sin(k * 9) * 0.15, 1.7 + k * (HALL_H - 2), 0);
        letter.rotation.y = k * 8;
        letter.material.opacity = 1 - Math.max(0, (k - 0.7) / 0.3);
        beam.material.opacity = 0.12 + 0.18 * Math.sin(k * Math.PI);
        if (k >= 1) { letterT = -1; beam.material.opacity = 0.12; }
      }
    },
  };
}

let flameTex = null;
function flameMaterial() {
  if (!flameTex) {
    flameTex = canvasTex(32, 48, (g) => {
      const r = g.createRadialGradient(16, 30, 1, 16, 28, 16);
      r.addColorStop(0, 'rgba(255,255,220,1)'); r.addColorStop(0.35, 'rgba(255,200,80,.95)');
      r.addColorStop(0.7, 'rgba(255,110,30,.5)'); r.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = r;
      g.beginPath(); g.moveTo(16, 2); g.quadraticCurveTo(30, 30, 16, 46); g.quadraticCurveTo(2, 30, 16, 2); g.fill();
    });
  }
  return new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}
