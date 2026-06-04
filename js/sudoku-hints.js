/**
 * @file Step-by-step tutor hint engine (DOM-free).
 *
 * buildTutorHint(board) replays the same cheap-first technique loop the rater
 * and solver use, but instead of returning a single placement it captures every
 * elimination step that leads to the next forced placement and packages them as
 * an ordered, teachable sequence:
 *
 *   観察 (observation) → 絞り込み (elimination ×N) → 結論 (conclusion)
 *
 * Each step is self-describing so the UI can both render the Japanese
 * explanation and annotate the board (region / focus / elimination / target).
 *
 * The returned hint carries { cell, value } at the top level so it flows through
 * the engine's existing applyHint() path and remains undoable.
 */

import {
  TECHNIQUES, buildCandidates, rowOf, colOf, boxOf,
} from './sudoku-techniques.js';

const STEP_TITLES = {
  'naked-single': '最後の候補',
  'hidden-single': '隠れたシングル',
};

function titleFor(tech) {
  return STEP_TITLES[tech.id] || tech.label;
}

function rcText(i) {
  return `${rowOf(i) + 1}行${colOf(i) + 1}列`;
}

/** Shared row/column/box across a set of cells (for region highlighting). */
function regionForCells(cells, single) {
  if (single && cells.length === 1) {
    const i = cells[0];
    return { row: rowOf(i), column: colOf(i), box: boxOf(i) };
  }
  if (!cells.length) return { row: null, column: null, box: null };
  const r0 = rowOf(cells[0]);
  const c0 = colOf(cells[0]);
  const b0 = boxOf(cells[0]);
  return {
    row: cells.every((i) => rowOf(i) === r0) ? r0 : null,
    column: cells.every((i) => colOf(i) === c0) ? c0 : null,
    box: cells.every((i) => boxOf(i) === b0) ? b0 : null,
  };
}

/**
 * @param {number[]} board
 * @returns {{title:string, technique:string, cell:number, value:number,
 *            steps:Array<Object>} | null}
 */
export function buildTutorHint(board) {
  const b = board.slice();
  const cands = buildCandidates(b);
  const elimSteps = [];
  const MAX = 12; // safety cap; a placement should surface well before this
  let placement = null;
  let placeRes = null;
  let placeTech = null;

  for (let guard = 0; guard <= MAX; guard++) {
    let tech = null;
    let res = null;
    for (const t of TECHNIQUES) {
      const r = t.apply(b, cands);
      if (r.applied) { tech = t; res = r; break; }
    }
    if (!tech) break;
    if (res.placements && res.placements.length) {
      placement = res.placements[0];
      placeRes = res;
      placeTech = tech;
      break;
    }
    elimSteps.push({ tech, res });
  }

  if (!placement) return null;

  const steps = [];

  if (elimSteps.length === 0) {
    // Direct single → observation reuses the technique's own reasoning.
    const hl = placeRes.highlights && placeRes.highlights.length
      ? placeRes.highlights
      : [placement.cell];
    steps.push({
      title: titleFor(placeTech),
      explanation: placeRes.reason,
      highlightedCells: hl,
      eliminatedCandidates: [],
      targetCell: null,
      ...regionForCells(hl, true),
    });
  } else {
    // Chain → frame the goal, then walk each elimination.
    const firstHl = elimSteps[0].res.highlights || [];
    steps.push({
      title: '観察',
      explanation: `${rcText(placement.cell)}を確定するために、まわりのマスの候補を絞り込んでいきましょう。`,
      highlightedCells: firstHl,
      eliminatedCandidates: [],
      targetCell: null,
      ...regionForCells(firstHl, false),
    });
    for (const s of elimSteps) {
      const hl = s.res.highlights || [];
      steps.push({
        title: titleFor(s.tech),
        explanation: s.res.reason,
        highlightedCells: hl,
        eliminatedCandidates: s.res.eliminations || [],
        targetCell: null,
        ...regionForCells(hl, false),
      });
    }
  }

  // Conclusion (always last).
  steps.push({
    title: '結論',
    explanation: `したがって、${rcText(placement.cell)}は ${placement.value} になります。`,
    highlightedCells: [placement.cell],
    eliminatedCandidates: [],
    targetCell: placement.cell,
    row: rowOf(placement.cell),
    column: colOf(placement.cell),
    box: boxOf(placement.cell),
  });

  const title = elimSteps.length
    ? `${elimSteps.map((s) => titleFor(s.tech)).join(' → ')} → 確定`
    : titleFor(placeTech);

  return {
    title,
    technique: placeTech.id,
    cell: placement.cell,
    value: placement.value,
    steps,
  };
}
