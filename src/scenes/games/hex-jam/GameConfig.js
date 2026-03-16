// HexJam - Game configuration (flat-top hex orientation)

// Change this integer to get a different (but reproducible) queue shuffle.
export const LEVEL_SEED = 42;

export const GRID_COLS = 10;
export const GRID_ROWS = 10;

// Hex circumradius in pixels.
// For flat-top hexes: visual width = 2*size, visual height = √3*size ≈ 1.73*size
// (each hex is wider than tall — the natural honeycomb look)
export const HEX_SIZE = 40;

// Number of enabled (visible/usable) units at the front of the queue
export const QUEUE_ENABLED = 5;

// Units per row in the snake queue display.
// 7 circles fill the canvas (x 72–648) while the first row still starts
// directly under the rightmost slot on the right.
export const QUEUE_COLS = 7;

export const COLORS = {
  red:    0xe74c3c,
  blue:   0x3498db,
  yellow: 0xf1c40f,
  green:  0x2ecc71,
  purple: 0x9b59b6,
};

export const COLOR_KEYS = ['red', 'blue', 'yellow', 'green', 'purple'];

// Hidden hex fill color (neutral gray)
export const COLOR_HIDDEN = 0xc5d5dd;

// Starting hex position (bottom-center of the 10×10 grid, even column)
export const START_COL = 4;
export const START_ROW = 9;

// Grid origin: pixel position of the CENTER of hex (col=0, row=0).
//
// Flat-top even-q, HEX_SIZE=40, 10 cols:
//   hSpacing = 60px, visual width = 9*60 + 2*40 = 620px
//   Centered on 720px canvas → left/right margin ≈ 50px each
//   GRID_ORIGIN_X = (720 − 620) / 2 + 40 = 90
//
// 10 rows, vSpacing ≈ 69.28px:
//   grid top  (even col, row 0) = GRID_ORIGIN_Y − 34.64 ≈ 85px (below title bar)
//   grid bottom (odd col, row 9) = GRID_ORIGIN_Y + 692.78 ≈ 813px
export const GRID_ORIGIN_X = 90;
export const GRID_ORIGIN_Y = 120;

// ── Slot zone (first QUEUE_ENABLED units) ────────────────────────────────────
// Five bordered compartments across the full canvas width.
// Score label sits between the grid bottom (~813px) and the slot top.
export const QUEUE_ORIGIN_Y = 880;   // vertical centre of the slots row
export const UNIT_RADIUS    = 46;    // circle radius inside each slot

// ── Snake zone (remaining units, tightly coupled) ─────────────────────────────
// SNAKE_SPACING = 2*UNIT_RADIUS + 4 → 4px gap between circle edges.
// Snake runs RIGHT-TO-LEFT on even rows, LEFT-TO-RIGHT on odd rows.
// Row 0 rightmost circle (first snake element) aligns under slot 4 at x=648.
// SNAKE_ORIGIN_X = 648 − (QUEUE_COLS−1)*96 = 648 − 6*96 = 72.
// Circle centres row 0 (r→l): 648, 552, 456, 360, 264, 168, 72.
export const SNAKE_ORIGIN_X  = 72;
export const QUEUE_SNAKE_Y   = 1032; // centre-y of the first snake row
export const SNAKE_SPACING_X = 96;    // 2*46 + 4  (tight within a row)
export const SNAKE_SPACING_Y = 200;   // rows + 2 walls + circle-sized open gap between walls
