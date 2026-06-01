/**
 * @file localStorage wrapper.
 *
 * Persists three pieces of state: the current game, settings, and statistics.
 * Game state writes are debounced because the engine emits frequently.
 */

const KEY_STATE = 'sudoku.state.v2';
const KEY_SETTINGS = 'sudoku.settings.v1';
const KEY_STATS = 'sudoku.stats.v1';

const STATE_WRITE_DELAY_MS = 500;

let stateWriteTimer = null;
let pendingState = null;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function flushStateNow() {
  if (stateWriteTimer) {
    clearTimeout(stateWriteTimer);
    stateWriteTimer = null;
  }
  if (pendingState) {
    write(KEY_STATE, pendingState);
    pendingState = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushStateNow);
  window.addEventListener('beforeunload', flushStateNow);
}

export const Storage = {
  loadState() { return read(KEY_STATE); },

  /** Debounced; coalesces frequent writes. */
  saveState(state) {
    pendingState = state;
    if (stateWriteTimer) return;
    stateWriteTimer = setTimeout(() => {
      stateWriteTimer = null;
      const toWrite = pendingState;
      pendingState = null;
      if (toWrite) write(KEY_STATE, toWrite);
    }, STATE_WRITE_DELAY_MS);
  },

  /** Flush pending writes immediately (e.g. when starting a new game). */
  flushState: flushStateNow,

  clearState() {
    flushStateNow();
    try { localStorage.removeItem(KEY_STATE); } catch { /* noop */ }
  },

  loadSettings() { return read(KEY_SETTINGS); },
  saveSettings(s) { write(KEY_SETTINGS, s); },

  loadStats() { return read(KEY_STATS); },
  saveStats(s) { write(KEY_STATS, s); },
};
