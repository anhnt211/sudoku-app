/**
 * @file Sudoku solver — backtracking, uniqueness check, technique-driven rating.
 *
 * Public surface (unchanged for callers):
 *   - emptyBoard()                       → 81-cell array of zeros
 *   - idx(r, c)                          → linear index helper
 *   - candidatesAt(board, i)             → array of legal values for cell i
 *   - countSolutions(board, limit=2)     → uniqueness check
 *   - solve(board)                       → first solution or null
 *   - rateDifficulty(board)              → { score, label, maxTier, solvable }
 *   - nextLogicalStep(board)             → { cell, value, technique, … } | null
 *
 * All technique-specific logic lives in sudoku-techniques.js. This module
 * orchestrates: backtracking for uniqueness, and applying techniques in
 * cost order for rating and hints.
 */

import { TECHNIQUES, TECHNIQUE_LABELS, buildCandidates, candidatesAt as candAt, idx as _idx } from './sudoku-techniques.js';

export const idx = _idx;
export const candidatesAt = candAt;

export function emptyBoard() {
  return new Array(81).fill(0);
}

/* -------------------------------------------------------------------------- */
/* Backtracking (uniqueness + brute solve)                                    */
/* -------------------------------------------------------------------------- */

function findMRV(b) {
  let bestCell = -1;
  let bestCands = null;
  for (let i = 0; i < 81; i++) {
    if (b[i]) continue;
    const cand = candAt(b, i);
    if (cand.length === 0) return { cell: i, candidates: [] };
    if (!bestCands || cand.length < bestCands.length) {
      bestCell = i;
      bestCands = cand;
      if (cand.length === 1) break;
    }
  }
  return bestCell === -1 ? -1 : { cell: bestCell, candidates: bestCands };
}

export function countSolutions(board, limit = 2) {
  const b = board.slice();
  let count = 0;
  const recurse = () => {
    const pick = findMRV(b);
    if (pick === -1) {
      count++;
      return count >= limit;
    }
    for (const v of pick.candidates) {
      b[pick.cell] = v;
      if (recurse()) return true;
      b[pick.cell] = 0;
    }
    return false;
  };
  recurse();
  return count;
}

export function solve(board) {
  const b = board.slice();
  return solveInPlace(b) ? b : null;
}

function solveInPlace(b) {
  const pick = findMRV(b);
  if (pick === -1) return true;
  for (const v of pick.candidates) {
    b[pick.cell] = v;
    if (solveInPlace(b)) return true;
    b[pick.cell] = 0;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Difficulty rating                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Rate a puzzle by repeatedly applying the cheapest applicable technique.
 *
 * @param {number[]} board
 * @returns {{ score:number, label:string, maxTier:number, solvable:boolean,
 *             techniqueCounts:Object }}
 */
export function rateDifficulty(board) {
  const b = board.slice();
  const cands = buildCandidates(b);
  let score = 0;
  let maxTier = 0;
  const techniqueCounts = Object.create(null);

  while (true) {
    let applied = false;
    for (const tech of TECHNIQUES) {
      const r = tech.apply(b, cands);
      if (!r.applied) continue;
      score += tech.cost;
      if (tech.tier > maxTier) maxTier = tech.tier;
      techniqueCounts[tech.id] = (techniqueCounts[tech.id] || 0) + 1;
      applied = true;
      break;
    }
    if (!applied) break;
  }

  let bruteForce = false;
  if (b.some((v) => v === 0)) {
    const count = countSolutions(b, 2);
    if (count !== 1) return { score, label: 'invalid', maxTier, solvable: false, bruteForce, techniqueCounts };
    bruteForce = true;
    score += 3000;
    techniqueCounts['brute-force'] = (techniqueCounts['brute-force'] || 0) + 1;
  }

  return {
    score,
    label: labelFor(score, maxTier, bruteForce),
    maxTier,
    solvable: true,
    bruteForce,
    techniqueCounts,
  };
}

/**
 * Map (score, maxTier) → difficulty label.
 *
 *   - Tier ≥ 7 (XY-Wing, Swordfish, brute force) → extreme.
 *   - Tier 6 (X-Wing): extreme when score is also high enough that the puzzle
 *     is "X-Wing heavy", else expert.
 *   - Tier 4–5 (triples, quads): expert with high score, else hard.
 *   - Tier 2–3 (locked candidates, pairs): hard with high score, else medium.
 *   - Tier 0–1 (singles only): medium with many singles, else easy.
 */
function labelFor(score, maxTier, bruteForce) {
  // Hardest pure-logical rung — XY-Wing, Swordfish, or harder.
  if (maxTier >= 7) return 'nightmare';
  // Needs guessing → at minimum expert.
  //   brute force layered on X-Wing (tier 6) is the reliable Nightmare catch-all;
  //   brute force on real techniques (tier ≥ 3) is extreme; otherwise expert.
  if (bruteForce) {
    if (maxTier >= 6) return 'nightmare';
    return maxTier >= 3 ? 'extreme' : 'expert';
  }
  if (maxTier === 6) return score >= 2200 ? 'extreme' : 'expert';
  if (maxTier === 5) return score >= 2200 ? 'expert' : 'hard';
  if (maxTier === 4) return score >= 1800 ? 'expert' : 'hard';
  if (maxTier === 3) return score >= 1200 ? 'hard' : 'medium';
  if (maxTier === 2) return score >= 1000 ? 'hard' : 'medium';
  return score >= 700 ? 'medium' : 'easy';
}

/* -------------------------------------------------------------------------- */
/* Hint engine                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compute the next playable step. If the cheapest applicable technique is an
 * elimination-only one, the engine keeps applying techniques until a placement
 * results, then explains the chain that led there.
 *
 * @param {number[]} board
 * @returns {{cell:number, value:number, technique:string, techniqueLabel:string,
 *            reason:string, chain:string[], highlights:number[]}|null}
 */
export function nextLogicalStep(board) {
  const b = board.slice();
  const cands = buildCandidates(b);
  const chain = [];          // labels of elimination steps taken so far
  const MAX_CHAIN = 8;       // safety cap; should never be reached

  while (chain.length <= MAX_CHAIN) {
    let stepTech = null;
    let stepResult = null;

    for (const tech of TECHNIQUES) {
      const r = tech.apply(b, cands);
      if (r.applied) {
        stepTech = tech;
        stepResult = r;
        break;
      }
    }
    if (!stepTech) return null;

    if (stepResult.placements && stepResult.placements.length) {
      const p = stepResult.placements[0];
      const reason = chain.length === 0
        ? stepResult.reason
        : `${chain.join(' → ')} で候補を絞り込んだ結果、${stepResult.reason}`;
      const chainLabels = chain.length === 0 ? [stepTech.label] : [...chain, stepTech.label];
      return {
        cell: p.cell,
        value: p.value,
        technique: stepTech.id,
        techniqueLabel: stepTech.label,
        reason,
        chain: chainLabels,
        highlights: stepResult.highlights || [p.cell],
      };
    }

    // Pure elimination — record and continue.
    chain.push(stepTech.label);
  }
  return null;
}

/** Re-export labels for the UI. */
export { TECHNIQUE_LABELS };
