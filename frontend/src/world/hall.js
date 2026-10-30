import * as THREE from 'three';
import { M, B, canvasTex } from '../core/three-utils.js';

/**
 * The corridor inside the cathedral: checkered floor, walls, roof,
 * hanging lamps and the stained glass window at the far end.
 *
 * Coordinates: the corridor runs along -z. The entrance is at z = 10.7 (see exterior.js),
 * the far wall at z = -43. The walkable strip is |x| <= 2.1.
 */
export function buildHall(scene, glassTex) {
  const colliders = [];

  scene.add(new THREE.HemisphereLight(0xfff0dc, 0x2a2233, 0.75));
  const sun = new THREE.DirectionalLight(0xffe2b8, 0.55);
  sun.position.set(3, 8, 6);
  scene.add(sun);
  const pinkL = new THREE.PointLight(0xff6aa8, 1.1, 22); pinkL.position.set(-2, 4, -36); scene.add(pinkL);
  const blueL = new THREE.PointLight(0x58a6ff, 1.1, 22); blueL.position.set(2, 4, -36); scene.add(blueL);

  const floorTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#6b4a34'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9dcc4'; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 26);
  floorTex.magFilter = THREE.NearestFilter;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 54), new THREE.MeshPhongMaterial({ map: floorTex, shininess: 60 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -16);
  scene.add(floor);

  const wallM = M(0x8c7a68);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 54), wallM);
    w.position.set(s * 5.2, 3.5, -16);
    scene.add(w); colliders.push(w);
  }
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 0.4), wallM);
  backWall.position.set(0, 3.5, -43);
  scene.add(backWall); colliders.push(backWall);

  const glass = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), new THREE.MeshBasicMaterial({ map: glassTex }));
  glass.position.set(0, 3.6, -42.75);
  scene.add(glass);
  const archTop = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 12, 1, false, 0, Math.PI), M(0x5a4636));
  archTop.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  archTop.position.set(0, 6.1, -42.7);
  scene.add(archTop);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(11, 0.3, 54), M(0x2f2533));
  ceiling.position.set(0, 7.1, -16);
  scene.add(ceiling); colliders.push(ceiling);
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 55), M(0x4b3a44));
    r.position.set(s * 2.7, 8.6, -16.2);
    r.rotation.z = -s * 0.55;
    scene.add(r);
  }

  const lampM = new THREE.MeshBasicMaterial({ color: 0xffe1a0 });
  for (let z = 2; z > -40; z -= 8) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), B(0x221a14));
    cord.position.set(0, 6.3, z); scene.add(cord);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampM);
    lamp.position.set(0, 5.5, z); scene.add(lamp);
  }

  return { floor, colliders };
}
