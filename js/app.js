/**
 * @file Application entry — wires engine, UI, settings, stats, storage, PWA.
 */

import { SudokuEngine } from './sudoku-engine.js';
import { createUI } from './ui.js';
import { createSettings } from './settings.js';
import { createStats } from './stats.js';
import { Storage } from './storage.js';
import { setupPWA } from './pwa.js';

const audio = createAudio();

main();

function main() {
  const engine = new SudokuEngine();
  const settings = createSettings();
  const stats = createStats();
  const pwa = setupPWA();

  /** Pending hint awaiting user confirmation to apply. */
  let pendingHint = null;

  const ui = createUI({ engine, settings, stats, onAction: handleAction, pwa });

  // Persist engine state — debounced inside Storage.
  engine.subscribe((state) => Storage.saveState(serializeFromState(state, engine)));

  // Restore previous game or start a new one.
  const saved = Storage.loadState();
  if (saved && engine.hydrate(saved)) {
    if (!engine.state.completed && !engine.state.gameOver && !engine.state.paused) {
      engine.startTimer();
    }
  } else {
    startNewGame('extreme');
  }

  // Pause when the tab/app goes hidden; resume only if not user-paused.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) engine.stopTimer();
    else if (!engine.state.paused) engine.startTimer();
  });
  window.addEventListener('pagehide', () => engine.stopTimer());

  // Prime audio on first interaction so iOS allows playback.
  ['pointerdown', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, audio.prime, { once: true })
  );

  /* ----- Dispatcher ----- */

  function handleAction(action, payload) {
    switch (action) {
      case 'select':
        if (pendingHint) ui.hideTutor();
        pendingHint = null;
        engine.select(payload);
        break;

      case 'input': {
        const before = { completed: engine.state.completed, gameOver: engine.state.gameOver };
        const result = engine.input(payload, { autoRemoveNotes: settings.get().autoRemoveNotes });
        if (result.kind === 'value' || result.kind === 'mistake') engine.startTimer();
        if (result.kind === 'mistake') {
          ui.flashMistake(engine.state.selected);
          if (settings.get().haptics) vibrate([40, 30, 40]);
          if (settings.get().sound) audio.play('err');
        } else if (result.kind === 'value') {
          if (settings.get().sound) audio.play('tap');
        } else if (result.kind === 'note' || result.kind === 'erase') {
          if (settings.get().sound) audio.play('tap');
        }
        if (!before.completed && engine.state.completed) finalizeWin();
        if (!before.gameOver && engine.state.gameOver) finalizeLoss();
        break;
      }

      case 'erase':
        engine.erase();
        if (settings.get().sound) audio.play('tap');
        break;

      case 'undo':
        engine.undo();
        if (settings.get().sound) audio.play('tap');
        break;

      case 'memo':
        engine.toggleMemo();
        break;

      case 'hint': {
        const hint = engine.hint();
        if (!hint) return;
        engine.select(hint.cell);
        pendingHint = hint;
        ui.showTutor(hint);
        break;
      }

      case 'tutor-cancel':
        pendingHint = null;
        break;

      case 'apply-hint': {
        const before = { completed: engine.state.completed };
        if (payload) engine.applyHint(payload);
        pendingHint = null;
        if (settings.get().haptics) vibrate(30);
        if (settings.get().sound) audio.play('tap');
        if (!before.completed && engine.state.completed) finalizeWin();
        break;
      }

      case 'pause':
        engine.togglePause();
        break;

      case 'new':
        ui.closeDialog();
        startNewGame(payload || 'extreme');
        break;

      case 'restart':
        engine.restart();
        engine.startTimer();
        break;

      case 'reset-stats':
        stats.reset();
        break;

      default: break;
    }
  }

  async function startNewGame(diff) {
    engine.stopTimer();
    ui.showLoading(true);
    // Yield once so the loading indicator paints before the (sync) generator runs.
    await new Promise((r) => setTimeout(r, 0));
    try {
      await engine.newGameAsync(diff);
      stats.recordNewGame();
      Storage.flushState();
      engine.startTimer();
      ui.announce('新しいゲームを開始しました');
    } finally {
      ui.showLoading(false);
    }
  }

  function finalizeWin() {
    engine.stopTimer();
    const ms = engine.state.elapsedMs;
    stats.recordWin({ timeMs: ms, score: engine.state.score, difficulty: engine.state.difficulty });
    if (settings.get().haptics) vibrate([60, 40, 60, 40, 80]);
    if (settings.get().sound) audio.play('win');
    ui.openDialog('victory');
    const desc = document.getElementById('victory-desc');
    if (desc) desc.textContent = `${formatTime(ms)} でクリア!`;
  }

  function finalizeLoss() {
    engine.stopTimer();
    stats.recordLoss();
    if (settings.get().haptics) vibrate([100, 50, 100]);
    if (settings.get().sound) audio.play('err');
    ui.openDialog('gameover');
  }
}

/* ----- Helpers ----- */

function serializeFromState(_state, engine) {
  // We always serialize via the engine to keep the format authoritative.
  return engine.serialize();
}

function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ----- Audio cues ----- */

function createAudio() {
  let ctx = null;
  function ensure() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { ctx = new C(); } catch { ctx = null; }
    return ctx;
  }
  function prime() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => undefined);
  }
  function play(kind) {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => undefined);
    try {
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g).connect(c.destination);
      const t = c.currentTime;
      if (kind === 'win') {
        o.frequency.setValueAtTime(880, t);
        o.frequency.exponentialRampToValueAtTime(1320, t + 0.25);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.5);
      } else if (kind === 'err') {
        o.frequency.setValueAtTime(180, t);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.start(t); o.stop(t + 0.3);
      } else {
        o.frequency.setValueAtTime(640, t);
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        o.start(t); o.stop(t + 0.1);
      }
    } catch { /* ignore */ }
  }
  return { prime, play };
}
