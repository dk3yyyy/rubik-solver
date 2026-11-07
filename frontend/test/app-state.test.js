/**
 * The app class cannot be started in `node --test` the way a browser starts it:
 * there is no three.js, no WebGL and no markup. These tests import the class
 * with a stub `document` and then exercise the methods on a hand-built `this`,
 * which is enough to pin the state machine and the startup wiring that the
 * pure-cube tests cannot see.
 *
 * Each test here is a regression: the comment says what the page used to do.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// main.js ends with document.addEventListener('DOMContentLoaded', ...), so a
// stub has to exist before the module is imported. Nothing else at module scope
// touches the DOM.
globalThis.document = { addEventListener() {} };

const { App } = await import('../src/main.js');
const { SpeedcubingStats } = await import('../src/speedcubing-stats.js');

const SRC = path.join(import.meta.dirname, '..', 'src');
const MAIN = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** The source of a parameterless class method, braces included. */
function methodBody(text, name) {
  const match = new RegExp(`^  ${name}\\(\\) \\{$`, 'm').exec(text);
  assert.ok(match, `main.js has no ${name}()`);
  const open = text.indexOf('{', match.index);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${name}()`);
}

const init = methodBody(MAIN, 'init');

// ---------------------------------------------------------------------------
// Startup wiring
// ---------------------------------------------------------------------------

test('startup applies a ?s= deep link', () => {
  // Copy Link has always written ?s=<facelet>, but nothing read it on load, so
  // the link opened the page and ignored the cube it carried.
  assert.match(init, /this\.loadDeepLink\(\)/);
});

test('startup paints the stored solve statistics', () => {
  // init() painted the best times but never the ao5/ao12/mo3 card, which stayed
  // empty after a reload even though the times were in localStorage.
  assert.match(init, /this\.updateStatsDisplay\(\)/);
});

test('startup honours the reduced-motion preference', () => {
  // reducedMotion was read in five places and never assigned, so the system
  // setting had no effect and the speed slider stayed live.
  assert.match(init, /this\.initAccessibility\(\)/);
});

test('startup reflects the empty hand-move stack in the Undo button', () => {
  assert.match(init, /this\.updateUndoButton\(\)/);
});

// ---------------------------------------------------------------------------
// Deep link
// ---------------------------------------------------------------------------

test('a deep link fills the facelet field and loads it', () => {
  const previousWindow = globalThis.window;
  const statuses = [];
  let loaded = 0;
  const app = {
    faceletInput: { value: '' },
    setStatus: (message) => statuses.push(message),
    loadFacelet: () => { loaded += 1; },
  };

  globalThis.window = { location: { search: `?s=${SOLVED}` } };
  App.prototype.loadDeepLink.call(app);
  assert.equal(app.faceletInput.value, SOLVED);
  assert.equal(loaded, 1);
  assert.deepEqual(statuses, []);

  // A malformed link says so instead of asking the API to validate 54 chars.
  globalThis.window = { location: { search: '?s=short' } };
  app.faceletInput.value = '';
  App.prototype.loadDeepLink.call(app);
  assert.equal(app.faceletInput.value, '');
  assert.equal(loaded, 1);
  assert.match(statuses[0], /expected 54/);

  globalThis.window = previousWindow;
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

test('the reduced-motion preference stops the cube animating', () => {
  const previousWindow = globalThis.window;
  const durations = [];
  const listeners = [];
  globalThis.window = {
    matchMedia: (query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: (type, listener) => listeners.push(listener),
    }),
  };

  const app = {
    reducedMotion: false,
    speedSlider: { value: '600', disabled: false },
    cube: { setMoveDuration: (ms) => durations.push(ms) },
    updateSpeedLabel() {},
    announce() {},
    applyReducedMotion: App.prototype.applyReducedMotion,
  };

  App.prototype.initAccessibility.call(app);
  assert.equal(app.reducedMotion, true);
  assert.equal(app.speedSlider.disabled, true);
  assert.deepEqual(durations, [0]);
  assert.equal(listeners.length, 1, 'the media query change is followed');

  // Turning the system setting back off restores the chosen speed.
  listeners[0]({ matches: false });
  assert.equal(app.reducedMotion, false);
  assert.equal(app.speedSlider.disabled, false);
  assert.deepEqual(durations, [0, 600]);

  globalThis.window = previousWindow;
});

// ---------------------------------------------------------------------------
// Manual moves and Undo
// ---------------------------------------------------------------------------

test('a hand-turned move is recorded, undoable and tracks the rendered cube', async () => {
  const queued = [];
  const manual = [];
  const app = {
    manualMoveStack: [],
    history: { manual, addMove(move) { manual.push(move); } },
    undoButton: { disabled: true },
    reducedMotion: true,
    currentFacelet: 'BEFORE',
    cube: {
      enqueue: async (move) => { queued.push(move); },
      readFacelet: () => 'AFTER',
    },
    announce() {},
    setStatus() {},
    clearManualMoves: App.prototype.clearManualMoves,
    updateUndoButton: App.prototype.updateUndoButton,
    syncRenderedFacelet: App.prototype.syncRenderedFacelet,
    applyManualMove: App.prototype.applyManualMove,
    undoManualMove: App.prototype.undoManualMove,
  };

  await App.prototype.applyManualMove.call(app, 'R');
  assert.deepEqual(queued, ['R']);
  assert.deepEqual(app.manualMoveStack, ['R']);
  assert.deepEqual(manual, ['R']);
  // The palette repaints from this string, so it must not stay on the state
  // before the move: toggling colourblind mode used to repaint the cube back to
  // solved after a few hand-typed turns.
  assert.equal(app.currentFacelet, 'AFTER');
  assert.equal(app.undoButton.disabled, false);

  await App.prototype.undoManualMove.call(app);
  assert.deepEqual(queued, ['R', "R'"]);
  assert.deepEqual(app.manualMoveStack, []);
  assert.deepEqual(manual, []);
  assert.equal(app.undoButton.disabled, true);

  // Nothing left to take back: the click is a no-op, not an extra turn.
  await App.prototype.undoManualMove.call(app);
  assert.deepEqual(queued, ['R', "R'"]);
});

test('a new cube state clears the hand-move stack', () => {
  const app = {
    manualMoveStack: ['R'],
    history: { manual: ['R'] },
    undoButton: { disabled: false },
    updateUndoButton: App.prototype.updateUndoButton,
    clearManualMoves: App.prototype.clearManualMoves,
  };
  App.prototype.clearManualMoves.call(app);
  assert.deepEqual(app.manualMoveStack, []);
  assert.deepEqual(app.history.manual, []);
  assert.equal(app.undoButton.disabled, true);
});

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

test('finished playback records one time and remembers the rendered cube', async () => {
  const events = [];
  const app = {
    solution: ['R', 'U'],
    currentMoveIndex: 0,
    isPlaying: false,
    reducedMotion: true,
    predictionTimer: null,
    currentFacelet: 'BEFORE',
    cube: {
      enqueue: async (move) => { events.push(move); },
      readFacelet: () => 'AFTER',
    },
    timer: {
      start: () => events.push('clock-start'),
      stop: () => events.push('clock-stop'),
    },
    startTimerDisplay() {},
    stopTimerDisplay() {},
    updatePlaybackDisplay() {},
    verifyRenderedState: () => events.push('verify'),
    saveTime: () => events.push('saved'),
    announce() {},
    clearManualMoves() {},
    syncRenderedFacelet: App.prototype.syncRenderedFacelet,
  };

  await App.prototype.play.call(app);
  assert.deepEqual(
    events,
    ['clock-start', 'R', 'U', 'clock-stop', 'verify', 'saved'],
  );
  assert.equal(app.isPlaying, false);
  assert.equal(app.currentFacelet, 'AFTER');
});

test('a scramble during playback does not record a solve time', async () => {
  const seen = [];
  const app = {
    solution: ['R', 'U'],
    currentMoveIndex: 0,
    isPlaying: false,
    reducedMotion: true,
    predictionTimer: null,
    currentFacelet: 'BEFORE',
    cube: {
      // Scramble's handler empties the solution and stops the loop while this
      // move is still in flight.
      enqueue: async () => {
        app.solution = [];
        app.currentMoveIndex = 0;
        app.isPlaying = false;
      },
      readFacelet: () => 'MID-SCRAMBLE',
    },
    timer: { start() {}, stop() {} },
    startTimerDisplay() {},
    stopTimerDisplay() {},
    updatePlaybackDisplay() {},
    verifyRenderedState: () => seen.push('verify'),
    saveTime: () => seen.push('saved'),
    announce() {},
    clearManualMoves() {},
    syncRenderedFacelet: App.prototype.syncRenderedFacelet,
  };

  await App.prototype.play.call(app);
  // The loop used to fall into its "reached the end" branch because 0 >= 0, and
  // saved a best time and announced a completed solution for a solve the person
  // had already replaced with a scramble.
  assert.deepEqual(seen, []);
  assert.equal(app.currentFacelet, 'BEFORE');
});

// ---------------------------------------------------------------------------
// Optimize
// ---------------------------------------------------------------------------

test('optimizing the history replaces the list that Play follows', () => {
  const statuses = [];
  const app = {
    isPlaying: false,
    currentMoveIndex: 0,
    solution: ['R', 'R', 'U'],
    history: {
      solution: ['R', 'R', 'U'],
      setSolution(moves) { this.solution = moves.slice(); },
    },
    updateHistoryDisplay() {},
    updatePlaybackDisplay() {},
    setStatus: (message) => statuses.push(message),
  };

  App.prototype.optimizeSolution.call(app);
  assert.deepEqual(app.history.solution, ['R2', 'U']);
  // The history is only text; this.solution is what Play follows.
  assert.deepEqual(app.solution, ['R2', 'U']);
  assert.equal(app.currentMoveIndex, 0);
  assert.deepEqual(statuses, ['Optimized: 3 to 2 moves']);
});

test('optimize refuses to move the cursor under a half-played solution', () => {
  const statuses = [];
  const app = {
    isPlaying: false,
    currentMoveIndex: 2,
    solution: ['R', 'U', 'R'],
    history: { solution: ['R', 'U', 'R'], setSolution() { assert.fail('must not replace'); } },
    updateHistoryDisplay() {},
    updatePlaybackDisplay() {},
    setStatus: (message) => statuses.push(message),
  };
  App.prototype.optimizeSolution.call(app);
  assert.match(statuses[0], /before optimizing/);
});

// ---------------------------------------------------------------------------
// A stale solve reply
// ---------------------------------------------------------------------------

test('a solve reply for an entry that has since changed is discarded', async () => {
  const previousFetch = globalThis.fetch;
  const FIRST = 'U'.repeat(54);
  const SECOND = 'R'.repeat(54);
  const picker = { complete: true, facelet: FIRST };
  let resolveFetch;
  globalThis.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });

  const app = {
    cubeInput: { getState: () => ({ ...picker }) },
    faceletInput: { value: '' },
    solution: [],
    solvedState: null,
    currentMoveIndex: 0,
    isPlaying: false,
    solvedInputFacelet: null,
    solveRequestId: 0,
    setStatus() {},
    announce() {},
    clearPrediction() {},
    showPrediction() {},
    updateHistoryDisplay() {},
    updatePlaybackDisplay() {},
    history: { setSolution() {} },
    apiError: (error) => String(error),
  };

  try {
    const pending = App.prototype.solve.call(app);
    // Prediction is debounced, so the entry can change while its request is in
    // flight; the reply is about the old facelet and must not become the
    // solution shown for the new one.
    picker.facelet = SECOND;
    resolveFetch(new Response(JSON.stringify({
      solution: 'R',
      move_count: 1,
      solved_state: SECOND,
    }), { status: 200 }));
    await pending;
    assert.deepEqual(app.solution, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

// ---------------------------------------------------------------------------
// History list semantics
// ---------------------------------------------------------------------------

function makeElement(tagName = 'span') {
  const classes = new Set();
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    dataset: {},
    attributes: {},
    textContent: '',
    children: [],
    setAttribute(name, value) { element.attributes[name] = String(value); },
    appendChild(child) { element.children.push(child); },
    querySelectorAll(selector) {
      if (selector !== '.move-chip') return [];
      return element.children.filter((child) => child.className.split(/\s+/).includes('move-chip'));
    },
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
    },
  };
  return element;
}

test('solution chips are list items and name the current move', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => makeElement(tagName) };
  try {
    const container = makeElement('div');
    App.prototype.renderMoves.call({}, container, ['R', "U'"]);

    // Both history containers are role="list"; children without a role made the
    // list read as empty to assistive technology.
    assert.deepEqual(
      container.children.map((chip) => chip.attributes.role),
      ['listitem', 'listitem'],
    );

    App.prototype.markCurrentMove.call({
      solutionDisplay: container,
      currentMoveIndex: 1,
    });
    assert.equal(container.children[0].attributes['aria-current'], 'false');
    assert.equal(container.children[1].attributes['aria-current'], 'true');
    assert.ok(container.children[0].classList.contains('is-done'));
    assert.ok(container.children[1].classList.contains('is-current'));
  } finally {
    globalThis.document = previousDocument;
  }
});

// ---------------------------------------------------------------------------
// Webcam streams
// ---------------------------------------------------------------------------

/** A MediaStream whose tracks remember being stopped. */
function makeStream(trackCount = 1) {
  const tracks = Array.from({ length: trackCount }, () => {
    const track = { stopped: false, stop() { track.stopped = true; } };
    return track;
  });
  return { tracks, getTracks() { return tracks; } };
}

function makeWebcamVideo() {
  return {
    srcObject: null,
    paused: false,
    videoWidth: 640,
    playCalls: 0,
    async play() { this.playCalls += 1; },
  };
}

/** A hand-built App with just the state webcam()/closeWebcam() touch. */
function makeWebcamApp(statuses = []) {
  return {
    currentStream: null,
    capturedFaces: [],
    lastCapturePixels: null,
    faceDetectionTimer: null,
    webcamHint: null,
    webcamFaceOverlay: null,
    webcamConfidenceBar: null,
    webcamConfidenceFill: null,
    webcamConfidenceLabel: null,
    webcamAutoCaptureBtn: null,
    lastFacePosition: null,
    faceStableSince: null,
    autoCaptureEnabled: false,
    updateWebcamHint() {},
    startFaceDetection() {},
    setStatus(message, type) { statuses.push([type, message]); },
    stopStream: App.prototype.stopStream,
    stopWebcamStream: App.prototype.stopWebcamStream,
    stopFaceDetection: App.prototype.stopFaceDetection,
    closeWebcam: App.prototype.closeWebcam,
    webcam: App.prototype.webcam,
  };
}

/** Replace navigator for the duration of `run`, then restore it. */
async function withNavigator(value, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
}

test('pressing Scan with webcam again releases the first camera stream', async () => {
  // The button stays on screen while the panel is open, and pressing it called
  // getUserMedia a second time and simply overwrote this.currentStream. The
  // first stream was never stopped, so the camera light stayed on and the
  // device stayed busy until the whole tab was closed.
  const previousDocument = globalThis.document;
  const first = makeStream();
  const second = makeStream();
  const streams = [first, second];
  const video = makeWebcamVideo();
  const panel = { hidden: true };
  globalThis.document = {
    getElementById: (id) => ({ 'webcam-panel': panel, 'webcam-video': video }[id] || null),
  };

  try {
    await withNavigator(
      { mediaDevices: { getUserMedia: async () => streams.shift() } },
      async () => {
        const app = makeWebcamApp();
        await App.prototype.webcam.call(app);
        assert.equal(app.currentStream, first);

        await App.prototype.webcam.call(app);
        assert.equal(first.tracks[0].stopped, true, 'the first camera stream was never released');
        assert.equal(second.tracks[0].stopped, false);
        assert.equal(app.currentStream, second);
        assert.equal(video.srcObject, second);
      },
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test('closing the panel while the camera prompt is open releases the late stream', async () => {
  // getUserMedia waits for the permission prompt. Closing the panel in the
  // meantime hid the video element, and the reply then attached a live stream
  // to it: the camera ran on behind a closed panel with no way to stop it.
  const previousDocument = globalThis.document;
  const video = makeWebcamVideo();
  const panel = { hidden: false };
  let settle;
  globalThis.document = {
    getElementById: (id) => ({ 'webcam-panel': panel, 'webcam-video': video }[id] || null),
  };

  try {
    await withNavigator(
      { mediaDevices: { getUserMedia: () => new Promise((resolve) => { settle = resolve; }) } },
      async () => {
        const app = makeWebcamApp();
        const pending = App.prototype.webcam.call(app);
        assert.equal(typeof settle, 'function', 'getUserMedia was never called');

        App.prototype.closeWebcam.call(app);
        const late = makeStream(2);
        settle(late);
        await pending;

        assert.ok(late.tracks.every((track) => track.stopped), 'the late stream kept the camera on');
        assert.equal(app.currentStream, null);
        assert.equal(video.srcObject, null);
        assert.equal(panel.hidden, true);
      },
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test('closing the panel stops every track in the stream', async () => {
  // Cameras are video-only today, but stopping tracks by kind (or by the first
  // one) leaves any extra track live and keeps the device open.
  const previousDocument = globalThis.document;
  const stream = makeStream(2);
  const video = makeWebcamVideo();
  video.srcObject = stream;
  const panel = { hidden: false };
  globalThis.document = {
    getElementById: (id) => ({ 'webcam-panel': panel, 'webcam-video': video }[id] || null),
  };

  try {
    const app = makeWebcamApp();
    app.currentStream = stream;
    App.prototype.closeWebcam.call(app);
    assert.ok(stream.tracks.every((track) => track.stopped));
    assert.equal(video.srcObject, null);
    assert.equal(panel.hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** A document that can run the execCommand copy path and record it. */
function makeClipboardDocument(execResult = true) {
  const copied = [];
  const body = {
    children: [],
    appendChild(element) { body.children.push(element); },
    removeChild(element) {
      body.children = body.children.filter((child) => child !== element);
    },
  };
  return {
    body,
    copied,
    createElement(tagName) {
      if (tagName !== 'textarea') return makeElement(tagName);
      return {
        tagName: 'TEXTAREA',
        value: '',
        style: {},
        attributes: {},
        selected: false,
        setAttribute(name, value) { this.attributes[name] = String(value); },
        select() { this.selected = true; },
      };
    },
    execCommand(command) { copied.push(command); return execResult; },
  };
}

test('copy falls back to execCommand when navigator.clipboard is missing', async () => {
  // navigator.clipboard only exists in a secure context. The app is meant to be
  // opened over plain http on the LAN, where it is undefined, and the copy
  // buttons called it directly: the click threw and nothing was copied.
  const previousDocument = globalThis.document;
  const documentStub = makeClipboardDocument();
  globalThis.document = documentStub;
  const statuses = [];

  try {
    await withNavigator({}, async () => {
      const app = {
        history: { format: (moves) => moves.join(' '), scramble: ['R'], solution: ["U'"] },
        setStatus: (message, type) => statuses.push([type, message]),
        copyText: App.prototype.copyText,
        execCommandCopy: App.prototype.execCommandCopy,
      };
      await App.prototype.copyHistory.call(app);
      assert.deepEqual(documentStub.copied, ['copy']);
      assert.deepEqual(statuses, [['success', 'Copied!']]);
      // The scratch textarea must not be left behind in the page.
      assert.equal(documentStub.body.children.length, 0);
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('copy says so readably when neither clipboard path works', async () => {
  const previousDocument = globalThis.document;
  const documentStub = makeClipboardDocument(false);
  globalThis.document = documentStub;
  const statuses = [];

  try {
    await withNavigator({}, async () => {
      const app = {
        history: { format: (moves) => moves.join(' '), scramble: [], solution: [] },
        setStatus: (message, type) => statuses.push([type, message]),
        copyText: App.prototype.copyText,
        execCommandCopy: App.prototype.execCommandCopy,
      };
      const copied = await App.prototype.copyHistory.call(app);
      assert.equal(copied, false);
      assert.equal(documentStub.copied[0], 'copy');
      assert.equal(statuses[0][0], 'error');
      assert.match(statuses[0][1], /Copy failed/);
      assert.match(statuses[0][1], /copy it by hand/);
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('copy uses the async clipboard on a secure origin', async () => {
  const previousDocument = globalThis.document;
  const documentStub = makeClipboardDocument();
  globalThis.document = documentStub;
  const written = [];
  const statuses = [];

  try {
    await withNavigator({ clipboard: { writeText: async (text) => { written.push(text); } } }, async () => {
      const app = {
        history: { format: (moves) => moves.join(' '), scramble: ['R'], solution: ['U'] },
        setStatus: (message, type) => statuses.push([type, message]),
        copyText: App.prototype.copyText,
        execCommandCopy: App.prototype.execCommandCopy,
      };
      await App.prototype.copyHistory.call(app);
      assert.equal(written.length, 1);
      assert.match(written[0], /Scramble: R\nSolution: U/);
      assert.deepEqual(documentStub.copied, [], 'the fallback must not run when the API works');
      assert.deepEqual(statuses, [['success', 'Copied!']]);
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('Copy Link refuses an incomplete facelet instead of emitting a corrupt link', async () => {
  // currentFacelet follows the displayed picker state, so it can be a partly
  // filled net where every unpainted sticker is '?'. The button copied that
  // straight into ?s=, producing a link the loader (and the solver) cannot use.
  const previousDocument = globalThis.document;
  const documentStub = makeClipboardDocument();
  globalThis.document = documentStub;
  const written = [];
  const statuses = [];

  try {
    await withNavigator({ clipboard: { writeText: async (text) => { written.push(text); } } }, async () => {
      const app = {
        currentFacelet: 'U'.repeat(53) + '?',
        setStatus: (message, type) => statuses.push([type, message]),
        copyText: App.prototype.copyText,
        execCommandCopy: App.prototype.execCommandCopy,
      };
      const copied = await App.prototype.copyLink.call(app);
      assert.equal(copied, undefined);
      assert.deepEqual(written, [], 'a corrupt link was copied');
      assert.deepEqual(documentStub.copied, [], 'a corrupt link was copied through the fallback');
      assert.equal(statuses[0][0], 'error');
      assert.match(statuses[0][1], /not complete/i);
      assert.match(statuses[0][1], /54/);
    });
  } finally {
    globalThis.document = previousDocument;
  }
});

test('Copy Link carries a complete facelet', async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentStub = makeClipboardDocument();
  globalThis.document = documentStub;
  globalThis.window = { location: { href: 'http://192.168.1.20:8123/' } };
  const written = [];
  const statuses = [];

  try {
    await withNavigator({ clipboard: { writeText: async (text) => { written.push(text); } } }, async () => {
      const app = {
        currentFacelet: SOLVED,
        setStatus: (message, type) => statuses.push([type, message]),
        copyText: App.prototype.copyText,
        execCommandCopy: App.prototype.execCommandCopy,
      };
      await App.prototype.copyLink.call(app);
      assert.equal(written.length, 1);
      const url = new URL(written[0]);
      assert.equal(url.searchParams.get('s'), SOLVED);
      assert.equal(url.origin, 'http://192.168.1.20:8123');
      assert.deepEqual(statuses, [['success', 'Link copied!']]);
    });
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

// ---------------------------------------------------------------------------
// Broken storage
// ---------------------------------------------------------------------------

test('a corrupt stored best-times list does not stop startup', () => {
  // localStorage can hold JSON that no longer parses (a half-written entry,
  // another tab, a hand edit). JSON.parse ran during init(), so one bad value
  // threw before the rest of the page was wired up.
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => '[{"time": 1000}, {"time":', setItem() {}, removeItem() {} },
    configurable: true,
    writable: true,
  });

  try {
    const display = makeElement('div');
    const app = {
      bestTimesDisplay: display,
      timer: { formatTime: () => '0.00' },
      readBestTimes: App.prototype.readBestTimes,
      updateBestTimesDisplay: App.prototype.updateBestTimesDisplay,
    };
    assert.doesNotThrow(() => App.prototype.updateBestTimesDisplay.call(app));
    assert.deepEqual(display.children, []);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});

test('storage that throws still lets the end of a solve finish', () => {
  // Private browsing modes and blocked-cookies settings make every read and
  // write throw. saveTime() ran at the end of every solve, with the parse and
  // both writes naked, so the solve ended on an exception.
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem() { throw new Error('SecurityError: storage is disabled'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError: storage is disabled'); },
    },
    configurable: true,
    writable: true,
  });

  try {
    let painted = 0;
    const app = {
      timer: { getElapsed: () => 12345 },
      stats: new SpeedcubingStats(),
      readBestTimes: App.prototype.readBestTimes,
      writeBestTimes: App.prototype.writeBestTimes,
      updateBestTimesDisplay() { painted += 1; },
      updateStatsDisplay() {},
      saveTime: App.prototype.saveTime,
    };
    assert.doesNotThrow(() => App.prototype.saveTime.call(app));
    assert.equal(painted, 1, 'the best times are repainted from the empty list');

    const statuses = [];
    const clearApp = {
      stats: new SpeedcubingStats(),
      updateBestTimesDisplay() {},
      updateStatsDisplay() {},
      setStatus: (message, type) => statuses.push([type, message]),
      clearBestTimes: App.prototype.clearBestTimes,
    };
    assert.doesNotThrow(() => App.prototype.clearBestTimes.call(clearApp));
    assert.deepEqual(statuses, [['info', 'Times cleared']]);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});

// ---------------------------------------------------------------------------
// Stepping versus Play, and Clear
// ---------------------------------------------------------------------------

test('stepping during playback stops the loop instead of double-counting the cursor', async () => {
  // Next/Prev moved the cursor and enqueued a move while the Play loop was
  // still running, so the loop counted a move and the button counted the same
  // one again: the mark on the solution no longer described the cube.
  const events = [];
  const app = {
    isPlaying: true,
    solution: ['R', 'U', 'F'],
    currentMoveIndex: 1,
    reducedMotion: true,
    currentFacelet: 'BEFORE',
    cube: {
      enqueue: async (move) => { events.push(move); },
      readFacelet: () => 'AFTER',
    },
    timer: { stop: () => events.push('clock-stop') },
    stopTimerDisplay() {},
    pause: App.prototype.pause,
    syncRenderedFacelet: App.prototype.syncRenderedFacelet,
    updatePlaybackDisplay() {},
    announce() {},
    setStatus() {},
    next: App.prototype.next,
    prev: App.prototype.prev,
  };

  await App.prototype.next.call(app);
  assert.equal(app.isPlaying, false);
  assert.deepEqual(events, ['clock-stop', 'U']);
  assert.equal(app.currentMoveIndex, 2);
  assert.equal(app.currentFacelet, 'AFTER');

  // Prev takes the same path: it must take manual control first too.
  app.isPlaying = true;
  events.length = 0;
  await App.prototype.prev.call(app);
  assert.equal(app.isPlaying, false);
  assert.deepEqual(events, ['clock-stop', "U'"]);
  assert.equal(app.currentMoveIndex, 1);
});

test('clearing the history also clears the solution Play follows', async () => {
  // Clear emptied the visible history but left this.solution and the cursor,
  // so Play happily replayed a solution that was no longer on screen.
  const statuses = [];
  const history = {
    scramble: ['R', 'U'],
    solution: ['R', 'U', 'F'],
    manual: ['R'],
    clear() { this.scramble = []; this.solution = []; this.manual = []; },
  };
  const played = [];
  const events = [];
  const app = {
    isPlaying: true,
    solution: ['R', 'U', 'F'],
    currentMoveIndex: 1,
    solvedState: SOLVED,
    solvedInputFacelet: SOLVED,
    solveRequestId: 7,
    manualMoveStack: ['R'],
    undoButton: { disabled: false },
    history,
    updateHistoryDisplay() {},
    updatePlaybackDisplay() {},
    clearPrediction() {},
    setStatus: (message, type) => statuses.push([type, message]),
    timer: { stop: () => events.push('clock-stop') },
    stopTimerDisplay() {},
    pause: App.prototype.pause,
    announce() {},
    clearManualMoves: App.prototype.clearManualMoves,
    updateUndoButton: App.prototype.updateUndoButton,
    clearHistory: App.prototype.clearHistory,
    cube: { enqueue: async (move) => { played.push(move); } },
  };

  App.prototype.clearHistory.call(app);
  assert.equal(app.isPlaying, false);
  // Clearing mid-play must not leave the solve clock running on a list that is
  // gone: pause() stops the timer and its display.
  assert.deepEqual(events, ['clock-stop']);
  assert.deepEqual(app.solution, []);
  assert.equal(app.currentMoveIndex, 0);
  assert.equal(app.solvedState, null);
  // A /api/solve reply already in flight must not put the list back after
  // Clear, so its request id is superseded.
  assert.equal(app.solveRequestId, 8);
  assert.deepEqual(history.solution, []);
  assert.deepEqual(app.manualMoveStack, []);
  assert.equal(app.undoButton.disabled, true);
  assert.deepEqual(statuses, [['info', 'Cleared']]);

  // With no list left, pressing Play again does nothing at all.
  await App.prototype.play.call(app);
  assert.deepEqual(played, []);
});
