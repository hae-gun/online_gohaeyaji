import * as THREE from 'three';
import { M, B, canvasTex, mergeStatic } from '../core/three-utils.js';
import { CONFESSION_HALL } from './booths.js';

/**
 * Inside the cathedral: the nave you walk into from the main doors, and the confession hall
 * through a side door on the right.
 *
 * Nave (NAVE): pews on both sides of a red carpet, Gaudí-like tree columns, coloured windows,
 * the altar behind a rail under a hanging canopy, a rack of votive candles, an offering box and
 * two holy water fonts by the door. Next to the entrance a sign points right: "고해소 가는 곳".
 *
 * Confession hall (CONFESSION_HALL): 21 booths on three walls (booths.js) and, in the middle,
 * "신께 알리기", the box where people leave questions for the site's admins.
 *
 * Returns floors for tap-to-walk, colliders for the camera, obstacles and seats for walking
 * and sitting, the places people can use (candles, fonts, offering box, inquiry box) and update().
 */
export const NAVE = { x0: -8.5, x1: 8.5, z0: -18.5, z1: 10.2, rail: -11.3 };
export const SIDE_DOOR = { x: 8.8, z0: 3.6, z1: 6.6 };
const NAVE_H = 9;
const HALL_H = 6.5;

export function buildHall(scene, glassTex) {
  const colliders = [];
  const obstacles = [];
  const seats = [];

  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2a2233, 0.75));
  const sun = new THREE.DirectionalLight(0xffe2b8, 0.55);
  sun.position.set(3, 8, 6);
  scene.add(sun);

  const wallM = M(0xcab89a, { shininess: 6 });
  const darkWoodM = M(0x4a2e1c), woodM = M(0x7a4d2c), goldM = M(0xd4ad55, { shininess: 90 });
  const add = (mesh, collide = false) => { scene.add(mesh); if (collide) colliders.push(mesh); return mesh; };
  const box = (w, h, d, m, x, y, z, collide = false) => {
    const b = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), collide);
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
  const tileTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#7d6a55'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#d9cbb0'; g.fillRect(2, 2, 60, 60); g.fillRect(66, 66, 60, 60);
    g.fillStyle = '#c7b796'; g.fillRect(66, 2, 60, 60); g.fillRect(2, 66, 60, 60);
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(8.5, 14.5);
  tileTex.magFilter = THREE.NearestFilter;
  const naveFloor = new THREE.Mesh(new THREE.PlaneGeometry(N.x1 - N.x0, N.z1 - N.z0), new THREE.MeshPhongMaterial({ map: tileTex, shininess: 30 }));
  naveFloor.rotation.x = -Math.PI / 2;
  naveFloor.position.set(0, 0, (N.z0 + N.z1) / 2);
  scene.add(naveFloor);
  // red carpet down the middle
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(1.8, N.z1 - N.rail - 0.4), M(0x8e2a24, { shininess: 4 }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.01, (N.z1 + N.rail) / 2); scene.add(carpet);

  // walls and ceiling (the facade closes the front)
  box(0.4, NAVE_H, N.z1 - N.z0 + 0.4, wallM, N.x0 - 0.2, NAVE_H / 2, (N.z0 + N.z1) / 2, true);
  box(17.8, NAVE_H, 0.4, wallM, 0, NAVE_H / 2, N.z0 - 0.2, true);
  box(17.8, 0.4, N.z1 - N.z0 + 0.4, M(0x2f2533), 0, NAVE_H + 0.2, (N.z0 + N.z1) / 2, true);
  // right wall, shared with the confession hall, open at the side door
  const D = SIDE_DOOR, wallZ1 = CONFESSION_HALL.z1 + 0.4;
  box(0.6, NAVE_H, D.z0 - N.z0, wallM, D.x, NAVE_H / 2, (N.z0 + D.z0) / 2, true);
  box(0.6, NAVE_H, wallZ1 - D.z1, wallM, D.x, NAVE_H / 2, (D.z1 + wallZ1) / 2, true);
  box(0.6, NAVE_H - 3.6, D.z1 - D.z0, wallM, D.x, 3.6 + (NAVE_H - 3.6) / 2, (D.z0 + D.z1) / 2, true);
  for (const s of [-1, 1]) {
    const arch = add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 10, 28, Math.PI), goldM));
    arch.rotation.y = Math.PI / 2; arch.position.set(D.x + s * 0.31, 2.1, (D.z0 + D.z1) / 2); arch.scale.set(1, 1, 1);
  }

  // the way to the booths: a sign right of the entrance, and plates over the side door
  const way = new THREE.Group(); way.position.set(4.6, 0, 8.3); way.rotation.y = -0.25; scene.add(way);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), darkWoodM); post.position.y = 0.75; way.add(post);
  const wayTex = canvasTex(320, 120, (g) => {
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, 320, 120);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 6; g.strokeRect(3, 3, 314, 114);
    g.fillStyle = '#3a2414'; g.font = 'bold 40px sans-serif'; g.textBaseline = 'middle';
    g.fillText('고해소 가는 곳', 22, 60);
    g.fillStyle = '#a3231b';
    g.beginPath(); g.moveTo(258, 32); g.lineTo(304, 60); g.lineTo(258, 88); g.lineTo(258, 72); g.lineTo(232, 72); g.lineTo(232, 48); g.lineTo(258, 48); g.fill();
  });
  const wayBoard = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.64, 0.06),
    [darkWoodM, darkWoodM, darkWoodM, darkWoodM, new THREE.MeshBasicMaterial({ map: wayTex }), darkWoodM]);
  wayBoard.position.y = 1.75; way.add(wayBoard);
  obstacles.push({ x: 4.6, z: 8.3, r: 0.35 });
  const overDoor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshBasicMaterial({ map: sign('고해소 →', null, 240, 50) }));
  overDoor.rotation.y = -Math.PI / 2; overDoor.position.set(D.x - 0.32, 4.1, (D.z0 + D.z1) / 2); scene.add(overDoor);
  const backPlate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), new THREE.MeshBasicMaterial({ map: sign('← 본당', null, 240, 50) }));
  backPlate.rotation.y = Math.PI / 2; backPlate.position.set(D.x + 0.32, 4.1, (D.z0 + D.z1) / 2); scene.add(backPlate);

  // tall coloured windows: blue on the left, warm on the right, as in Barcelona
  for (const z of [5, -1.5, -7.5]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.6), new THREE.MeshBasicMaterial({ map: glassTex, color: 0x9ab8ff }));
    w.rotation.y = Math.PI / 2; w.position.set(N.x0 + 0.01, 4.8, z); scene.add(w);
  }
  for (const z of [-1.5, -7.5]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 4.6), new THREE.MeshBasicMaterial({ map: glassTex, color: 0xffc58a }));
    w.rotation.y = -Math.PI / 2; w.position.set(D.x - 0.31, 4.8, z); scene.add(w);
  }
  const blueL = new THREE.PointLight(0x6f9bff, 0.7, 16); blueL.position.set(-6, 6, 0); scene.add(blueL);
  const warmL = new THREE.PointLight(0xffa860, 0.7, 16); warmL.position.set(6, 6, -3); scene.add(warmL);

  // tree columns: a trunk that branches near the ceiling
  const columnM = M(0xd8cdb8, { shininess: 10 });
  for (const s of [-1, 1]) {
    for (const z of [8, 1.6, -4.6, -10.4]) {
      const x = s * 7.6;
      const trunk = add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 6.2, 16), columnM)); trunk.position.set(x, 3.1, z);
      const knot = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), columnM)); knot.position.set(x, 6.2, z); knot.scale.y = 0.7;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const br = add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 3.4, 16), columnM));
        br.position.set(x + Math.cos(a) * 0.8, 7.6, z + Math.sin(a) * 0.8);
        br.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      obstacles.push({ x, z, r: 0.45 });
    }
  }

  // pews: two blocks, facing the altar; three seats each
  for (let r = 0; r < 9; r++) {
    const zr = 6.6 - r * 1.7;
    for (const s of [-1, 1]) {
      const xa = s * 1.3, xb = s * 6.6, cx = (xa + xb) / 2, len = Math.abs(xb - xa);
      box(len, 0.08, 0.45, woodM, cx, 0.45, zr + 0.02);
      box(len, 0.5, 0.07, woodM, cx, 0.78, zr + 0.28);
      for (const e of [xa, xb]) box(0.08, 0.95, 0.6, darkWoodM, e, 0.47, zr + 0.05);
      obstacles.push({ box: true, x0: Math.min(xa, xb) - 0.05, x1: Math.max(xa, xb) + 0.05, z0: zr + 0.08, z1: zr + 0.34 });
      for (const k of [0.17, 0.5, 0.83]) {
        const x = xa + (xb - xa) * k;
        seats.push({ seat: new THREE.Vector3(x, 0, zr - 0.02), rot: Math.PI, front: new THREE.Vector3(x, 0, zr - 0.7) });
      }
    }
  }

  // sanctuary: raised floor behind a rail, altar, canopy and cross
  box(17, 0.3, N.rail - N.z0, M(0xb9a27a, { shininess: 10 }), 0, 0.15, (N.rail + N.z0) / 2);
  for (let x = -7.8; x <= 7.81; x += 0.6) box(0.07, 0.8, 0.07, goldM, x, 0.4, N.rail);
  box(15.7, 0.08, 0.16, darkWoodM, 0, 0.84, N.rail);
  obstacles.push({ box: true, x0: N.x0, x1: N.x1, z0: N.z0, z1: N.rail + 0.3 });
  box(3.2, 1.05, 1.2, M(0xe9e2d0), 0, 0.3 + 0.52, -14.6);
  box(3.3, 0.06, 1.25, M(0xf7f2e6), 0, 0.3 + 1.07, -14.6);
  box(3.32, 0.35, 0.02, M(0xb02a24), 0, 0.3 + 0.9, -13.97);
  const altarFlames = [];
  for (const x of [-1.2, 1.2]) {
    box(0.1, 0.5, 0.1, M(0xfaf6ea), x, 1.65, -14.6);
    const f = new THREE.Sprite(flameMaterial()); f.scale.set(0.16, 0.26, 1); f.position.set(x, 2.0, -14.6); scene.add(f);
    altarFlames.push(f);
  }
  // the cross on the back wall, under a hanging hexagonal canopy with little bulbs
  box(0.3, 3.6, 0.2, goldM, 0, 4.8, N.z0 + 0.15);
  box(2.0, 0.3, 0.2, goldM, 0, 5.8, N.z0 + 0.15);
  const canopy = new THREE.Group(); canopy.position.set(0, 7.0, -14.6); scene.add(canopy);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 0.5, 16, 1, true), M(0xe8dcc0, { side: THREE.DoubleSide })); canopy.add(can);
  const canTop = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.6, 16), M(0xd4ad55)); canTop.position.y = 0.55; canopy.add(canTop);
  const bulbM = B(0xffe6a0);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), bulbM); b.position.set(Math.cos(a) * 2.05, -0.3, Math.sin(a) * 2.05); canopy.add(b);
  }
  for (const a of [0.5, 2.6, 4.7]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 16), B(0x221a14)); cord.position.set(Math.cos(a) * 1.4, 1.1, Math.sin(a) * 1.4); canopy.add(cord);
  }
  const altarL = new THREE.PointLight(0xffd59a, 0.9, 14); altarL.position.set(0, 5, -13); scene.add(altarL);
  const rose = new THREE.Mesh(new THREE.CircleGeometry(1.4, 28), new THREE.MeshBasicMaterial({ map: glassTex }));
  rose.position.set(0, 7.6, N.z0 + 0.02); scene.add(rose);

  // holy water fonts by the door: a shell on a short pillar
  const fonts = [];
  for (const s of [-1, 1]) {
    const x = s * 2.5, z = 9.0;
    box(0.3, 0.9, 0.3, M(0xbcae96), x, 0.45, z);
    const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0xe9e2d6, { side: THREE.DoubleSide })));
    shell.position.set(x, 1.05, z);
    const water = add(new THREE.Mesh(new THREE.CircleGeometry(0.36, 28), M(0x7fb4e6, { shininess: 120 })));
    water.rotation.x = -Math.PI / 2; water.position.set(x, 0.98, z);
    obstacles.push({ x, z, r: 0.42 });
    fonts.push(new THREE.Vector3(x, 0, z));
  }

  // votive candles: a rack of 18 in three steps, at the left in front of the rail
  const rack = new THREE.Group(); rack.position.set(-5.4, 0, -10.2); scene.add(rack);
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
  const candleL = new THREE.PointLight(0xffb060, 0.3, 7); candleL.position.set(-5.4, 1.8, -9.4); scene.add(candleL);
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshBasicMaterial({ map: glassTex, color: 0xffe2b0 }));
  icon.rotation.y = Math.PI / 2; icon.position.set(N.x0 + 0.02, 2.6, -10.2); scene.add(icon);
  obstacles.push({ box: true, x0: -6.8, x1: -4.0, z0: -10.75, z1: -9.65 });

  // offering box on a stand, right of the candles
  const offer = new THREE.Group(); offer.position.set(-3.2, 0, -10.0); scene.add(offer);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.85, 16), darkWoodM); stand.position.y = 0.42; offer.add(stand);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.42), woodM); chest.position.y = 1.07; offer.add(chest);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), B(0x110c08)); slot.position.y = 1.3; offer.add(slot);
  const offerLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshBasicMaterial({ map: sign('봉헌함', null, 150, 54) }));
  offerLabel.position.set(0, 1.07, 0.215); offer.add(offerLabel);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16), M(0xe8c35a, { shininess: 120 }));
  coin.rotation.x = Math.PI / 2; coin.visible = false; offer.add(coin);
  let coinT = -1;
  obstacles.push({ x: -3.2, z: -10.0, r: 0.4 });

  /* ================================================================ confession hall */
  const H = CONFESSION_HALL;
  const hcx = (H.x0 + H.x1) / 2, hcz = (H.z0 + H.z1) / 2, hw = H.x1 - H.x0, hd = H.z1 - H.z0;
  const checker = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6b4a34'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9dcc4'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  });
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
  checker.repeat.set(hw / 2.4, hd / 2.4);
  checker.magFilter = THREE.NearestFilter;
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(hw, hd), new THREE.MeshPhongMaterial({ map: checker, shininess: 60 }));
  hallFloor.rotation.x = -Math.PI / 2; hallFloor.position.set(hcx, 0, hcz); scene.add(hallFloor);
  const hallWallM = M(0x8c7a68);
  box(hw + 0.8, HALL_H, 0.4, hallWallM, hcx, HALL_H / 2, H.z0 - 0.2, true);
  box(hw + 0.8, HALL_H, 0.4, hallWallM, hcx, HALL_H / 2, H.z1 + 0.2, true);
  box(0.4, HALL_H, hd + 0.8, hallWallM, H.x1 + 0.2, HALL_H / 2, hcz, true);
  box(hw + 0.8, 0.3, hd + 0.8, M(0x2f2533), hcx, HALL_H + 0.15, hcz, true);
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
  const shellM = M(0xb9a37f, { shininess: 6 });
  const outside = (w, h, x, y, z, ry, rx = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), shellM);
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
  dress(-nx, nz1 - 1.2, -nx, nz0 + 0.3, -1, 0, NT);              // nave, left side
  dress(-nx + 0.3, nz0, nx - 0.3, nz0, 0, -1, NT, 5.5);          // nave, back
  dress(nx, nz0 + 0.3, nx, hz0 - 0.3, 1, 0, NT);                 // nave, right side behind the hall
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
      candles: new THREE.Vector3(-5.4, 0, -9.0),
      fonts,
      offering: new THREE.Vector3(-3.2, 0, -9.3),
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
