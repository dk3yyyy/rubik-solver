/**
 * The cube logic must agree with the Python solver, otherwise the animated cube
 * shows a different state than the solution text describes. `facelets.json` is
 * generated with rubik-solver-py and holds the facelet string the solver
 * produces for each single move and for a few short sequences.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  FACES,
  FACE_CELLS,
  FACE_COLOURS,
  FACE_NET,
  FACE_NORMALS,
  FACE_ORDER,
  STICKER_COUNT,
  STICKER_PLACEMENTS,
  applyMoveToFacelet,
  applyMovesToFacelet,
  countColours,
  describeApiError,
  describeInputProblems,
  faceletAt,
  faceletFromStickers,
  formatMove,
  invertMove,
  invertSequence,
  moveToRotation,
  normalFromEuler,
  optimizeMoves,
  parseMove,
  rotateVector,
} from '../src/cube-logic.js';

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./facelets.json', import.meta.url), 'utf8'),
);
const SOLVED = fixtures.solved;

const SEQUENCES = {
  sexy: "R U R' U'",
  'tperm-ish': "R U R' U' R' F R2 U' R' U' R U R' F'",
  'double-mix': 'U2 D2 R2 L2 F2 B2',
  scramble1: "L2 D2 L2 B2 D L2 R2 D2 B2 U' F2 U2 B U2 L' B L2 B2 U2 L2 R2 U'",
};

test('every single move matches the solver', () => {
  for (const [move, expected] of Object.entries(fixtures.singleMoves)) {
    assert.equal(applyMoveToFacelet(SOLVED, move), expected, `move ${move}`);
  }
});

test('prime moves are the inverse of their clockwise move', () => {
  for (const face of FACES) {
    const once = applyMoveToFacelet(SOLVED, face);
    assert.equal(applyMoveToFacelet(once, `${face}'`), SOLVED, face);
  }
});

test('double moves match the solver and equal two quarter turns', () => {
  for (const face of FACES) {
    const twice = applyMoveToFacelet(applyMoveToFacelet(SOLVED, face), face);
    assert.equal(twice, fixtures.singleMoves[`${face}2`], face);
  }
});

test('move sequences match the solver', () => {
  for (const [name, expected] of Object.entries(fixtures.sequences)) {
    const moves = SEQUENCES[name].split(' ');
    assert.equal(applyMovesToFacelet(SOLVED, moves), expected, name);
  }
});

test('the previous view of a sequence restores the solved cube', () => {
  const moves = SEQUENCES.scramble1.split(' ');
  const scrambled = applyMovesToFacelet(SOLVED, moves);
  assert.equal(applyMovesToFacelet(scrambled, invertSequence(moves)), SOLVED);
});

test('the facelet grid is a bijection over all 54 stickers', () => {
  const seen = new Set();
  for (const face of FACES) {
    FACE_CELLS[face].forEach((cell, index) => {
      const normal = FACE_NORMALS[face];
      const key = `${cell}|${normal}`;
      assert.ok(!seen.has(key), `duplicate sticker at ${key}`);
      seen.add(key);
      const lookup = faceletAt(cell, normal);
      assert.equal(lookup.face, face);
      assert.equal(lookup.index, index);
    });
  }
  assert.equal(seen.size, 54);
});

test('the U face runs from the back of the cube to the front', () => {
  // Regression: the U rows used to be reversed, mirroring the top face.
  assert.deepEqual(FACE_CELLS.U[0], [-1, 1, -1]);
  assert.deepEqual(FACE_CELLS.U[2], [1, 1, -1]);
  assert.deepEqual(FACE_CELLS.U[6], [-1, 1, 1]);
  assert.deepEqual(FACE_CELLS.U[8], [1, 1, 1]);
});

test('double turns are handled by moveToRotation', () => {
  const rotation = moveToRotation('R2');
  assert.equal(rotation.axis, 'x');
  assert.equal(rotation.quarterTurns, 2);
  assert.equal(moveToRotation('U').quarterTurns, -1);
  assert.equal(moveToRotation("U'").quarterTurns, 1);
});

test('invertMove handles primes and doubles', () => {
  assert.equal(invertMove('R'), "R'");
  assert.equal(invertMove("R'"), 'R');
  assert.equal(invertMove('R2'), 'R2');
});

test('parseMove rejects junk', () => {
  assert.equal(parseMove('X'), null);
  assert.equal(parseMove('R3'), null);
  assert.equal(parseMove(''), null);
  assert.equal(parseMove(null), null);
});

test('formatMove normalises accumulated turns', () => {
  assert.equal(formatMove('R', 1), 'R');
  assert.equal(formatMove('R', 2), 'R2');
  assert.equal(formatMove('R', 3), "R'");
  assert.equal(formatMove('R', 4), '');
  assert.equal(formatMove('R', -1), "R'");
});

test('optimizeMoves cancels and combines same-face turns', () => {
  assert.deepEqual(optimizeMoves(['R', 'R']), ['R2']);
  assert.deepEqual(optimizeMoves(['R', "R'"]), []);
  assert.deepEqual(optimizeMoves(['R', 'R', 'R']), ["R'"]);
  assert.deepEqual(optimizeMoves(['R', 'R2']), ["R'"]);
  assert.deepEqual(optimizeMoves(['R2', 'R2']), []);
  assert.deepEqual(optimizeMoves(['U', 'R', 'U']), ['U', 'R', 'U']);
  assert.deepEqual(optimizeMoves(["U'", 'U']), []);
});

test('optimizeMoves preserves the resulting cube state', () => {
  const moves = SEQUENCES['tperm-ish'].split(' ');
  const optimized = optimizeMoves(moves);
  assert.equal(
    applyMovesToFacelet(SOLVED, optimized),
    applyMovesToFacelet(SOLVED, moves),
  );
});

test('rotateVector turns a right-angle the right way', () => {
  assert.deepEqual(rotateVector([0, 0, 1], 'y', 1), [1, 0, 0]);
  assert.deepEqual(rotateVector([1, 0, 0], 'y', 1), [0, 0, -1]);
  assert.deepEqual(rotateVector([0, 1, 0], 'x', 1), [0, 0, 1]);
  assert.deepEqual(rotateVector([1, 0, 0], 'z', 1), [0, 1, 0]);
  assert.deepEqual(rotateVector([1, 2, 3], 'x', 4), [1, 2, 3]);
});

test('every sticker plane faces outwards', () => {
  // Regression: U and D carried each other's rotation, so both planes faced
  // into the cube and were culled, leaving dark top and bottom faces.
  const round = (n) => Math.round(n * 1000) / 1000;
  for (const { face, position, rotation } of STICKER_PLACEMENTS) {
    const normal = normalFromEuler(rotation).map(round);
    const expected = FACE_NORMALS[face].map(round);
    assert.deepEqual(normal, expected, `sticker ${face}`);

    const offsetMatchesFace = FACE_NORMALS[face].some(
      (component, axis) => component !== 0 && Math.sign(position[axis]) === Math.sign(component),
    );
    assert.ok(offsetMatchesFace, `sticker ${face} is not offset towards its face`);
  }
});

test('the palette names the six cube colours', () => {
  const names = FACE_ORDER.map((face) => FACE_COLOURS[face].name);
  assert.deepEqual(names.sort(), ['blue', 'green', 'orange', 'red', 'white', 'yellow']);
  for (const face of FACE_ORDER) {
    assert.match(FACE_COLOURS[face].hex, /^#[0-9a-f]{6}$/);
  }
});

test('the picker net covers all six faces exactly once', () => {
  assert.equal(FACE_NET.length, 6);
  assert.deepEqual(FACE_NET.map((entry) => entry.face).sort(), [...FACE_ORDER].sort());
  const cells = new Set(FACE_NET.map(({ row, column }) => `${row},${column}`));
  assert.equal(cells.size, 6, 'two faces share a net cell');
});

test('an empty picker reports how many stickers are missing', () => {
  const stickers = new Array(STICKER_COUNT).fill(null);
  assert.equal(describeInputProblems(stickers), '54 stickers left to fill');
  stickers[0] = 'U';
  assert.equal(describeInputProblems(stickers), '53 stickers left to fill');
});

test('a full picker with the wrong colour counts is called out', () => {
  // Red ends up one short, white one over, while blue stays at nine.
  const stickers = SOLVED.split('');
  stickers[9] = 'B';   // a red sticker becomes blue
  stickers[45] = 'U';  // a blue sticker becomes white
  const problems = describeInputProblems(stickers);
  assert.ok(problems.includes('red 8/9'), problems);
  assert.ok(problems.includes('white 10/9'), problems);
});

test('a complete, valid picker reports no problems', () => {
  assert.equal(describeInputProblems(SOLVED.split('')), null);
});

test('countColours tallies each colour', () => {
  const counts = countColours(SOLVED.split(''));
  for (const letter of FACE_ORDER) assert.equal(counts[letter], 9, letter);
  assert.deepEqual(countColours(new Array(STICKER_COUNT).fill(null)), {
    U: 0, R: 0, F: 0, D: 0, L: 0, B: 0,
  });
});

test('an unfilled picker produces a facelet the solver will reject', () => {
  const stickers = new Array(STICKER_COUNT).fill(null);
  stickers[4] = 'U';
  assert.equal(faceletFromStickers(stickers).length, STICKER_COUNT);
  assert.ok(faceletFromStickers(stickers).includes('?'));
});

test('a network failure says the backend is not running', () => {
  const message = describeApiError(new TypeError('Failed to fetch'), 'http://localhost:8000');
  assert.ok(message.includes('Cannot reach the solver backend at http://localhost:8000'), message);
  assert.ok(message.includes('uvicorn main:app'), message);
});

test('a network failure without a known address still explains the fix', () => {
  const message = describeApiError(new TypeError('Failed to fetch'));
  assert.ok(message.includes('on this address'), message);
  assert.ok(message.includes('backend'), message);
});

test('solver errors are passed through unchanged', () => {
  const original = new Error('No solution found within 22 moves');
  assert.equal(describeApiError(original, 'http://localhost:8000'), original.message);
  assert.equal(describeApiError('something odd'), 'something odd');
});
