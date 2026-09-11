import { Cube3D } from '/src/cube3d.js';
import { Timer } from '/src/timer.js';
import { MoveHistory, invertMoves, optimizeSolution } from '/src/history.js';

class App {
  constructor() {
    this.cube = null;
    this.status = document.getElementById('status');
    this.moveCounter = document.getElementById('move-counter');
    this.timer = new Timer();
    this.timerDisplay = document.getElementById('timer');
    this.history = new MoveHistory();
    this.historyScramble = document.getElementById('history-scramble');
    this.historySolution = document.getElementById('history-solution');
    this.solution = [];
    this.scrambleMoves = [];
    this.currentMoveIndex = 0;
    this.isPlaying = false;
    this.init();
  }

  init() {
    const canvasContainer = document.getElementById('cube-canvas');
    this.cube = new Cube3D(canvasContainer);
    this.bindEvents();
    this.setStatus('Ready. Click "Scramble" to start, or paste a facelet string.', 'info');
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
    document.getElementById('btn-timer-start').addEventListener('click', () => this.startTimer());
    document.getElementById('btn-timer-stop').addEventListener('click', () => this.stopTimer());
    document.getElementById('btn-timer-reset').addEventListener('click', () => this.resetTimer());
    document.getElementById('btn-copy').addEventListener('click', () => this.copyHistory());
    document.getElementById('btn-invert').addEventListener('click', () => this.invertScramble());
    document.getElementById('btn-optimize').addEventListener('click', () => this.optimizeSolution());
    document.getElementById('btn-clear-history').addEventListener('click', () => this.clearHistory());
    
    const speedSlider = document.getElementById('speed-slider');
    speedSlider.addEventListener('input', (e) => {
      this.cube.setSpeed(1100 - parseInt(e.target.value));
    });

    document.getElementById('facelet-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadFacelet();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const moveKeys = {
        'u': "U'", 'U': 'U',
        'd': "D'", 'D': 'D',
        'l': "L'", 'L': 'L',
        'r': "R'", 'R': 'R',
        'f': "F'", 'F': 'F',
        'b': "B'", 'B': 'B'
      };
      
      if (moveKeys[e.key] && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        this.cube.applyMove(moveKeys[e.key], true);
      }
    });
  }

  async scramble() {
    this.setStatus('Generating scramble...', 'loading');
    try {
      const response = await fetch('http://localhost:8000/api/scramble');
      const data = await response.json();
      
      this.cube.reset();
      this.scrambleMoves = data.scramble.split(' ');
      this.solution = [];
      this.currentMoveIndex = 0;
      
      // Auto-start timer
      this.timer.reset();
      this.timer.start();
      this.updateTimerDisplay();
      
      // Track history
      this.history.setScramble(this.scrambleMoves);
      this.updateHistoryDisplay();
      
      await this.cube.applyMoves(this.scrambleMoves, true);
      this.cube.updateStickers(data.facelet);
      this.cube.scrambleFacelet = data.facelet;
      
      this.moveCounter.textContent = `Scrambled: ${this.scrambleMoves.length} moves`;
      this.setStatus('Scrambled! Now click "Solve" or "Play" to see the solution.', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  async solve() {
    const faceletInput = document.getElementById('facelet-input');
    let facelet = faceletInput.value.trim();
    
    if (!facelet || facelet.length !== 54) {
      if (this.cube.scrambleFacelet) {
        facelet = this.cube.scrambleFacelet;
      } else {
        this.setStatus('Please enter a 54-char facelet string first', 'error');
        return;
      }
    }
    
    this.setStatus('Solving...', 'loading');
    try {
      const response = await fetch('http://localhost:8000/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facelet })
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Solve failed');
      }
      
      const data = await response.json();
      this.solution = data.solution.split(' ');
      this.currentMoveIndex = 0;
      
      this.moveCounter.textContent = `${data.length} moves`;
      this.setStatus(`Solution: ${data.solution}`, 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  play() {
    if (this.solution.length > 0) {
      this.isPlaying = true;
      this.cube.playSolution(this.solution.slice(this.currentMoveIndex)).then(() => {
        this.stopTimer();
        this.isPlaying = false;
      });
    }
  }

  pause() {
    this.isPlaying = false;
    this.cube.pause();
    this.timer.stop();
    this.updateTimerDisplay();
  }

  next() {
    if (this.currentMoveIndex < this.solution.length) {
      this.cube.applyMove(this.solution[this.currentMoveIndex], true);
      this.currentMoveIndex++;
      this.updateMoveCounter();
    }
  }

  prev() {
    if (this.currentMoveIndex > 0) {
      const move = this.solution[this.currentMoveIndex - 1];
      const inverse = move.includes("'") ? move.replace("'", "") : move + "'";
      this.cube.applyMove(inverse, true);
      this.currentMoveIndex--;
      this.updateMoveCounter();
    }
  }

  updateMoveCounter() {
    this.moveCounter.textContent = `Move ${this.currentMoveIndex}/${this.solution.length}`;
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
    this.moveCounter.textContent = '0 moves';
    this.setStatus('Reset to solved state', 'info');
  }

  async loadFacelet() {
    const faceletInput = document.getElementById('facelet-input');
    const facelet = faceletInput.value.trim();
    
    if (facelet.length !== 54) {
      this.setStatus('Facelet string must be exactly 54 characters', 'error');
      return;
    }
    
    this.setStatus('Validating...', 'loading');
    
    try {
      const response = await fetch('http://localhost:8000/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facelet })
      });
      
      const data = await response.json();
      
      if (!data.valid) {
        this.setStatus('Invalid cube: ' + data.error, 'error');
        return;
      }
      
      this.cube.reset();
      this.cube.updateStickers(facelet);
      this.setStatus('Cube loaded!', 'success');
    } catch (err) {
      this.setStatus('Error: ' + err.message, 'error');
    }
  }

  async webcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    
    panel.hidden = false;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      video.srcObject = stream;
      this.currentStream = stream;
    } catch (err) {
      this.setStatus('Camera not available: ' + err.message, 'error');
      panel.hidden = true;
    }
  }

  async captureFace() {
    const video = document.getElementById('webcam-video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'face.jpg');
      
      try {
        const response = await fetch('http://localhost:8000/api/detect/single', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        this.setStatus(`Detected: ${data.facelet}`, 'success');
      } catch (err) {
        this.setStatus('Detection failed: ' + err.message, 'error');
      }
    }, 'image/jpeg');
  }

  closeWebcam() {
    const panel = document.getElementById('webcam-panel');
    const video = document.getElementById('webcam-video');
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
    video.srcObject = null;
    panel.hidden = true;
  }

  // Timer methods
  startTimer() {
    this.timer.start();
    this.updateTimerDisplay();
  }

  stopTimer() {
    this.timer.stop();
    this.updateTimerDisplay();
  }

  resetTimer() {
    this.timer.reset();
    this.updateTimerDisplay();
  }

  updateTimerDisplay() {
    this.timer.updateDisplay(this.timerDisplay);
    if (this.timer.running) {
      requestAnimationFrame(() => this.updateTimerDisplay());
    }
  }

  // History methods
  updateHistoryDisplay() {
    this.historyScramble.textContent = this.history.format(this.history.getScramble());
    this.historySolution.textContent = this.history.format(this.history.getSolution());
  }

  copyHistory() {
    const text = this.history.summary();
    navigator.clipboard.writeText(text).then(() => {
      this.setStatus('Copied to clipboard!', 'success');
    }).catch(() => {
      this.setStatus('Failed to copy', 'error');
    });
  }

  invertScramble() {
    const scramble = this.history.getScramble();
    if (scramble.length === 0) {
      this.setStatus('No scramble to invert', 'error');
      return;
    }
    const inverted = invertMoves(scramble);
    this.cube.applyMoves(inverted, true);
    this.history.setScramble(inverted);
    this.updateHistoryDisplay();
    this.setStatus('Scramble inverted', 'success');
  }

  optimizeSolution() {
    const solution = this.history.getSolution();
    if (solution.length === 0) {
      this.setStatus('No solution to optimize', 'error');
      return;
    }
    const result = optimizeSolution(solution);
    this.history.setSolution(result.moves);
    this.updateHistoryDisplay();
    this.setStatus(`Optimized: ${solution.length} → ${result.moves.length} moves (removed ${result.removed})`, 'success');
  }

  clearHistory() {
    this.history.clear();
    this.updateHistoryDisplay();
    this.setStatus('History cleared', 'info');
  }

  setStatus(message, type = 'info') {
    this.status.textContent = message;
    this.status.className = `status status-${type}`;
    
    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        if (this.status.textContent === message) {
          this.status.textContent = '';
          this.status.className = 'status';
        }
      }, 8000);
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
