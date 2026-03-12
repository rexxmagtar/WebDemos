// BalloonArrows - Game configuration
// Colors: red, blue, yellow
export const COLORS = {
  red: 0xe74c3c,
  blue: 0x3498db,
  yellow: 0xf1c40f,
};

export const COLOR_KEYS = ['red', 'blue', 'yellow'];

// Conveyor and queues
export const MAX_CONVEYOR_BALLOONS = 6;
export const QUEUE_COUNT = 3;
export const QUEUE_DEPTH = 11;

// Arrow maze - 15x15 field
export const MAZE_ROWS = 15;
export const MAZE_COLS = 15;
export const MAZE_CELL_SIZE = 22;

// Conveyor track around maze (rounded rect)
export const CONVEYOR_SLOT_COUNT = 12;
export const CONVEYOR_TRACK_WIDTH = 36;
export const CONVEYOR_CORNER_RADIUS = 24;

// Balloon sizing
export const BALLOON_RADIUS = 16;

// Conveyor animation (progress per second, 0-1 = full loop)
export const CONVEYOR_SPEED = 0.15;

// Arrow triggers only when balloon exactly aligns with arrow raycast (in pixels)
export const ARROW_PROXIMITY_THRESHOLD = 8;

// Arrow maze: max segments per arrow (2–10), fills space even with few balloons
export const MAX_ARROW_SEGMENTS = 10;

// Debug: draw 10x10 maze cell grid (black lines)
export const DEBUG_DRAW_10x10_GRID = false;
// Debug: log generator stats (available cells vs balloons)
export const DEBUG_GENERATOR = true;

// Seed for maze generation (set to a number for reproducible mazes, null for random)
export const MAZE_SEED = 232;

// 15x15 heart mask (scaled from 10x10): 1 = cell available for arrows
const HEART_10 = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];
export const HEART_MASK = Array.from({ length: 15 }, (_, r) =>
  Array.from({ length: 15 }, (_, c) => (HEART_10[Math.floor(r * 10 / 15)]?.[Math.floor(c * 10 / 15)] ?? 0))
);

// Balloons: total count, distributed across queues (5 per color for 15 total)
export const BALLOON_COUNT = 35;

