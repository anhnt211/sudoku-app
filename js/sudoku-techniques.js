/**
 * @file Sudoku solving techniques.
 *
 * Each technique is a pure function on (board, cands) state. When the pattern
 * is found, the function mutates the candidate state (and possibly the board)
 * and returns metadata; otherwise it returns { applied: false }.
 *
 * Techniques are exported in difficulty order via TECHNIQUES, where the
 * solver/rater/hint engine iterates the list cheap-first.
 *
 * Each tech result has shape:
 *   {
 *     applied:      true,
 *     placements:   [{cell, value}],   // value(s) placed (may be empty)
 *     eliminations: [{cell, value}],   // candidates removed (may be empty)
 *     highlights:   [cell, …],         // cells the player should look at
 *     reason:       string,            // Japanese explanation
 *   }
 */

/* -------------------------------------------------------------------------- */
/* Lookup tables                                                              */
/* -------------------------------------------------------------------------- */

const ROW_OF = new Array(81);
const COL_OF = new Array(81);
const BOX_OF = new Array(81);
const ROW_CELLS = Array.from({ length: 9 }, () => []);
const COL_CELLS = Array.from({ length: 9 }, () => []);
const BOX_CELLS = Array.from({ length: 9 }, () => []);

for (let i = 0; i < 81; i++) {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
  ROW_OF[i] = r; COL_OF[i] = c; BOX_OF[i] = b;
  ROW_CELLS[r].push(i);
  COL_CELLS[c].push(i);
  BOX_CELLS[b].push(i);
}

const ROW_UNITS = ROW_CELLS.map((cells, i) => ({ cells, kind: 'row', name: `${i + 1}行目`, index: i }));
const COL_UNITS = COL_CELLS.map((cells, i) => ({ cells, kind: 'col', name: `${i + 1}列目`, index: i }));
const BOX_UNITS = BOX_CELLS.map((cells, i) => ({ cells, kind: 'box', name: `${i + 1}ブロック`, index: i }));
const ALL_UNITS = [...ROW_UNITS, ...COL_UNITS, ...BOX_UNITS];

const PEERS = (() => {
  const out = new Array(81);
  for (let i = 0; i < 81; i++) {
    const s = new Set();
    for (const k of ROW_CELLS[ROW_OF[i]]) s.add(k);
    for (const k of COL_CELLS[COL_OF[i]]) s.add(k);
    for (const k of BOX_CELLS[BOX_OF[i]]) s.add(k);
    s.delete(i);
    out[i] = [...s];
  }
  return out;
})();

const PEERS_SET = PEERS.map((arr) => new Set(arr));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export const idx = (r, c) => r * 9 + c;
export const rowOf = (i) => ROW_OF[i];
export const colOf = (i) => COL_OF[i];
export const boxOf = (i) => BOX_OF[i];
export const peersOf = (i) => PEERS[i];

function rc(i) { return `${ROW_OF[i] + 1}行${COL_OF[i] + 1}列`; }
function cellList(cells) { return cells.map(rc).join('、'); }

function place(b, cands, i, v) {
  b[i] = v;
  cands[i] = null;
  for (const p of PEERS[i]) if (cands[p]) cands[p].delete(v);
}

/** Compute the candidates Set for every empty cell. */
export function buildCandidates(b) {
  const cands = new Array(81).fill(null);
  for (let i = 0; i < 81; i++) {
    if (b[i]) continue;
    const s = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const p of PEERS[i]) s.delete(b[p]);
    cands[i] = s;
  }
  return cands;
}

/** Naked candidates for cell i without building the full state. */
export function candidatesAt(b, i) {
  if (b[i]) return [];
  const taken = new Uint8Array(10);
  for (const p of PEERS[i]) taken[b[p]] = 1;
  const out = [];
  for (let v = 1; v <= 9; v++) if (!taken[v]) out.push(v);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Singles                                                                    */
/* -------------------------------------------------------------------------- */

function applyNakedSingle(b, cands) {
  for (let i = 0; i < 81; i++) {
    if (!cands[i] || cands[i].size !== 1) continue;
    const v = cands[i].values().next().value;
    place(b, cands, i, v);
    return {
      applied: true,
      placements: [{ cell: i, value: v }],
      eliminations: [],
      highlights: [i],
      reason: `${rc(i)}には ${v} 以外の候補がありません。`,
    };
  }
  return { applied: false };
}

function applyHiddenSingle(b, cands) {
  for (const u of ALL_UNITS) {
    for (let v = 1; v <= 9; v++) {
      let where = -1;
      let count = 0;
      let already = false;
      for (const i of u.cells) {
        if (b[i] === v) { already = true; break; }
        if (cands[i] && cands[i].has(v)) {
          where = i;
          if (++count > 1) break;
        }
      }
      if (!already && count === 1) {
        place(b, cands, where, v);
        return {
          applied: true,
          placements: [{ cell: where, value: v }],
          eliminations: [],
          highlights: [where],
          reason: `${u.name}で ${v} を入れられるのは ${rc(where)} だけです。`,
        };
      }
    }
  }
  return { applied: false };
}

/* -------------------------------------------------------------------------- */
/* Locked candidates                                                          */
/* -------------------------------------------------------------------------- */

function applyPointing(b, cands) {
  for (const box of BOX_UNITS) {
    for (let v = 1; v <= 9; v++) {
      const cells = [];
      for (const i of box.cells) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length < 2 || cells.length > 3) continue;

      const r0 = ROW_OF[cells[0]];
      const c0 = COL_OF[cells[0]];
      const sameRow = cells.every((i) => ROW_OF[i] === r0);
      const sameCol = !sameRow && cells.every((i) => COL_OF[i] === c0);
      if (!sameRow && !sameCol) continue;

      const line = sameRow ? ROW_CELLS[r0] : COL_CELLS[c0];
      const eliminations = [];
      for (const i of line) {
        if (BOX_OF[i] === box.index || !cands[i]) continue;
        if (cands[i].has(v)) {
          cands[i].delete(v);
          eliminations.push({ cell: i, value: v });
        }
      }
      if (eliminations.length) {
        return {
          applied: true,
          placements: [],
          eliminations,
          highlights: cells,
          reason: `${box.index + 1}ブロック内で ${v} は ${sameRow ? `${r0 + 1}行目` : `${c0 + 1}列目`}にしか入らないので、同じ${sameRow ? '行' : '列'}の他のマスから ${v} を消せます。`,
        };
      }
    }
  }
  return { applied: false };
}

function applyClaiming(b, cands) {
  for (const unit of [...ROW_UNITS, ...COL_UNITS]) {
    for (let v = 1; v <= 9; v++) {
      const cells = [];
      for (const i of unit.cells) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length < 2 || cells.length > 3) continue;

      const b0 = BOX_OF[cells[0]];
      if (!cells.every((i) => BOX_OF[i] === b0)) continue;

      const eliminations = [];
      const unitSet = new Set(unit.cells);
      for (const i of BOX_CELLS[b0]) {
        if (unitSet.has(i) || !cands[i]) continue;
        if (cands[i].has(v)) {
          cands[i].delete(v);
          eliminations.push({ cell: i, value: v });
        }
      }
      if (eliminations.length) {
        return {
          applied: true,
          placements: [],
          eliminations,
          highlights: cells,
          reason: `${unit.name}で ${v} は ${b0 + 1}ブロックにしか入らないので、同じブロックの他のマスから ${v} を消せます。`,
        };
      }
    }
  }
  return { applied: false };
}

/* -------------------------------------------------------------------------- */
/* Naked / hidden subsets                                                     */
/* -------------------------------------------------------------------------- */

function applyNakedSubset(b, cands, size, label) {
  for (const unit of ALL_UNITS) {
    const open = [];
    for (const i of unit.cells) {
      if (cands[i] && cands[i].size >= 2 && cands[i].size <= size) open.push(i);
    }
    if (open.length < size) continue;

    const found = findNakedSubset(open, size, cands);
    if (!found) continue;

    const { combo, union } = found;
    const eliminations = [];
    for (const i of unit.cells) {
      if (combo.includes(i) || !cands[i]) continue;
      for (const v of union) {
        if (cands[i].has(v)) {
          cands[i].delete(v);
          eliminations.push({ cell: i, value: v });
        }
      }
    }
    if (eliminations.length) {
      return {
        applied: true,
        placements: [],
        eliminations,
        highlights: combo,
        reason: `${unit.name}の${size}マス (${cellList(combo)}) は候補が {${[...union].sort().join(', ')}} の${label}です。同じユニットの他のマスから消せます。`,
      };
    }
  }
  return { applied: false };
}

function findNakedSubset(open, size, cands) {
  const result = { combo: null, union: null };
  // Recursive combination generator.
  function recurse(start, picked) {
    if (picked.length === size) {
      const union = new Set();
      for (const i of picked) for (const v of cands[i]) union.add(v);
      if (union.size === size) {
        result.combo = picked.slice();
        result.union = union;
        return true;
      }
      return false;
    }
    for (let i = start; i < open.length; i++) {
      picked.push(open[i]);
      if (recurse(i + 1, picked)) return true;
      picked.pop();
    }
    return false;
  }
  return recurse(0, []) ? result : null;
}

function applyHiddenSubset(b, cands, size, label) {
  for (const unit of ALL_UNITS) {
    // Positions per value in this unit.
    const positions = new Array(10);
    for (let v = 1; v <= 9; v++) positions[v] = [];
    for (const i of unit.cells) {
      if (!cands[i]) continue;
      for (const v of cands[i]) positions[v].push(i);
    }
    const candidateValues = [];
    for (let v = 1; v <= 9; v++) {
      if (positions[v].length >= 2 && positions[v].length <= size) candidateValues.push(v);
    }
    if (candidateValues.length < size) continue;

    const found = findHiddenSubset(candidateValues, positions, size);
    if (!found) continue;

    const { values, cells } = found;
    const eliminations = [];
    for (const c of cells) {
      for (const v of [...cands[c]]) {
        if (!values.includes(v)) {
          cands[c].delete(v);
          eliminations.push({ cell: c, value: v });
        }
      }
    }
    if (eliminations.length) {
      return {
        applied: true,
        placements: [],
        eliminations,
        highlights: cells,
        reason: `${unit.name}で {${values.join(', ')}} は ${size}マス (${cellList(cells)}) にしか入らない${label}です。これらのマスの他候補を消せます。`,
      };
    }
  }
  return { applied: false };
}

function findHiddenSubset(values, positions, size) {
  const result = { values: null, cells: null };
  function recurse(start, picked) {
    if (picked.length === size) {
      const cellSet = new Set();
      for (const v of picked) for (const c of positions[v]) cellSet.add(c);
      if (cellSet.size === size) {
        result.values = picked.slice();
        result.cells = [...cellSet];
        return true;
      }
      return false;
    }
    for (let i = start; i < values.length; i++) {
      picked.push(values[i]);
      if (recurse(i + 1, picked)) return true;
      picked.pop();
    }
    return false;
  }
  return recurse(0, []) ? result : null;
}

const applyNakedPair    = (b, c) => applyNakedSubset(b, c, 2, 'ペア');
const applyNakedTriple  = (b, c) => applyNakedSubset(b, c, 3, 'トリプル');
const applyNakedQuad    = (b, c) => applyNakedSubset(b, c, 4, 'カルテット');
const applyHiddenPair   = (b, c) => applyHiddenSubset(b, c, 2, 'ヒドゥンペア');
const applyHiddenTriple = (b, c) => applyHiddenSubset(b, c, 3, 'ヒドゥントリプル');
const applyHiddenQuad   = (b, c) => applyHiddenSubset(b, c, 4, 'ヒドゥンカルテット');

/* -------------------------------------------------------------------------- */
/* X-Wing                                                                     */
/* -------------------------------------------------------------------------- */

function applyXWing(b, cands) {
  for (let v = 1; v <= 9; v++) {
    // Row-based: 2 rows whose digit-v cells share the same 2 columns.
    const rowPairs = [];
    for (let r = 0; r < 9; r++) {
      const cells = [];
      for (const i of ROW_CELLS[r]) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length === 2) rowPairs.push({ row: r, cols: [COL_OF[cells[0]], COL_OF[cells[1]]], cells });
    }
    for (let x = 0; x < rowPairs.length; x++) {
      for (let y = x + 1; y < rowPairs.length; y++) {
        const A = rowPairs[x], B = rowPairs[y];
        if (A.cols[0] !== B.cols[0] || A.cols[1] !== B.cols[1]) continue;
        const eliminations = [];
        for (const col of A.cols) {
          for (const i of COL_CELLS[col]) {
            if (ROW_OF[i] === A.row || ROW_OF[i] === B.row || !cands[i]) continue;
            if (cands[i].has(v)) {
              cands[i].delete(v);
              eliminations.push({ cell: i, value: v });
            }
          }
        }
        if (eliminations.length) {
          return {
            applied: true,
            placements: [],
            eliminations,
            highlights: [...A.cells, ...B.cells],
            reason: `X-Wing: ${v} が${A.row + 1}行目と${B.row + 1}行目で同じ2列 (${A.cols[0] + 1}列, ${A.cols[1] + 1}列) にしか入らないため、それらの列の他の行から ${v} を消せます。`,
          };
        }
      }
    }
    // Column-based mirror.
    const colPairs = [];
    for (let c = 0; c < 9; c++) {
      const cells = [];
      for (const i of COL_CELLS[c]) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length === 2) colPairs.push({ col: c, rows: [ROW_OF[cells[0]], ROW_OF[cells[1]]], cells });
    }
    for (let x = 0; x < colPairs.length; x++) {
      for (let y = x + 1; y < colPairs.length; y++) {
        const A = colPairs[x], B = colPairs[y];
        if (A.rows[0] !== B.rows[0] || A.rows[1] !== B.rows[1]) continue;
        const eliminations = [];
        for (const row of A.rows) {
          for (const i of ROW_CELLS[row]) {
            if (COL_OF[i] === A.col || COL_OF[i] === B.col || !cands[i]) continue;
            if (cands[i].has(v)) {
              cands[i].delete(v);
              eliminations.push({ cell: i, value: v });
            }
          }
        }
        if (eliminations.length) {
          return {
            applied: true,
            placements: [],
            eliminations,
            highlights: [...A.cells, ...B.cells],
            reason: `X-Wing: ${v} が${A.col + 1}列目と${B.col + 1}列目で同じ2行 (${A.rows[0] + 1}行, ${A.rows[1] + 1}行) にしか入らないため、それらの行の他の列から ${v} を消せます。`,
          };
        }
      }
    }
  }
  return { applied: false };
}

/* -------------------------------------------------------------------------- */
/* XY-Wing                                                                    */
/* -------------------------------------------------------------------------- */

function applyXYWing(b, cands) {
  const bivalues = [];
  for (let i = 0; i < 81; i++) {
    if (cands[i] && cands[i].size === 2) {
      const vs = [...cands[i]];
      bivalues.push({ cell: i, a: vs[0], b: vs[1] });
    }
  }

  for (const pivot of bivalues) {
    const pPeers = PEERS_SET[pivot.cell];
    // Wings: bivalue cells seen by the pivot that share exactly one candidate.
    const wings = [];
    for (const w of bivalues) {
      if (w.cell === pivot.cell || !pPeers.has(w.cell)) continue;
      const sharesA = (w.a === pivot.a || w.b === pivot.a) && !(w.a === pivot.b || w.b === pivot.b);
      const sharesB = (w.a === pivot.b || w.b === pivot.b) && !(w.a === pivot.a || w.b === pivot.a);
      if (!sharesA && !sharesB) continue;
      const shared = sharesA ? pivot.a : pivot.b;
      const z = w.a === shared ? w.b : w.a;
      wings.push({ cell: w.cell, shared, z });
    }
    // Match two wings: one sharing pivot.a (with extra z), one sharing pivot.b (with the same z).
    for (let i = 0; i < wings.length; i++) {
      const W1 = wings[i];
      if (W1.shared !== pivot.a) continue;
      for (let j = 0; j < wings.length; j++) {
        if (i === j) continue;
        const W2 = wings[j];
        if (W2.shared !== pivot.b) continue;
        if (W2.z !== W1.z) continue;
        const z = W1.z;
        const peers1 = PEERS_SET[W1.cell];
        const peers2 = PEERS_SET[W2.cell];
        const eliminations = [];
        for (let k = 0; k < 81; k++) {
          if (k === pivot.cell || k === W1.cell || k === W2.cell || !cands[k]) continue;
          if (!peers1.has(k) || !peers2.has(k)) continue;
          if (cands[k].has(z)) {
            cands[k].delete(z);
            eliminations.push({ cell: k, value: z });
          }
        }
        if (eliminations.length) {
          return {
            applied: true,
            placements: [],
            eliminations,
            highlights: [pivot.cell, W1.cell, W2.cell],
            reason: `XY-Wing: ピボット${rc(pivot.cell)}={${pivot.a},${pivot.b}}、ウイング${rc(W1.cell)}={${pivot.a},${z}} と ${rc(W2.cell)}={${pivot.b},${z}}。両ウイングを見るマスから ${z} を消せます。`,
          };
        }
      }
    }
  }
  return { applied: false };
}

/* -------------------------------------------------------------------------- */
/* Swordfish                                                                  */
/* -------------------------------------------------------------------------- */

function applySwordfish(b, cands) {
  for (let v = 1; v <= 9; v++) {
    // Row-based.
    const rowCands = [];
    for (let r = 0; r < 9; r++) {
      const cells = [];
      for (const i of ROW_CELLS[r]) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length >= 2 && cells.length <= 3) {
        rowCands.push({ row: r, cols: cells.map((i) => COL_OF[i]), cells });
      }
    }
    for (let x = 0; x < rowCands.length; x++) {
      for (let y = x + 1; y < rowCands.length; y++) {
        for (let z = y + 1; z < rowCands.length; z++) {
          const A = rowCands[x], B = rowCands[y], C = rowCands[z];
          const colSet = new Set([...A.cols, ...B.cols, ...C.cols]);
          if (colSet.size !== 3) continue;
          const cols = [...colSet];
          const rows = [A.row, B.row, C.row];
          const eliminations = [];
          for (const col of cols) {
            for (const i of COL_CELLS[col]) {
              if (rows.includes(ROW_OF[i]) || !cands[i]) continue;
              if (cands[i].has(v)) {
                cands[i].delete(v);
                eliminations.push({ cell: i, value: v });
              }
            }
          }
          if (eliminations.length) {
            return {
              applied: true,
              placements: [],
              eliminations,
              highlights: [...A.cells, ...B.cells, ...C.cells],
              reason: `Swordfish: ${v} が${rows.map((r) => r + 1).join('、')}行で同じ3列 (${cols.map((c) => c + 1).join('、')}) にしか入らないため、それらの列の他の行から ${v} を消せます。`,
            };
          }
        }
      }
    }
    // Column-based mirror.
    const colCands = [];
    for (let c = 0; c < 9; c++) {
      const cells = [];
      for (const i of COL_CELLS[c]) if (cands[i] && cands[i].has(v)) cells.push(i);
      if (cells.length >= 2 && cells.length <= 3) {
        colCands.push({ col: c, rows: cells.map((i) => ROW_OF[i]), cells });
      }
    }
    for (let x = 0; x < colCands.length; x++) {
      for (let y = x + 1; y < colCands.length; y++) {
        for (let z = y + 1; z < colCands.length; z++) {
          const A = colCands[x], B = colCands[y], C = colCands[z];
          const rowSet = new Set([...A.rows, ...B.rows, ...C.rows]);
          if (rowSet.size !== 3) continue;
          const rows = [...rowSet];
          const cols = [A.col, B.col, C.col];
          const eliminations = [];
          for (const row of rows) {
            for (const i of ROW_CELLS[row]) {
              if (cols.includes(COL_OF[i]) || !cands[i]) continue;
              if (cands[i].has(v)) {
                cands[i].delete(v);
                eliminations.push({ cell: i, value: v });
              }
            }
          }
          if (eliminations.length) {
            return {
              applied: true,
              placements: [],
              eliminations,
              highlights: [...A.cells, ...B.cells, ...C.cells],
              reason: `Swordfish: ${v} が${cols.map((c) => c + 1).join('、')}列で同じ3行 (${rows.map((r) => r + 1).join('、')}) にしか入らないため、それらの行の他の列から ${v} を消せます。`,
            };
          }
        }
      }
    }
  }
  return { applied: false };
}

/* -------------------------------------------------------------------------- */
/* Technique registry                                                         */
/* -------------------------------------------------------------------------- */

export const TECHNIQUES = [
  { id: 'naked-single',  label: 'ネイキッドシングル', tier: 0, cost:  10, apply: applyNakedSingle },
  { id: 'hidden-single', label: 'ヒドゥンシングル',   tier: 1, cost:  20, apply: applyHiddenSingle },
  { id: 'pointing',      label: 'ポインティング',     tier: 2, cost:  60, apply: applyPointing },
  { id: 'claiming',      label: 'クレーミング',       tier: 2, cost:  60, apply: applyClaiming },
  { id: 'naked-pair',    label: 'ネイキッドペア',     tier: 3, cost:  80, apply: applyNakedPair },
  { id: 'hidden-pair',   label: 'ヒドゥンペア',       tier: 3, cost: 120, apply: applyHiddenPair },
  { id: 'naked-triple',  label: 'ネイキッドトリプル', tier: 4, cost: 180, apply: applyNakedTriple },
  { id: 'hidden-triple', label: 'ヒドゥントリプル',   tier: 4, cost: 260, apply: applyHiddenTriple },
  { id: 'naked-quad',    label: 'ネイキッドカルテット', tier: 5, cost: 360, apply: applyNakedQuad },
  { id: 'hidden-quad',   label: 'ヒドゥンカルテット', tier: 5, cost: 460, apply: applyHiddenQuad },
  { id: 'x-wing',        label: 'X-Wing',             tier: 6, cost: 500, apply: applyXWing },
  { id: 'xy-wing',       label: 'XY-Wing',            tier: 7, cost: 700, apply: applyXYWing },
  { id: 'swordfish',     label: 'Swordfish',          tier: 7, cost: 850, apply: applySwordfish },
];

/** Lookup helper for UI / hint labels. */
export const TECHNIQUE_LABELS = Object.fromEntries(
  TECHNIQUES.map((t) => [t.id, t.label])
);
