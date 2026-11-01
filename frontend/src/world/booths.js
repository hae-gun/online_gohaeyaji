import * as THREE from 'three';
import { M, B, canvasTex } from '../core/three-utils.js';

export const BOOTH_COUNT = 21;

/**
 * The confession hall, right of the nave (see hall.js). Inside measures, in world units.
 * Coming in through the side door you face +x: seven booths on the left wall (z0), seven on the
 * front wall (x1) and seven on the right wall (z1).
 */
export const CONFESSION_HALL = { x0: 9.1, x1: 36.6, z0: -15.4, z1: 10.1 };
const PER_WALL = 7;
const STEP = 2.9;       // booth to booth along a wall
const DEPTH = 2.2;      // booth body, wall to door
const WIDTH = 2.6;      // booth body along the wall
const ENTRY = 3.4;      // free floor between the side door and the first booths

/** Centre, door direction (unit normal into the hall) and rotation of booth i. */
function placement(i) {
  const H = CONFESSION_HALL;
  const zc = (H.z0 + H.z1) / 2;
  const wall = Math.floor(i / PER_WALL), k = i % PER_WALL;
  const firstX = H.x0 + ENTRY + STEP / 2;
  if (wall === 0) return { x: firstX + k * STEP, z: H.z0 + DEPTH / 2, nx: 0, nz: 1, rot: -Math.PI / 2 };           // left, front to back
  if (wall === 1) return { x: H.x1 - DEPTH / 2, z: zc + (k - 3) * STEP, nx: -1, nz: 0, rot: Math.PI };               // front, left to right
  return { x: firstX + (PER_WALL - 1 - k) * STEP, z: H.z1 - DEPTH / 2, nx: 0, nz: -1, rot: Math.PI / 2 };            // right, front to back
}

const LED_ON = 0xff4a3d;
const LED_OFF = 0x2b2422;

/**
 * Twenty-one confessional booths, seven on each of three walls of the confession hall.
 * Booth ids are 0..20; the plate above each door shows id + 1 (1-7 left, 8-14 front, 15-21 right).
 *
 * Each booth exposes:
 *  - spot: where the player stands to open the door
 *  - facing: rotation.y of someone at the spot looking at the door
 *  - box: the body's floor footprint {x0, x1, z0, z1}, for walking
 *  - setOccupied(v): turns the LED on or off (driven by the room client, never by local guesses)
 *  - doorTarget: 0 closed, ~1.3 open; main.js eases the hinge toward it
 */
export function buildBooths(scene, colliders) {
  const booths = [];
  const haloTex = canvasTex(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,90,70,1)'); r.addColorStop(1, 'rgba(255,90,70,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  const woodM = M(0x5b3a24), doorM = M(0x7d5434), goldM = M(0xd4ad55, { shininess: 80 });
  const interiorM = B(0x080605);

  for (let i = 0; i < BOOTH_COUNT; i++) {
    const P = placement(i);
    const g = new THREE.Group();
    g.position.set(P.x, 0, P.z);
    g.rotation.y = P.rot;   // the door is on the group's +x side

    const body = new THREE.Mesh(new THREE.BoxGeometry(DEPTH, 3.4, WIDTH), woodM); body.position.y = 1.7; body.userData.booth = i; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(DEPTH + 0.3, 0.25, WIDTH + 0.3), M(0x4a2e1c)); roof.position.y = 3.5; g.add(roof);
    colliders.push(body, roof);
    const cv = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), goldM); cv.position.set(0.6, 4.0, 0); g.add(cv);
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), goldM); ch.position.set(0.6, 4.13, 0); g.add(ch);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.5), interiorM); dark.rotation.y = Math.PI / 2; dark.position.set(1.105, 1.25, 0); g.add(dark);

    const hinge = new THREE.Group(); hinge.position.set(1.12, 0, -0.6); g.add(hinge);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.5, 1.2), doorM); door.position.set(0.04, 1.25, 0.6); door.userData.booth = i; hinge.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), goldM); knob.position.set(0.12, 1.2, 1.05); hinge.add(knob);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.6), M(0x3a2416)); grille.position.set(0.05, 1.85, 0.6); hinge.add(grille);

    const ledMat = new THREE.MeshBasicMaterial({ color: LED_OFF });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.34), ledMat); led.position.set(1.15, 2.82, 0); g.add(led);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(0.9, 0.6, 1); halo.position.set(1.3, 2.82, 0); halo.visible = false; g.add(halo);

    const plateTex = canvasTex(128, 72, (c, w, h) => {
      c.fillStyle = '#2a1b10'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#d4ad55'; c.font = 'bold 48px serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(i + 1), w / 2, h / 2 + 2);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), new THREE.MeshBasicMaterial({ map: plateTex }));
    plate.rotation.y = Math.PI / 2; plate.position.set(1.13, 3.12, 0); g.add(plate);

    scene.add(g);
    const across = P.nx !== 0;   // body depth runs along x on the front wall
    const hx = across ? DEPTH / 2 : WIDTH / 2, hz = across ? WIDTH / 2 : DEPTH / 2;
    const booth = {
      id: i, group: g, hinge, occupied: false, doorTarget: 0,
      spot: new THREE.Vector3(P.x + P.nx * 1.95, 0, P.z + P.nz * 1.95),
      facing: Math.atan2(-P.nx, -P.nz),
      normal: new THREE.Vector3(P.nx, 0, P.nz),
      box: { x0: P.x - hx, x1: P.x + hx, z0: P.z - hz, z1: P.z + hz },
      setOccupied(v) {
        booth.occupied = v;
        ledMat.color.setHex(v ? LED_ON : LED_OFF);
        halo.visible = v;
      },
    };
    booths.push(booth);
  }
  return booths;
}
