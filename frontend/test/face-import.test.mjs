// Picture to face code (src/net/face-import.js): the colour reduction, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelsToFace } from '../src/net/face-import.js';
import { validFace, splitFace, FACE_CELLS } from '../src/net/faces.js';

const picture = (colourAt) => {
  const px = new Uint8ClampedArray(FACE_CELLS * 4);
  for (let i = 0; i < FACE_CELLS; i++) px.set(colourAt(i % 32, Math.floor(i / 32)), i * 4);
  return px;
};

test('transparent pixels become empty cells, fixed colours need no own colour', () => {
  const f = pixelsToFace(picture((x) => (x < 16 ? [0, 0, 0, 0] : [0x15, 0x10, 0x10, 255])));
  assert.ok(validFace(f));
  const { grid, picked } = splitFace(f);
  assert.equal(grid[0], '0');
  assert.equal(grid[31], '1');   // 검정
  assert.equal(picked.length, 0);
});

test('other colours get own slots, never more than 8', () => {
  // 32 columns, each its own vivid colour
  const f = pixelsToFace(picture((x) => [(x * 37) % 256, (x * 91) % 256, (x * 53) % 256, 255]));
  assert.ok(validFace(f));
  const { picked } = splitFace(f);
  assert.ok(picked.length >= 1 && picked.length <= 8, `picked ${picked.length}`);
});

test('a few flat colours come through exactly', () => {
  const blue = [0x30, 0x70, 0xe0, 255], green = [0x20, 0xb0, 0x60, 255];
  const f = pixelsToFace(picture((x, y) => (y < 16 ? blue : green)));
  const { grid, picked } = splitFace(f);
  assert.deepEqual(picked.sort(), ['#20b060', '#3070e0']);
  assert.notEqual(grid[0], grid[FACE_CELLS - 1]);
});
