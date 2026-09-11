export class Timer {
  constructor() {
    this.startTime = null;
    this.elapsed = 0;
    this.running = false;
    this.intervalId = null;
  }

  start() {
    if (this.running) return;
    this.startTime = Date.now() - this.elapsed;
    this.running = true;
    this.intervalId = setInterval(() => {
      this.elapsed = Date.now() - this.startTime;
    }, 100);
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.intervalId);
    this.running = false;
    this.elapsed = Date.now() - this.startTime;
  }

  reset() {
    clearInterval(this.intervalId);
    this.running = false;
    this.elapsed = 0;
    this.startTime = null;
  }

  getElapsed() {
    if (this.running) {
      return Date.now() - this.startTime;
    }
    return this.elapsed;
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  }

  updateDisplay(element) {
    element.textContent = this.formatTime(this.getElapsed());
  }
}
