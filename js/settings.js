/**
 * @file Settings store.
 *
 * Single source of truth for user preferences. Subscribers are notified on
 * change; writes are persisted via a debounced storage call.
 */

import { Storage } from './storage.js';

const DEFAULTS = Object.freeze({
  dark: prefersDark(),
  sound: false,
  highlightSame: true,
  autoRemoveNotes: true,
  haptics: true,
});

function prefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function createSettings() {
  const initial = { ...DEFAULTS, ...(Storage.loadSettings() || {}) };
  let state = initial;
  const listeners = new Set();

  const save = debounce((s) => Storage.saveSettings(s), 250);

  function get() { return state; }

  function set(patch) {
    const next = { ...state, ...patch };
    if (shallowEqual(next, state)) return;
    state = next;
    save(state);
    for (const fn of listeners) fn(state);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { get, set, subscribe };
}

function shallowEqual(a, b) {
  for (const k of Object.keys(a)) if (a[k] !== b[k]) return false;
  for (const k of Object.keys(b)) if (a[k] !== b[k]) return false;
  return true;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
}
