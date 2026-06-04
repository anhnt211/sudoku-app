/**
 * @file Sudoku puzzle generator.
 *
 * Strategy:
 *   1. Build a random fully-solved grid via randomized backtracking.
 *   2. Walk cells in centrosymmetric pairs and try to remove them, keeping
 *      the puzzle uniquely solvable after every removal.
 *   3. Rate the result via rateDifficulty(). For the requested difficulty, we
 *      enforce both the label and (for hard/expert/extreme) a minimum-tier
 *      constraint so the puzzle truly requires the expected techniques.
 *   4. Up to a budget of attempts; if we don't find an exact match, return
 *      the closest one we did find. We always return a valid uniquely
 *      solvable puzzle.
 *
 * Two entry points:
 *   - generatePuzzle(diff)       — synchronous, may block ~0.2–2s for extreme.
 *   - generatePuzzleAsync(diff)  — yields between attempts to keep UI smooth.
 */

import { emptyBoard, candidatesAt, countSolutions, rateDifficulty } from './sudoku-solver.js';

const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'extreme', 'nightmare'];

/** Lower clue counts → harder puzzles. */
const TARGET_CLUES = {
  easy:    38,
  medium:  28,
  hard:    24,
  expert:  23,
  extreme: 22,
  nightmare: 21,
};

/** Minimum logical tier the rater must have applied for the label to match.
 *  Prevents "lucky" sparse puzzles solvable by trivial techniques from being
 *  promoted, and prevents brute-force-only puzzles from being labeled extreme
 *  unless the requested tier explicitly allows them. */
const MIN_TIER = {
  easy:    0,
  medium:  1,   // at least hidden singles
  hard:    2,   // at least locked candidates
  expert:  3,   // at least pairs (brute-force allowed for expert tier)
  extreme: 6,   // at least X-Wing (or brute-force, on extreme)
  nightmare: 7, // XY-Wing / Swordfish (or brute-force layered on X-Wing)
};

/** Attempts per difficulty. Higher = better match, but slower. */
const ATTEMPT_BUDGET = {
  easy: 3, medium: 14, hard: 35, expert: 30, extreme: 50, nightmare: 60,
};

const rand = (n) => Math.floor(Math.random() * n);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateSolved() {
  const b = emptyBoard();
  fillRecursive(b);
  return b;
}

function fillRecursive(b) {
  const i = b.indexOf(0);
  if (i === -1) return true;
  const cand = shuffle(candidatesAt(b, i));
  for (const v of cand) {
    b[i] = v;
    if (fillRecursive(b)) return true;
    b[i] = 0;
  }
  return false;
}

/* -------------------------------------------------------------------------- */

export function generatePuzzle(requested = 'extreme') {
  const target = TARGET_CLUES[requested] ?? TARGET_CLUES.hard;
  const attempts = ATTEMPT_BUDGET[requested] ?? 4;
  const minTier = MIN_TIER[requested] ?? 0;
  let best = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = generateOne(target);
    if (!candidate) continue;
    if (matchesRequest(candidate, requested, minTier)) {
      return { ...candidate, requested };
    }
    best = chooseClosest(best, candidate, requested);
  }

  if (best) return { ...best, requested };
  // Should be unreachable in practice; generateOne almost always succeeds.
  const fallback = generateOne(TARGET_CLUES[requested] + 6);
  if (fallback) return { ...fallback, requested };
  const solution = generateSolved();
  return {
    puzzle: solution.slice(),
    solution,
    givens: solution.map(() => true),
    difficulty: 'easy',
    score: 0,
    maxTier: 0,
    requested,
  };
}

export function generatePuzzleAsync(requested = 'extreme') {
  return new Promise((resolve) => {
    const target = TARGET_CLUES[requested] ?? TARGET_CLUES.hard;
    const attempts = ATTEMPT_BUDGET[requested] ?? 4;
    const minTier = MIN_TIER[requested] ?? 0;
    let best = null;
    let attempt = 0;

    const tick = () => {
      const candidate = generateOne(target);
      attempt++;
      if (candidate) {
        if (matchesRequest(candidate, requested, minTier)) {
          resolve({ ...candidate, requested });
          return;
        }
        best = chooseClosest(best, candidate, requested);
      }
      if (attempt >= attempts) {
        if (best) { resolve({ ...best, requested }); return; }
        resolve(generatePuzzle(requested));
        return;
      }
      setTimeout(tick, 0);
    };

    tick();
  });
}

function matchesRequest(candidate, requested, minTier) {
  if (candidate.difficulty !== requested) return false;
  if ((candidate.maxTier ?? 0) >= minTier) return true;
  // Brute-force-required puzzles are acceptable for expert+ tiers.
  if (candidate.bruteForce
    && (requested === 'extreme' || requested === 'expert' || requested === 'nightmare')) return true;
  return false;
}

function chooseClosest(current, candidate, requested) {
  if (!current) return candidate;
  const reqOrder = DIFFICULTIES.indexOf(requested);
  const currentDelta = Math.abs(DIFFICULTIES.indexOf(current.difficulty) - reqOrder);
  const candidateDelta = Math.abs(DIFFICULTIES.indexOf(candidate.difficulty) - reqOrder);
  if (candidateDelta !== currentDelta) return candidateDelta < currentDelta ? candidate : current;

  // Same label distance — pick by quality:
  //   1. Prefer pure-logical solves over brute-force when requesting non-extreme.
  if (requested !== 'extreme' && current.bruteForce !== candidate.bruteForce) {
    return candidate.bruteForce ? current : candidate;
  }
  //   2. Prefer the one closer to the requested tier.
  const target = MIN_TIER[requested] ?? 0;
  const curT = Math.abs((current.maxTier ?? 0) - target);
  const newT = Math.abs((candidate.maxTier ?? 0) - target);
  return newT < curT ? candidate : current;
}

/**
 * Build one puzzle: solve, remove cells in symmetric pairs while preserving
 * uniqueness, then rate.
 */
function generateOne(minClues) {
  const solution = generateSolved();
  const puzzle = solution.slice();

  for (const pair of symmetricRemovalOrder()) {
    if (countClues(puzzle) <= minClues) break;

    const a = pair[0];
    const b = pair.length > 1 ? pair[1] : null;
    if (puzzle[a] === 0 && (b === null || puzzle[b] === 0)) continue;

    const savedA = puzzle[a];
    const savedB = b !== null ? puzzle[b] : 0;

    puzzle[a] = 0;
    if (b !== null) puzzle[b] = 0;

    if (countSolutions(puzzle, 2) === 1) continue;

    if (b !== null) {
      puzzle[a] = savedA;
      puzzle[b] = savedB;
      puzzle[a] = 0;
      if (countSolutions(puzzle, 2) !== 1) puzzle[a] = savedA;
    } else {
      puzzle[a] = savedA;
    }
  }

  const rating = rateDifficulty(puzzle);
  if (!rating.solvable) return null;

  return {
    puzzle,
    solution,
    givens: puzzle.map((v) => v !== 0),
    difficulty: rating.label,
    score: rating.score,
    maxTier: rating.maxTier,
    bruteForce: rating.bruteForce,
    techniqueCounts: rating.techniqueCounts,
  };
}

function countClues(b) {
  let n = 0;
  for (let i = 0; i < 81; i++) if (b[i]) n++;
  return n;
}

function symmetricRemovalOrder() {
  const seen = new Set();
  const pairs = [];
  for (let i = 0; i < 81; i++) {
    if (seen.has(i)) continue;
    const j = 80 - i;
    seen.add(i);
    seen.add(j);
    pairs.push(i === j ? [i] : [i, j]);
  }
  return shuffle(pairs);
}
