/**
 * @file UI layer — renders engine/settings/stats onto the DOM.
 *
 * Architecture:
 *   - Cells, number-pad buttons, dialogs are built once at startup.
 *   - render(state) updates only the cells whose visible state changed.
 *   - renderTimer(state) updates only the clock — bypasses the cell loop.
 *   - Dialog open/close manages focus (move into dialog, restore opener).
 *   - The hint toast displays the technique reason from the solver.
 *   - Mistake input triggers a shake animation; haptics fire if available.
 */

const DIFF_LABELS = {
  easy: 'やさしい',
  medium: 'ふつう',
  hard: 'むずかしい',
  expert: 'エキスパート',
  extreme: 'エクストリーム',
};

const TECHNIQUE_LABELS = {
  'naked-single': 'ネイキッドシングル',
  'hidden-single': 'ヒドゥンシングル',
  'pointing': 'ポインティング',
  'claiming': 'クレーミング',
  'naked-pair': 'ネイキッドペア',
  'hidden-pair': 'ヒドゥンペア',
  'naked-triple': 'ネイキッドトリプル',
  'hidden-triple': 'ヒドゥントリプル',
  'naked-quad': 'ネイキッドカルテット',
  'hidden-quad': 'ヒドゥンカルテット',
  'x-wing': 'X-Wing',
  'xy-wing': 'XY-Wing',
  'swordfish': 'Swordfish',
  'reveal': '答えの表示',
};

/**
 * @param {Object} deps
 * @param {import('./sudoku-engine.js').SudokuEngine} deps.engine
 * @param {ReturnType<import('./settings.js').createSettings>} deps.settings
 * @param {ReturnType<import('./stats.js').createStats>} deps.stats
 * @param {(action:string, payload?:any)=>void} deps.onAction
 * @param {{setTheme:(t:string)=>void}} deps.pwa
 */
export function createUI({ engine, settings, stats, onAction, pwa }) {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- DOM refs ---------- */
  const refs = {
    app: $('#app'),
    board: $('#board'),
    boardOverlay: $('#board-overlay'),
    pad: $('#number-pad'),
    loading: $('#loading'),
    toast: $('#hint-toast'),
    liveRegion: $('#live-region'),

    statDifficulty: $('#stat-difficulty'),
    statMistakes: $('#stat-mistakes'),
    statTime: $('#stat-time'),
    statTotal: $('#stat-total'),
    score: $('#score-display'),

    btnUndo: $('#btn-undo'),
    btnErase: $('#btn-erase'),
    btnMemo: $('#btn-memo'),
    btnHint: $('#btn-hint'),
    btnPause: $('#btn-pause'),
    btnResume: $('#btn-resume'),
    btnSettings: $('#btn-settings'),
    btnTheme: $('#btn-theme'),
    btnNewGame: $('#btn-new-game'),

    memoBadge: $('#memo-badge'),
    hintBadge: $('#hint-badge'),

    dialogRoot: $('#dialog-root'),
    dialogSettings: $('#dialog-settings'),
    dialogNew: $('#dialog-new'),
    dialogGameOver: $('#dialog-gameover'),
    dialogVictory: $('#dialog-victory'),

    optDark: $('#opt-dark'),
    optSound: $('#opt-sound'),
    optHighlight: $('#opt-highlight'),
    optAutoNotes: $('#opt-autonotes'),
    optHaptics: $('#opt-haptics'),

    statsList: $('#stats-list'),
    btnResetStats: $('#btn-reset-stats'),
    btnCloseSettings: $('#btn-close-settings'),
    btnCloseNew: $('#btn-close-new'),
    btnRestart: $('#btn-restart'),
    btnNewAfterOver: $('#btn-new-after-over'),
    btnNewAfterWin: $('#btn-new-after-win'),
    victoryDesc: $('#victory-desc'),
  };

  /* ---------- Build grid + pad once ---------- */
  /** @type {Array<{root:HTMLElement, value:HTMLElement, notes:HTMLElement, noteNodes:HTMLElement[]}>} */
  const cells = new Array(81);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.idx = String(i);
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', cellAriaLabel(i, 0, false));

    const value = document.createElement('div');
    value.className = 'cell-value';
    cell.appendChild(value);

    const notes = document.createElement('div');
    notes.className = 'cell-notes';
    const noteNodes = new Array(9);
    for (let n = 1; n <= 9; n++) {
      const note = document.createElement('span');
      note.className = 'cell-note';
      note.textContent = String(n);
      notes.appendChild(note);
      noteNodes[n - 1] = note;
    }
    cell.appendChild(notes);
    frag.appendChild(cell);
    cells[i] = { root: cell, value, notes, noteNodes };
  }
  refs.board.appendChild(frag);

  /** @type {HTMLButtonElement[]} */
  const padBtns = new Array(9);
  const padFrag = document.createDocumentFragment();
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad-btn';
    btn.dataset.num = String(n);
    btn.textContent = String(n);
    btn.setAttribute('aria-label', `${n} を入力`);
    padFrag.appendChild(btn);
    padBtns[n - 1] = btn;
  }
  refs.pad.appendChild(padFrag);

  /* ---------- Event delegation ---------- */

  refs.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !refs.board.contains(cell)) return;
    const i = Number(cell.dataset.idx);
    if (Number.isFinite(i)) onAction('select', i);
  });

  refs.pad.addEventListener('click', (e) => {
    const btn = e.target.closest('.pad-btn');
    if (!btn || btn.classList.contains('is-done') || !refs.pad.contains(btn)) return;
    const n = Number(btn.dataset.num);
    if (Number.isFinite(n)) onAction('input', n);
  });

  refs.btnUndo.addEventListener('click', () => onAction('undo'));
  refs.btnErase.addEventListener('click', () => onAction('erase'));
  refs.btnMemo.addEventListener('click', () => onAction('memo'));
  refs.btnHint.addEventListener('click', () => onAction('hint'));
  refs.btnPause.addEventListener('click', () => onAction('pause'));
  refs.btnResume.addEventListener('click', () => onAction('pause'));
  refs.btnSettings.addEventListener('click', () => openDialog('settings'));
  refs.btnNewGame.addEventListener('click', () => openDialog('new'));
  refs.btnTheme.addEventListener('click', () => settings.set({ dark: !settings.get().dark }));

  refs.optDark.addEventListener('change', () => settings.set({ dark: refs.optDark.checked }));
  refs.optSound.addEventListener('change', () => settings.set({ sound: refs.optSound.checked }));
  refs.optHighlight.addEventListener('change', () => settings.set({ highlightSame: refs.optHighlight.checked }));
  refs.optAutoNotes.addEventListener('change', () => settings.set({ autoRemoveNotes: refs.optAutoNotes.checked }));
  refs.optHaptics.addEventListener('change', () => settings.set({ haptics: refs.optHaptics.checked }));

  refs.btnResetStats.addEventListener('click', () => onAction('reset-stats'));
  refs.btnCloseSettings.addEventListener('click', () => closeDialog());
  refs.btnCloseNew.addEventListener('click', () => closeDialog());
  refs.btnRestart.addEventListener('click', () => { closeDialog(); onAction('restart'); });
  refs.btnNewAfterOver.addEventListener('click', () => openDialog('new'));
  refs.btnNewAfterWin.addEventListener('click', () => openDialog('new'));

  $$('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => onAction('new', btn.dataset.diff));
  });

  // Tap backdrop to close.
  refs.dialogRoot.addEventListener('click', (e) => {
    if (e.target === refs.dialogRoot) closeDialog();
  });

  // Keyboard.
  document.addEventListener('keydown', (e) => {
    if (!refs.dialogRoot.hidden) {
      if (e.key === 'Escape') closeDialog();
      return;
    }
    if (engine.state.paused) return;
    const k = e.key;
    if (k >= '1' && k <= '9') { e.preventDefault(); onAction('input', Number(k)); }
    else if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); onAction('erase'); }
    else if (k.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAction('undo'); }
    else if (k === 'm' || k === 'M') onAction('memo');
    else if (k === 'h' || k === 'H') onAction('hint');
    else if (k === ' ') { e.preventDefault(); onAction('pause'); }
    else if (k.startsWith('Arrow')) { e.preventDefault(); moveSelection(k); }
  });

  function moveSelection(dir) {
    const cur = engine.state.selected < 0 ? 0 : engine.state.selected;
    let r = Math.floor(cur / 9);
    let c = cur % 9;
    if (dir === 'ArrowUp') r = (r + 8) % 9;
    if (dir === 'ArrowDown') r = (r + 1) % 9;
    if (dir === 'ArrowLeft') c = (c + 8) % 9;
    if (dir === 'ArrowRight') c = (c + 1) % 9;
    onAction('select', r * 9 + c);
  }

  /* ---------- Dialog management with focus restoration ---------- */

  /** @type {HTMLElement|null} */
  let dialogOpener = null;
  const DIALOG_MAP = {
    settings: refs.dialogSettings,
    new: refs.dialogNew,
    gameover: refs.dialogGameOver,
    victory: refs.dialogVictory,
  };

  function openDialog(name) {
    const next = DIALOG_MAP[name];
    if (!next) return;
    if (!refs.dialogRoot.hidden && next.hidden === false) return;
    dialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    refs.dialogRoot.hidden = false;
    for (const d of Object.values(DIALOG_MAP)) d.hidden = d !== next;
    if (name === 'settings') renderSettingsDialog();
    // Move focus into dialog.
    const focusable = next.querySelector('button, [tabindex="0"], input');
    if (focusable instanceof HTMLElement) focusable.focus();
  }

  function closeDialog() {
    if (refs.dialogRoot.hidden) return;
    refs.dialogRoot.hidden = true;
    for (const d of Object.values(DIALOG_MAP)) d.hidden = true;
    if (dialogOpener) {
      try { dialogOpener.focus(); } catch { /* noop */ }
      dialogOpener = null;
    }
  }

  /* ---------- Theme ---------- */

  function applyTheme() {
    const dark = settings.get().dark;
    const theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    if (pwa && pwa.setTheme) pwa.setTheme(theme);
  }

  /* ---------- Rendering ---------- */

  /** Last rendered values for diffing. */
  const prev = {
    selected: -2,
    values: new Array(81).fill(-1),
    notesMask: new Array(81).fill(-1),
    mistakes: -1,
    memoMode: null,
    difficulty: null,
    score: null,
    paused: null,
    empties: -1,
  };

  let activeHint = null;

  function render(state) {
    const s = state || engine.state;

    // Header.
    if (s.difficulty !== prev.difficulty) {
      refs.statDifficulty.textContent = DIFF_LABELS[s.difficulty] || s.difficulty;
      prev.difficulty = s.difficulty;
    }
    if (s.mistakes !== prev.mistakes) {
      refs.statMistakes.textContent = `${s.mistakes}/3`;
      refs.statMistakes.classList.toggle('is-warn', s.mistakes >= 2);
      prev.mistakes = s.mistakes;
    }
    if (s.score !== prev.score) {
      refs.score.textContent = String(s.score || 0);
      prev.score = s.score;
    }

    // Memo state.
    if (s.memoMode !== prev.memoMode) {
      refs.btnMemo.setAttribute('aria-pressed', String(s.memoMode));
      refs.btnMemo.classList.toggle('is-on', s.memoMode);
      refs.memoBadge.textContent = s.memoMode ? 'ON' : 'OFF';
      refs.memoBadge.classList.toggle('action-badge--on', s.memoMode);
      refs.memoBadge.classList.toggle('action-badge--off', !s.memoMode);
      prev.memoMode = s.memoMode;
    }

    // Pause overlay.
    if (s.paused !== prev.paused) {
      refs.boardOverlay.hidden = !s.paused;
      refs.btnPause.setAttribute('aria-label', s.paused ? '再開' : '一時停止');
      prev.paused = s.paused;
    }

    // Selection + same-value highlighting (touches multiple cells; cheap loop).
    const sel = s.selected;
    const selRow = sel >= 0 ? Math.floor(sel / 9) : -1;
    const selCol = sel >= 0 ? sel % 9 : -1;
    const selBox = sel >= 0 ? Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3) : -1;
    const selValue = sel >= 0 ? s.board[sel] : 0;
    const highlightSame = !!settings.get().highlightSame;

    // Per-cell update — only touch DOM for fields that changed.
    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      const v = s.board[i];
      const r = Math.floor(i / 9);
      const col = i % 9;
      const box = Math.floor(r / 3) * 3 + Math.floor(col / 3);

      // Value or notes diff.
      if (v !== prev.values[i]) {
        if (v) {
          c.value.textContent = String(v);
          c.value.hidden = false;
          c.notes.hidden = true;
        } else {
          c.value.textContent = '';
          c.value.hidden = true;
          c.notes.hidden = false;
        }
        prev.values[i] = v;
      }
      // Notes mask diff (only meaningful when empty).
      if (!v) {
        const mask = notesMask(s.notes[i]);
        if (mask !== prev.notesMask[i]) {
          for (let n = 0; n < 9; n++) {
            const on = (mask >> n) & 1;
            c.noteNodes[n].classList.toggle('is-on', on === 1);
          }
          prev.notesMask[i] = mask;
        }
      } else {
        prev.notesMask[i] = -1;
      }

      // Highlights — cheap classList.toggle, no need to diff.
      const isSelected = i === sel;
      const isRelated = sel >= 0 && !isSelected && (r === selRow || col === selCol || box === selBox);
      const isSame = highlightSame && selValue !== 0 && v === selValue && !isSelected;
      const isError = !s.givens[i] && v !== 0 && v !== s.solution[i];
      const isHint = activeHint && activeHint.cell === i;

      c.root.classList.toggle('is-given', s.givens[i]);
      c.root.classList.toggle('is-user', !s.givens[i] && v !== 0);
      c.root.classList.toggle('is-selected', isSelected);
      c.root.classList.toggle('is-related', isRelated);
      c.root.classList.toggle('is-same', isSame);
      c.root.classList.toggle('is-error', isError);
      c.root.classList.toggle('is-hint', !!isHint);

      // Update aria label when value changes.
      if (v !== prev.values[i] || isSelected) {
        c.root.setAttribute('aria-label', cellAriaLabel(i, v, s.givens[i]));
      }
    }

    // Number pad — dim values fully placed.
    if (s.empties !== prev.empties || prev.empties === -1) {
      const counts = new Array(10).fill(0);
      for (let i = 0; i < 81; i++) counts[s.board[i]]++;
      for (let n = 1; n <= 9; n++) {
        padBtns[n - 1].classList.toggle('is-done', counts[n] >= 9);
      }
      prev.empties = s.empties;
    }

    // Hint badge.
    refs.hintBadge.textContent = s.empties > 0 ? '1' : '0';

    // Time (state path also updates time so initial render is correct).
    refs.statTime.textContent = formatTime(s.elapsedMs);
  }

  /** Cheap path used by timer ticks — only updates the clock. */
  function renderTick(state) {
    refs.statTime.textContent = formatTime(state.elapsedMs);
  }

  function renderTotals(statsState) {
    refs.statTotal.textContent = formatNumber(statsState.totalScore || 0);
  }

  function renderSettingsDialog() {
    const s = settings.get();
    refs.optDark.checked = !!s.dark;
    refs.optSound.checked = !!s.sound;
    refs.optHighlight.checked = !!s.highlightSame;
    refs.optAutoNotes.checked = !!s.autoRemoveNotes;
    refs.optHaptics.checked = !!s.haptics;
    renderStatsList();
  }

  function renderStatsList() {
    const st = stats.get();
    const winRate = st.played ? Math.round((st.completed / st.played) * 100) : 0;
    const avg = st.completed ? Math.round(st.totalTimeMs / st.completed) : 0;
    const rows = [
      ['プレイ回数', st.played],
      ['クリア回数', st.completed],
      ['勝率', `${winRate}%`],
      ['ベストタイム', st.bestTimeMs ? formatTime(st.bestTimeMs) : '—'],
      ['平均タイム', avg ? formatTime(avg) : '—'],
      ['現在の連勝', st.currentStreak],
      ['最長連勝', st.longestStreak],
      ['通算スコア', formatNumber(st.totalScore || 0)],
    ];
    refs.statsList.innerHTML = rows
      .map(([k, v]) => `<li><span>${escapeHTML(k)}</span><strong>${escapeHTML(String(v))}</strong></li>`)
      .join('');
  }

  /* ---------- Side effects (hint toast, loading, mistakes) ---------- */

  function showHint(hint) {
    activeHint = hint;
    const chainLabels = (hint.chain && hint.chain.length)
      ? hint.chain.map((l) => TECHNIQUE_LABELS[l] || l)
      : [TECHNIQUE_LABELS[hint.technique] || hint.technique];
    const title = chainLabels.join(' → ');
    refs.toast.innerHTML = `
      <div class="toast-title">${escapeHTML(title)}</div>
      <div class="toast-body">${escapeHTML(hint.reason)}</div>
      <button class="toast-action" type="button" id="toast-apply">答えを入れる</button>
    `;
    refs.toast.hidden = false;
    refs.toast.classList.add('is-visible');
    announce(`ヒント: ${hint.reason}`);

    const apply = refs.toast.querySelector('#toast-apply');
    if (apply) apply.addEventListener('click', () => {
      onAction('apply-hint', hint);
      hideHint();
    });

    clearTimeout(showHint._t);
    showHint._t = setTimeout(hideHint, 8000);
    render();
  }

  function hideHint() {
    activeHint = null;
    refs.toast.classList.remove('is-visible');
    setTimeout(() => { refs.toast.hidden = true; }, 200);
    render();
  }

  function flashMistake(i) {
    const c = cells[i];
    if (!c) return;
    c.root.classList.remove('shake');
    // restart animation
    // eslint-disable-next-line no-unused-expressions
    void c.root.offsetWidth;
    c.root.classList.add('shake');
    announce(`間違い ${engine.state.mistakes}/3`);
  }

  function showLoading(on) {
    refs.loading.hidden = !on;
  }

  function announce(msg) {
    refs.liveRegion.textContent = '';
    requestAnimationFrame(() => { refs.liveRegion.textContent = msg; });
  }

  /* ---------- Wire up engine + settings + stats ---------- */

  engine.subscribe(render);
  engine.subscribeTick(renderTick);
  settings.subscribe(() => { applyTheme(); render(); renderSettingsDialog(); });
  stats.subscribe((s) => { renderTotals(s); renderStatsList(); });

  applyTheme();
  render();
  renderTotals(stats.get());

  return { showHint, hideHint, flashMistake, showLoading, announce, openDialog, closeDialog };
}

/* ---------- Helpers ---------- */

function notesMask(set) {
  let m = 0;
  for (const v of set) m |= 1 << (v - 1);
  return m;
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatNumber(n) {
  return new Intl.NumberFormat('ja-JP').format(n || 0);
}

function cellAriaLabel(i, v, given) {
  const r = Math.floor(i / 9) + 1;
  const c = (i % 9) + 1;
  const valTxt = v ? `${v}` : '空';
  return `${r}行 ${c}列 ${valTxt}${given ? ' 固定' : ''}`;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
