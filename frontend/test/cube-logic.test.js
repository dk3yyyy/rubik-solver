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
  SCAN_FACES,
  STICKER_COUNT,
  STICKER_PLACEMENTS,
  BackendUnreachable,
  applyMoveToFacelet,
  applyMovesToFacelet,
  captureHint,
  countColours,
  describeApiError,
  describeInputProblems,
  describeScanError,
  faceletAt,
  faceletFromStickers,
  formatMove,
  frameIsBlank,
  framesLookIdentical,
  invertMove,
  invertSequence,
  isLocalOrigin,
  movePlaybackState,
  moveToRotation,
  normalFromEuler,
  optimizeMoves,
  parseMove,
  playbackCounterText,
  readApiResponse,
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
  const message = describeApiError(new TypeError('Failed to fetch'), 'http://localhost:8000', 'http://localhost:5173');
  assert.ok(message.includes('Cannot reach the solver backend at http://localhost:8000'), message);
  assert.ok(message.includes('uvicorn main:app'), message);
});

test('a network failure without a known address still explains the fix', () => {
  const message = describeApiError(new TypeError('Failed to fetch'), null, 'http://127.0.0.1:8000');
  assert.ok(message.includes('on this address'), message);
  assert.ok(message.includes('backend'), message);
});

test('a hosted page is told browsers block it, not to start the backend', () => {
  // Telling someone on the GitHub Pages copy to start a backend would be wrong:
  // Chrome denies a public page access to loopback whatever the server sends.
  const message = describeApiError(new TypeError('Failed to fetch'), 'http://localhost:8000', 'https://dk3yyyy.github.io');
  assert.ok(message.includes('hosted copy cannot reach'), message);
  assert.ok(message.includes('http://localhost:8000'), message);
  assert.ok(message.includes('browsers block'), message);
});

test('isLocalOrigin recognises the local addresses', () => {
  for (const origin of ['http://localhost:8000', 'http://127.0.0.1:5173', 'https://localhost', 'http://[::1]:8000']) {
    assert.ok(isLocalOrigin(origin), origin);
  }
  for (const origin of ['https://dk3yyyy.github.io', 'https://example.com', '', null]) {
    assert.ok(!isLocalOrigin(origin), String(origin));
  }
});

test('solver errors are passed through unchanged', () => {
  const original = new Error('No solution found within 22 moves');
  assert.equal(describeApiError(original, 'http://localhost:8000', 'http://localhost:5173'), original.message);
  assert.equal(describeApiError('something odd'), 'something odd');
});

test('a good API reply is parsed', async () => {
  const response = new Response(JSON.stringify({ solution: "R U R'" }), { status: 200 });
  assert.deepEqual(await readApiResponse(response), { solution: "R U R'" });
});

test('a JSON error from our API keeps its own message', async () => {
  const response = new Response(JSON.stringify({ detail: 'Unsolvable cube state' }), {
    status: 422,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(() => readApiResponse(response), /Unsolvable cube state/);
});

test('a static host answering 404 with HTML counts as unreachable', async () => {
  // This is what /api/solve returns on the GitHub Pages copy, and reading it as
  // JSON is what used to surface a parse error to the user.
  const response = new Response('<!DOCTYPE html><title>404</title>', { status: 404 });
  await assert.rejects(() => readApiResponse(response), BackendUnreachable);
});

test('an empty reply counts as unreachable rather than crashing', async () => {
  await assert.rejects(() => readApiResponse(new Response('', { status: 200 })), BackendUnreachable);
});

test('that failure is reported as the hosted-copy problem, not a parse error', async () => {
  const error = await readApiResponse(new Response('<html>404</html>', { status: 404 }))
    .catch((thrown) => thrown);
  const message = describeApiError(error, null, 'https://dk3yyyy.github.io');
  assert.ok(message.includes('hosted copy cannot reach'), message);
  assert.ok(!message.toLowerCase().includes('json'), message);
});

test('a 500 from our own API is not mistaken for an unreachable backend', async () => {
  const response = new Response(JSON.stringify({ detail: 'Solver failed' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
  const error = await readApiResponse(response).catch((thrown) => thrown);
  assert.ok(!(error instanceof BackendUnreachable), error.name);
  assert.equal(describeApiError(error, null, 'http://localhost:8000'), 'Solver failed');
});

test('the move you are on is current, the ones behind it are done', () => {
  assert.equal(movePlaybackState(0, 0), 'current');
  assert.equal(movePlaybackState(1, 0), 'pending');
  assert.equal(movePlaybackState(0, 3), 'done');
  assert.equal(movePlaybackState(3, 3), 'current');
  assert.equal(movePlaybackState(4, 3), 'pending');
});

test('exactly one move is current part way through a solution', () => {
  const states = Array.from({ length: 22 }, (_, index) => movePlaybackState(index, 7));
  assert.equal(states.filter((state) => state === 'current').length, 1);
  assert.equal(states.filter((state) => state === 'done').length, 7);
  assert.equal(states.filter((state) => state === 'pending').length, 14);
});

test('nothing is current once the solution has played out', () => {
  const states = Array.from({ length: 5 }, (_, index) => movePlaybackState(index, 5));
  assert.deepEqual(states, ['done', 'done', 'done', 'done', 'done']);
});

test('the counter agrees with the mark on the solution', () => {
  // Both come from the cursor, so a "Move 3/22" counter and a mark on the fourth
  // chip can never appear together.
  for (const cursor of [0, 1, 7, 22]) {
    assert.equal(playbackCounterText(cursor, 22), cursor === 0 ? '0/22 moves' : `Move ${cursor}/22`);
  }
  assert.equal(playbackCounterText(0, 0), '0 moves');
});

test('the scan says which face is next and how to hold it', () => {
  // "3/6 faces captured" left the person working out the order and orientation
  // themselves, which is the step that produces a cube the solver rejects.
  assert.ok(captureHint(0).includes('WHITE'));
  assert.ok(captureHint(0).includes('blue edge up'));
  assert.ok(captureHint(1).includes('RED'));
  assert.ok(captureHint(1).includes('1 captured, 5 to go'));
  assert.ok(captureHint(5).includes('BLUE'));
  assert.ok(captureHint(6).includes('All six'));
});

test('the six faces are listed once each, in the order the scanner wants', () => {
  assert.deepEqual(SCAN_FACES.map((face) => face.letter), ['U', 'R', 'F', 'D', 'L', 'B']);
  assert.equal(new Set(SCAN_FACES.map((face) => face.colour)).size, 6);
  // U and D are the two that are not held white up. If a fixture-driven neighbour
  // ever changes, this is where it shows up.
  assert.equal(SCAN_FACES.filter((face) => face.hold.includes('white edge up')).length, 4);
  assert.ok(SCAN_FACES[0].hold.includes('blue edge up'));
  assert.ok(SCAN_FACES[3].hold.includes('green edge up'));
});

test('a blank camera frame is caught rather than blamed on the lighting', () => {
  assert.equal(frameIsBlank(new Uint8ClampedArray(32 * 32 * 4)), true);
  assert.equal(frameIsBlank(new Uint8ClampedArray(32 * 32 * 4).fill(120)), false);
  assert.equal(frameIsBlank(null), true);
  assert.equal(frameIsBlank(new Uint8ClampedArray(0)), true);
});

test('capturing the same frame twice is caught at the press', () => {
  const white = new Uint8ClampedArray(32 * 32 * 4).fill(240);
  const red = new Uint8ClampedArray(32 * 32 * 4).fill(30);
  red[0] = 200;

  assert.equal(framesLookIdentical(white, new Uint8ClampedArray(32 * 32 * 4).fill(240)), true);
  assert.equal(framesLookIdentical(white, red), false);
  // Nonsense inputs must not be reported as a repeat, or capture would lock up.
  assert.equal(framesLookIdentical(white, null), false);
  assert.equal(framesLookIdentical(white, new Uint8ClampedArray(8)), false);
  assert.equal(framesLookIdentical(new Uint8ClampedArray(0), new Uint8ClampedArray(0)), false);
});

test('a geometry failure carries the holding advice, others pass through', () => {
  const geometry = describeScanError('Detected state is not a solvable cube: Invalid corner piece: those three stickers cannot share a corner.');
  assert.ok(geometry.includes('Invalid corner piece'));
  assert.ok(geometry.includes('U then R, F, D, L, B'));

  const lighting = 'Could not read 2 sticker(s) on face(s) R (2 stickers). Retake those faces straight on and evenly lit.';
  assert.equal(describeScanError(lighting), lighting);
  assert.ok(describeScanError('').length > 0);
  assert.ok(describeScanError(undefined).length > 0);
});
