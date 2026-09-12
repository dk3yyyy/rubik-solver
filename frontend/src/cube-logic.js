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

export function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin || '');
}

/**
 * The six faces the scanner wants, in order, and how to hold the cube for each.
 *
 * The scan reads each image top to bottom as that face's facelet order, so the
 * row at the top of the picture has to be the row the facelet calls first. The
 * neighbours below are taken from the move fixtures, not from memory: U's first
 * row touches B, D's touches F, and the other four touch U.
 */
export const SCAN_FACES = [
  { letter: 'U', colour: 'white', hold: 'white facing the camera, blue edge up' },
  { letter: 'R', colour: 'red', hold: 'red facing the camera, white edge up' },
  { letter: 'F', colour: 'green', hold: 'green facing the camera, white edge up' },
  { letter: 'D', colour: 'yellow', hold: 'yellow facing the camera, green edge up' },
  { letter: 'L', colour: 'orange', hold: 'orange facing the camera, white edge up' },
  { letter: 'B', colour: 'blue', hold: 'blue facing the camera, white edge up' },
];

/**
 * What to tell someone mid-scan. "3/6 faces captured" left them working out for
 * themselves which face was next and which way round to hold it, which is the
 * step that silently produces a cube the solver rejects.
 */
export function captureHint(captured) {
  const next = SCAN_FACES[captured];
  if (!next) return 'All six faces captured, working out the cube...';
  const done = captured === 0 ? '' : `${captured} captured, ${SCAN_FACES.length - captured} to go. `;
  return `${done}Next: ${next.colour.toUpperCase()} centre. Hold the cube ${next.hold}, filling the frame, then press Capture.`;
}

/**
 * A camera stream that has not started paints black, and the scanner then
 * reports stickers it cannot read, which looks like a lighting problem. Catch
 * the blank frame instead of blaming the light.
 */
export function frameIsBlank(pixels) {
  if (!pixels || pixels.length < 4) return true;
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    total += pixels[i] + pixels[i + 1] + pixels[i + 2];
  }
  return total / ((pixels.length / 4) * 3) < 8;
}

/**
 * Scan failures come back as geometry: "Invalid corner piece", "Face U appears 8
 * times". Add what to do about it, since the cause is nearly always how the cube
 * was held.
 */
export function describeScanError(message) {
  const text = (message || '').trim();
  if (!text) return 'The scan could not be read.';
  if (/not a solvable cube|Invalid (corner|edge) piece|appears \d+ times/i.test(text)) {
    return `${text} Check the order, U then R, F, D, L, B, and that each face fills the frame straight on.`;
  }
  return text;
}

/**
 * How a move in the solution list reads against the playback cursor.
 *
 * The cursor is the index of the move to play next, so it is the move the person
 * should be turning right now. Everything before it is done, everything after is
 * still to come. Following along by counting tokens in a 21 move string is the
 * step people get wrong.
 */
export function movePlaybackState(index, cursor) {
  if (index < cursor) return 'done';
  if (index === cursor) return 'current';
  return 'pending';
}

/**
 * The counter beside the cube. Derived from the same cursor as the mark on the
 * solution, so the two cannot drift apart.
 */
export function playbackCounterText(cursor, total) {
  if (!total) return '0 moves';
  return cursor === 0 ? `0/${total} moves` : `Move ${cursor}/${total}`;
}

/**
 * The request never reached our API.
 *
 * Distinct from a normal HTTP failure: a static host answers /api/... with its
 * own 404 page, or the connection is refused outright, and neither produces a
 * message worth showing a user.
 */
export class BackendUnreachable extends Error {
  constructor(message = 'Failed to fetch') {
    super(message);
    this.name = 'BackendUnreachable';
  }
}

/**
 * Read an API reply, turning anything that is not our API's JSON into a
 * BackendUnreachable.
 *
 * `response.json()` cannot be called before checking `response.ok`: when the
 * frontend is served by a static host, `/api/solve` comes back as that host's
 * HTML 404 and the parse error is what the user ends up seeing.
 */
export async function readApiResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (data === null) {
    // Not JSON, so this was not our API answering, however the status reads.
    throw new BackendUnreachable();
  }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : null;
    throw new Error(detail || `Server returned ${response.status}`);
  }
  return data;
}

/**
 * Turn a failed API call into something the user can act on.
 *
 * A TypeError out of fetch means the request never reached a server, which has
 * two very different causes. A page served from a public origin cannot reach a
 * loopback backend at all: Chrome gates that behind a permission the app cannot
 * request, so telling someone to "start the backend" would be wrong. Only when
 * the page is itself local is the missing backend the likely explanation.
 */
export function describeApiError(error, where, pageOrigin) {
  const message = (error && error.message) || String(error);
  const unreachable = error instanceof BackendUnreachable
    || /failed to fetch|network\s?error|load failed|fetch failed/i.test(message);
  if (!unreachable) {
    return message;
  }
  if (pageOrigin && !isLocalOrigin(pageOrigin)) {
    return 'This hosted copy cannot reach the solver backend, because browsers block a public '
      + 'page from talking to a service running on your machine. Run the app locally instead: '
      + 'start the backend with "uvicorn main:app" in the backend folder, then open '
      + 'http://localhost:8000, which serves this page and the API together.';
  }
  const location = where ? ` at ${where}` : ' on this address';
  return `Cannot reach the solver backend${location}. `
    + 'Start it with "uvicorn main:app" inside the backend folder, then try again.';
}
