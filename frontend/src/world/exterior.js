import * as THREE from 'three';
import { M, B, canvasTex, mergeStatic } from '../core/three-utils.js';
import { OUTDOOR, TRAILS, TRAIL_HALF, EVENT_FIELD, awayFromPaths } from './layout.js';

/** z of the facade. Everything with z > FACADE_Z is outside. */
export const FACADE_Z = 10.7;
/** Centre of the fountain in the plaza. */
export const FOUNTAIN = { x: 0, z: 22, r: 3.55 };

/**
 * Outside the cathedral, at dusk.
 *
 * The facade is inspired by Gaudí's basilica in Barcelona (Sagrada Família), built crudely from
 * primitives: three portals with "melting" columns and tall pointed gables, a green cypress on top of
 * the central gable, four slender bell towers like corn cobs with spiral window slits and mosaic tips,
 * and a much taller central spire with a gold cross behind them. Original low-poly shapes, no model files.
 *
 * In front: a tiled plaza with a two-tier fountain in the middle, benches around it and along the
 * path (people can sit on them, see emotes.js 'sit'), plane trees, cypresses and lamp posts.
 * Around (world/layout.js): a gravel path all the way round the buildings, two trails through a
 * wood with benches and lamps, and a big event field with a stage at the far end, for events
 * such as 수능 or the year's end (eventField.setBanner changes its banner).
 *
 * Returns: walkable ground meshes (tap-to-walk), the door leaves (animated in main), round obstacles
 * for walking collision, the benches (sit spots) and update(dt, t) for the water.
 */
export function buildExterior(scene, { glassTex, colliders }) {
  const FZ = FACADE_Z;
  const obstacles = [];

  /* ---------------------------------------------------------------- sky */
  const skyTex = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#1d1b3d'); gr.addColorStop(0.3, '#46366a'); gr.addColorStop(0.45, '#a9667a');
    gr.addColorStop(0.5, '#e5a170'); gr.addColorStop(0.53, '#5a4560'); gr.addColorStop(1, '#2a2230');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(170, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.position.set(0, 0, 10);
  scene.add(sky);

  /* ---------------------------------------------------------------- facade */
  // sandy stone with vertical drips, the "melting candle" look of the basilica
  const stoneTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c4ae88'; g.fillRect(0, 0, w, h);
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(120,96,64,.13)' : 'rgba(255,245,220,.16)';
      g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, len = 30 + rnd() * 120, wd = 4 + rnd() * 8;
      g.fillStyle = 'rgba(110,86,58,.22)';
      g.fillRect(x, 0, wd, len);
      g.beginPath(); g.arc(x + wd / 2, len, wd * 0.8, 0, Math.PI * 2); g.fill();
    }
  });
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.repeat.set(2, 2);
  const stoneM = M(0xffffff, { map: stoneTex, shininess: 12 });
  const darkStoneM = M(0x9c8a70, { shininess: 10 });
  const goldM = M(0xd4ad55, { shininess: 90 });
  const facade = [];
  const add = (mesh, collide = false) => { scene.add(mesh); if (collide) facade.push(mesh); return mesh; };

  // main wall with the doorway (x -1.6..1.6, y 0..4.3) left open
  [[-5.8, 6.5, 8.4, 13], [5.8, 6.5, 8.4, 13], [0, 8.65, 3.2, 8.7]].forEach(([x, y, w, h]) => {
    const p = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 1), stoneM), true);
    p.position.set(x, y, FZ);
  });

  // a pointed gable as a thin extruded triangle
  function gable(x, y, w, h, z, depth = 0.6) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    const m = add(new THREE.Mesh(geo, stoneM), true);
    m.position.set(x, y, z - depth / 2);
    return m;
  }
  // a column that looks like dripping wax: stacked spheres getting smaller toward the top
  function meltingColumn(x, z, height, r0) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const s = add(new THREE.Mesh(new THREE.SphereGeometry(r0 * (1 - k * 0.45), 7, 5), stoneM));
      s.scale.y = 1.35;
      s.position.set(x, 0.35 + k * (height - 0.5), z);
    }
    obstacles.push({ x, z, r: r0 + 0.12 });
  }
  // portal arch: half torus, stretched up into a pointed shape
  function arch(x, y, r, z) {
    const a = add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.2, 5, 12, Math.PI), darkStoneM));
    a.position.set(x, y, z);
    a.scale.y = 1.5;
  }

  // central portal (the real entrance)
  meltingColumn(-2.05, FZ + 0.72, 4.4, 0.38);
  meltingColumn(2.05, FZ + 0.72, 4.4, 0.38);
  arch(0, 4.3, 2.05, FZ + 0.62);
  const tymp = add(new THREE.Mesh(new THREE.CircleGeometry(1.55, 14, 0, Math.PI), M(0x5a3d26)));
  tymp.position.set(0, 4.3, FZ + 0.51);
  gable(0, 12.4, 7, 10, FZ);
  // the green cypress on top of the central gable, with white doves on it
  const cypressM = M(0x3f7a4a, { shininess: 20 });
  [[0, 22.6, 1.3, 2.6], [0, 24.4, 1.0, 2.2], [0, 25.9, 0.7, 1.8]].forEach(([x, y, r, h]) => {
    const c = add(new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), cypressM)); c.position.set(x, y, FZ);
  });
  [[-0.7, 23.2, 0.6], [0.8, 23.9, 0.5], [-0.4, 25.2, 0.4], [0.35, 26.2, 0.35]].forEach(([x, y, z]) => {
    const d = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), B(0xf4f1ea))); d.scale.set(1, 0.8, 1.4); d.position.set(x, y, FZ + z);
  });
  // rose window over the door, a smaller one up in the gable
  const rose = add(new THREE.Mesh(new THREE.CircleGeometry(1.7, 18), new THREE.MeshBasicMaterial({ map: glassTex })));
  rose.position.set(0, 9.6, FZ + 0.52);
  const roseRim = add(new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.16, 5, 18), darkStoneM)); roseRim.position.set(0, 9.6, FZ + 0.53);
  const rose2 = add(new THREE.Mesh(new THREE.CircleGeometry(0.85, 14), new THREE.MeshBasicMaterial({ map: glassTex })));
  rose2.position.set(0, 16.4, FZ + 0.32);

  // side portals (closed, decorative)
  for (const s of [-1, 1]) {
    const x = s * 6;
    const door = add(new THREE.Mesh(new THREE.BoxGeometry(2, 3.3, 0.1), M(0x4f2f1a))); door.position.set(x, 1.65, FZ + 0.52);
    meltingColumn(x - 1.45, FZ + 0.66, 3.6, 0.3);
    meltingColumn(x + 1.45, FZ + 0.66, 3.6, 0.3);
    arch(x, 3.3, 1.45, FZ + 0.6);
    gable(x, 12.4, 5, 6.5, FZ);
    const lancet = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3), new THREE.MeshBasicMaterial({ map: glassTex })));
    lancet.position.set(x, 7.6, FZ + 0.52);
  }

  /* bell towers: tall tapering "corn cobs" with spiral window slits and a mosaic tip */
  const mosaicTex = canvasTex(64, 64, (g) => {
    const cols = ['#c0392b', '#e7b52f', '#f4f1ea', '#2e6fd8', '#27ae60', '#e67e22'];
    for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
      g.fillStyle = cols[(x * 7 + y * 3 + ((x * y) >> 4)) % cols.length];
      g.fillRect(x, y, 8, 8);
    }
  });
  const mosaicM = new THREE.MeshPhongMaterial({ map: mosaicTex, shininess: 90, flatShading: true });
  const slit = new THREE.BoxGeometry(0.14, 0.5, 0.1);
  const slitM = B(0x241c22);
  const slits = [];
  function tower(x, z, base, top, r) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      // fat at the bottom, slim at the top, rounded like a cob
      pts.push(new THREE.Vector2(Math.max(0.02, r * (1 - Math.pow(k, 1.8))), base + k * (top - base)));
    }
    const t = add(new THREE.Mesh(new THREE.LatheGeometry(pts.reverse(), 10), stoneM), true);
    t.position.set(x, 0, z);
    const radiusAt = (y) => r * (1 - Math.pow((y - base) / (top - base), 1.8));
    for (let y = base + 3, a = 0; y < top - 3; y += 0.55, a += 0.95) {
      const rr = radiusAt(y);
      slits.push(new THREE.Matrix4().compose(
        new THREE.Vector3(x + Math.sin(a) * rr, y, z + Math.cos(a) * rr),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)),
        new THREE.Vector3(1, 1, 1)));
    }
    const tip = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), mosaicM)); tip.position.set(x, top + 0.3, z);
    const crown = add(new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 6), mosaicM)); crown.position.set(x, top + 1.1, z);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 5, 4), B(0xf4f1ea)));
      ball.position.set(x + Math.sin(a) * 0.55, top + 0.75, z + Math.cos(a) * 0.55);
    }
  }
  tower(-3.3, FZ - 0.35, 9, 35, 1.3);
  tower(3.3, FZ - 0.35, 9, 35, 1.3);
  tower(-7.6, FZ - 0.35, 9, 31, 1.15);
  tower(7.6, FZ - 0.35, 9, 31, 1.15);
  // the tallest spire, further back over the nave, with the gold cross
  tower(0, 3, 9.5, 47, 2.4);   // starts above the nave ceiling
  const crossV = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), goldM)); crossV.position.set(0, 49.8, 3);
  const crossH = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.3), goldM)); crossH.position.set(0, 50.3, 3);
  const slitMesh = new THREE.InstancedMesh(slit, slitM, slits.length);
  slits.forEach((m, i) => slitMesh.setMatrixAt(i, m));
  scene.add(slitMesh);

  colliders.push(...facade);

  // warm uplights wash the facade, as at night in Barcelona
  for (const s of [-1, 1]) {
    const up = new THREE.PointLight(0xffc68a, 0.55, 18); up.position.set(s * 6, 1.2, FZ + 3.5); scene.add(up);
  }
  const spireLight = new THREE.PointLight(0xffd9a8, 0.45, 30); spireLight.position.set(0, 24, FZ + 8); scene.add(spireLight);

  // main double doors; main.js swings them open when the player is near
  const mainDoorM = M(0x6a3f22);
  const leafL = new THREE.Group(); leafL.position.set(-1.5, 0, FZ); scene.add(leafL);
  const leafR = new THREE.Group(); leafR.position.set(1.5, 0, FZ); scene.add(leafR);
  const dl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 0.12), mainDoorM); dl.position.set(0.75, 2, 0); leafL.add(dl);
  const dr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 0.12), mainDoorM); dr.position.set(-0.75, 2, 0); leafR.add(dr);
  for (const [leaf, x] of [[leafL, 1.3], [leafR, -1.3]]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), goldM); k.position.set(x, 1.9, 0.12); leaf.add(k);
  }

  /* ---------------------------------------------------------------- ground and plaza */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 240), M(0x3d5638, { shininess: 5 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(5, -0.01, 40); scene.add(ground);

  const tileTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#6a5a49'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#a8977a'; g.fillRect(1, 1, 30, 30); g.fillRect(33, 33, 30, 30);
    g.fillStyle = '#9a896d'; g.fillRect(33, 1, 30, 30); g.fillRect(1, 33, 30, 30);
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(13, 11.5);
  tileTex.magFilter = THREE.NearestFilter;
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(26, 23), new THREE.MeshPhongMaterial({ map: tileTex, shininess: 8 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.set(0, 0.005, 23); scene.add(plaza);
  // a darker ring of tiles around the fountain
  const inlay = new THREE.Mesh(new THREE.RingGeometry(3.4, 5.6, 32), M(0x6e4a36, { shininess: 4 }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.set(FOUNTAIN.x, 0.009, FOUNTAIN.z); scene.add(inlay);
  const pathTex = tileTex.clone(); pathTex.repeat.set(2, 8); pathTex.needsUpdate = true;
  const path = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 16), new THREE.MeshPhongMaterial({ map: pathTex, shininess: 8 }));
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.006, 42.5); scene.add(path);

  // low hedges along the plaza sides, with gaps: at the front corners (to the path round the
  // cathedral) and in the middle (to the trails)
  const hedgeM = M(0x2f5a33);
  for (const s of [-1, 1]) {
    for (const [z0, z1] of [[17.5, 20], [24, 33.5]]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, z1 - z0), hedgeM); h.position.set(s * 13.2, 0.35, (z0 + z1) / 2); scene.add(h);
      obstacles.push({ box: true, x0: s * 13.2 - 0.4, x1: s * 13.2 + 0.4, z0, z1 });
    }
  }

  /* ---------------------------------------------------------------- fountain */
  const fountain = buildFountain(scene, stoneM, darkStoneM);
  obstacles.push({ x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r, big: true });

  /* ---------------------------------------------------------------- benches */
  const benches = [];
  const woodM = M(0x8a5a34), ironM = M(0x2a2830);
  // things that never move go here and are merged at the end (mergeStatic)
  const furniture = new THREE.Group();
  scene.add(furniture);
  function bench(x, z, rot) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; furniture.add(g);
    for (let i = 0; i < 3; i++) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.15), woodM); sl.position.set(0, 0.45, -0.17 + i * 0.17); g.add(sl);
    }
    for (let i = 0; i < 2; i++) {
      const bk = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.13, 0.04), woodM); bk.position.set(0, 0.66 + i * 0.2, -0.3 - i * 0.03); bk.rotation.x = -0.18; g.add(bk);
    }
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.5), ironM); side.position.set(s * 0.88, 0.225, -0.02); g.add(side);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.5), ironM); arm.position.set(s * 0.92, 0.62, -0.02); g.add(arm);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.05), ironM); back.position.set(s * 0.88, 0.72, -0.33); back.rotation.x = -0.18; g.add(back);
    }
    // two round obstacles along the bench; sit spot slightly in front of the seat
    const ax = Math.cos(rot), az = -Math.sin(rot), fx = Math.sin(rot), fz = Math.cos(rot);
    for (const k of [-0.55, 0.55]) obstacles.push({ x: x + ax * k - fx * 0.05, z: z + az * k - fz * 0.05, r: 0.45 });
    benches.push({ x, z, rot, seat: new THREE.Vector3(x + fx * 0.02, 0, z + fz * 0.02), front: new THREE.Vector3(x + fx * 0.75, 0, z + fz * 0.75) });
  }
  // six around the fountain, facing it (the gaps toward the door and the path are left open)
  for (const deg of [50, 90, 130, 230, 270, 310]) {
    const a = (deg * Math.PI) / 180, R = 7.4;
    bench(FOUNTAIN.x + Math.sin(a) * R, FOUNTAIN.z + Math.cos(a) * R, a + Math.PI);
  }
  // and along the path to the south, facing the path
  for (const z of [38.5, 44.5]) {
    bench(3.4, z, -Math.PI / 2);
    bench(-3.4, z, Math.PI / 2);
  }

  /* ---------------------------------------------------------------- notice board */
  const board = new THREE.Group(); board.position.set(-4.9, 0, 13.6); board.rotation.y = 0.35; scene.add(board);
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
  obstacles.push({ x: -4.9, z: 13.6, r: 0.9 });

  /* ---------------------------------------------------------------- trees */
  const trunkM = M(0x5a3d26);
  const crownMs = [M(0x3a6b3a), M(0x4a7c3c), M(0x2f5a33)];
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // plane tree: short trunk, lumpy round crown
  function planeTree(x, z, size = 1, collide = true) {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * size, 0.24 * size, 2 * size, 6), trunkM); tr.position.set(x, size, z); scene.add(tr);
    const cm = crownMs[Math.floor(rnd() * crownMs.length)];
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * size, 0), cm); c.position.set(x, 2.9 * size, z); c.rotation.y = rnd() * 3; scene.add(c);
    const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05 * size, 0), cm); c2.position.set(x + 0.6 * size, 3.6 * size, z - 0.3 * size); scene.add(c2);
    if (collide) obstacles.push({ x, z, r: 0.5 });
  }
  // cypress: tall, dark and slim, very Mediterranean
  function cypress(x, z, h = 6, collide = true) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.75, h, 7), M(0x24452c)); c.position.set(x, h / 2, z); scene.add(c);
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.6, h * 0.55, 7), M(0x2a5233)); c2.position.set(x, h * 0.62, z); scene.add(c2);
    if (collide) obstacles.push({ x, z, r: 0.6 });
  }
  for (const s of [-1, 1]) {
    for (const z of [14.5, 18.8, 27.2, 31.5]) planeTree(s * 11.6, z, 1);
    cypress(s * 11.6, 12.4, 7.5);
    cypress(s * 12.4, 34.3, 6);
    for (const z of [37, 41.5, 46]) cypress(s * 5.6, z, 5 + rnd() * 1.5);
  }
  buildWood(scene, rnd);

  /* ---------------------------------------------------------------- lamp posts */
  const lampHeadM = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const poleM = M(0x222026);
  function lamp(x, z, collide = true) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 2.8, 6), poleM); pole.position.set(x, 1.4, z); furniture.add(pole);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 6), poleM); cap.position.set(x, 3.25, z); furniture.add(cap);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.3), lampHeadM); head.position.set(x, 2.98, z); furniture.add(head);
    if (collide) obstacles.push({ x, z, r: 0.3 });
  }
  for (const [x, z] of [[-12.3, 25.2], [12.3, 25.2], [-8.5, 33.8], [8.5, 33.8], [-2.8, 13.2], [2.8, 13.2], [-2.6, 41.5], [2.6, 41.5], [-2.6, 48], [2.6, 48]]) lamp(x, z);

  /* ---------------------------------------------------------------- the path round the cathedral */
  const gravelTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#9c8c74'; g.fillRect(0, 0, 64, 64);
    let sd = 5;
    const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 260; i++) { g.fillStyle = r() < 0.5 ? '#8a7a62' : '#b2a38a'; g.fillRect(r() * 64, r() * 64, 2, 2); }
  });
  gravelTex.wrapS = gravelTex.wrapT = THREE.RepeatWrapping;
  const groundMeshes = [ground, plaza, path];
  function flat(w, d, x, z, rotY, tex, y = 0.004) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / 2.5, d / 2.5);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshPhongMaterial({ map: t, shininess: 4 }));
    m.rotation.set(-Math.PI / 2, 0, rotY); m.position.set(x, y, z); scene.add(m);
    groundMeshes.push(m);
    return m;
  }
  for (const r of OUTDOOR) {
    if (r.area !== 'around') continue;
    flat(r.x1 - r.x0, r.z1 - r.z0, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0, gravelTex);
  }
  // lamps along the ring
  for (const [x, z] of [[-17.4, 4], [-17.4, -10], [-10, -26.4], [6, -26.4], [22, -26.4], [42, -10], [42, 4], [26, 16]]) lamp(x, z);

  /* ---------------------------------------------------------------- trails through the wood */
  TRAILS.forEach((t, ti) => {
    for (let i = 0; i < t.length - 1; i++) {
      const [ax, az] = t[i], [bx, bz] = t[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      flat(TRAIL_HALF * 2, len, (ax + bx) / 2, (az + bz) / 2, Math.atan2(dx, dz), gravelTex, 0.003);
      if (i > 0) {
        const joint = new THREE.Mesh(new THREE.CircleGeometry(TRAIL_HALF, 16), new THREE.MeshPhongMaterial({ map: gravelTex, shininess: 4 }));
        joint.rotation.x = -Math.PI / 2; joint.position.set(ax, 0.0035, az); scene.add(joint);
      }
      if (ti === 2) continue;   // the straight path already has its lamps and benches
      // a bench on every other segment, at the trail's edge, facing across it; a lamp opposite
      const nx = dz / len, nz = -dx / len, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const side = i % 2 ? 1 : -1;
      if (i % 2 === 0) bench(mx + nx * side * 1.15, mz + nz * side * 1.15, Math.atan2(-nx * side, -nz * side));
      lamp(mx - nx * side * 1.95, mz - nz * side * 1.95, false);
    }
  });

  /* ---------------------------------------------------------------- the event field */
  const eventField = buildEventField(scene, furniture, obstacles, groundMeshes, bench);
  // benches, lamps and the event field's fittings never move: a few draw calls instead of ~1000
  mergeStatic(furniture);

  return {
    groundMeshes,
    eventField,
    leafL,
    leafR,
    obstacles,
    benches,
    update(dt, t) { fountain.update(dt, t); },
  };
}

/**
 * A wood all around: plane trees and cypresses on every free spot away from the paths, the
 * buildings and the event field. Instanced (5 draw calls for ~200 trees), no collision needed
 * because nobody can walk there.
 */
function buildWood(scene, rnd) {
  const plane = [], cyp = [];
  for (let tries = 0; tries < 2400 && plane.length + cyp.length < 230; tries++) {
    const x = -55 + rnd() * 115, z = -45 + rnd() * 170;
    if (x > -12 && x < 40 && z > -19 && z < 12) continue;    // the buildings
    if (!awayFromPaths(x, z, 2.2)) continue;
    if ([...plane, ...cyp].some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    (rnd() < 0.4 ? cyp : plane).push({ x, z, s: 0.85 + rnd() * 0.6, a: rnd() * 6 });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const inst = (geo, mat, list, place) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => { place(t, v, sc); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.a); im.setMatrixAt(i, m4.compose(v, q, sc)); });
    scene.add(im);
  };
  inst(new THREE.CylinderGeometry(0.16, 0.24, 2, 6), M(0x5a3d26), plane, (t, p, s) => { p.set(t.x, t.s, t.z); s.setScalar(t.s); });
  inst(new THREE.IcosahedronGeometry(1.5, 0), M(0x3f7240), plane, (t, p, s) => { p.set(t.x, 2.9 * t.s, t.z); s.setScalar(t.s); });
  inst(new THREE.IcosahedronGeometry(1.05, 0), M(0x335f36), plane, (t, p, s) => { p.set(t.x + 0.6 * t.s, 3.6 * t.s, t.z - 0.3 * t.s); s.setScalar(t.s); });
  inst(new THREE.ConeGeometry(0.75, 6, 7), M(0x24452c), cyp, (t, p, s) => { p.set(t.x, 3 * t.s, t.z); s.setScalar(t.s); });
  inst(new THREE.ConeGeometry(0.6, 3.3, 7), M(0x2a5233), cyp, (t, p, s) => { p.set(t.x, 3.7 * t.s, t.z); s.setScalar(t.s); });
}

/**
 * The event field: a big paved square with a stage at the far end, string lights all round and
 * two notice boards at the entrance. Empty most of the time; events (수능 응원, 연말) use it.
 * Returns { setBanner(title, sub) } to change what the stage banner says.
 */
function buildEventField(ground, scene, obstacles, groundMeshes, bench) {
  const E = EVENT_FIELD;
  const w = E.x1 - E.x0, d = E.z1 - E.z0, cx = (E.x0 + E.x1) / 2, cz = (E.z0 + E.z1) / 2;
  const paveTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#7c6d5c'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#b9aa8f'; g.fillRect(2, 2, 124, 60); g.fillRect(2, 66, 60, 60); g.fillRect(66, 66, 60, 60);
  });
  paveTex.wrapS = paveTex.wrapT = THREE.RepeatWrapping;
  paveTex.repeat.set(w / 4, d / 4);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshPhongMaterial({ map: paveTex, shininess: 6 }));
  pave.rotation.x = -Math.PI / 2; pave.position.set(cx, 0.005, cz); ground.add(pave);
  groundMeshes.push(pave);
  // a big circle in the middle, room for a tree, a stand or a crowd
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.5, 8.3, 48), M(0x8e2a24, { shininess: 4 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.009, cz - 4); scene.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.9, 40), M(0xd4ad55, { shininess: 30 }));
  ring2.rotation.x = -Math.PI / 2; ring2.position.set(cx, 0.009, cz - 4); scene.add(ring2);

  // stage at the far end, facing the entrance
  const stageM = M(0x4a2e1c), clothM = M(0x8e2a24);
  const stage = new THREE.Mesh(new THREE.BoxGeometry(24, 1, 7), stageM); stage.position.set(cx, 0.5, E.stageZ + 3.5); scene.add(stage);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(24.1, 0.6, 0.05), clothM); skirt.position.set(cx, 0.5, E.stageZ - 0.03); scene.add(skirt);
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(4, 0.33 * (i + 1), 0.6), stageM);
    step.position.set(cx, 0.165 * (i + 1), E.stageZ - 1.8 + i * 0.6); scene.add(step);
  }
  obstacles.push({ box: true, x0: cx - 12.2, x1: cx + 12.2, z0: E.stageZ - 2.2, z1: E.stageZ + 7.2 });
  const frameM = M(0x2a2228);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 0.4), frameM); post.position.set(cx + s * 10, 4.5, E.stageZ + 6); scene.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(20.4, 0.4, 0.4), frameM); beam.position.set(cx, 8, E.stageZ + 6); scene.add(beam);
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 1024; bannerCanvas.height = 256;
  const bannerTex = new THREE.CanvasTexture(bannerCanvas);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(19, 4.75), new THREE.MeshBasicMaterial({ map: bannerTex }));
  banner.rotation.y = Math.PI; banner.position.set(cx, 5.2, E.stageZ + 5.8); scene.add(banner);
  function setBanner(title, sub) {
    const g = bannerCanvas.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#2a1b3d'); gr.addColorStop(1, '#5a2b44');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#d4ad55'; g.lineWidth = 10; g.strokeRect(10, 10, 1004, 236);
    g.fillStyle = '#f3e7c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 84px sans-serif'; g.fillText(title, 512, sub ? 104 : 128);
    if (sub) { g.font = '40px sans-serif'; g.fillStyle = '#d4ad55'; g.fillText(sub, 512, 190); }
    bannerTex.needsUpdate = true;
  }
  setBanner('이벤트 광장', '행사가 있는 날 이곳에서 함께 모입니다');

  // string lights between poles around the field
  const poles = [];
  for (let i = 0; i <= 6; i++) poles.push([E.x0 + 1 + (i * (w - 2)) / 6, E.z0 + 1.5]);
  for (let z = E.z0 + 1.5 + 11; z <= E.stageZ - 3; z += 11) { poles.push([E.x1 - 1, z]); }
  for (let z = E.stageZ - 3; z >= E.z0 + 1.5 + 11; z -= 11) { poles.push([E.x0 + 1, z]); }
  const ordered = [];
  // west side up, entrance row across, east side down
  const west = poles.filter((p) => p[0] === E.x0 + 1 && p[1] > E.z0 + 1.6).sort((a, b) => b[1] - a[1]);
  // none in the middle of the entrance, where the path comes in
  const front = poles.filter((p) => p[1] === E.z0 + 1.5 && Math.abs(p[0] - cx) > 4).sort((a, b) => a[0] - b[0]);
  const east = poles.filter((p) => p[0] === E.x1 - 1 && p[1] > E.z0 + 1.6).sort((a, b) => a[1] - b[1]);
  ordered.push(...west, ...front, ...east);
  const postM = M(0x2a2228);
  const bulbGeo = new THREE.SphereGeometry(0.09, 6, 4);
  const bulbs = [];
  const colours = [0xffd98a, 0xff8a8a, 0x9ad0ff, 0xb6f0a0];
  for (const [x, z] of ordered) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6), postM); p.position.set(x, 2.1, z); scene.add(p);
    obstacles.push({ x, z, r: 0.3 });
  }
  for (let i = 0; i < ordered.length - 1; i++) {
    const [ax, az] = ordered[i], [bx, bz] = ordered[i + 1];
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      bulbs.push([ax + (bx - ax) * t, 4.1 - Math.sin(t * Math.PI) * 0.9, az + (bz - az) * t, colours[(i + k) % colours.length]]);
    }
  }
  for (const c of colours) {
    const mine = bulbs.filter((b) => b[3] === c);
    const im = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: c }), mine.length);
    const m4 = new THREE.Matrix4();
    mine.forEach((b, i) => im.setMatrixAt(i, m4.makeTranslation(b[0], b[1], b[2])));
    scene.add(im);
  }

  // notice boards at the entrance, facing people coming in
  const boardTex = canvasTex(400, 220, (g) => {
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, 400, 220);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 8; g.strokeRect(4, 4, 392, 212);
    g.fillStyle = '#3a2414'; g.textAlign = 'center';
    g.font = 'bold 44px sans-serif'; g.fillText('이벤트 광장', 200, 70);
    g.font = '24px sans-serif'; g.fillText('행사가 있는 날', 200, 125); g.fillText('이곳에서 함께 모입니다', 200, 165);
  });
  for (const s of [-1, 1]) {
    const x = cx + s * 9, z = E.z0 + 3;
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = Math.PI - s * 0.3; scene.add(b);
    for (const t of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.8, 0.12), M(0x4a2e1c)); post.position.set(t * 0.95, 0.9, 0); b.add(post);
    }
    const face = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.25, 0.08), M(0x4a2e1c)); face.position.y = 1.95; b.add(face);
    const txt = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.12), new THREE.MeshBasicMaterial({ map: boardTex }));
    txt.position.set(0, 1.95, 0.045); b.add(txt);
    obstacles.push({ x, z, r: 1.1 });
  }
  // benches along both long sides, facing in
  for (const z of [72, 82, 92]) {
    bench(E.x0 + 2.5, z, Math.PI / 2);
    bench(E.x1 - 2.5, z, -Math.PI / 2);
  }
  return { setBanner };
}

/**
 * Two-tier fountain: a wide stone basin, a pedestal with an upper bowl, a spout on top.
 * Water: the spout arcs into the upper bowl, the bowl spills over into the basin (both particle
 * streams), and rings spread on the basin surface.
 */
function buildFountain(scene, stoneM, darkStoneM) {
  const { x: X, z: Z } = FOUNTAIN;
  const g = new THREE.Group(); g.position.set(X, 0, Z); scene.add(g);

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.3, 0.65, 28), stoneM); basin.position.y = 0.325; g.add(basin);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.17, 6, 28), darkStoneM); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.66; g.add(rim);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.55, 1.6, 10), stoneM); pedestal.position.y = 1.4; g.add(pedestal);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.45, 0.42, 16), stoneM); bowl.position.y = 2.26; g.add(bowl);
  const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(1.27, 0.08, 5, 16), darkStoneM); bowlRim.rotation.x = -Math.PI / 2; bowlRim.position.y = 2.5; g.add(bowlRim);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 0.6, 8), stoneM); stem.position.y = 2.75; g.add(stem);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), darkStoneM); knob.position.y = 3.1; g.add(knob);

  // water surfaces: a rippling texture that drifts
  const waterTex = canvasTex(128, 128, (c) => {
    c.fillStyle = '#3f7fb0'; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(210,235,255,.35)'; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(64, 64, 8 + i * 9, 0, Math.PI * 2); c.stroke(); }
  });
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  const waterM = new THREE.MeshPhongMaterial({ map: waterTex, color: 0x9cc8ee, emissive: 0x16385a, shininess: 120, specular: 0xffffff, transparent: true, opacity: 0.92 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.95, 28), waterM); water.rotation.x = -Math.PI / 2; water.position.y = 0.67; g.add(water);
  const upper = new THREE.Mesh(new THREE.CircleGeometry(1.18, 16), waterM); upper.rotation.x = -Math.PI / 2; upper.position.y = 2.49; g.add(upper);

  // rings spreading on the basin
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 28),
      new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.5, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; r.position.y = 0.68; g.add(r);
    rings.push({ mesh: r, phase: i / 3 });
  }

  // particle streams
  const N = 260;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), kind = new Uint8Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const drops = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8efff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
  g.add(drops);
  function spawn(i) {
    const a = Math.random() * Math.PI * 2;
    if (i % 2 === 0) {       // spout: arcs up and out into the upper bowl
      const sp = 0.55 + Math.random() * 0.35;
      pos.set([0, 3.2, 0], i * 3);
      vel.set([Math.cos(a) * sp, 2.4 + Math.random() * 0.6, Math.sin(a) * sp], i * 3);
      kind[i] = 0;
    } else {                 // overflow: drips from the bowl rim down to the basin
      pos.set([Math.cos(a) * 1.3, 2.45, Math.sin(a) * 1.3], i * 3);
      vel.set([Math.cos(a) * 0.35, -0.2, Math.sin(a) * 0.35], i * 3);
      kind[i] = 1;
    }
  }
  for (let i = 0; i < N; i++) { spawn(i); pos[i * 3 + 1] -= Math.random() * 2; }

  return {
    update(dt, t) {
      waterTex.offset.set(Math.sin(t * 0.3) * 0.05, t * 0.04);
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        vel[k + 1] -= 6.5 * dt;
        pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
        const floor = kind[i] === 0 ? 2.49 : 0.67;
        if (pos[k + 1] < floor) spawn(i);
      }
      geo.attributes.position.needsUpdate = true;
      for (const r of rings) {
        const p = (t * 0.35 + r.phase) % 1;
        r.mesh.scale.setScalar(1.3 + p * 1.6);
        r.mesh.material.opacity = 0.45 * (1 - p);
      }
    },
  };
}
