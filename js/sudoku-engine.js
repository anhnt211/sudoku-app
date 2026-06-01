/**
 * @file Sudoku engine — pure game state. No DOM.
 *
 * Owns:
 *   - puzzle / solution / givens (immutable per game)
 *   - board / notes / mistakes / elapsedMs / selected / memoMode / paused
 *   - completion + gameOver flags
 *   - undo history
 *   - the active timer
 *
 * Exposes two event streams to consumers:
 *   - subscribe(fn)     → invoked on any *state* change (board, selection, …)
 *   - subscribeTick(fn) → invoked once per timer tick (clock-only redraw)
 *
 * This separation lets the UI avoid full re-renders for the second-by-second
 * timer update.
 */

import { generatePuzzle, generatePuzzleAsync } from './sudoku-generator.js';
import { idx, nextLogicalStep } from './sudoku-solver.js';

const MAX_MISTAKES = 3;
const MAX_HISTORY = 500;
const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'expert', 'extreme']);

/**
 * @typedef {Object} EngineState
 * @property {number[]} puzzle
 * @property {number[]} solution
 * @property {boolean[]} givens
 * @property {number[]} board
 * @property {Array<Set<number>>} notes
 * @property {number} mistakes
 * @property {number} elapsedMs
 * @property {number} empties
 * @property {string} difficulty       resolved label
 * @property {string} requested        user-requested label
 * @property {number} score
 * @property {number} selected
 * @property {boolean} memoMode
 * @property {boolean} paused
 * @property {boolean} completed
 * @property {boolean} gameOver
 */

export class SudokuEngine {
  constructor() {
    /** @type {EngineState} */
    this.state = SudokuEngine.blank();
    this.history = [];
    this._stateListeners = new Set();
    this._tickListeners = new Set();
    this._timer = null;
    this._lastTick = 0;
  }

  static blank() {
    return {
      puzzle: new Array(81).fill(0),
      solution: new Array(81).fill(0),
      givens: new Array(81).fill(false),
      board: new Array(81).fill(0),
      notes: Array.from({ length: 81 }, () => new Set()),
      mistakes: 0,
      elapsedMs: 0,
      empties: 0,
      difficulty: 'extreme',
      requested: 'extreme',
      score: 0,
      selected: -1,
      memoMode: false,
      paused: false,
      completed: false,
      gameOver: false,
    };
  }

  /* -------- Subscriptions -------- */

  /** Subscribe to state-changed events. */
  subscribe(fn) {
    this._stateListeners.add(fn);
    return () => this._stateListeners.delete(fn);
  }

  /** Subscribe to timer ticks (every 1s while running). */
  subscribeTick(fn) {
    this._tickListeners.add(fn);
    return () => this._tickListeners.delete(fn);
  }

  _emitState() {
    for (const fn of this._stateListeners) fn(this.state);
  }

  _emitTick() {
    for (const fn of this._tickListeners) fn(this.state);
  }

  /* -------- (De)serialization -------- */

  serialize() {
    const s = this.state;
    return {
      puzzle: s.puzzle,
      solution: s.solution,
      givens: s.givens,
      board: s.board,
      notes: s.notes.map((set) => Array.from(set)),
      mistakes: s.mistakes,
      elapsedMs: s.elapsedMs,
      empties: s.empties,
      difficulty: s.difficulty,
      requested: s.requested,
      score: s.score,
      selected: s.selected,
      memoMode: s.memoMode,
      paused: s.paused,
      completed: s.completed,
      gameOver: s.gameOver,
    };
  }

  hydrate(data) {
    if (!data || !Array.isArray(data.puzzle) || data.puzzle.length !== 81) return false;
    if (!Array.isArray(data.solution) || data.solution.length !== 81) return false;

    const blank = SudokuEngine.blank();
    const notes = Array.from({ length: 81 }, (_, i) => new Set(
      (Array.isArray(data.notes) && Array.isArray(data.notes[i])) ? data.notes[i] : []
    ));

    this.state = {
      ...blank,
      ...data,
      notes,
    };
    // empties may be missing in older saves — recompute defensively.
    this.state.empties = countZeros(this.state.board);
    this.history = [];
    this._emitState();
    return true;
  }

  /* -------- New game / restart -------- */

  /**
   * Start a new puzzle synchronously. May block up to ~1s for "extreme".
   * @param {string} difficulty
   */
  newGame(difficulty = 'extreme') {
    const req = VALID_DIFFICULTIES.has(difficulty) ? difficulty : 'extreme';
    const result = generatePuzzle(req);
    this._installPuzzle(result, req);
  }

  /**
   * Start a new puzzle asynchronously — yields to the UI between attempts.
   * @param {string} difficulty
   * @returns {Promise<void>}
   */
  async newGameAsync(difficulty = 'extreme') {
    const req = VALID_DIFFICULTIES.has(difficulty) ? difficulty : 'extreme';
    const result = await generatePuzzleAsync(req);
    this._installPuzzle(result, req);
  }

  _installPuzzle(result, requested) {
    const { puzzle, solution, givens, score, difficulty } = result;
    this.state = {
      ...SudokuEngine.blank(),
      puzzle,
      solution,
      givens,
      board: puzzle.slice(),
      empties: countZeros(puzzle),
      difficulty,
      requested,
      score,
    };
    this.history = [];
    this._emitState();
  }

  /** Restart current puzzle from its givens. */
  restart() {
    if (!this.state.puzzle.some((v) => v !== 0)) return;
    this.state = {
      ...this.state,
      board: this.state.puzzle.slice(),
      notes: Array.from({ length: 81 }, () => new Set()),
      mistakes: 0,
      elapsedMs: 0,
      empties: countZeros(this.state.puzzle),
      completed: false,
      gameOver: false,
      paused: false,
    };
    this.history = [];
    this._emitState();
  }

  /* -------- Selection / memo -------- */

  /** Set selected cell index (0..80 or -1). */
  select(i) {
    if (typeof i !== 'number' || !Number.isInteger(i) || i < -1 || i > 80) return;
    if (i === this.state.selected) return;
    this.state.selected = i;
    this._emitState();
  }

  toggleMemo() {
    this.state.memoMode = !this.state.memoMode;
    this._emitState();
  }

  /* -------- Input -------- */

  /**
   * Place a value (or note) at the currently selected cell.
   * @param {number} value 1..9
   * @param {{autoRemoveNotes?: boolean}} [opts]
   * @returns {{kind: 'value'|'note'|'erase'|'mistake'|'noop'}}
   */
  input(value, opts) {
    const { autoRemoveNotes = true } = opts || {};
    const i = this.state.selected;
    if (!Number.isInteger(value) || value < 1 || value > 9) return { kind: 'noop' };
    if (i < 0 || this.state.gameOver || this.state.completed || this.state.paused)
      return { kind: 'noop' };
    if (this.state.givens[i]) return { kind: 'noop' };

    const before = this._snapshotCell(i);

    if (this.state.memoMode) {
      if (this.state.board[i]) return { kind: 'noop' };
      const notes = this.state.notes[i];
      if (notes.has(value)) notes.delete(value);
      else notes.add(value);
      this._push(before);
      this._emitState();
      return { kind: 'note' };
    }

    // Same value tapped → erase.
    if (this.state.board[i] === value) {
      this.state.board[i] = 0;
      this.state.empties += 1;
      this._push(before);
      this._emitState();
      return { kind: 'erase' };
    }

    const wasEmpty = this.state.board[i] === 0;
    this.state.board[i] = value;
    this.state.notes[i].clear();
    if (wasEmpty) this.state.empties -= 1;

    if (autoRemoveNotes) this._scrubPeerNotes(i, value);

    const correct = this.state.solution[i] === value;
    let kind = 'value';
    if (!correct) {
      this.state.mistakes += 1;
      kind = 'mistake';
      if (this.state.mistakes >= MAX_MISTAKES) this.state.gameOver = true;
    }
    if (this.state.empties === 0 && this._isBoardSolved()) this.state.completed = true;

    this._push(before);
    this._emitState();
    return { kind };
  }

  /** Erase the currently selected cell. */
  erase() {
    const i = this.state.selected;
    if (i < 0 || this.state.givens[i]) return false;
    if (this.state.paused || this.state.gameOver || this.state.completed) return false;
    if (this.state.board[i] === 0 && this.state.notes[i].size === 0) return false;

    const before = this._snapshotCell(i);
    if (this.state.board[i] !== 0) this.state.empties += 1;
    this.state.board[i] = 0;
    this.state.notes[i].clear();
    this._push(before);
    this._emitState();
    return true;
  }

  /** Undo last action. */
  undo() {
    const snap = this.history.pop();
    if (!snap) return false;

    const prevVal = this.state.board[snap.i];
    if (prevVal !== 0 && snap.value === 0) this.state.empties += 1;
    if (prevVal === 0 && snap.value !== 0) this.state.empties -= 1;

    this.state.board[snap.i] = snap.value;
    this.state.notes[snap.i] = new Set(snap.notes);
    this.state.mistakes = snap.mistakes;
    this.state.gameOver = snap.mistakes >= MAX_MISTAKES;
    this.state.completed = this.state.empties === 0 && this._isBoardSolved();
    this._emitState();
    return true;
  }

  /* -------- Hints -------- */

  /**
   * Compute the next hint. Returns null when game is over / complete.
   */
  hint() {
    if (this.state.gameOver || this.state.completed || this.state.paused) return null;
    const step = nextLogicalStep(this.state.board);
    if (step) return step;
    return this._revealStep();
  }

  /** Apply the given hint: place the value, no mistake counted. */
  applyHint(hint) {
    if (!hint || this.state.gameOver || this.state.completed) return;
    const i = hint.cell;
    if (i < 0 || this.state.givens[i]) return;

    const before = this._snapshotCell(i);
    if (this.state.board[i] === 0) this.state.empties -= 1;
    this.state.board[i] = hint.value;
    this.state.notes[i].clear();
    this._scrubPeerNotes(i, hint.value);
    this.state.selected = i;

    if (this.state.empties === 0 && this._isBoardSolved()) this.state.completed = true;

    this._push(before);
    this._emitState();
  }

  _revealStep() {
    for (let i = 0; i < 81; i++) {
      if (!this.state.board[i]) {
        return {
          cell: i,
          value: this.state.solution[i],
          technique: 'reveal',
          reason: '論理的に確定できる手が見つかりませんでした。答えを表示します。',
        };
      }
    }
    return null;
  }

  /* -------- Pause / Timer -------- */

  /** Toggle paused state. Stops or resumes the timer accordingly. */
  setPaused(paused) {
    const next = !!paused;
    if (next === this.state.paused) return;
    if (next) {
      this._stopInternal();
      this.state.paused = true;
    } else {
      this.state.paused = false;
      this._startInternal();
    }
    this._emitState();
  }

  togglePause() {
    this.setPaused(!this.state.paused);
  }

  /**
   * Start the timer. No-op if completed / gameOver / paused.
   * Safe to call repeatedly.
   */
  startTimer() {
    if (this.state.completed || this.state.gameOver || this.state.paused) return;
    this._startInternal();
  }

  /** Stop the timer without changing paused state (e.g. tab hidden). */
  stopTimer() {
    this._stopInternal();
  }

  _startInternal() {
    if (this._timer) return;
    this._lastTick = Date.now();
    this._timer = setInterval(() => {
      const now = Date.now();
      this.state.elapsedMs += now - this._lastTick;
      this._lastTick = now;
      this._emitTick();
    }, 1000);
  }

  _stopInternal() {
    if (!this._timer) return;
    this.state.elapsedMs += Date.now() - this._lastTick;
    clearInterval(this._timer);
    this._timer = null;
  }

  /* -------- Helpers -------- */

  _snapshotCell(i) {
    return {
      i,
      value: this.state.board[i],
      notes: Array.from(this.state.notes[i]),
      mistakes: this.state.mistakes,
    };
  }

  _push(snap) {
    this.history.push(snap);
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  _isBoardSolved() {
    for (let i = 0; i < 81; i++) {
      if (this.state.board[i] !== this.state.solution[i]) return false;
    }
    return true;
  }

  _scrubPeerNotes(i, v) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k++) {
      this.state.notes[idx(r, k)].delete(v);
      this.state.notes[idx(k, c)].delete(v);
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) this.state.notes[idx(br + a, bc + b)].delete(v);
  }
}

function countZeros(b) {
  let n = 0;
  for (let i = 0; i < 81; i++) if (b[i] === 0) n++;
  return n;
}
