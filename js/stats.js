/**
 * @file Statistics store.
 *
 * Tracks: games played, games completed, best time, average time, win rate,
 * current/longest streak, total score. Persists via Storage.
 */

import { Storage } from './storage.js';

const DEFAULTS = Object.freeze({
  played: 0,
  completed: 0,
  bestTimeMs: null,
  totalTimeMs: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalScore: 0,
});

export function createStats() {
  let state = { ...DEFAULTS, ...(Storage.loadStats() || {}) };
  const listeners = new Set();

  function notify() {
    Storage.saveStats(state);
    for (const fn of listeners) fn(state);
  }

  return {
    get() { return state; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    recordNewGame() {
      state = { ...state, played: state.played + 1 };
      notify();
    },

    recordWin({ timeMs, score }) {
      const next = {
        ...state,
        completed: state.completed + 1,
        totalTimeMs: state.totalTimeMs + timeMs,
        totalScore: state.totalScore + (score || 0),
        currentStreak: state.currentStreak + 1,
      };
      if (!next.bestTimeMs || timeMs < next.bestTimeMs) next.bestTimeMs = timeMs;
      if (next.currentStreak > next.longestStreak) next.longestStreak = next.currentStreak;
      state = next;
      notify();
    },

    recordLoss() {
      state = { ...state, currentStreak: 0 };
      notify();
    },

    reset() {
      state = { ...DEFAULTS };
      notify();
    },
  };
}
