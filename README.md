# Game Prototypes

A Phaser 3 web project for testing indie game ideas and validating core loop concepts.

## No Build Required (GitHub Pages)

This project runs with **no npm or build step**. Phaser is loaded from a CDN. Multiple JS files load natively via ES modules.

Deploy to GitHub Pages: push the repo, enable GitHub Pages in repo settings, and it works.

**Local test:** Run `npx serve .` (opening `index.html` directly may fail due to CORS with modules).

## Project Structure

```
index.html               # Menu with links to each game (no JS)
doodle-jump.html        # Doodle Jump page (loads only that game)
sorter.html             # Sorter page (loads only that game)
src/
├── games/
│   ├── doodle-jump.js   # Doodle Jump entry
│   └── sorter.js       # Sorter entry
├── lib/
│   └── phaser.js       # CDN shim
├── scenes/games/
│   ├── doodle-jump/     # Doodle Jump scene
│   └── sorter/          # Sorter scene + assets
└── assets/
```

## Games

### Doodle Jump

[doodle-jump.html](doodle-jump.html) — Endless vertical jumper. Use **arrow keys** or **A/D** to move left/right.

### Sorter

[sorter.html](sorter.html) — Puzzle game: process seeds, water, and crates to fulfill consumers. Sprites in `assets/sorter/` — see [ASSETS_NEEDED.md](assets/sorter/ASSETS_NEEDED.md).

## Adding a New Game

1. Create `src/scenes/games/your-game/YourGameScene.js`
2. Create `src/games/your-game.js` that boots Phaser with only that scene
3. Create `your-game.html` that loads Phaser CDN + `src/games/your-game.js`
4. Add a link in `index.html` to `your-game.html`
