import * as THREE from 'three';
import { M, B, canvasTex } from '../core/three-utils.js';

/** z of the facade. Everything with z > FACADE_Z is outside. */
export const FACADE_Z = 10.7;

/**
 * Dusk sky, the yard, the path and the cathedral facade with its double doors.
 * Returns the walkable ground meshes (for tap-to-walk), the door leaves (animated in main),
 * and round obstacles (trees, lamp posts, notice board) used for walking collision.
 */
export function buildExterior(scene, { glassTex, colliders }) {
  const FZ = FACADE_Z;

  const skyTex = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#1d1b3d'); gr.addColorStop(0.32, '#4a3866'); gr.addColorStop(0.47, '#a9667a');
    gr.addColorStop(0.5, '#e5a170'); gr.addColorStop(0.53, '#5a4560'); gr.addColorStop(1, '#2a2230');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.position.set(0, 0, 10);
  scene.add(sky);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 80), M(0x3d5638, { shininess: 5 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.01, 51); scene.add(ground);
  const pathM = M(0xb3a58f, { shininess: 10 });
  const path = new THREE.Mesh(new THREE.PlaneGeometry(4, 34), pathM);
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.005, 28); scene.add(path);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.5), pathM);
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.006, 13.4); scene.add(plaza);

  // facade
  const stoneM = M(0xcdbfa6), trimM = M(0x9c8d78), gold = () => M(0xd4ad55, { shininess: 80 });
  const facade = [];
  const add = (mesh, collide = true) => { scene.add(mesh); if (collide) facade.push(mesh); return mesh; };
  [[-4.25, 5, 5.5, 10], [4.25, 5, 5.5, 10], [0, 7, 3, 6]].forEach(([x, y, w, h]) => {
    const p = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.8), stoneM)); p.position.set(x, y, FZ);
  });
  for (const s of [-1, 1]) {
    const bt = add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 10.6, 1.4), trimM)); bt.position.set(s * 7.1, 5.3, FZ + 0.2);
  }
  const gable = add(new THREE.Mesh(new THREE.CylinderGeometry(8.08, 8.08, 0.8, 3), stoneM));
  gable.rotation.x = -Math.PI / 2; gable.scale.z = 0.3; gable.position.set(0, 11.2, FZ);
  const tower = add(new THREE.Mesh(new THREE.BoxGeometry(3, 7, 3), stoneM)); tower.position.set(0, 12.5, 8.4);
  const belfry = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.05), B(0x1a1420)), false); belfry.position.set(0, 14.3, 9.93);
  const spire = add(new THREE.Mesh(new THREE.ConeGeometry(2.25, 4.5, 4), M(0x4b3a44)), false);
  spire.rotation.y = Math.PI / 4; spire.position.set(0, 18.25, 8.4);
  const crossV = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18), gold()), false); crossV.position.set(0, 21, 8.4);
  const crossH = add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.18), gold()), false); crossH.position.set(0, 21.25, 8.4);
  const rose = add(new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), new THREE.MeshBasicMaterial({ map: glassTex })), false);
  rose.position.set(0, 7.4, FZ + 0.41);
  const roseRim = add(new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.12, 4, 16), trimM), false); roseRim.position.set(0, 7.4, FZ + 0.42);
  for (const s of [-1, 1]) {
    const lw = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 2.8), new THREE.MeshBasicMaterial({ map: glassTex })), false);
    lw.position.set(s * 4.3, 5, FZ + 0.41);
  }
  const tymp = add(new THREE.Mesh(new THREE.CircleGeometry(1.5, 12, 0, Math.PI), M(0x5a3d26)), false); tymp.position.set(0, 4, FZ + 0.41);
  colliders.push(...facade);

  // main double doors; main.js swings them open when the player is near
  const mainDoorM = M(0x6a3f22);
  const leafL = new THREE.Group(); leafL.position.set(-1.5, 0, FZ); scene.add(leafL);
  const leafR = new THREE.Group(); leafR.position.set(1.5, 0, FZ); scene.add(leafR);
  const dl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 0.12), mainDoorM); dl.position.set(0.75, 2, 0); leafL.add(dl);
  const dr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 0.12), mainDoorM); dr.position.set(-0.75, 2, 0); leafR.add(dr);
  for (const [leaf, x] of [[leafL, 1.3], [leafR, -1.3]]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), gold()); k.position.set(x, 1.9, 0.12); leaf.add(k);
  }

  const obstacles = [];

  // notice board by the path
  const board = new THREE.Group(); board.position.set(3.4, 0, 15); board.rotation.y = -0.35; scene.add(board);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), M(0x4a2e1c)); post.position.set(s * 0.8, 0.8, 0); board.add(post);
  }
  const boardFace = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.08), M(0x4a2e1c)); boardFace.position.y = 1.75; board.add(boardFace);
  const boardTex = canvasTex(350, 190, (g, w) => {
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, w, 190);
    g.fillStyle = '#3a2414'; g.textAlign = 'center';
    g.font = 'bold 40px serif'; g.fillText('고해야지', w / 2, 58);
    g.font = '24px sans-serif'; g.fillText('24시간 개방', w / 2, 106); g.fillText('고해 내용은 저장되지 않습니다', w / 2, 148);
  });
  const boardTxt = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.95), new THREE.MeshBasicMaterial({ map: boardTex }));
  boardTxt.position.set(0, 1.75, 0.045); board.add(boardTxt);
  obstacles.push({ x: 3.4, z: 15, r: 0.9 });

  // trees
  const leafM = M(0x2f5a33), trunkM = M(0x5a3d26);
  [[-8, 16], [8.5, 18], [-9.5, 24], [7.5, 27], [-7, 33], [9.5, 35], [-10, 41], [6.5, 42], [-4.5, 21], [11, 23]].forEach(([x, z]) => {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.4, 5), trunkM); tr.position.set(x, 0.7, z); scene.add(tr);
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 6), leafM); c1.position.set(x, 2.4, z); scene.add(c1);
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.0, 6), leafM); c2.position.set(x, 3.6, z); scene.add(c2);
    obstacles.push({ x, z, r: 0.75 });
  });

  // lamp posts along the path
  const lampHeadM = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (let z = 17; z < 44; z += 7) for (const s of [-1, 1]) {
    const x = s * 2.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 5), M(0x222026)); pole.position.set(x, 1.3, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.32), lampHeadM); head.position.set(x, 2.75, z); scene.add(head);
    obstacles.push({ x, z, r: 0.3 });
  }

  return { groundMeshes: [ground, path, plaza], leafL, leafR, obstacles };
}
