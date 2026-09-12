/** Speedcubing statistics: ao5, ao12, mo3 from stored solve times. */
export class SpeedcubingStats {
  constructor(storageKey = 'rubik-solve-times') {
    this.storageKey = storageKey;
  }

  getTimes() {
    return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
  }

  addTime(ms) {
    if (ms <= 0) return;
    const times = this.getTimes();
    times.push({ time: ms, date: Date.now() });
    localStorage.setItem(this.storageKey, JSON.stringify(times));
    return times;
  }

  clear() {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Calculate average of N: drop best and worst, average the rest.
   * If fewer than N times exist, returns null.
   */
  averageOf(n) {
    const times = this.getTimes();
    if (times.length < n) return null;
    const recent = times.slice(-n).map(t => t.time).sort((a, b) => a - b);
    const middle = recent.slice(1, -1); // drop best and worst
    const sum = middle.reduce((a, b) => a + b, 0);
    return sum / middle.length;
  }

  /**
   * Mean of N: average all N without dropping.
   * If fewer than N times exist, returns null.
   */
  meanOf(n) {
    const times = this.getTimes();
    if (times.length < n) return null;
    const recent = times.slice(-n).map(t => t.time);
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / n;
  }

  getAo5() { return this.averageOf(5); }
  getAo12() { return this.averageOf(12); }
  getMo3() { return this.meanOf(3); }

  formatTime(ms) {
    if (ms == null) return '-';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const cs = Math.floor((ms % 1000) / 10);
    if (min > 0) {
      return `${min}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    }
    return `${sec}.${String(cs).padStart(2, '0')}`;
  }

  getCount() {
    return this.getTimes().length;
  }
}
