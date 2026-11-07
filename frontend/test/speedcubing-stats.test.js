/**
 * solve-time statistics are read from localStorage, and every read happened
 * during startup. Two things go wrong with a browser store in practice:
 *
 *  - it throws outright (private browsing, blocked cookies, a file:// page),
 *    and getTimes()/addTime() let that escape, so the page died on load and
 *    again at the end of each solve;
 *  - it hands back JSON that no longer parses, or a list someone edited.
 *
 * A broken store has to mean "no history", never a broken app.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SpeedcubingStats } from '../src/speedcubing-stats.js';

/** Replace localStorage for the duration of `run`, then restore it. */
function withLocalStorage(store, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

test('a healthy store records and averages solve times', () => {
  let saved = null;
  withLocalStorage({
    getItem: () => saved,
    setItem: (key, value) => { saved = value; },
    removeItem: () => { saved = null; },
  }, () => {
    const stats = new SpeedcubingStats();
    stats.addTime(1000);
    stats.addTime(2000);
    stats.addTime(3000);
    assert.equal(stats.getCount(), 3);
    // mo3 is the plain mean of the three most recent times.
    assert.equal(stats.getMo3(), 2000);
    assert.equal(stats.getAo5(), null);
    stats.clear();
    assert.equal(stats.getCount(), 0);
  });
});

test('corrupt JSON reads as an empty history instead of throwing', () => {
  withLocalStorage({
    getItem: () => '[{"time": 1000}, {"time":',
    setItem() {},
    removeItem() {},
  }, () => {
    const stats = new SpeedcubingStats();
    assert.deepEqual(stats.getTimes(), []);
    assert.equal(stats.getAo5(), null);
    assert.equal(stats.getAo12(), null);
    assert.equal(stats.getMo3(), null);
    assert.equal(stats.getCount(), 0);
  });
});

test('entries that are not times are dropped from a mix', () => {
  withLocalStorage({
    getItem: () => JSON.stringify([{ time: 1000 }, { time: null }, null, { time: 3000 }]),
    setItem() {},
    removeItem() {},
  }, () => {
    const stats = new SpeedcubingStats();
    assert.deepEqual(stats.getTimes(), [{ time: 1000 }, { time: 3000 }]);
    // Two real times are not a mean of three, so no mo3 rather than a NaN.
    assert.equal(stats.getMo3(), null);
    assert.equal(stats.formatTime(stats.getMo3()), '-');
  });
});

test('a store that refuses every operation still records nothing and throws nothing', () => {
  withLocalStorage({
    getItem() { throw new Error('SecurityError: storage is disabled'); },
    setItem() { throw new Error('QuotaExceededError'); },
    removeItem() { throw new Error('SecurityError: storage is disabled'); },
  }, () => {
    const stats = new SpeedcubingStats();
    assert.deepEqual(stats.getTimes(), []);
    assert.doesNotThrow(() => stats.addTime(12345));
    assert.doesNotThrow(() => stats.clear());
    assert.equal(stats.getCount(), 0);
  });
});
