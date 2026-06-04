/**
 * @file Statistics store.
 *
 * Tracks aggregate play data plus a high-score system:
 *   - games played / completed, win rate, average time
 *   - overall best time, current / longest streak, total score
 *   - highScore         : highest single-game score ever
 *   - bestScoreByDiff   : highest score per difficulty
 *   - fastestByDiff     : fastest completion time (ms) per difficulty
 *
 * Persists via Storage under the existing `sudoku.stats.v1` key. Older saves
 * (which lack the high-score fields) are migrated forward on load by merging
 * over DEFAULTS — no existing data is discarded.
 */

import { Storage } from './storage.js';

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'expert', 'extreme', 'nightmare']);

const DEFAULTS = Object.freeze({
  played: 0,
  completed: 0,
  bestTimeMs: null,
  totalTimeMs: 0,
  currentStreak: 0,
  longestStreak: 0,
  totalScore: 0,
  highScore: 0,
  bestScoreByDiff: {},
  fastestByDiff: {},
});

/** Build live state from a saved blob, cloning nested maps so DEFAULTS is never shared/mutated. */
function fromSaved(saved) {
  const s = saved || {};
  return {
    ...DEFAULTS,
    ...s,
    bestScoreByDiff: { ...(s.bestScoreByDiff || {}) },
    fastestByDiff: { ...(s.fastestByDiff || {}) },
  };
}

export function createStats() {
  let state = fromSaved(Storage.loadStats());
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

    recordWin({ timeMs, score, difficulty }) {
      const sc = score || 0;
      const next = {
        ...state,
        completed: state.completed + 1,
        totalTimeMs: state.totalTimeMs + timeMs,
        totalScore: state.totalScore + sc,
        currentStreak: state.currentStreak + 1,
        bestScoreByDiff: { ...state.bestScoreByDiff },
        fastestByDiff: { ...state.fastestByDiff },
      };
      if (!next.bestTimeMs || timeMs < next.bestTimeMs) next.bestTimeMs = timeMs;
      if (next.currentStreak > next.longestStreak) next.longestStreak = next.currentStreak;
      if (sc > next.highScore) next.highScore = sc;

      const d = VALID_DIFFICULTIES.has(difficulty) ? difficulty : null;
      if (d) {
        if (sc > (next.bestScoreByDiff[d] || 0)) next.bestScoreByDiff[d] = sc;
        const prevFast = next.fastestByDiff[d];
        if (prevFast == null || timeMs < prevFast) next.fastestByDiff[d] = timeMs;
      }

      state = next;
      notify();
    },

    recordLoss() {
      state = { ...state, currentStreak: 0 };
      notify();
    },

    reset() {
      state = { ...DEFAULTS, bestScoreByDiff: {}, fastestByDiff: {} };
      notify();
    },
  };
}
