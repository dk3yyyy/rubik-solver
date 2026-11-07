/** Speedcubing statistics: ao5, ao12, mo3 from stored solve times. */
export class SpeedcubingStats {
  constructor(storageKey = 'rubik-solve-times') {
    this.storageKey = storageKey;
  }

  /**
   * The stored solve list, or an empty one when the store cannot be used.
   *
   * localStorage throws outright in some private browsing modes, with blocked
   * cookies, or on a file:// page; getItem can also return JSON that no longer
   * parses (a half-written entry, another tab, a hand edit). Both used to
   * escape from here, and getTimes() runs during startup for the ao5/ao12 card,
   * so one bad value took the whole page down with it.
   */
  getTimes() {
    let raw;
    try {
      raw = localStorage.getItem(this.storageKey);
    } catch (err) {
      return [];
    }
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && Number.isFinite(entry.time));
  }

  addTime(ms) {
    if (ms <= 0) return;
    const times = this.getTimes();
    times.push({ time: ms, date: Date.now() });
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(times));
    } catch (err) {
      // Storage full or unavailable: the solve still counts for this visit,
      // there is simply nowhere to keep it.
    }
    return times;
  }

  clear() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (err) {
      // Nothing to clear in a store that cannot be reached.
    }
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
