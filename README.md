# Sudoku

A mobile-first, offline-ready Sudoku PWA written in plain HTML5, CSS3, and ES6+
JavaScript. No frameworks, no build step, no backend.

* Fits a single iPhone 12 screen without scrolling (`100dvh`, board kept square via `aspect-ratio: 1/1`).
* Installable on iPhone Safari and Android Chrome.
* Works fully offline after first load (service worker cache).
* Generates **unique-solution** puzzles up to the *Extreme* tier (top ~20% hardest).
* Pure ES6 modules, clean architecture (engine / generator / solver / UI / storage / PWA), no globals.

---

## Project structure

```
/
├── index.html
├── manifest.json
├── service-worker.js
├── README.md
├── assets/
│   └── icons/
│       ├── icon.svg
│       ├── icon-180.png
│       ├── icon-192.png
│       └── icon-512.png
├── css/
│   └── app.css
└── js/
    ├── app.js              # entry — wires engine + UI + storage + PWA
    ├── sudoku-engine.js    # game state, history, timer, hints, win/loss
    ├── sudoku-generator.js # symmetric-removal puzzle generator
    ├── sudoku-solver.js    # backtracking + naked/hidden single/pair, scoring
    ├── ui.js               # DOM rendering & event delegation
    ├── storage.js          # localStorage wrapper (state, settings, stats)
    └── pwa.js              # service-worker registration
```

---

## Features

### Gameplay
* 9×9 board, cell selection, number entry, replacement, delete.
* **Memo mode** — pencil marks rendered as a 3×3 mini-grid inside each cell.
* **Undo** — full action history (value, deleted value, memo changes, mistake counter).
* **Hint** — 3 internal levels:
  * Level 1 highlights a solvable cell.
  * Level 2 explains why (technique + reason).
  * Level 3 reveals the answer.
  The UI button uses Level 1 by default; tap the hint button twice on the same
  cell within 2 seconds to apply Level 3.
* Mistake counter (max 3) with game-over dialog and restart.
* Victory animation + best-time tracking.

### Highlighting
Selecting a cell highlights:
* The entire row
* The entire column
* The 3×3 block
* Every cell on the board that contains the same value

### Engine
* Random fully-solved grid via randomised backtracking.
* Centrosymmetric clue removal with uniqueness verification (`countSolutions` ≤ 2).
* Difficulty scored via technique-weighted cost:
  * naked single, hidden single, naked pair, hidden pair, backtracking guess.
* Labels: easy, medium, hard, expert, extreme. Default: **extreme**.

### Persistence (localStorage)
* Current board, elapsed time, notes, mistakes, difficulty, selected cell.
* Autosaved after every move; restored automatically on reload.
* Statistics: games played, completed, best time, average time, win rate,
  current streak, longest streak, total score.
* Settings: dark mode, sound, highlight-same-numbers, auto-remove notes.

### Timer
* Starts on first move.
* Pauses when the document is hidden (`visibilitychange`).
* Pause button overlays the board with a Resume button.
* Time persists after refresh.

### PWA
* `manifest.json` for installation (name, short_name, start_url, icons, theme/background colour, standalone display).
* `service-worker.js` caches all core assets; network-first for navigations, cache-first for assets, offline fallback to `index.html`.
* Apple touch icon + iOS web-app meta tags.

### Accessibility
* All buttons & cells ≥ 44 px touch targets.
* `user-scalable=no` viewport + `touch-action: manipulation` prevent accidental zooming.
* Keyboard support: 1–9 inputs, Backspace/Delete erase, arrows move selection, Cmd/Ctrl+Z undo, `m` memo, `h` hint, Esc closes dialogs.
* Roles: `grid`, `gridcell`, `aria-label`s on icon buttons.

---

## Running locally

The app is static. Any HTTP server works — **don't open `index.html` via the
`file://` protocol**, because service workers and ES modules require an HTTP
origin.

```bash
# from inside the project folder
python3 -m http.server 8080
#   then open http://localhost:8080
```

Or, with Node installed:

```bash
npx serve .
```

Then visit the URL the server prints.

---

## Deploying to GitHub Pages

1. Create a new repository on GitHub, e.g. `sudoku`.
2. Push the contents of this folder to the `main` branch:

   ```bash
   git init
   git add .
   git commit -m "Initial Sudoku PWA"
   git branch -M main
   git remote add origin https://github.com/<you>/sudoku.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment**
   * **Source:** *Deploy from a branch*
   * **Branch:** `main` / `(root)`
4. Wait ~1 minute. The site will be available at
   `https://<you>.github.io/sudoku/`.

### PWA install
* **iPhone Safari:** open the page → Share → *Add to Home Screen*.
* **Android Chrome:** open the page → menu → *Install app*.

> If you serve from `https://<you>.github.io/sudoku/`, the `manifest.json`,
> `service-worker.js`, and all asset paths are already relative (`./`), so no
> changes are needed.

---

## Tech notes

* No build, no transpiler. All `js/*.js` files use native ES modules
  (`<script type="module" src="js/app.js">`).
* The solver and generator are written for speed on mid-range mobile hardware:
  MRV heuristic during backtracking and early exit when `countSolutions` ≥ 2.
* UI updates are batched into a single `render()` call per state change, driven
  by an engine pub/sub. Event delegation is used for board cells and the number
  pad — no per-cell listeners.
* The board is laid out with CSS Grid (`grid-template-columns: repeat(9, 1fr)`)
  and stays a perfect square via `aspect-ratio: 1/1`. The whole app is contained
  in a flex column of fixed-height children inside a `100dvh` viewport, so the
  iPhone 12 layout never scrolls.

---

## License

Personal-use project. Do whatever you want with the code.
