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
export const QUEUE_DEPTH = 8;

// Arrow maze (dir: 0=N, 1=E, 2=S, 3=W) - tight packing, larger display
export const MAZE_ROWS = 5;
export const MAZE_COLS = 5;
export const MAZE_CELL_SIZE = 44;

// Conveyor track around maze (rounded rect)
export const CONVEYOR_SLOT_COUNT = 12;
export const CONVEYOR_TRACK_WIDTH = 36;
export const CONVEYOR_CORNER_RADIUS = 24;

// Balloon sizing
export const BALLOON_RADIUS = 16;

// Conveyor animation (progress per second, 0-1 = full loop)
export const CONVEYOR_SPEED = 0.15;

// Arrow triggers only when balloon exactly aligns with arrow exit point (~1/4 slot)
export const ARROW_PROXIMITY_THRESHOLD = 0.005;

// Debug: draw 10x10 sub-grid with black lines for each arrow cell
export const DEBUG_DRAW_10x10_GRID = false;

// Level data: queues (arrays of color keys), maze (grid of { color, dir } or null)
export const INITIAL_QUEUES = [
  ['red', 'blue', 'yellow', 'red', 'blue', 'yellow', 'red'],
  ['blue', 'yellow', 'red', 'blue', 'yellow', 'red', 'blue'],
  ['yellow', 'red', 'blue', 'yellow', 'red', 'blue', 'yellow'],
];

// Fallback maze if generator fails (path = 4 points on 10x10 grid, spans 0-9)
function makePath(dir) {
  const paths = {
    0: [[4, 9], [4, 4], [7, 4], [7, 0]],
    1: [[1, 5], [7, 5], [7, 3], [9, 3]],
    2: [[5, 1], [5, 7], [3, 7], [3, 9]],
    3: [[8, 4], [2, 4], [2, 6], [0, 6]],
  };
  return paths[dir];
}
export const FALLBACK_MAZE = [
  [{ color: 'red', path: makePath(0) }, { color: 'blue', path: makePath(0) }, { color: 'yellow', path: makePath(0) }, { color: 'red', path: makePath(0) }, { color: 'blue', path: makePath(1) }],
  [{ color: 'yellow', path: makePath(3) }, { color: 'red', path: makePath(1) }, { color: 'blue', path: makePath(2) }, { color: 'red', path: makePath(1) }, { color: 'red', path: makePath(2) }],
  [{ color: 'blue', path: makePath(3) }, { color: 'yellow', path: makePath(1) }, { color: 'red', path: makePath(2) }, { color: 'blue', path: makePath(0) }, { color: 'yellow', path: makePath(1) }],
  [{ color: 'red', path: makePath(3) }, { color: 'blue', path: makePath(2) }, { color: 'yellow', path: makePath(1) }, { color: 'red', path: makePath(3) }, { color: 'blue', path: makePath(2) }],
  [{ color: 'yellow', path: makePath(3) }, { color: 'red', path: makePath(3) }, { color: 'blue', path: makePath(2) }, { color: 'yellow', path: makePath(2) }, { color: 'red', path: makePath(2) }],
];
