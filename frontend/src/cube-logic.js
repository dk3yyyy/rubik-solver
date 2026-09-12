/**
 * Pure cube logic: move notation, the facelet-to-3D grid mapping, and the
 * rotation a move applies to a layer.
 *
 * Kept free of three.js and the DOM so it can be unit tested with `node --test`
 * and reused by the renderer.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

/** Outward normal of each face in cube space (x right, y up, z towards viewer). */
export const FACE_NORMALS = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/**
 * Grid position of each facelet, in the standard Kociemba facelet order
 * (U1..U9, R1..R9, ...). Derived from the solver library's own corner and edge
 * facelet tables, so the renderer agrees with the solver:
 *
 *   U1 is the back-left corner, U9 the front-right; the U rows run from the
 *   back of the cube to the front. Getting this backwards mirrors the U face.
 */
export const FACE_CELLS = {
  U: [
    [-1, 1, -1], [0, 1, -1], [1, 1, -1],
    [-1, 1, 0], [0, 1, 0], [1, 1, 0],
    [-1, 1, 1], [0, 1, 1], [1, 1, 1],
  ],
  R: [
    [1, 1, 1], [1, 1, 0], [1, 1, -1],
    [1, 0, 1], [1, 0, 0], [1, 0, -1],
    [1, -1, 1], [1, -1, 0], [1, -1, -1],
  ],
  F: [
    [-1, 1, 1], [0, 1, 1], [1, 1, 1],
    [-1, 0, 1], [0, 0, 1], [1, 0, 1],
    [-1, -1, 1], [0, -1, 1], [1, -1, 1],
  ],
  D: [
    [-1, -1, 1], [0, -1, 1], [1, -1, 1],
    [-1, -1, 0], [0, -1, 0], [1, -1, 0],
    [-1, -1, -1], [0, -1, -1], [1, -1, -1],
  ],
  L: [
    [-1, 1, -1], [-1, 1, 0], [-1, 1, 1],
    [-1, 0, -1], [-1, 0, 0], [-1, 0, 1],
    [-1, -1, -1], [-1, -1, 0], [-1, -1, 1],
  ],
  B: [
    [1, 1, -1], [0, 1, -1], [-1, 1, -1],
    [1, 0, -1], [0, 0, -1], [-1, 0, -1],
    [1, -1, -1], [0, -1, -1], [-1, -1, -1],
  ],
};

// Axis and layer each face turns, plus the angle of a single (non-prime,
// non-double) turn. The sign is what a viewer looking at that face calls
// clockwise, so a clockwise U turn is -90 degrees about +Y.
const MOVE_INFO = {
  U: { axis: 'y', layer: 1, base: -Math.PI / 2 },
  D: { axis: 'y', layer: -1, base: Math.PI / 2 },
  R: { axis: 'x', layer: 1, base: -Math.PI / 2 },
  L: { axis: 'x', layer: -1, base: Math.PI / 2 },
  F: { axis: 'z', layer: 1, base: -Math.PI / 2 },
  B: { axis: 'z', layer: -1, base: Math.PI / 2 },
};

export function parseMove(move) {
  if (typeof move !== 'string') return null;
  const text = move.trim();
  if (!text) return null;
  const face = text[0].toUpperCase();
  if (!MOVE_INFO[face]) return null;
  const suffix = text.slice(1);
  let turns = 1;
  if (suffix === "'") turns = -1;
  else if (suffix === '2') turns = 2;
  else if (suffix !== '') return null;
  return { face, suffix, turns };
}

export function formatMove(face, turns) {
  const normalised = ((turns % 4) + 4) % 4;
  if (normalised === 0) return '';
  if (normalised === 1) return face;
  if (normalised === 2) return `${face}2`;
  return `${face}'`;
}

/** Axis, layer and signed angle for a move. Handles primes and doubles. */
export function moveToRotation(move) {
  const parsed = parseMove(move);
  if (!parsed) return null;
  const info = MOVE_INFO[parsed.face];
  // angle drives the three.js rotation; quarterTurns drives the integer grid
  // maths. They must agree in sign, and for a clockwise turn that sign is
  // negative (U is -90 degrees about +Y), while parseMove reports turns = 1.
  // A half turn is the same either way, so keep it positive.
  let quarterTurns = Math.sign(info.base) * parsed.turns;
  if (Math.abs(quarterTurns) === 2) quarterTurns = 2;
  return {
    axis: info.axis,
    layer: info.layer,
    turns: parsed.turns,
    quarterTurns,
    angle: info.base * parsed.turns,
  };
}

export function invertMove(move) {
  const parsed = parseMove(move);
  if (!parsed) return move;
  return formatMove(parsed.face, -parsed.turns);
}

export function invertSequence(moves) {
  return moves.slice().reverse().map(invertMove);
}

/**
 * Rotate an integer grid vector by `quarterTurns` right-angle turns about
 * `axis`. Uses integer arithmetic so positions never drift.
 */
export function rotateVector(vector, axis, quarterTurns) {
  let [x, y, z] = vector;
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < turns; i += 1) {
    if (axis === 'x') {
      [y, z] = [-z, y];
    } else if (axis === 'y') {
      [x, z] = [z, -x];
    } else {
      [x, y] = [-y, x];
    }
  }
  // Adding zero normalises -0 to 0 so grid comparisons stay exact.
  return [x + 0, y + 0, z + 0];
}

/**
 * Where each face's sticker sits on a cubie and how it is rotated.
 *
 * A PlaneGeometry faces +Z, so a sticker must be rotated until its normal
 * points away from the cube. The U and D stickers used to carry each other's
 * rotation, which left both top and bottom planes facing into the cube where
 * backface culling hid them.
 */
export const STICKER_PLACEMENTS = [
  { face: 'U', position: [0, 0.48, 0], rotation: [-Math.PI / 2, 0, 0] },
  { face: 'D', position: [0, -0.48, 0], rotation: [Math.PI / 2, 0, 0] },
  { face: 'F', position: [0, 0, 0.48], rotation: [0, 0, 0] },
  { face: 'B', position: [0, 0, -0.48], rotation: [0, Math.PI, 0] },
  { face: 'R', position: [0.48, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { face: 'L', position: [-0.48, 0, 0], rotation: [0, -Math.PI / 2, 0] },
];

/**
 * The world direction a PlaneGeometry faces after an XYZ Euler rotation,
 * i.e. R = Rx * Ry * Rz applied to (0, 0, 1).
 */
export function normalFromEuler([x, y]) {
  const sinX = Math.sin(x);
  const cosX = Math.cos(x);
  const sinY = Math.sin(y);
  const cosY = Math.cos(y);
  // The + 0 turns -0 into 0 so callers can compare exactly.
  return [sinY + 0, -sinX * cosY + 0, cosX * cosY + 0];
}

/** Which face and facelet index sits at a given grid position and normal. */
export function faceletAt(position, normal) {
  for (const face of FACES) {
    const direction = FACE_NORMALS[face];
    if (direction[0] !== normal[0] || direction[1] !== normal[1] || direction[2] !== normal[2]) {
      continue;
    }
    const index = FACE_CELLS[face].findIndex(
      (cell) => cell[0] === position[0] && cell[1] === position[1] && cell[2] === position[2],
    );
    if (index !== -1) return { face, index, facelet: FACES.indexOf(face) * 9 + index };
  }
  return null;
}

/**
 * Apply one move to a facelet string. This is the same transformation the
 * renderer performs, used to test the mapping against the solver.
 */
export function applyMoveToFacelet(facelet, move) {
  const rotation = moveToRotation(move);
  if (!rotation) return facelet;
  const axisIndex = { x: 0, y: 1, z: 2 }[rotation.axis];
  const next = facelet.split('');
  for (const face of FACES) {
    FACE_CELLS[face].forEach((cell, index) => {
      // Only the turning layer moves; everything else keeps its stickers.
      if (cell[axisIndex] !== rotation.layer) return;
      const normal = FACE_NORMALS[face];
      const target = faceletAt(
        rotateVector(cell, rotation.axis, rotation.quarterTurns),
        rotateVector(normal, rotation.axis, rotation.quarterTurns),
      );
      if (target) next[target.facelet] = facelet[FACES.indexOf(face) * 9 + index];
    });
  }
  return next.join('');
}

export function applyMovesToFacelet(facelet, moves) {
  return moves.reduce((state, move) => applyMoveToFacelet(state, move), facelet);
}

/** Cancel redundant turns between neighbouring moves of the same face. */
export function optimizeMoves(moves) {
  const result = [];
  for (const move of moves) {
    const parsed = parseMove(move);
    if (!parsed) continue;
    const previous = result[result.length - 1];
    if (previous && previous.face === parsed.face) {
      result.pop();
      const turns = (((previous.turns + parsed.turns) % 4) + 4) % 4;
      if (turns !== 0) result.push({ face: parsed.face, turns });
    } else {
      result.push({ face: parsed.face, turns: parsed.turns });
    }
  }
  return result.map(({ face, turns }) => formatMove(face, turns));
}

/**
 * The six sticker colours, in the standard Western scheme: white up, green
 * front, red right, blue back, orange left, yellow down. Single source of
 * truth for the 3D materials and the on-screen picker.
 */
export const FACE_COLOURS = {
  U: { letter: 'U', name: 'white', hex: '#ffffff' },
  R: { letter: 'R', name: 'red', hex: '#b71234' },
  F: { letter: 'F', name: 'green', hex: '#009b48' },
  D: { letter: 'D', name: 'yellow', hex: '#ffd500' },
  L: { letter: 'L', name: 'orange', hex: '#ff5900' },
  B: { letter: 'B', name: 'blue', hex: '#0046ad' },
};

export const STICKER_COUNT = 54;
export const STICKERS_PER_FACE = 9;

/** How a face is labelled in the picker, and where its centre is. */
export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

/**
 * Net layout for the picker: the six faces arranged the way a cube unfolds,
 * so the user can read a physical cube off it.
 *
 *     .  U  .  .
 *     L  F  R  B
 *     .  D  .  .
 */
export const FACE_NET = [
  { face: 'U', row: 1, column: 2 },
  { face: 'L', row: 2, column: 1 },
  { face: 'F', row: 2, column: 2 },
  { face: 'R', row: 2, column: 3 },
  { face: 'B', row: 2, column: 4 },
  { face: 'D', row: 3, column: 2 },
];

/** Count how many stickers of each colour the input holds. */
export function countColours(stickers) {
  const counts = { U: 0, R: 0, F: 0, D: 0, L: 0, B: 0 };
  for (const sticker of stickers) {
    if (sticker && sticker in counts) counts[sticker] += 1;
  }
  return counts;
}

/**
 * Describe what still needs fixing in a partly filled cube, or null when the
 * input has nine stickers of each colour and can be sent to the solver.
 */
export function describeInputProblems(stickers) {
  if (stickers.length !== STICKER_COUNT) {
    return `Expected ${STICKER_COUNT} stickers, got ${stickers.length}`;
  }
  const missing = stickers.filter((sticker) => !sticker).length;
  if (missing) {
    return `${missing} sticker${missing === 1 ? '' : 's'} left to fill`;
  }
  const counts = countColours(stickers);
  const wrong = Object.entries(counts).filter(([, count]) => count !== STICKERS_PER_FACE);
  if (wrong.length) {
    return wrong.map(([letter, count]) => `${FACE_COLOURS[letter].name} ${count}/9`).join(', ');
  }
  return null;
}

export function faceletFromStickers(stickers) {
  return stickers.map((sticker) => sticker || '?').join('');
}

/**
 * Turn a failed API call into something the user can act on.
 *
 * A TypeError out of fetch means the request never reached a server. On a
 * statically hosted copy of the app that almost always means the Python
 * backend is not running, so say so instead of showing "Failed to fetch".
 */
export function describeApiError(error, where) {
  const message = (error && error.message) || String(error);
  if (/failed to fetch|network\s?error|load failed|fetch failed/i.test(message)) {
    const location = where ? ` at ${where}` : ' on this address';
    return `Cannot reach the solver backend${location}. `
      + 'Start it with "uvicorn main:app" inside the backend folder, then try again.';
  }
  return message;
}
