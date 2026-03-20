# Cake Out — sprite asset

Add your PNG here:

| File | Description |
|------|-------------|
| **cake-piece.png** | One cake slice / wedge. Use a **light or white** base so Phaser **`setTint`** matches level colors (green, red, blue, yellow, purple). |

## Suggested specs

- **Size:** 64×64 or 128×128 px (the game scales to the grid cell)
- **Format:** PNG with transparency
- **Filename:** `cake-piece.png` — path is `ASSET_PATHS.CAKE_PIECE` in `src/scenes/games/cake-out/SpriteKeys.js`.

Until this file is in `assets/cake-out/`, Phaser will fail at load—add the PNG when ready.
