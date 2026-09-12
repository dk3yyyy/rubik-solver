/* Rubik's Cube Solver — frontend */

import {
  FACES,
  FACE_CELLS,
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

class App {
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
    this.faceletInput = document.getElementById('facelet-input');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedLabelEl = document.getElementById('speed-label');
    this.inputStatusEl = document.getElementById('cube-input-status');
    this.predictionEl = document.getElementById('move-prediction');
    this.cubeInput = null;
    this.predictionTimer = null;
    this.lastMirrored = null;
    this.solvedInputFacelet = null;
    this.stats = new SpeedcubingStats();
    this.inspectionActive = false;
    this.inspectionTimeLeft = 0;
    this.inspectionInterval = null;
    this.inspectionTimeout = null;
    this.solveStartTime = null;
    this.manualMoveStack = [];
    this.movePreviewEl = null;
    this.movePreviewMovesEl = null;

    this.init();
  }



  bindEvents() {
    document.getElementById('btn-scramble').addEventListener('click', () => this.scramble());
    document.getElementById('btn-solve').addEventListener('click', () => this.solveAndPlay());
    document.getElementById('btn-reset').addEventListener('click', () => this.reset());
    document.getElementById('btn-play').addEventListener('click', () => this.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.pause());
    document.getElementById('btn-next').addEventListener('click', () => this.next());
    document.getElementById('btn-prev').addEventListener('click', () => this.prev());
    document.getElementById('btn-load').addEventListener('click', () => this.loadFacelet());
    document.getElementById('btn-webcam').addEventListener('click', () => this.webcam());
    document.getElementById('webcam-capture').addEventListener('click', () => this.captureFace());
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
        this.cube.enqueue(map[e.key], true);
        this.history.addMove(map[e.key]);
        this.updateHistoryDisplay();
      }
    });

    this.speedSlider.addEventListener('input', (e) => {
      this.cube.setMoveDuration(Number(e.target.value));
      this.updateSpeedLabel();
    });
  }

  async scramble() {
    this.setStatus('Generating scramble...', 'loading');
    try {
      const data = await readApiResponse(await fetch(api('/scramble')));

      this.cube.reset();
      this.scrambleMoves = data.scramble.split(' ').filter(Boolean);
      this.solution = [];
      this.solvedState = null;
      this.currentMoveIndex = 0;

      this.timer.reset();
      this.endInspection();
      this.stopTimerDisplay();

      this.history.setScramble(this.scrambleMoves);
      // The scramble replaces the cube, so a solution for the previous one is no
      // longer about anything on screen.
      this.history.setSolution([]);
      this.updateHistoryDisplay();

      await this.cube.playSolution(this.scrambleMoves);
      this.currentFacelet = data.state;
      this.cube.updateStickers(data.state);
      this.solvedInputFacelet = null;
      this.cubeInput.setFacelet(data.state);

      this.moveCounterEl.textContent = `Scrambled: ${this.scrambleMoves.length} moves`;
      this.setStatus('Scrambled! Click "Solve" to find a solution.', 'success');
    } catch (err) {
      this.setStatus(this.apiError(err), 'error');
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
    // When inspection ends, start the timer.
    this.inspectionTimeout = setTimeout(() => {
      this.timer.start();
      this.startTimerDisplay();
    }, 15000);
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
      return;
    }

    const facelet = (state && state.complete)
      ? state.facelet
      : (this.faceletInput.value.trim().toUpperCase() || this.currentFacelet);

    if (!facelet || facelet.length !== STICKER_TOTAL) {
      this.setStatus('Fill in all 54 stickers, or paste a facelet string', 'error');
      return;
    }

    this.setStatus('Solving...', 'loading');
    try {
      const data = await readApiResponse(await fetch(api('/solve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: facelet })
      }));

      this.solution = data.solution.split(' ').filter(Boolean);
      this.solvedState = data.solved_state;
      this.currentMoveIndex = 0;
      this.isPlaying = false;
      this.solvedInputFacelet = facelet;
      this.history.setSolution(this.solution);
      this.updateHistoryDisplay();

      this.showPrediction(data.move_count, this.solution.length === 0);
      this.updatePlaybackDisplay();
      this.setStatus(
        this.solution.length
          ? `Your cube needs ${data.move_count} moves. `
            + 'Set the speed, then press Play to follow along, or use Next to step through.'
          : 'That cube is already solved, so no moves are needed.',
        'success',
      );
    } catch (err) {
      this.clearPrediction();
      this.setStatus(this.apiError(err), 'error');
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
      this.cube.updateStickers(painted <= FACE_COUNT ? SOLVED_FACELET : state.facelet);
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
    const ms = Number(this.speedSlider.value);
    this.speedLabelEl.textContent = `${(ms / 1000).toFixed(2)}s per move`;
  }

  /** Turn a failed request into something the user can act on. */
  apiError(err) {
    const origin = typeof window !== 'undefined' ? window.location.origin : null;
    return describeApiError(err, API_BASE || null, origin);
  }

  async play() {
    if (this.isPlaying || this.currentMoveIndex >= this.solution.length) return;
    // A queued prediction would otherwise reset the solution mid-playback.
    clearTimeout(this.predictionTimer);
    this.isPlaying = true;
    this.timer.start();
    this.startTimerDisplay();

    // Checking isPlaying each step is what lets Pause stop playback instead of
    // letting the whole solution play out.
    while (this.isPlaying && this.currentMoveIndex < this.solution.length) {
      const move = this.solution[this.currentMoveIndex];
      this.currentMoveIndex += 1;
      await this.cube.enqueue(move, true);
      this.updatePlaybackDisplay();
    }

    if (this.currentMoveIndex >= this.solution.length) {
      this.isPlaying = false;
      this.timer.stop();
      this.stopTimerDisplay();
      this.verifyRenderedState();
      this.saveTime();
    }
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
  }

  async next() {
    if (this.currentMoveIndex < this.solution.length) {
      const move = this.solution[this.currentMoveIndex];
      this.currentMoveIndex += 1;
      await this.cube.enqueue(move, true);
      this.updatePlaybackDisplay();
      if (this.currentMoveIndex === this.solution.length) this.verifyRenderedState();
    }
  }

  async prev() {
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      this.currentMoveIndex -= 1;
      await this.cube.enqueue(invertMove(move), true);
      this.updatePlaybackDisplay();
    }
  }

  reset() {
    this.cube.reset();
    this.solution = [];
    this.scrambleMoves = [];
    this.solvedState = null;
    this.solvedInputFacelet = null;
    this.currentFacelet = SOLVED_FACELET;
    this.currentMoveIndex = 0;
    this.isPlaying = false;
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

      this.cube.reset();
      this.cube.updateStickers(facelet);
      this.currentFacelet = facelet;
      this.solvedState = null;
      this.solvedInputFacelet = null;
      this.cubeInput.setFacelet(facelet);
      this.setStatus('Cube loaded. Press Solve to predict the moves.', 'success');
    } catch (err) {
      this.setStatus(this.apiError(err), 'error');
    }
  }

  async webcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    this.capturedFaces = [];
    this.lastCapturePixels = null;
    this.updateWebcamHint();
    panel.hidden = false;

    // mediaDevices only exists in a secure context, so a phone opening the app
    // over plain http on the local network has no camera API at all.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setStatus(
        'This page cannot reach the camera. Browsers only allow it over https or on '
        + 'localhost, so open the app at http://localhost:8000 rather than a network address.',
        'error',
      );
      panel.hidden = true;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      this.currentStream = stream;
      // autoplay is subject to browser policy. Asking explicitly means a stream
      // that never starts is reported here, rather than arriving at the scanner
      // as six black frames it cannot read.
      await video.play();
    } catch (err) {
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

    this.capturedFaces.push(canvas.toDataURL('image/jpeg', 0.9));
    this.updateWebcamHint();

    if (this.capturedFaces.length === FACE_COUNT) {
      await this.scanCapturedFaces();
    } else {
      const caught = SCAN_FACES[this.capturedFaces.length - 1];
      this.setStatus(`Captured ${caught ? caught.colour : 'face'} (${this.capturedFaces.length}/${FACE_COUNT})`, 'info');
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

      this.cube.reset();
      this.cube.updateStickers(data.state);
      this.currentFacelet = data.state;
      this.solvedState = null;
      this.solvedInputFacelet = null;
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

  closeWebcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }
    video.srcObject = null;
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
    navigator.clipboard.writeText(text)
      .then(() => this.setStatus('Copied!', 'success'))
      .catch(() => this.setStatus('Copy failed', 'error'));
  }

  /** Copy a deep link with the current facelet to the clipboard. */
  copyLink() {
    const facelet = this.currentFacelet || SOLVED_FACELET;
    const url = new URL(window.location.href);
    url.searchParams.set('s', facelet);
    navigator.clipboard.writeText(url.toString())
      .then(() => this.setStatus('Link copied!', 'success'))
      .catch(() => this.setStatus('Copy failed', 'error'));
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
        this.setStatus('Inspection over — timer running!', 'info');
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

  invertScramble() {
    if (this.history.scramble.length === 0) { this.setStatus('No scramble', 'error'); return; }
    const inverted = this.history.scramble.slice().reverse().map(invertMove);
    this.cube.playSolution(inverted);
    this.history.setScramble(inverted);
    this.updateHistoryDisplay();
    this.setStatus('Inverted', 'success');
  }

  optimizeSolution() {
    if (this.history.solution.length === 0) { this.setStatus('No solution', 'error'); return; }
    const before = this.history.solution.length;
    const optimized = optimizeMoves(this.history.solution);
    this.history.setSolution(optimized);
    this.updateHistoryDisplay();
    this.setStatus(`Optimized: ${before} to ${optimized.length} moves`, 'success');
  }

  clearHistory() {
    this.history.clear();
    this.updateHistoryDisplay();
    this.setStatus('Cleared', 'info');
  }

  saveTime() {
    const elapsed = this.timer.getElapsed();
    if (elapsed <= 0) return;
    const times = JSON.parse(localStorage.getItem('rubik-best-times') || '[]');
    times.push({ time: elapsed, date: Date.now() });
    times.sort((a, b) => a.time - b.time);
    localStorage.setItem('rubik-best-times', JSON.stringify(times.slice(0, 10)));
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

  updateBestTimesDisplay() {
    const times = JSON.parse(localStorage.getItem('rubik-best-times') || '[]');
    this.bestTimesDisplay.innerHTML = '';
    times.slice(0, 5).forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'best-time-entry' + (i === 0 ? ' best' : '');
      div.textContent = `${i + 1}. ${this.timer.formatTime(entry.time)}`;
      this.bestTimesDisplay.appendChild(div);
    });
  }

  clearBestTimes() {
    localStorage.removeItem('rubik-best-times');
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
}

document.addEventListener('DOMContentLoaded', () => new App());
