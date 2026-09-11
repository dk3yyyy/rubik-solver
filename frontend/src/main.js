/* Rubik's Cube Solver — frontend */

import {
  FACES,
  FACE_CELLS,
  FACE_NORMALS,
  STICKER_PLACEMENTS,
  invertMove,
  moveToRotation,
  optimizeMoves,
} from './cube-logic.js';

const COLORS = {
  U: 0xffffff, D: 0xffd500, F: 0x009b48,
  B: 0x0046ad, L: 0xff5900, R: 0xb71234, interior: 0x1a1a1a
};

const SOLVED_FACELET = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
const FACE_COUNT = 6;

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
    this.timerDisplay = document.getElementById('timer');
    this.statusEl = document.getElementById('status');
    this.moveCounterEl = document.getElementById('move-counter');
    this.scrambleDisplay = document.getElementById('history-scramble');
    this.solutionDisplay = document.getElementById('history-solution');
    this.bestTimesDisplay = document.getElementById('best-times');
    this.webcamHint = document.getElementById('webcam-hint');
    this.faceletInput = document.getElementById('facelet-input');
    this.speedSlider = document.getElementById('speed-slider');

    this.init();
  }

  init() {
    const container = document.getElementById('cube-canvas');
    this.cube = new Cube3D(container);
    this.cube.setMoveDuration(Number(this.speedSlider.value));
    this.bindEvents();
    this.updateBestTimesDisplay();
    this.setStatus('Ready. Click "Scramble" to start.', 'info');
  }

  bindEvents() {
    document.getElementById('btn-scramble').addEventListener('click', () => this.scramble());
    document.getElementById('btn-solve').addEventListener('click', () => this.solve());
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

    this.faceletInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadFacelet();
    });

    document.addEventListener('keydown', (e) => {
      const map = { 'u': "U'", 'U': 'U', 'd': "D'", 'D': 'D', 'l': "L'", 'L': 'L', 'r': "R'", 'R': 'R', 'f': "F'", 'F': 'F', 'b': "B'", 'B': 'B' };
      if (map[e.key] && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        this.cube.enqueue(map[e.key], true);
        this.history.addMove(map[e.key]);
        this.updateHistoryDisplay();
      }
    });

    this.speedSlider.addEventListener('input', (e) => {
      this.cube.setMoveDuration(Number(e.target.value));
    });
  }

  async scramble() {
    this.setStatus('Generating scramble...', 'loading');
    try {
      const res = await fetch(api('/scramble'));
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      this.cube.reset();
      this.scrambleMoves = data.scramble.split(' ').filter(Boolean);
      this.solution = [];
      this.solvedState = null;
      this.currentMoveIndex = 0;

      this.timer.reset();
      this.timer.start();
      this.updateTimerDisplay();

      this.history.setScramble(this.scrambleMoves);
      this.updateHistoryDisplay();

      await this.cube.playSolution(this.scrambleMoves);
      this.currentFacelet = data.state;
      this.cube.updateStickers(data.state);
      this.faceletInput.value = data.state;

      this.timer.stop();
      this.updateTimerDisplay();
      this.moveCounterEl.textContent = `Scrambled: ${this.scrambleMoves.length} moves`;
      this.setStatus('Scrambled! Click "Solve" to find a solution.', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  async solve() {
    let facelet = this.faceletInput.value.trim().toUpperCase();

    if (!facelet || facelet.length !== 54) {
      if (this.currentFacelet) facelet = this.currentFacelet;
      else { this.setStatus('Enter a 54-character facelet string first', 'error'); return; }
    }

    this.setStatus('Solving...', 'loading');
    try {
      const res = await fetch(api('/solve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: facelet })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Server returned ${res.status}`);

      this.solution = data.solution.split(' ').filter(Boolean);
      this.solvedState = data.solved_state;
      this.currentMoveIndex = 0;
      this.history.setSolution(this.solution);
      this.updateHistoryDisplay();

      this.moveCounterEl.textContent = `${data.move_count} moves`;
      this.setStatus(
        this.solution.length ? `Solution (${data.move_count} moves): ${data.solution}` : 'Cube is already solved',
        'success'
      );
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  async play() {
    if (this.isPlaying || this.currentMoveIndex >= this.solution.length) return;
    this.isPlaying = true;
    this.timer.start();
    this.updateTimerDisplay();

    await this.cube.playSolution(this.solution.slice(this.currentMoveIndex));
    this.currentMoveIndex = this.solution.length;
    this.isPlaying = false;

    this.timer.stop();
    this.updateTimerDisplay();
    this.moveCounterEl.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
    this.verifyRenderedState();
    this.saveTime();
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
    this.isPlaying = false;
    this.timer.stop();
    this.updateTimerDisplay();
  }

  async next() {
    if (this.currentMoveIndex < this.solution.length) {
      const move = this.solution[this.currentMoveIndex];
      this.currentMoveIndex += 1;
      await this.cube.enqueue(move, true);
      this.moveCounterEl.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
      if (this.currentMoveIndex === this.solution.length) this.verifyRenderedState();
    }
  }

  async prev() {
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      this.currentMoveIndex -= 1;
      await this.cube.enqueue(invertMove(move), true);
      this.moveCounterEl.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
    }
  }

  reset() {
    this.cube.reset();
    this.solution = [];
    this.scrambleMoves = [];
    this.solvedState = null;
    this.currentFacelet = SOLVED_FACELET;
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.faceletInput.value = '';
    this.timer.reset();
    this.updateTimerDisplay();
    this.history.clear();
    this.updateHistoryDisplay();
    this.moveCounterEl.textContent = '0 moves';
    this.setStatus('Reset to solved state', 'info');
  }

  async loadFacelet() {
    const facelet = this.faceletInput.value.trim().toUpperCase();

    if (facelet.length !== 54) { this.setStatus('Facelet must be 54 characters', 'error'); return; }

    this.setStatus('Validating...', 'loading');
    try {
      const res = await fetch(api('/validate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: facelet })
      });
      const data = await res.json();
      if (!data.valid) { this.setStatus('Invalid: ' + data.error, 'error'); return; }

      this.cube.reset();
      this.cube.updateStickers(facelet);
      this.currentFacelet = facelet;
      this.solvedState = null;
      this.setStatus('Cube loaded!', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  async webcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    this.capturedFaces = [];
    this.updateWebcamHint();
    panel.hidden = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      this.currentStream = stream;
    } catch (err) {
      this.setStatus('Camera: ' + err.message, 'error');
      panel.hidden = true;
    }
  }

  async captureFace() {
    const video = document.getElementById('webcam-video');
    if (!video.videoWidth) { this.setStatus('Camera is not ready yet', 'error'); return; }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    this.capturedFaces.push(canvas.toDataURL('image/jpeg', 0.9));
    this.updateWebcamHint();

    if (this.capturedFaces.length === FACE_COUNT) await this.scanCapturedFaces();
    else this.setStatus(`Captured face ${this.capturedFaces.length}/${FACE_COUNT}`, 'info');
  }

  updateWebcamHint() {
    if (!this.webcamHint) return;
    const done = this.capturedFaces.length;
    this.webcamHint.textContent = done === 0
      ? 'Point the camera at one face and capture all six, in order U, R, F, D, L, B.'
      : `${done}/${FACE_COUNT} faces captured.`;
  }

  async scanCapturedFaces() {
    this.setStatus('Scanning cube...', 'loading');
    try {
      const res = await fetch(api('/webcam-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: this.capturedFaces })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Server returned ${res.status}`);

      this.cube.reset();
      this.cube.updateStickers(data.state);
      this.currentFacelet = data.state;
      this.solvedState = null;
      this.faceletInput.value = data.state;
      this.moveCounterEl.textContent = 'Scanned cube';
      this.setStatus(`Scanned cube (confidence ${Math.round(data.confidence * 100)}%)`, 'success');
      this.capturedFaces = [];
      this.closeWebcam();
    } catch (err) {
      this.setStatus('Scan failed: ' + err.message, 'error');
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

  updateTimerDisplay() {
    this.timerDisplay.textContent = this.timer.formatTime(this.timer.getElapsed());
  }

  updateHistoryDisplay() {
    this.scrambleDisplay.textContent = this.history.format(this.history.scramble);
    this.solutionDisplay.textContent = this.history.format(this.history.solution);
  }

  copyHistory() {
    const text = `Scramble: ${this.history.format(this.history.scramble)}\nSolution: ${this.history.format(this.history.solution)}`;
    navigator.clipboard.writeText(text)
      .then(() => this.setStatus('Copied!', 'success'))
      .catch(() => this.setStatus('Copy failed', 'error'));
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
    this.updateBestTimesDisplay();
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
    this.updateBestTimesDisplay();
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
