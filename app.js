/* Rubik's Cube Solver — Complete Client-Side Application */

const COLORS = {
  U: 0xffffff, D: 0xffd500, F: 0x009b48,
  B: 0x0046ad, L: 0xff5900, R: 0xb71234, interior: 0x1a1a1a
};

class Cube3D {
  constructor(container) {
    this.container = container;
    this.cubies = [];
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
    
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.15 }));
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
    this.updateStickers('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
    
    window.addEventListener('resize', () => this.onResize());
    this.animate();
  }
  
  createCube() {
    const geo = new THREE.BoxGeometry(0.95, 0.95, 0.95);
    const stickerGeo = new THREE.PlaneGeometry(0.85, 0.85);
    const offset = 0.48;
    
    const configs = [
      { pos: [0, offset, 0], rot: [Math.PI / 2, 0, 0], face: 'U' },
      { pos: [0, -offset, 0], rot: [-Math.PI / 2, 0, 0], face: 'D' },
      { pos: [0, 0, offset], rot: [0, 0, 0], face: 'F' },
      { pos: [0, 0, -offset], rot: [0, Math.PI, 0], face: 'B' },
      { pos: [offset, 0, 0], rot: [0, Math.PI / 2, 0], face: 'R' },
      { pos: [-offset, 0, 0], rot: [0, -Math.PI / 2, 0], face: 'L' }
    ];
    
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const mat = new THREE.MeshStandardMaterial({ color: COLORS.interior, roughness: 0.5, metalness: 0.1 });
          const cubie = new THREE.Mesh(geo, mat);
          cubie.position.set(x, y, z);
          cubie.castShadow = true;
          cubie.receiveShadow = true;
          cubie.userData = { gridPos: { x, y, z } };
          
          configs.forEach(c => {
            const sticker = new THREE.Mesh(stickerGeo, new THREE.MeshStandardMaterial({ 
              color: COLORS.interior, roughness: 0.35, metalness: 0 
            }));
            sticker.position.set(...c.pos);
            sticker.rotation.set(...c.rot);
            sticker.userData.face = c.face;
            cubie.add(sticker);
          });
          
          this.scene.add(cubie);
          this.cubies.push(cubie);
        }
      }
    }
  }
  
  getCubieAt(x, y, z) {
    return this.cubies.find(c => 
      Math.round(c.position.x) === x && Math.round(c.position.y) === y && Math.round(c.position.z) === z
    );
  }
  
  updateStickers(facelet) {
    if (!facelet || facelet.length !== 54) return;
    const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
    const maps = {
      U: [[-1,1,1],[0,1,1],[1,1,1],[-1,1,0],[0,1,0],[1,1,0],[-1,1,-1],[0,1,-1],[1,1,-1]],
      R: [[1,1,1],[1,1,0],[1,1,-1],[1,0,1],[1,0,0],[1,0,-1],[1,-1,1],[1,-1,0],[1,-1,-1]],
      F: [[-1,1,1],[0,1,1],[1,1,1],[-1,0,1],[0,0,1],[1,0,1],[-1,-1,1],[0,-1,1],[1,-1,1]],
      D: [[-1,-1,1],[0,-1,1],[1,-1,1],[-1,-1,0],[0,-1,0],[1,-1,0],[-1,-1,-1],[0,-1,-1],[1,-1,-1]],
      L: [[-1,1,-1],[-1,1,0],[-1,1,1],[-1,0,-1],[-1,0,0],[-1,0,1],[-1,-1,-1],[-1,-1,0],[-1,-1,1]],
      B: [[1,1,-1],[0,1,-1],[-1,1,-1],[1,0,-1],[0,0,-1],[-1,0,-1],[1,-1,-1],[0,-1,-1],[-1,-1,-1]]
    };
    
    let idx = 0;
    for (const face of faces) {
      for (const pos of maps[face]) {
        const cubie = this.getCubieAt(pos[0], pos[1], pos[2]);
        if (cubie) {
          const sticker = cubie.children.find(s => s.userData.face === face);
          if (sticker) sticker.material.color.setHex(COLORS[facelet[idx]] || COLORS.interior);
        }
        idx++;
      }
    }
  }
  
  applyMove(move, animate = true) {
    const map = {
      'U': { axis: 'y', layer: 1, angle: -Math.PI / 2 }, "U'": { axis: 'y', layer: 1, angle: Math.PI / 2 },
      'D': { axis: 'y', layer: -1, angle: Math.PI / 2 }, "D'": { axis: 'y', layer: -1, angle: -Math.PI / 2 },
      'R': { axis: 'x', layer: 1, angle: -Math.PI / 2 }, "R'": { axis: 'x', layer: 1, angle: Math.PI / 2 },
      'L': { axis: 'x', layer: -1, angle: Math.PI / 2 }, "L'": { axis: 'x', layer: -1, angle: -Math.PI / 2 },
      'F': { axis: 'z', layer: 1, angle: -Math.PI / 2 }, "F'": { axis: 'z', layer: 1, angle: Math.PI / 2 },
      'B': { axis: 'z', layer: -1, angle: Math.PI / 2 }, "B'": { axis: 'z', layer: -1, angle: -Math.PI / 2 }
    };
    
    const data = map[move];
    if (!data) return Promise.resolve();
    
    const cubiesInLayer = this.cubies.filter(c => c.userData.gridPos[data.axis] === data.layer);
    
    if (animate) {
      return this.animateMove(cubiesInLayer, data.axis, data.angle);
    } else {
      cubiesInLayer.forEach(c => {
        c.rotateOnWorldAxis(new THREE.Vector3(data.axis === 'x' ? 1 : 0, data.axis === 'y' ? 1 : 0, data.axis === 'z' ? 1 : 0), data.angle);
        this.updateGridPos(c, data.axis, data.angle);
      });
      return Promise.resolve();
    }
  }
  
  animateMove(cubies, axis, angle) {
    return new Promise(resolve => {
      const duration = 300;
      const start = Date.now();
      let current = 0;
      
      const animate = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const delta = (eased * angle) - current;
        current = eased * angle;
        
        cubies.forEach(c => c.rotateOnWorldAxis(new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), delta));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          cubies.forEach(c => this.updateGridPos(c, axis, angle));
          resolve();
        }
      };
      animate();
    });
  }
  
  updateGridPos(cubie, axis, angle) {
    const pos = cubie.userData.gridPos;
    if (Math.abs(angle) < 0.5) return;
    
    if (axis === 'x') {
      const newY = pos.z * (angle > 0 ? -1 : 1);
      const newZ = pos.y * (angle > 0 ? 1 : -1);
      pos.y = Math.round(newY);
      pos.z = Math.round(newZ);
    } else if (axis === 'y') {
      const newX = pos.z * (angle > 0 ? 1 : -1);
      const newZ = pos.x * (angle > 0 ? -1 : 1);
      pos.x = Math.round(newX);
      pos.z = Math.round(newZ);
    } else {
      const newX = pos.y * (angle > 0 ? -1 : 1);
      const newY = pos.x * (angle > 0 ? 1 : -1);
      pos.x = Math.round(newX);
      pos.y = Math.round(newY);
    }
  }
  
  async playSolution(moves) {
    for (const move of moves) {
      await this.applyMove(move, true);
    }
  }
  
  reset() {
    this.cubies.forEach(c => {
      c.rotation.set(0, 0, 0);
      c.userData.gridPos = { x: Math.round(c.position.x), y: Math.round(c.position.y), z: Math.round(c.position.z) };
    });
    this.updateStickers('UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
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
    this.scrambleMoves = [];
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.timerDisplay = document.getElementById('timer');
    this.statusEl = document.getElementById('status');
    this.moveCounterEl = document.getElementById('move-counter');
    this.scrambleDisplay = document.getElementById('history-scramble');
    this.solutionDisplay = document.getElementById('history-solution');
    this.bestTimesDisplay = document.getElementById('best-times');
    
    this.init();
  }
  
  init() {
    const container = document.getElementById('cube-canvas');
    this.cube = new Cube3D(container);
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
    document.getElementById('btn-copy').addEventListener('click', () => this.copyHistory());
    document.getElementById('btn-invert').addEventListener('click', () => this.invertScramble());
    document.getElementById('btn-optimize').addEventListener('click', () => this.optimizeSolution());
    document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());
    document.getElementById('btn-clear-times').addEventListener('click', () => this.clearBestTimes());
    
    document.getElementById('facelet-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadFacelet();
    });
    
    document.addEventListener('keydown', (e) => {
      const map = { 'u': "U'", 'U': 'U', 'd': "D'", 'D': 'D', 'l': "L'", 'L': 'L', 'r': "R'", 'R': 'R', 'f': "F'", 'F': 'F', 'b': "B'", 'B': 'B' };
      if (map[e.key] && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        this.cube.applyMove(map[e.key], true);
        this.history.addMove(map[e.key]);
        this.updateHistoryDisplay();
      }
    });
  }
  
  async scramble() {
    this.setStatus('Generating scramble...', 'loading');
    try {
      let data;
      try {
        const res = await fetch('https://rubik-solver-api.dk3yyyy.repl.co/api/scramble');
        if (res.ok) data = await res.json();
        else throw new Error('API unavailable');
      } catch {
        const moves = this.generateScramble();
        const cube = new Cube();
        cube.move(moves);
        data = { scramble: moves, facelet: cube.asString() };
      }
      
      this.cube.reset();
      this.scrambleMoves = data.scramble.split(' ');
      this.solution = [];
      this.currentMoveIndex = 0;
      
      this.timer.reset();
      this.timer.start();
      this.updateTimerDisplay();
      
      this.history.setScramble(this.scrambleMoves);
      this.updateHistoryDisplay();
      
      await this.cube.playSolution(this.scrambleMoves);
      this.cube.updateStickers(data.facelet);
      this.cube.scrambleFacelet = data.facelet;
      
      this.moveCounterEl.textContent = `Scrambled: ${this.scrambleMoves.length} moves`;
      this.setStatus('Scrambled! Click "Solve" to find solution.', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }
  
  generateScramble() {
    const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
    const moves = [];
    let lastFace = null;
    for (let i = 0; i < 20; i++) {
      let face;
      do { face = faces[Math.floor(Math.random() * faces.length)]; } while (face === lastFace);
      lastFace = face;
      const modifier = Math.random() > 0.5 ? "'" : '';
      moves.push(face + modifier);
    }
    return moves.join(' ');
  }
  
  async solve() {
    const input = document.getElementById('facelet-input');
    let facelet = input.value.trim();
    
    if (!facelet || facelet.length !== 54) {
      if (this.cube.scrambleFacelet) facelet = this.cube.scrambleFacelet;
      else { this.setStatus('Enter a 54-char facelet string first', 'error'); return; }
    }
    
    this.setStatus('Solving...', 'loading');
    try {
      let data;
      try {
        const res = await fetch('https://rubik-solver-api.dk3yyyy.repl.co/api/solve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facelet })
        });
        if (res.ok) data = await res.json();
        else throw new Error('API unavailable');
      } catch {
        const cube = Cube.from(facelet);
        const solution = cube.solve();
        data = { solution: solution, length: solution.split(' ').length };
      }
      
      this.solution = data.solution.split(' ');
      this.currentMoveIndex = 0;
      this.history.setSolution(this.solution);
      this.updateHistoryDisplay();
      
      this.moveCounterEl.textContent = `${data.length} moves`;
      this.setStatus(`Solution: ${data.solution}`, 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }
  
  play() {
    if (this.solution.length > 0) {
      this.isPlaying = true;
      this.cube.playSolution(this.solution.slice(this.currentMoveIndex)).then(() => {
        this.timer.stop();
        this.isPlaying = false;
        this.updateTimerDisplay();
        this.saveTime();
      });
    }
  }
  
  pause() {
    this.isPlaying = false;
    this.timer.stop();
    this.updateTimerDisplay();
  }
  
  next() {
    if (this.currentMoveIndex < this.solution.length) {
      this.cube.applyMove(this.solution[this.currentMoveIndex], true);
      this.currentMoveIndex++;
      this.moveCounterEl.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
    }
  }
  
  prev() {
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      const inverse = move.includes("'") ? move.replace("'", "") : move + "'";
      this.cube.applyMove(inverse, true);
      this.currentMoveIndex--;
      this.moveCounterEl.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
    }
  }
  
  reset() {
    this.cube.reset();
    this.solution = [];
    this.scrambleMoves = [];
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.timer.reset();
    this.updateTimerDisplay();
    this.history.clear();
    this.updateHistoryDisplay();
    this.moveCounterEl.textContent = '0 moves';
    this.setStatus('Reset to solved state', 'info');
  }
  
  async loadFacelet() {
    const input = document.getElementById('facelet-input');
    const facelet = input.value.trim();
    
    if (facelet.length !== 54) { this.setStatus('Facelet must be 54 characters', 'error'); return; }
    
    this.setStatus('Validating...', 'loading');
    try {
      let valid = true;
      try {
        const res = await fetch('https://rubik-solver-api.dk3yyyy.repl.co/api/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facelet })
        });
        if (res.ok) valid = (await res.json()).valid;
      } catch {
        // Fallback: basic validation
        valid = facelet.length === 54 && /^[URFDLB]+$/.test(facelet);
      }
      
      if (!valid) { this.setStatus('Invalid cube state', 'error'); return; }
      
      this.cube.reset();
      this.cube.updateStickers(facelet);
      this.setStatus('Cube loaded!', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }
  
  updateTimerDisplay() {
    this.timerDisplay.textContent = this.timer.formatTime(this.timer.getElapsed());
    if (this.timer.running) requestAnimationFrame(() => this.updateTimerDisplay());
  }
  
  updateHistoryDisplay() {
    this.scrambleDisplay.textContent = this.history.format(this.history.scramble);
    this.solutionDisplay.textContent = this.history.format(this.history.solution);
  }
  
  copyHistory() {
    const text = `Scramble: ${this.history.format(this.history.scramble)}\nSolution: ${this.history.format(this.history.solution)}`;
    navigator.clipboard.writeText(text).then(() => this.setStatus('Copied!', 'success')).catch(() => this.setStatus('Copy failed', 'error'));
  }
  
  invertScramble() {
    if (this.history.scramble.length === 0) { this.setStatus('No scramble', 'error'); return; }
    const inv = this.history.scramble.slice().reverse().map(m => m.includes("'") ? m.replace("'", "") : m + "'");
    this.cube.playSolution(inv);
    this.history.setScramble(inv);
    this.updateHistoryDisplay();
    this.setStatus('Inverted', 'success');
  }
  
  optimizeSolution() {
    if (this.history.solution.length === 0) { this.setStatus('No solution', 'error'); return; }
    
    const optimized = [];
    for (const move of this.history.solution) {
      const face = move[0];
      const isPrime = move.includes("'");
      
      if (optimized.length > 0 && optimized[optimized.length - 1][0] === face) {
        const last = optimized[optimized.length - 1];
        const lastPrime = last.includes("'");
        if (lastPrime === isPrime) {
          optimized[optimized.length - 1] = face + '2';
        } else {
          optimized.pop();
        }
      } else {
        optimized.push(move);
      }
    }
    
    this.history.setSolution(optimized);
    this.updateHistoryDisplay();
    this.setStatus(`Optimized: ${this.history.solution.length} → ${optimized.length}`, 'success');
  }
  
  clearHistory() {
    this.history.clear();
    this.updateHistoryDisplay();
    this.setStatus('Cleared', 'info');
  }
  
  saveTime() {
    const elapsed = this.timer.getElapsed();
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
      setTimeout(() => { if (this.statusEl.textContent === message) { this.statusEl.textContent = ''; this.statusEl.className = 'status'; } }, 8000);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => new App());
