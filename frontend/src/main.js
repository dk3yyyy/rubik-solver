/* Rubik's Cube Solver — frontend */

import {
  FACES,
  FACE_CELLS,
  CB_FACE_COLOURS,
  FACE_COLOURS,
  FACE_NORMALS,
  SCAN_FACES,
  STICKER_PLACEMENTS,
  captureHint,
  describeApiError,
  describeScanError,
  frameIsBlank,
  framesLookIdentical,
  invertMove,
  isCompleteFacelet,
  movePlaybackState,
  moveToRotation,
  optimizeMoves,
  playbackCounterText,
  readApiResponse,
} from './cube-logic.js';
import { CubeInput } from './cube-input.js';
import { SpeedcubingStats } from './speedcubing-stats.js';

// Three.js wants integer colours; the picker and the cube share one palette.
const COLORS = Object.fromEntries(
  Object.entries(FACE_COLOURS).map(([face, { hex }]) => [face, parseInt(hex.slice(1), 16)]),
);
COLORS.interior = 0x1a1a1a;

const SOLVED_FACELET = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const FACE_COUNT = 6;
const STICKER_TOTAL = 54;

// Requests go to the same origin by default, which the Vite dev server proxies
// to the backend (see vite.config.js). Set VITE_API_URL to point elsewhere,
// e.g. when serving the built frontend from the backend host.
const API_BASE = ((import.meta.env && import.meta.env.VITE_API_URL) || '').replace(/\/+$/, '');
const api = (path) => `${API_BASE}/api${path}`;

const axisVector = (axis) => new THREE.Vector3(
  axis === 'x' ? 1 : 0,
  axis === 'y' ? 1 : 0,
  axis === 'z' ? 1 : 0
);

class Cube3D {
  constructor(container) {
    this.container = container;
    this.cubies = [];
    this.moveDuration = 300;
    this.queue = Promise.resolve();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(5, 4, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 15;

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
    hemi.position.set(0, 10, 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    this.scene.add(dir);

    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-5, 5, -5);
    this.scene.add(fill);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.5;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(10, 20, 0xdddddd, 0xeeeeee);
    grid.position.y = -2.49;
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    this.scene.add(grid);

    this.createCube();
    this.updateStickers(SOLVED_FACELET);

    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }

  createCube() {
    const geo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    const stickerGeo = new THREE.PlaneGeometry(0.85, 0.85);

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const mat = new THREE.MeshStandardMaterial({ color: COLORS.interior, roughness: 0.5, metalness: 0.1 });
          const cubie = new THREE.Mesh(geo, mat);
          cubie.position.set(x, y, z);
          cubie.castShadow = true;
          cubie.receiveShadow = true;
          cubie.userData = { gridPos: { x, y, z }, home: { x, y, z } };

          STICKER_PLACEMENTS.forEach(({ face, position, rotation }) => {
            const sticker = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({
              color: COLORS.interior, roughness: 0.35, metalness: 0
            }));
            sticker.position.set(...position);
            sticker.rotation.set(...rotation);
            sticker.userData.face = face;
            cubie.add(sticker);
          });

          this.scene.add(cubie);
          this.cubies.push(cubie);
        }
      }
    }
  }

  getCubieAt(x, y, z) {
    return this.cubies.find(c => c.userData.gridPos.x === x && c.userData.gridPos.y === y && c.userData.gridPos.z === z);
  }

  /** The sticker on `cubie` whose outward normal points along `direction`. */
  stickerFacing(cubie, direction) {
    const target = new THREE.Vector3(direction[0], direction[1], direction[2]);
    let best = null;
    let bestDot = 0.99;
    for (const sticker of cubie.children) {
      const normal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(sticker.quaternion)
        .applyQuaternion(cubie.quaternion);
      const dot = normal.dot(target);
      if (dot > bestDot) {
        bestDot = dot;
        best = sticker;
      }
    }
    return best;
  }

  colourLetter(hex) {
    for (const [letter, value] of Object.entries(COLORS)) {
      if (letter !== 'interior' && value === hex) return letter;
    }
    return '?';
  }

  /**
   * Paint the cube so it shows `facelet`.
   *
   * Stickers are matched by the direction they currently face, not by the
   * label they were created with, so this is correct however the cubies have
   * been turned.
   */
  updateStickers(facelet) {
    if (!facelet || facelet.length !== 54) return;
    let index = 0;
    for (const face of FACES) {
      for (const cell of FACE_CELLS[face]) {
        const cubie = this.getCubieAt(cell[0], cell[1], cell[2]);
        const colour = COLORS[facelet[index]] || COLORS.interior;
        if (cubie) {
          const sticker = this.stickerFacing(cubie, FACE_NORMALS[face]);
          if (sticker) sticker.material.color.setHex(colour);
        }
        index += 1;
      }
    }
  }

  /** Read the facelet string the rendered cube currently shows. */
  readFacelet() {
    const letters = [];
    for (const face of FACES) {
      for (const cell of FACE_CELLS[face]) {
        const cubie = this.getCubieAt(cell[0], cell[1], cell[2]);
        const sticker = cubie ? this.stickerFacing(cubie, FACE_NORMALS[face]) : null;
        letters.push(sticker ? this.colourLetter(sticker.material.color.getHex()) : '?');
      }
    }
    return letters.join('');
  }

  setMoveDuration(ms) {
    this.moveDuration = Math.max(0, ms);
  }

  /** Queue a move so overlapping key presses cannot corrupt the cube. */
  enqueue(move, animate = true) {
    this.queue = this.queue.then(() => this.applyMove(move, animate));
    return this.queue;
  }

  applyMove(move, animate = true) {
    const rotation = moveToRotation(move);
    if (!rotation) return Promise.resolve();

    const axis = axisVector(rotation.axis);
    const cubies = this.cubies.filter(c => c.userData.gridPos[rotation.axis] === rotation.layer);

    if (!animate || this.moveDuration === 0) {
      this.rotateCubies(cubies, axis, rotation.angle);
      this.settle(cubies);
      return Promise.resolve();
    }
    return this.animateMove(cubies, axis, rotation.angle);
  }

  /**
   * Rotate a layer about the cube's centre.
   *
   * rotateOnWorldAxis only spins an object in place, so the position has to be
   * rotated too; without that the cubies never actually orbit the cube.
   */
  rotateCubies(cubies, axis, angle) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    for (const cubie of cubies) {
      cubie.position.applyAxisAngle(axis, angle);
      cubie.quaternion.premultiply(rotation);
    }
  }

  animateMove(cubies, axis, angle) {
    return new Promise(resolve => {
      const duration = this.moveDuration;
      const start = Date.now();
      let applied = 0;

      const step = () => {
        const elapsed = Date.now() - start;
        const progress = duration === 0 ? 1 : Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const target = eased * angle;
        this.rotateCubies(cubies, axis, target - applied);
        applied = target;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          this.settle(cubies);
          resolve();
        }
      };
      step();
    });
  }

  /** Snap a rotated layer back onto the integer grid. */
  settle(cubies) {
    for (const cubie of cubies) {
      cubie.position.set(
        Math.round(cubie.position.x),
        Math.round(cubie.position.y),
        Math.round(cubie.position.z)
      );
      this.snapRotation(cubie);
      cubie.userData.gridPos = {
        x: cubie.position.x,
        y: cubie.position.y,
        z: cubie.position.z,
      };
    }
  }

  /** Remove floating point drift by rounding the rotation matrix to -1/0/1. */
  snapRotation(cubie) {
    const matrix = new THREE.Matrix4().makeRotationFromQuaternion(cubie.quaternion);
    const elements = matrix.elements;
    for (let i = 0; i < elements.length; i++) elements[i] = Math.round(elements[i]);
    cubie.quaternion.setFromRotationMatrix(matrix);
  }

  async playSolution(moves) {
    for (const move of moves) {
      await this.enqueue(move, true);
    }
  }

  reset() {
    for (const cubie of this.cubies) {
      const { x, y, z } = cubie.userData.home;
      cubie.position.set(x, y, z);
      cubie.rotation.set(0, 0, 0);
      cubie.quaternion.set(0, 0, 0, 1);
      cubie.userData.gridPos = { x, y, z };
    }
    this.updateStickers(SOLVED_FACELET);
  }

  onResize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

class Timer {
  constructor() {
    this.startTime = null;
    this.elapsed = 0;
    this.running = false;
    this.interval = null;
  }

  start() {
    if (this.running) return;
    this.startTime = Date.now() - this.elapsed;
    this.running = true;
    this.interval = setInterval(() => { this.elapsed = Date.now() - this.startTime; }, 100);
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.interval);
    this.running = false;
    this.elapsed = Date.now() - this.startTime;
  }

  reset() {
    clearInterval(this.interval);
    this.running = false;
    this.elapsed = 0;
    this.startTime = null;
  }

  getElapsed() {
    return this.running ? Date.now() - this.startTime : this.elapsed;
  }

  formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}

class MoveHistory {
  constructor() {
    this.scramble = [];
    this.solution = [];
    this.manual = [];
  }

  setScramble(moves) { this.scramble = [...moves]; }
  setSolution(moves) { this.solution = [...moves]; }
  addMove(move) { this.manual.push(move); }
  clear() { this.scramble = []; this.solution = []; this.manual = []; }
  format(moves) { return moves.join(' '); }
}

export class App {
  constructor() {
    this.cube = null;
    this.timer = new Timer();
    this.history = new MoveHistory();
    this.solution = [];
    this.solvedState = null;
    this.currentFacelet = SOLVED_FACELET;
    this.scrambleMoves = [];
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.capturedFaces = [];
    this.lastCapturePixels = null;
    this.timerDisplay = document.getElementById('timer');
    this.timerInterval = null;
    this.statusEl = document.getElementById('status');
    this.moveCounterEl = document.getElementById('move-counter');
    this.scrambleDisplay = document.getElementById('history-scramble');
    this.solutionDisplay = document.getElementById('history-solution');
    this.bestTimesDisplay = document.getElementById('best-times');
    this.webcamHint = document.getElementById('webcam-hint');
    this.webcamFaceOverlay = document.getElementById('webcam-face-overlay');
    this.webcamConfidenceBar = document.getElementById('webcam-confidence-bar');
    this.webcamConfidenceFill = document.getElementById('webcam-confidence-fill');
    this.webcamConfidenceLabel = document.getElementById('webcam-confidence-label');
    this.webcamAutoCaptureBtn = document.getElementById('webcam-auto-capture');
    this.faceletInput = document.getElementById('facelet-input');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedLabelEl = document.getElementById('speed-label');
    this.inputStatusEl = document.getElementById('cube-input-status');
    this.predictionEl = document.getElementById('move-prediction');
    this.cubeInput = null;
    this.predictionTimer = null;
    this.lastMirrored = null;
    this.solvedInputFacelet = null;
    this.themeToggle = document.getElementById('theme-toggle');
    this.themeIcon = document.getElementById('theme-icon');
    this.cbToggle = document.getElementById('cb-toggle');
    this.colorblindMode = false;
    this.reducedMotion = false;
    this.ariaLive = document.getElementById('aria-live');
    this.stats = new SpeedcubingStats();
    this.inspectionActive = false;
    this.inspectionTimeLeft = 0;
    this.inspectionInterval = null;
    this.inspectionTimeout = null;
    this.solveStartTime = null;
    this.manualMoveStack = [];
    this.undoButton = document.getElementById('btn-undo');
    this.solveRequestId = 0;
    this.movePreviewEl = null;
    this.movePreviewMovesEl = null;

    this.init();
  }

  init() {
    const container = document.getElementById('cube-canvas');
    this.cube = new Cube3D(container);
    this.cube.setMoveDuration(Number(this.speedSlider.value));
    this.cubeInput = new CubeInput(
      document.getElementById('cube-net'),
      document.getElementById('cube-palette'),
      { onChange: (state, meta) => this.onInputChange(state, meta) },
    );
    this.bindEvents();
    this.updateSpeedLabel();
    this.updateBestTimesDisplay();
    this.updateStatsDisplay();
    this.updateInputStatus(this.cubeInput.getState());
    this.initAccessibility();
    this.updateUndoButton();
    this.setStatus('Fill in your cube below, or press Scramble to try a random one.', 'info');
    // The Copy Link button writes ?s=<facelet>; without this the link opened a
    // page that ignored the cube it carried.
    this.loadDeepLink();
  }



  bindEvents() {
    this.restorePreferences();
    if (this.themeToggle) {
      this.themeToggle.addEventListener('click', () => this.toggleTheme());
    }
    if (this.cbToggle) {
      this.cbToggle.addEventListener('click', () => this.toggleColorblindMode());
    }
    document.getElementById('btn-scramble').addEventListener('click', () => this.scramble());
    document.getElementById('btn-solve').addEventListener('click', () => this.solveAndPlay());
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());
    if (this.undoButton) this.undoButton.addEventListener('click', () => this.undoManualMove());
    document.getElementById('btn-play').addEventListener('click', () => this.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.pause());
    document.getElementById('btn-next').addEventListener('click', () => this.next());
    document.getElementById('btn-prev').addEventListener('click', () => this.prev());
    document.getElementById('btn-load').addEventListener('click', () => this.loadFacelet());
    document.getElementById('btn-webcam').addEventListener('click', () => this.webcam());
    document.getElementById('webcam-capture').addEventListener('click', () => this.captureFace());
    document.getElementById('webcam-auto-capture').addEventListener('click', () => this.toggleAutoCapture());
    document.getElementById('webcam-close').addEventListener('click', () => this.closeWebcam());
    document.getElementById('btn-copy').addEventListener('click', () => this.copyHistory());
    document.getElementById('btn-invert').addEventListener('click', () => this.invertScramble());
    document.getElementById('btn-optimize').addEventListener('click', () => this.optimizeSolution());
    document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());
    document.getElementById('btn-clear-times').addEventListener('click', () => this.clearBestTimes());
    const copyLinkBtn = document.getElementById('btn-copy-link');
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => this.copyLink());
    document.getElementById('btn-input-solve').addEventListener('click', () => this.solve());
    document.getElementById('btn-input-clear').addEventListener('click', () => this.clearInput());

    this.faceletInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadFacelet();
    });

    document.addEventListener('keydown', (e) => {
      if (document.activeElement.tagName === 'INPUT') return;
      // Taking back a hand-typed move, the same shortcut a text editor uses.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.undoManualMove();
        return;
      }
      // Arrow keys step through the solution one move at a time.
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.next();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.solveAndPlay();
        return;
      }
      // Space starts/ends inspection, like a stackmat timer.
      if (e.key === ' ') {
        e.preventDefault();
        if (this.inspectionActive) {
          this.endInspection();
          this.timer.start();
          this.startTimerDisplay();
        } else if (!this.timer.running && this.timer.elapsed === 0 && this.scrambleMoves.length > 0) {
          this.ensureTimerRunning();
        }
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.scramble();
        return;
      }
      const map = { 'u': "U'", 'U': 'U', 'd': "D'", 'D': 'D', 'l': "L'", 'L': 'L', 'r': "R'", 'R': 'R', 'f': "F'", 'F': 'F', 'b': "B'", 'B': 'B' };
      if (map[e.key]) {
        e.preventDefault();
        this.ensureTimerRunning();
        this.applyManualMove(map[e.key]);
      }
    });

    this.speedSlider.addEventListener('input', (e) => {
      this.cube.setMoveDuration(Number(e.target.value));
      this.updateSpeedLabel();
    });
  }

  async scramble() {
    this.setStatus('Generating scramble...', 'loading');
    this.announce('Generating scramble');
    // A scramble pressed while a solution is playing must stop that playback.
    // Leaving the loop running let the completion branch below record a solve
    // time for a solve the person had already abandoned.
    this.isPlaying = false;
    try {
      const data = await readApiResponse(await fetch(api('/scramble')));

      // Let any move already animating finish before its cubies are reset, or
      // the settle at the end of that move lands on top of the reset cube.
      await this.cube.queue;
      this.cube.reset();
      this.scrambleMoves = data.scramble.split(' ').filter(Boolean);
      this.solution = [];
      this.solvedState = null;
      this.currentMoveIndex = 0;
      this.clearManualMoves();

      this.timer.reset();
      this.endInspection();
      this.stopTimerDisplay();

      this.history.setScramble(this.scrambleMoves);
      this.history.setSolution([]);
      this.updateHistoryDisplay();

      await this.cube.playSolution(this.scrambleMoves);
      this.currentFacelet = data.state;
      this.cube.updateStickers(data.state);
      this.solvedInputFacelet = null;
      this.cubeInput.setFacelet(data.state);

      this.moveCounterEl.textContent = `Scrambled: ${this.scrambleMoves.length} moves`;
      this.setStatus('Scrambled! Click "Solve" to find a solution.', 'success');
      this.announce(`Scramble complete. ${this.scrambleMoves.length} moves applied.`);
    } catch (err) {
      this.setStatus(this.apiError(err), 'error');
      this.announce(`Error: ${this.apiError(err)}`);
    }
  }

  /**
   * Start inspection before the solve timer begins on first user input.
   * The timer should measure how long the user takes to solve, not how
   * long the scramble animation plays out.
   */
  ensureTimerRunning() {
    if (this.timer.running || this.timer.elapsed > 0) return;
    if (this.inspectionActive) return;
    this.startInspection();
  }

  /**
   * The Solve button and the Enter key: work the solution out, then run it on the
   * cube. Computing alone left the cube sitting there scrambled, and because a
   * scramble already triggers a prediction the button looked like it did nothing.
   */
  async solveAndPlay() {
    await this.solve();
    if (!this.solution.length || this.isPlaying) return;
    this.currentMoveIndex = 0;
    this.updatePlaybackDisplay();
    await this.play();
  }

  async solve() {
    const state = this.cubeInput ? this.cubeInput.getState() : null;

    if (state && !state.complete) {
      this.setStatus(`Your cube is not finished: ${state.problems}.`, 'error');
      this.announce(`Cube incomplete: ${state.problems}`);
      return;
    }

    const fromPicker = Boolean(state && state.complete);
    const facelet = fromPicker
      ? state.facelet
      : (this.faceletInput.value.trim().toUpperCase() || this.currentFacelet);

    if (!facelet || facelet.length !== STICKER_TOTAL) {
      this.setStatus('Fill in all 54 stickers, or paste a facelet string', 'error');
      this.announce('Invalid facelet string');
      return;
    }

    // Prediction fires on its own shortly after the last sticker is painted, so
    // a reply can land after the entry has moved on. Tag each request and drop
    // any answer that a later request, or a later edit, has superseded.
    this.solveRequestId = (this.solveRequestId || 0) + 1;
    const requestId = this.solveRequestId;

    this.setStatus('Solving...', 'loading');
    this.announce('Solving cube');
    try {
      const data = await readApiResponse(await fetch(api('/solve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: facelet })
      }));

      if (requestId !== this.solveRequestId) return;
      if (fromPicker) {
        const latest = this.cubeInput.getState();
        if (!latest.complete || latest.facelet !== facelet) return;
      }

      this.solution = data.solution.split(' ').filter(Boolean);
      this.solvedState = data.solved_state;
      this.currentMoveIndex = 0;
      this.isPlaying = false;
      this.solvedInputFacelet = facelet;
      this.history.setSolution(this.solution);
      this.updateHistoryDisplay();

      this.showPrediction(data.move_count, this.solution.length === 0);
      this.updatePlaybackDisplay();
      const msg = this.solution.length
        ? `Your cube needs ${data.move_count} moves. Set the speed, then press Play to follow along, or use Next to step through.`
        : 'That cube is already solved, so no moves are needed.';
      this.setStatus(msg, 'success');
      this.announce(msg);
    } catch (err) {
      this.clearPrediction();
      this.setStatus(this.apiError(err), 'error');
      this.announce(`Error: ${this.apiError(err)}`);
    }
  }

  /** Show the predicted move count for the cube the user entered. */
  showPrediction(count, alreadySolved) {
    if (!this.predictionEl) return;
    this.predictionEl.hidden = false;
    this.predictionEl.textContent = '';

    if (alreadySolved) {
      this.predictionEl.appendChild(
        document.createTextNode('Already solved, so there is nothing to do.'),
      );
      return;
    }

    const headline = document.createElement('span');
    headline.className = 'prediction-count';
    headline.textContent = `${count} ${count === 1 ? 'move' : 'moves'}`;
    this.predictionEl.appendChild(headline);
    this.predictionEl.appendChild(
      document.createTextNode('Set the speed, then press Play to follow along, or tap Next to step through one move at a time.'),
    );
  }

  clearPrediction() {
    if (!this.predictionEl) return;
    this.predictionEl.hidden = true;
    this.predictionEl.textContent = '';
  }

  /** React to a sticker being painted or cleared. */
  onInputChange(state, meta = {}) {
    if (meta.lockedCentre) {
      this.setStatus(
        `The ${FACE_COLOURS[meta.lockedCentre].name} centre is fixed. `
        + 'Hold the cube with white on top and green facing you so the centres line up.',
        'info',
      );
    }

    // Any edit invalidates a solution computed for the previous entry. Testing
    // the solution rather than the recorded facelet matters: loadFacelet and the
    // scan clear that record before setting the new cube, and a solution left
    // over from the previous cube could still be played against the new one.
    if (this.solution.length && state.facelet !== this.solvedInputFacelet) {
      this.solution = [];
      this.solvedState = null;
      this.solvedInputFacelet = null;
      this.currentMoveIndex = 0;
      this.history.setSolution([]);
      this.updateHistoryDisplay();
      this.updatePlaybackDisplay();
      this.clearPrediction();
    }

    if (!this.isPlaying) {
      const painted = state.stickers.filter(Boolean).length;
      // With nothing entered yet, rest on the solved cube rather than a dark one.
      const shown = painted <= FACE_COUNT ? SOLVED_FACELET : state.facelet;
      this.cube.updateStickers(shown);
      // The remembered facelet is what palette switches repaint from, so it has
      // to follow the picker. Leaving it on the old state made the cube jump
      // back to that state when colourblind mode was toggled.
      this.currentFacelet = shown;
    }

    this.updateInputStatus(state);
    this.syncFaceletInput(state);

    if (state.complete) this.schedulePrediction();
    else this.clearPrediction();
  }

  /** Keep the paste field in step with the picker without clobbering typing. */
  syncFaceletInput(state) {
    if (state.complete) {
      this.faceletInput.value = state.facelet;
      this.lastMirrored = state.facelet;
      return;
    }
    if (this.lastMirrored && this.faceletInput.value === this.lastMirrored) {
      this.faceletInput.value = '';
      this.lastMirrored = null;
    }
  }

  updateInputStatus(state) {
    if (!this.inputStatusEl) return;
    if (state.complete) {
      this.inputStatusEl.textContent = 'All 54 stickers set. Working out the shortest solution...';
      this.inputStatusEl.classList.add('is-ready');
    } else {
      this.inputStatusEl.textContent = state.problems;
      this.inputStatusEl.classList.remove('is-ready');
    }
  }

  /** Wait a moment so a burst of taps does not fire a request each. */
  schedulePrediction() {
    clearTimeout(this.predictionTimer);
    this.predictionTimer = setTimeout(() => this.solve(), 250);
  }

  clearInput() {
    clearTimeout(this.predictionTimer);
    this.clearManualMoves();
    this.solution = [];
    this.solvedState = null;
    this.solvedInputFacelet = null;
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.lastMirrored = null;
    this.faceletInput.value = '';
    this.history.clear();
    this.updateHistoryDisplay();
    this.clearPrediction();
    this.updatePlaybackDisplay();
    this.cubeInput.clear();
    this.setStatus('Cleared. Enter your cube again.', 'info');
  }

  updateSpeedLabel() {
    if (!this.speedLabelEl) return;
    if (this.reducedMotion) {
      this.speedLabelEl.textContent = 'instant moves (reduced motion)';
      return;
    }
    const ms = Number(this.speedSlider.value);
    this.speedLabelEl.textContent = `${(ms / 1000).toFixed(2)}s per move`;
  }

  // Called from every action the user triggers, and it had no definition at all:
  // each scramble, solve and playback threw before it announced anything.
  announce(message) {
    if (!this.ariaLive) {
      return;
    }
    this.ariaLive.textContent = '';
    requestAnimationFrame(() => {
      this.ariaLive.textContent = message;
    });
  }

  /** Turn a failed request into something the user can act on. */
  apiError(err) {
    const origin = typeof window !== 'undefined' ? window.location.origin : null;
    return describeApiError(err, API_BASE || null, origin);
  }

  async play() {
    if (this.isPlaying || this.currentMoveIndex >= this.solution.length) return;
    clearTimeout(this.predictionTimer);
    // The list this playback was started for. Scramble, Reset and Clear can
    // replace this.solution while a move is in flight, and the loop must not
    // mistake that for having reached the end.
    const solution = this.solution;
    this.isPlaying = true;
    this.clearManualMoves();
    this.timer.start();
    this.startTimerDisplay();
    this.announce('Playing solution');

    while (this.isPlaying && this.currentMoveIndex < solution.length) {
      const move = solution[this.currentMoveIndex];
      this.currentMoveIndex += 1;
      await this.cube.enqueue(move, !this.reducedMotion);
      this.updatePlaybackDisplay();
    }

    // Whatever ended the loop, the cube has settled on the moves played so far.
    // (Skipped when a replacement state has taken over the cube.)
    if (this.solution === solution) {
      this.syncRenderedFacelet();
    }

    if (this.isPlaying && this.solution === solution && this.currentMoveIndex >= solution.length) {
      this.isPlaying = false;
      this.timer.stop();
      this.stopTimerDisplay();
      this.verifyRenderedState();
      this.saveTime();
      this.announce('Solution complete');
    }
  }

  /**
   * Remember the facelet the settled cube is showing. Palette switches repaint
   * from this string, and Copy Link puts it in the URL, so it has to follow
   * every move that reaches the cube by hand or through playback.
   */
  syncRenderedFacelet() {
    this.currentFacelet = this.cube.readFacelet();
  }

  /**
   * Turn one layer by hand. The move is stacked so Undo can take it back, and
   * the remembered facelet follows the cube, so a later palette switch or link
   * copy describes the cube on screen rather than the state before the move.
   */
  async applyManualMove(move) {
    // Stack the move before the animation runs, so Undo is live as soon as the
    // key is pressed rather than after the turn finishes.
    this.manualMoveStack.push(move);
    this.history.addMove(move);
    this.updateUndoButton();
    await this.cube.enqueue(move, !this.reducedMotion);
    this.syncRenderedFacelet();
    this.announce(`Move ${move}`);
  }

  /** Take back the last move typed by hand. */
  async undoManualMove() {
    const move = this.manualMoveStack.pop();
    if (!move) return;
    this.history.manual.pop();
    this.updateUndoButton();
    await this.cube.enqueue(invertMove(move), !this.reducedMotion);
    this.syncRenderedFacelet();
    this.announce(`Undid ${move}`);
    this.setStatus(`Undid ${move}`, 'info');
  }

  /** The Undo button is only usable while there is a hand-typed move to take back. */
  updateUndoButton() {
    if (!this.undoButton) return;
    this.undoButton.disabled = this.manualMoveStack.length === 0;
  }

  /** A new cube state makes the hand-typed move stack meaningless. */
  clearManualMoves() {
    this.manualMoveStack = [];
    this.history.manual = [];
    this.updateUndoButton();
  }

  /**
   * The cube is painted from the backend facelet, so if the rendered state
   * drifts from what the server computed, repaint rather than show a wrong
   * solved cube.
   */
  verifyRenderedState() {
    if (!this.solvedState) return;
    const rendered = this.cube.readFacelet();
    if (rendered !== this.solvedState) {
      console.warn('Rendered cube did not match the solver state; repainting.', rendered, this.solvedState);
      this.cube.updateStickers(this.solvedState);
    }
    this.currentFacelet = this.solvedState;
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.timer.stop();
    this.stopTimerDisplay();
    this.announce('Playback paused');
  }

  async next() {
    // Stepping and Play both move the same cursor, so letting them run together
    // made the cursor and the cube drift apart: the Play loop counted a move
    // while Next incremented the cursor for the same move again. Taking manual
    // control is what pressing Next means, so stop the loop and step from where
    // playback had got to. Disabling the buttons instead would also have
    // ignored the arrow keys, which take this same path.
    if (this.isPlaying) this.pause();
    if (this.currentMoveIndex < this.solution.length) {
      const move = this.solution[this.currentMoveIndex];
      this.currentMoveIndex += 1;
      await this.cube.enqueue(move, !this.reducedMotion);
      this.syncRenderedFacelet();
      this.updatePlaybackDisplay();
      this.announce(`Move ${this.currentMoveIndex} of ${this.solution.length}: ${move}`);
      if (this.currentMoveIndex === this.solution.length) {
        this.verifyRenderedState();
        this.announce('Solution complete');
      }
    }
  }

  async prev() {
    // Same mutual exclusion as next(): a step request ends playback first.
    if (this.isPlaying) this.pause();
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      this.currentMoveIndex -= 1;
      await this.cube.enqueue(invertMove(move), !this.reducedMotion);
      this.syncRenderedFacelet();
      this.updatePlaybackDisplay();
      this.announce(`Back to move ${this.currentMoveIndex} of ${this.solution.length}`);
    }
  }

  reset() {
    this.isPlaying = false;
    this.clearManualMoves();
    this.cube.reset();
    this.solution = [];
    this.scrambleMoves = [];
    this.solvedState = null;
    this.solvedInputFacelet = null;
    this.currentFacelet = SOLVED_FACELET;
    this.currentMoveIndex = 0;
    this.lastMirrored = null;
    this.faceletInput.value = '';
    this.timer.reset();
    this.endInspection();
    this.stopTimerDisplay();
    this.history.clear();
    this.updateHistoryDisplay();
    this.clearPrediction();
    this.updatePlaybackDisplay();
    if (this.cubeInput) this.cubeInput.clear();
    this.setStatus('Reset to solved state', 'info');
    this.announce('Cube reset to solved state');
  }

  async loadFacelet() {
    const facelet = this.faceletInput.value.trim().toUpperCase();

    if (facelet.length !== STICKER_TOTAL) {
      this.setStatus(`Facelet must be ${STICKER_TOTAL} characters`, 'error');
      return;
    }

    this.setStatus('Validating...', 'loading');
    try {
      const data = await readApiResponse(await fetch(api('/validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: facelet })
      }));
      if (!data.valid) { this.setStatus('Invalid: ' + data.error, 'error'); return; }

      this.isPlaying = false;
      this.clearManualMoves();
      this.cube.reset();
      this.cube.updateStickers(facelet);
      this.currentFacelet = facelet;
      this.solvedState = null;
      this.solvedInputFacelet = null;
      this.currentMoveIndex = 0;
      this.cubeInput.setFacelet(facelet);
      this.setStatus('Cube loaded. Press Solve to predict the moves.', 'success');
    } catch (err) {
      this.setStatus(this.apiError(err), 'error');
    }
  }

  async webcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    // A scan is a new session. The counter is how a reply from getUserMedia
    // knows whether the panel that asked for it is still the one on screen;
    // closeWebcam() bumps it too. The button stays clickable while the panel is
    // open, and pressing it again used to call getUserMedia a second time and
    // simply overwrite this.currentStream: the first stream was never stopped,
    // so the camera light stayed on and the device stayed busy.
    this.webcamSession = (this.webcamSession || 0) + 1;
    const session = this.webcamSession;
    this.stopWebcamStream();
    this.stopFaceDetection();
    this.capturedFaces = [];
    this.lastCapturePixels = null;
    this.autoCaptureEnabled = false;
    this.lastFacePosition = null;
    this.faceStableSince = null;
    this.updateWebcamHint();
    panel.hidden = false;

    // Reset UI elements
    if (this.webcamFaceOverlay) {
      const box = this.webcamFaceOverlay.querySelector('.face-overlay-box');
      if (box) box.classList.remove('is-detected');
    }
    if (this.webcamConfidenceBar) this.webcamConfidenceBar.hidden = true;
    if (this.webcamAutoCaptureBtn) {
      this.webcamAutoCaptureBtn.classList.remove('is-active');
      this.webcamAutoCaptureBtn.setAttribute('aria-pressed', 'false');
    }

    // mediaDevices only exists in a secure context, so a phone opening the app
    // over plain http on the local network has no camera API at all.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // "Open it at localhost" is advice a phone cannot follow: on the phone
      // localhost is the phone. Say what is true for each device instead - the
      // computer running the backend can use localhost, and anything else needs
      // the app served over https.
      this.setStatus(
        'This page cannot reach the camera, because browsers only allow camera access '
        + 'over https or on the machine that serves the app. On that computer, open '
        + 'http://localhost:8000; on a phone or another device, the app has to be '
        + 'served over https.',
        'error',
      );
      panel.hidden = true;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      // The permission prompt can stay up for as long as the person takes, and
      // the panel can be closed (or a second scan started) meanwhile. Attaching
      // this stream now would turn the camera back on behind a closed panel
      // with no reference left to stop it, so release it instead.
      if (session !== this.webcamSession) {
        this.stopStream(stream);
        return;
      }
      this.currentStream = stream;
      video.srcObject = stream;
      // autoplay is subject to browser policy. Asking explicitly means a stream
      // that never starts is reported here, rather than arriving at the scanner
      // as six black frames it cannot read.
      await video.play();
      // Closing during autoplay is the same race one step later, and the stream
      // is now owned by the panel, so release it through the session's state.
      if (session !== this.webcamSession) {
        this.stopWebcamStream();
        return;
      }
      this.startFaceDetection();
    } catch (err) {
      // A failure from a session nobody wants any more (a second scan has
      // replaced it) must not close the panel that is open now.
      if (session !== this.webcamSession) return;
      this.setStatus('Camera: ' + ((err && err.message) || err), 'error');
      this.closeWebcam();
    }
  }

  async captureFace() {
    const video = document.getElementById('webcam-video');
    if (!video.videoWidth) { this.setStatus('Camera is not ready yet', 'error'); return; }
    if (video.paused) {
      this.setStatus('The camera is not running. Close the panel and press "Scan with webcam" again.', 'error');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Sample the frame so a camera that is not delivering a picture is caught
    // here, instead of the scanner reporting stickers it cannot read.
    const probe = document.createElement('canvas');
    probe.width = 32;
    probe.height = 32;
    const probeCtx = probe.getContext('2d');
    probeCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 32, 32);
    const pixels = probeCtx.getImageData(0, 0, 32, 32).data;

    if (frameIsBlank(pixels)) {
      this.setStatus(
        'The camera is showing a blank frame. Check that no other app is using it, then try again.',
        'error',
      );
      return;
    }

    if (this.capturedFaces.length && framesLookIdentical(pixels, this.lastCapturePixels)) {
      this.setStatus(
        'That frame is the same as the last one, so the cube has not turned. Turn it to '
        + 'the next face and press Capture again.',
        'error',
      );
      return;
    }
    this.lastCapturePixels = pixels;

    // Get confidence for this capture using the detect endpoint.
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      const detectResult = await readApiResponse(await fetch(api('/detect-frame'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      }));
      this.showCaptureConfidence(detectResult.confidence || 0);
    } catch (_err) {
      // Detection failure is non-fatal — the capture still works.
    }

    this.capturedFaces.push(canvas.toDataURL('image/jpeg', 0.9));
    this.updateWebcamHint();

    if (this.capturedFaces.length === FACE_COUNT) {
      await this.scanCapturedFaces();
    } else {
      const caught = SCAN_FACES[this.capturedFaces.length - 1];
      this.setStatus(`Captured ${caught ? caught.colour : 'face'} (${this.capturedFaces.length}/${FACE_COUNT})`, 'info');
    }
  }

  /** Start polling the video feed for face detection. */
  startFaceDetection() {
    if (this.faceDetectionTimer) return;
    this.faceDetectionTimer = setInterval(() => this.updateFaceDetection(), 500);
  }

  /** Analyse the current video frame and update the face detection overlay. */
  async updateFaceDetection() {
    const video = document.getElementById('webcam-video');
    if (!video.videoWidth || video.paused) return;

    // Draw current frame to a small canvas to keep the payload compact.
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

    try {
      const result = await readApiResponse(await fetch(api('/detect-frame'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      }));

      this.handleFaceDetectionResult(result);
    } catch (_err) {
      // Detection failures are non-fatal: just skip this frame.
    }
  }

  handleFaceDetectionResult(result) {
    if (!this.webcamFaceOverlay) return;
    const box = this.webcamFaceOverlay.querySelector('.face-overlay-box');
    const text = this.webcamFaceOverlay.querySelector('.face-overlay-text');
    if (!box) return;

    if (result.face_detected) {
      box.classList.add('is-detected');
      if (text) {
        text.textContent = result.confidence > 0.8
          ? 'Face detected — ready to capture'
          : 'Face detected — hold steady';
      }

      // Auto-capture: trigger when face is stable and confidence is high.
      if (this.autoCaptureEnabled) {
        this.checkAutoCapture(result);
      }
    } else {
      box.classList.remove('is-detected');
      if (text) text.textContent = 'Position cube face here';
      this.lastFacePosition = null;
      this.faceStableSince = null;
    }
  }

  /** Track face position stability and auto-capture when ready. */
  checkAutoCapture(result) {
    const position = `${result.colours?.join(',') || ''}:${Math.round(result.coverage * 100)}`;
    const now = Date.now();

    if (this.lastFacePosition !== position) {
      this.lastFacePosition = position;
      this.faceStableSince = now;
      return;
    }

    const stable = now - (this.faceStableSince || now) > 1000;
    const highConfidence = result.confidence > 0.8;

    if (stable && highConfidence) {
      this.lastFacePosition = null;
      this.faceStableSince = null;
      this.captureFace();
    }
  }

  /** Toggle the auto-capture feature on/off. */
  toggleAutoCapture() {
    this.autoCaptureEnabled = !this.autoCaptureEnabled;
    if (this.webcamAutoCaptureBtn) {
      this.webcamAutoCaptureBtn.classList.toggle('is-active', this.autoCaptureEnabled);
      this.webcamAutoCaptureBtn.setAttribute('aria-pressed', String(this.autoCaptureEnabled));
    }
    if (this.autoCaptureEnabled) {
      this.setStatus('Auto-capture enabled — hold the cube steady to capture automatically', 'info');
    } else {
      this.lastFacePosition = null;
      this.faceStableSince = null;
    }
  }

  /** Show the confidence bar after a capture. */
  showCaptureConfidence(confidence) {
    if (!this.webcamConfidenceBar || !this.webcamConfidenceFill || !this.webcamConfidenceLabel) return;
    this.webcamConfidenceBar.hidden = false;
    const pct = Math.round(confidence * 100);
    this.webcamConfidenceFill.style.width = `${pct}%`;
    this.webcamConfidenceFill.classList.remove('is-good', 'is-okay', 'is-poor');

    if (confidence > 0.8) {
      this.webcamConfidenceFill.classList.add('is-good');
      this.webcamConfidenceLabel.textContent = `Good scan (${pct}%)`;
    } else if (confidence >= 0.5) {
      this.webcamConfidenceFill.classList.add('is-okay');
      this.webcamConfidenceLabel.textContent = `Okay (${pct}%)`;
    } else {
      this.webcamConfidenceFill.classList.add('is-poor');
      this.webcamConfidenceLabel.textContent = `Poor — retake (${pct}%)`;
    }
  }

  updateWebcamHint() {
    if (!this.webcamHint) return;
    this.webcamHint.textContent = captureHint(this.capturedFaces.length);
  }

  async scanCapturedFaces() {
    this.setStatus('Scanning cube...', 'loading');
    // The captures are spent, so a fresh scan should not compare its first frame
    // against the last frame of this one.
    this.lastCapturePixels = null;
    try {
      const data = await readApiResponse(await fetch(api('/webcam-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: this.capturedFaces })
      }));

      this.isPlaying = false;
      this.clearManualMoves();
      this.cube.reset();
      this.cube.updateStickers(data.state);
      this.currentFacelet = data.state;
      this.solvedState = null;
      this.solvedInputFacelet = null;
      this.currentMoveIndex = 0;
      this.cubeInput.setFacelet(data.state);
      this.moveCounterEl.textContent = 'Scanned cube';
      this.setStatus(
        `Scanned cube (confidence ${Math.round(data.confidence * 100)}%). `
        + 'Check the grid below and fix any wrong stickers before solving.',
        'success',
      );
      this.capturedFaces = [];
      this.closeWebcam();
    } catch (err) {
      this.setStatus('Scan failed: ' + describeScanError(this.apiError(err)), 'error');
      this.capturedFaces = [];
      this.updateWebcamHint();
    }
  }

  /** Stop every track in a MediaStream, which is what releases the device. */
  stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    for (const track of stream.getTracks()) {
      if (track && typeof track.stop === 'function') track.stop();
    }
  }

  /**
   * Release the stream this panel owns, if any.
   *
   * Every track is stopped, not just the first: a camera is video-only today,
   * but any track left live keeps the device open and the indicator lit.
   */
  stopWebcamStream() {
    const stream = this.currentStream;
    this.currentStream = null;
    this.stopStream(stream);
  }

  /** Stop the 500ms face-detection poll, and forget it. */
  stopFaceDetection() {
    if (this.faceDetectionTimer) {
      clearInterval(this.faceDetectionTimer);
      this.faceDetectionTimer = null;
    }
  }

  closeWebcam() {
    // Bump the session first: a getUserMedia or video.play() still in flight
    // belongs to a panel nobody wants now, and must stop its own stream rather
    // than attach it to a hidden video element.
    this.webcamSession = (this.webcamSession || 0) + 1;
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    const owned = this.currentStream;
    this.stopWebcamStream();
    if (video.srcObject && video.srcObject !== owned) {
      // A stream that reached the element without becoming this.currentStream
      // (a reply from a superseded scan): it would outlive the panel, so stop
      // it too. The stream just stopped is skipped so its tracks stop once.
      this.stopStream(video.srcObject);
    }
    video.srcObject = null;
    this.stopFaceDetection();
    panel.hidden = true;
  }

  /** One-shot render, used when the clock is not running. */
  renderTimer() {
    this.timerDisplay.textContent = this.timer.formatTime(this.timer.getElapsed());
  }

  /**
   * Tick the clock while it runs. The timer object only tracks elapsed time;
   * without this the display would freeze as soon as the clock started.
   */
  startTimerDisplay() {
    if (this.timerInterval) return;
    this.renderTimer();
    this.timerInterval = setInterval(() => this.renderTimer(), 50);
  }

  stopTimerDisplay() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.renderTimer();
  }

  /**
   * The solution is a list of moves and, during playback, one of them is the move
   * you are on. Rendering it as an undifferentiated string left people counting
   * tokens in a 20 move sequence to work out what to turn next.
   */
  renderMoves(container, moves) {
    container.innerHTML = '';
    moves.forEach((move, index) => {
      const chip = document.createElement('span');
      chip.className = 'move-chip';
      chip.dataset.index = String(index);
      chip.textContent = move;
      // Both history lists are role="list"; a list whose children have no role
      // is announced as empty by some screen readers, which showed the moves
      // visually and hid them from assistive technology.
      chip.setAttribute('role', 'listitem');
      container.appendChild(chip);
    });
  }

  /** Mark the move the person should be turning: done behind, next ahead. */
  markCurrentMove() {
    if (!this.solutionDisplay) return;
    for (const chip of this.solutionDisplay.querySelectorAll('.move-chip')) {
      const index = Number(chip.dataset.index);
      const state = movePlaybackState(index, this.currentMoveIndex);
      chip.classList.toggle('is-done', state === 'done');
      chip.classList.toggle('is-current', state === 'current');
      // The chip is the only place that says which move is next while stepping,
      // so name it for a screen reader as well as colouring it.
      chip.setAttribute('aria-current', state === 'current' ? 'true' : 'false');
    }
  }

  /**
   * The counter and the mark on the solution, both from the one cursor, so they
   * can never disagree about which move you are on.
   */
  updatePlaybackDisplay() {
    this.moveCounterEl.textContent = playbackCounterText(
      this.currentMoveIndex,
      this.solution.length,
    );
    this.markCurrentMove();
  }

  updateHistoryDisplay() {
    this.renderMoves(this.scrambleDisplay, this.history.scramble);
    this.renderMoves(this.solutionDisplay, this.history.solution);
    this.markCurrentMove();
  }

  copyHistory() {
    const text = `Scramble: ${this.history.format(this.history.scramble)}\nSolution: ${this.history.format(this.history.solution)}`;
    return this.copyText(text, 'Copied!');
  }

  /**
   * Put text on the clipboard, or say why it could not be done.
   *
   * The async Clipboard API only exists in a secure context. Opening the app
   * over plain http on the LAN is supported (see isLocalOrigin), and there
   * navigator.clipboard is undefined - yet both copy buttons called
   * navigator.clipboard.writeText directly, so pressing either threw a
   * TypeError, copied nothing, and left the status line untouched. Fall back to
   * the old textarea + execCommand('copy') path, which still works there, and
   * report a readable failure when even that is refused.
   */
  async copyText(text, successMessage) {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(text);
        this.setStatus(successMessage, 'success');
        return true;
      } catch (err) {
        // A permissions policy or an unfocused document can reject the async
        // API while execCommand still works, so try that before giving up.
      }
    }
    if (this.execCommandCopy(text)) {
      this.setStatus(successMessage, 'success');
      return true;
    }
    this.setStatus(
      'Copy failed: this page is not allowed to use the clipboard. '
      + 'Select the text and copy it by hand.',
      'error',
    );
    return false;
  }

  /**
   * The pre-Clipboard-API copy path.
   *
   * execCommand only acts on a selection, so the scratch textarea has to be in
   * the document and selected; it is removed again straight away so nothing is
   * left behind on the page. It is moved off-screen rather than hidden because
   * a display:none element cannot be selected.
   */
  execCommandCopy(text) {
    if (typeof document === 'undefined' || !document.body
      || typeof document.execCommand !== 'function') {
      return false;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    let copied = false;
    try {
      area.select();
      copied = document.execCommand('copy') === true;
    } catch (err) {
      copied = false;
    } finally {
      document.body.removeChild(area);
    }
    return copied;
  }

  /** Copy a deep link with the current facelet to the clipboard. */
  copyLink() {
    const facelet = this.currentFacelet || '';
    // currentFacelet follows the displayed state, and the displayed state can
    // be the picker's: 54 characters where every unpainted sticker is '?', or
    // nothing at all. Copying that wrote ?s=???... into the link, which the
    // loader rejects as "expected 54 chars" (or, worse, hands to the backend as
    // a cube it cannot read). Refuse and say what is missing instead.
    if (!isCompleteFacelet(facelet)) {
      this.setStatus(
        'Cannot copy a link yet: the cube on screen is not complete. '
        + 'Fill in all 54 stickers, load a facelet, or scan a cube first.',
        'error',
      );
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('s', facelet);
    return this.copyText(url.toString(), 'Link copied!');
  }

  /** Load facelet from ?s= URL parameter on page load. */
  loadDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const facelet = params.get('s');
    if (!facelet) return;
    if (facelet.length !== STICKER_TOTAL) {
      this.setStatus(`Invalid facelet in URL: expected ${STICKER_TOTAL} chars`, 'error');
      return;
    }
    this.faceletInput.value = facelet;
    this.loadFacelet();
  }

  /** Start the 15s inspection countdown before the solve timer begins. */
  startInspection() {
    if (this.inspectionActive) return;
    this.inspectionActive = true;
    this.inspectionTimeLeft = 15000;
    this.updateInspectionDisplay();
    this.inspectionInterval = setInterval(() => {
      this.inspectionTimeLeft -= 100;
      if (this.inspectionTimeLeft <= 0) {
        this.inspectionTimeLeft = 0;
        this.endInspection();
        // Start the clock from this countdown itself. A second setTimeout used
        // to do it, but endInspection() cleared that timeout when the countdown
        // hit zero, so the status said "timer running!" while the clock stayed
        // at 00:00.00 for the whole solve.
        this.timer.start();
        this.startTimerDisplay();
        this.setStatus('Inspection over — timer running!', 'info');
        return;
      }
      this.updateInspectionDisplay();
    }, 100);
  }

  endInspection() {
    this.inspectionActive = false;
    if (this.inspectionInterval) {
      clearInterval(this.inspectionInterval);
      this.inspectionInterval = null;
    }
    if (this.inspectionTimeout) {
      clearTimeout(this.inspectionTimeout);
      this.inspectionTimeout = null;
    }
    this.inspectionTimeLeft = 0;
    this.updateInspectionDisplay();
  }

  updateInspectionDisplay() {
    const el = document.getElementById('inspection-timer');
    if (!el) return;
    if (!this.inspectionActive) {
      el.textContent = '';
      el.classList.remove('active', 'warning');
      return;
    }
    el.classList.add('active');
    el.classList.toggle('warning', this.inspectionTimeLeft <= 3000);
    const sec = Math.ceil(this.inspectionTimeLeft / 1000);
    el.textContent = `Inspection: ${sec}s`;
  }

  async invertScramble() {
    if (this.history.scramble.length === 0) { this.setStatus('No scramble', 'error'); return; }
    const inverted = this.history.scramble.slice().reverse().map(invertMove);
    this.clearManualMoves();
    await this.cube.playSolution(inverted);
    this.syncRenderedFacelet();
    this.history.setScramble(inverted);
    this.updateHistoryDisplay();
    this.setStatus('Inverted', 'success');
  }

  optimizeSolution() {
    if (this.history.solution.length === 0) { this.setStatus('No solution', 'error'); return; }
    // The cursor holds a place in the current list; replacing the list under a
    // half-played solution would move that place onto a different move.
    if (this.isPlaying || this.currentMoveIndex > 0) {
      this.setStatus('Finish or reset playback before optimizing the solution.', 'error');
      return;
    }
    const before = this.history.solution.length;
    const optimized = optimizeMoves(this.history.solution);
    this.history.setSolution(optimized);
    // The history is only the text on screen; Play follows this.solution. Left
    // stale, the cube played the unoptimized list while the history showed the
    // shorter one.
    this.solution = optimized.slice();
    this.currentMoveIndex = 0;
    this.updateHistoryDisplay();
    this.updatePlaybackDisplay();
    this.setStatus(`Optimized: ${before} to ${optimized.length} moves`, 'success');
  }

  clearHistory() {
    // The history is the visible copy of this.solution, but Play follows
    // this.solution and the cursor. Emptying only the text left the old list
    // perfectly playable: the panel showed no moves while Play replayed them
    // onto a cube that no longer described them. Clear the list, the cursor and
    // the solved state with the display, and stop any playback in progress so
    // the loop cannot carry on against a list nobody can see. pause() is used
    // rather than clearing isPlaying by hand because it also stops the solve
    // clock and its display, which the completion branch would otherwise do.
    if (this.isPlaying) this.pause();
    // A solve already on the wire would land after this Clear and put back the
    // list the user just removed. solve() drops any reply whose request id is
    // no longer current, so bump it here.
    this.solveRequestId = (this.solveRequestId || 0) + 1;
    this.solution = [];
    this.solvedState = null;
    this.solvedInputFacelet = null;
    this.currentMoveIndex = 0;
    this.history.clear();
    // MoveHistory.clear() also drops the hand-typed moves, so the Undo stack
    // has to be emptied with them or the button would undo a move that is no
    // longer listed.
    this.clearManualMoves();
    this.updateHistoryDisplay();
    this.clearPrediction();
    this.updatePlaybackDisplay();
    this.setStatus('Cleared', 'info');
  }

  saveTime() {
    const elapsed = this.timer.getElapsed();
    if (elapsed <= 0) return;
    const times = this.readBestTimes();
    times.push({ time: elapsed, date: Date.now() });
    times.sort((a, b) => a.time - b.time);
    this.writeBestTimes(times.slice(0, 10));
    this.stats.addTime(elapsed);
    this.updateBestTimesDisplay();
    this.updateStatsDisplay();
  }

  updateStatsDisplay() {
    const statsEl = document.getElementById('speedcubing-stats');
    if (!statsEl) return;
    const ao5 = this.stats.getAo5();
    const ao12 = this.stats.getAo12();
    const mo3 = this.stats.getMo3();
    const count = this.stats.getCount();

    statsEl.innerHTML = '';
    const items = [
      { label: 'ao5', value: ao5, desc: 'Average of 5' },
      { label: 'ao12', value: ao12, desc: 'Average of 12' },
      { label: 'mo3', value: mo3, desc: 'Mean of 3' },
      { label: 'solves', value: count, desc: 'Total solves' },
    ];
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'stat-item';
      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = item.label;
      const val = document.createElement('span');
      val.className = 'stat-value';
      val.textContent = item.label === 'solves' ? String(item.value) : this.stats.formatTime(item.value);
      div.appendChild(label);
      div.appendChild(val);
      statsEl.appendChild(div);
    });
  }

  /**
   * The ten stored best times, or an empty list when the store is unusable.
   *
   * localStorage can throw outright (private browsing modes, blocked cookies,
   * a file:// page), and the string it holds can stop parsing (a half-written
   * entry, another tab, a hand edit). Both used to escape: this read runs from
   * init() to paint the best-times list, so one bad value stopped the rest of
   * the page booting, and saveTime() calls it at the end of every solve. A
   * broken store should mean "no history", not a broken app.
   */
  readBestTimes() {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem('rubik-best-times') || '[]');
    } catch (err) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && Number.isFinite(entry.time));
  }

  /** Store the best-times list, ignoring a store that will not take it. */
  writeBestTimes(times) {
    try {
      localStorage.setItem('rubik-best-times', JSON.stringify(times));
    } catch (err) {
      // The solve still shows for this visit; there is nowhere to persist it.
    }
  }

  updateBestTimesDisplay() {
    const times = this.readBestTimes();
    this.bestTimesDisplay.innerHTML = '';
    times.slice(0, 5).forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'best-time-entry' + (i === 0 ? ' best' : '');
      div.textContent = `${i + 1}. ${this.timer.formatTime(entry.time)}`;
      this.bestTimesDisplay.appendChild(div);
    });
  }

  clearBestTimes() {
    try {
      localStorage.removeItem('rubik-best-times');
    } catch (err) {
      // Nothing to remove from a store that cannot be reached; the lists are
      // repainted empty below either way.
    }
    this.stats.clear();
    this.updateBestTimesDisplay();
    this.updateStatsDisplay();
    this.setStatus('Times cleared', 'info');
  }

  setStatus(message, type = 'info') {
    this.statusEl.textContent = message;
    this.statusEl.className = `status status-${type}`;
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        if (this.statusEl.textContent === message) {
          this.statusEl.textContent = '';
          this.statusEl.className = 'status';
        }
      }, 8000);
    }
  }
  /**
   * Honour the operating system's reduced-motion setting.
   *
   * This used to live in an initAccessibility() that the boot sequence no longer
   * called, so `reducedMotion` was never assigned: every move kept animating
   * and the speed slider stayed live for people who had asked their system not
   * to animate things.
   */
  initAccessibility() {
    const query = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.reducedMotion = Boolean(query && query.matches);
    this.applyReducedMotion(this.reducedMotion);
    if (query && query.addEventListener) {
      query.addEventListener('change', (event) => {
        this.reducedMotion = event.matches;
        this.applyReducedMotion(event.matches);
        this.announce(event.matches ? 'Reduced motion enabled' : 'Reduced motion disabled');
      });
    }
  }

  /** Make the cube jump instead of glide, and retire the speed control, or undo that. */
  applyReducedMotion(enabled) {
    if (enabled) {
      this.cube.setMoveDuration(0);
      if (this.speedSlider) this.speedSlider.disabled = true;
    } else {
      if (this.speedSlider) this.speedSlider.disabled = false;
      this.cube.setMoveDuration(Number(this.speedSlider ? this.speedSlider.value : 0));
    }
    this.updateSpeedLabel();
  }

  // The header carries a theme button and a colourblind button. Each needs a
  // preference to write somewhere and something to apply, or pressing it does
  // nothing at all, which is what these two buttons used to do.
  restorePreferences() {
    const prefersDark = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.setTheme(this.readPreference('rubik-theme') || (prefersDark ? 'dark' : 'light'), false);
    if (this.readPreference('rubik-cb-mode') === 'true') {
      this.enableColorblindMode(false);
    }
  }

  readPreference(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null; // private browsing: the choice simply does not persist
    }
  }

  writePreference(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      // Nothing to be done about it: the toggle still works for this visit.
    }
  }

  setTheme(theme, remember = true) {
    const dark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (this.themeIcon) {
      this.themeIcon.textContent = dark ? '☀️' : '🌙';
    }
    if (this.themeToggle) {
      this.themeToggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
      this.themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
    if (remember) {
      this.writePreference('rubik-theme', dark ? 'dark' : 'light');
    }
  }

  toggleTheme() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.setTheme(dark ? 'light' : 'dark');
    this.announce(dark ? 'Light mode' : 'Dark mode');
  }

  toggleColorblindMode() {
    if (this.colorblindMode) {
      this.disableColorblindMode();
    } else {
      this.enableColorblindMode(true);
    }
  }

  enableColorblindMode(announceChange) {
    this.colorblindMode = true;
    document.documentElement.classList.add('cb-mode');
    this.applyPalette(CB_FACE_COLOURS);
    if (this.cbToggle) {
      this.cbToggle.setAttribute('aria-pressed', 'true');
    }
    this.writePreference('rubik-cb-mode', 'true');
    if (announceChange) {
      this.announce('Colour-blind friendly palette on');
      this.setStatus('High-contrast colours and sticker patterns applied.', 'success');
    }
  }

  disableColorblindMode() {
    this.colorblindMode = false;
    document.documentElement.classList.remove('cb-mode');
    this.applyPalette(FACE_COLOURS);
    if (this.cbToggle) {
      this.cbToggle.setAttribute('aria-pressed', 'false');
    }
    this.writePreference('rubik-cb-mode', 'false');
    this.announce('Standard palette restored');
    this.setStatus('Standard palette restored.', 'info');
  }

  applyPalette(palette) {
    for (const [face, { hex }] of Object.entries(palette)) {
      COLORS[face] = parseInt(hex.slice(1), 16);
    }
    // A stored preference is applied while the page is still starting, and the
    // cube may not exist yet.
    if (this.cube) {
      this.cube.updateStickers(this.currentFacelet);
    }
    if (this.cubeInput) {
      this.cubeInput.refresh();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => new App());
