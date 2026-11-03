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

import { sampleToGrid } from '../src/net/face-import.js';

test('a dark backdrop is removed, the drawing is cropped and keeps flat colours', () => {
  // 100x100: dark backdrop, a 50x50 blue square in the middle with a white dot inside
  const W = 100, px = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) {
    const x = i % W, y = (i - x) / W;
    let c = [27, 23, 33];
    if (x >= 25 && x < 75 && y >= 25 && y < 75) c = [0, 125, 252];
    if (x >= 45 && x < 55 && y >= 45 && y < 55) c = [250, 250, 250];
    if (x % 10 === 0 && c[0] === 27) c = [40, 38, 48];   // grid lines of a screenshot
    px.set([...c, 255], i * 4);
  }
  const out = sampleToGrid(px, W, W);
  const cell = (x, y) => [...out.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  assert.deepEqual(cell(0, 0), [0, 125, 252, 255]);   // cropped: the square fills the grid
  assert.deepEqual(cell(16, 16), [250, 250, 250, 255]);
  const kept = sampleToGrid(px, W, W, { removeBackground: false });
  assert.equal(kept[3], 255);                          // corner kept as backdrop colour
  assert.ok(kept[0] < 60);
});
