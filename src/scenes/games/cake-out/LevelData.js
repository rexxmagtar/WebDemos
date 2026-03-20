import {
  GRID_ROWS,
  GRID_COLS,
  PLACEHOLDER_SIZE,
  COLOR_KEYS,
  LEVEL_SEED,
} from './GameConfig.js';
import { createSeededRandom } from './PlateGenerator.js';

/** Fewer cells per seed ⇒ smaller patches; same color can seed several separate blobs. */
const CLUSTER_FILLS_PER_SEED = 30;
/** Enough seeds for multiple smaller groups (several regions may share one color). */
const CLUSTER_SEEDS_MIN = 14;
const CLUSTER_SEEDS_MAX = 42;

/**
 * Placeholder anchors: top-left (row, col) of each 4×4 dock.
 * Layout matches mockup: top-center, mid-left, mid-right, bottom-center.
 */
export const PLACEHOLDER_ANCHORS = [
  [1, 8],
  [12, 2],
  [12, 14],
  [24, 8],
];

function cellInAnyPlaceholder(r, c, anchors = PLACEHOLDER_ANCHORS) {
  for (const [ar, ac] of anchors) {
    if (r >= ar && r < ar + PLACEHOLDER_SIZE && c >= ac && c < ac + PLACEHOLDER_SIZE) {
      return true;
    }
  }
  return false;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const UNSET = 0;

/**
 * Many seeds with random colors → small–medium blobs; duplicate hues give several same-color groups.
 * null = placeholder dock; { type, color } = cake.
 */
export function buildInitialGrid(seed = LEVEL_SEED) {
  const rng = createSeededRandom(seed + 777);

  const grid = [];
  const fillable = [];

  for (let r = 0; r < GRID_ROWS; r++) {
    grid[r] = [];
    for (let c = 0; c < GRID_COLS; c++) {
      if (cellInAnyPlaceholder(r, c)) {
        grid[r][c] = null;
      } else {
        grid[r][c] = UNSET;
        fillable.push([r, c]);
      }
    }
  }

  shuffleInPlace(fillable, rng);

  let numSeeds = Math.ceil(fillable.length / CLUSTER_FILLS_PER_SEED);
  numSeeds = Math.min(CLUSTER_SEEDS_MAX, Math.max(CLUSTER_SEEDS_MIN, numSeeds));
  numSeeds = Math.min(numSeeds, fillable.length);

  const frontier = [];
  for (let i = 0; i < numSeeds; i++) {
    const [r, c] = fillable[i];
    const color = COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)];
    grid[r][c] = { type: 'cake', color };
    frontier.push([r, c]);
  }

  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  while (frontier.length > 0) {
    const pick = Math.floor(rng() * frontier.length);
    const [r, c] = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();

    const cell = grid[r][c];
    if (!cell || cell === UNSET) continue;
    const { color } = cell;

    const dirs = shuffleInPlace([...deltas], rng);
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
      if (grid[nr][nc] !== UNSET) continue;
      grid[nr][nc] = { type: 'cake', color };
      frontier.push([nr, nc]);
    }
  }

  return grid;
}

export function getPlaceholderFootprint(anchorR, anchorC) {
  const cells = [];
  for (let dr = 0; dr < PLACEHOLDER_SIZE; dr++) {
    for (let dc = 0; dc < PLACEHOLDER_SIZE; dc++) {
      cells.push([anchorR + dr, anchorC + dc]);
    }
  }
  return cells;
}
