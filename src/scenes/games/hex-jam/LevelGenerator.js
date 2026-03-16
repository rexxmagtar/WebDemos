// HexJam - Level generation
// Guarantees: count of each color in hexColors === count of that color in queue.

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
// Returns a function that produces reproducible floats in [0, 1) for a given seed.
function makePRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Fisher-Yates shuffle using a provided random function ────────────────────
function shuffle(array, rand) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ── Flower picture (10×10) ───────────────────────────────────────────────────
// Large flower head (rows 0-6) + stem/leaves (rows 7-9), blue sky background.
//
// Color counts: blue=41  red=22  yellow=21  green=10  purple=6  → total 100
//
//   R = wide petal ring (outer)
//   Y = large yellow centre
//   P = purple core accents inside centre
//   G = stem + leaves
//   B = sky background
const B = 'blue', R = 'red', Y = 'yellow', G = 'green', P = 'purple';
const FLOWER_PATTERN = [
  //  0  1  2  3  4  5  6  7  8  9
  [   B, R, R, R, R, R, R, R, B, B ],  // row 0 — wide top petal ring
  [   B, R, Y, Y, Y, Y, Y, R, B, B ],  // row 1 — upper centre
  [   B, R, P, Y, Y, Y, P, R, B, B ],  // row 2 — centre + purple accent
  [   R, Y, Y, P, Y, P, Y, Y, R, B ],  // row 3 — widest centre row
  [   B, R, P, Y, Y, Y, P, R, B, B ],  // row 4 — centre + purple accent
  [   B, R, Y, Y, Y, Y, Y, R, B, B ],  // row 5 — lower centre
  [   B, B, R, R, R, R, R, B, B, B ],  // row 6 — bottom petal ring
  [   B, B, G, G, G, G, B, B, B, B ],  // row 7 — stem + leaf base
  [   B, G, G, B, G, B, G, G, B, B ],  // row 8 — wide leaves
  [   B, B, B, B, G, B, B, B, B, B ],  // row 9 — stem base
];

// ── Flat-top even-q neighbour offsets ────────────────────────────────────────
function neighbours(col, row, cols, rows) {
  const dirs = col % 2 === 0
    ? [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]]
    : [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]];
  return dirs
    .map(([dc, dr]) => [col + dc, row + dr])
    .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows);
}

/**
 * Generate a level.
 *
 * For a 10×10 grid the flower picture is used; any other size falls back to
 * an evenly-distributed layout.
 *
 * The queue is shuffled with a reproducible seeded PRNG so the same seed
 * always produces the same order.  After shuffling the front of the queue is
 * guaranteed to be playable:
 *
 *   position 0        → start hex colour (consumed on game init)
 *   positions 1 … N  → one slot per neighbour of the start hex (same colour
 *                       allowed multiple times), so every revealed hex has a
 *                       matching unit in the first visible QUEUE_ENABLED slots.
 *
 * @param {number}   cols
 * @param {number}   rows
 * @param {string[]} colorKeys
 * @param {number}   [startCol]
 * @param {number}   [startRow]
 * @param {number}   [seed]
 */
export function generateLevel(cols, rows, colorKeys,
                              startCol = 0, startRow = 0, seed = 1) {
  const rand      = makePRNG(seed);
  const hexColors = new Map();
  const colorList = [];

  if (cols === 10 && rows === 10) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const color = FLOWER_PATTERN[r][c];
        hexColors.set(`${c},${r}`, color);
        colorList.push(color);
      }
  } else {
    const total      = cols * rows;
    const numColors  = colorKeys.length;
    const baseCount  = Math.floor(total / numColors);
    const remainder  = total % numColors;
    for (let i = 0; i < numColors; i++) {
      const count = baseCount + (i < remainder ? 1 : 0);
      for (let j = 0; j < count; j++) colorList.push(colorKeys[i]);
    }
    shuffle(colorList, rand);
    let idx = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        hexColors.set(`${c},${r}`, colorList[idx++]);
  }

  // Build queue with same color counts, shuffled with the seeded PRNG
  const queue = [...colorList];
  shuffle(queue, rand);

  // ── Seed the front for guaranteed playability ─────────────────────────────
  // Build the list of colors needed at the very start:
  //   index 0       → consumed immediately for the start hex
  //   index 1 … N  → one entry per neighbour (duplicates allowed) so that
  //                   every initially-revealed hex has a match in the first
  //                   visible queue slots
  const needed = [hexColors.get(`${startCol},${startRow}`)];
  for (const [nc, nr] of neighbours(startCol, startRow, cols, rows))
    needed.push(hexColors.get(`${nc},${nr}`));

  for (let s = 0; s < needed.length; s++) {
    const color = needed[s];
    const idx   = queue.indexOf(color, s);   // first occurrence at or after s
    if (idx !== -1 && idx !== s) [queue[s], queue[idx]] = [queue[idx], queue[s]];
  }
  // ─────────────────────────────────────────────────────────────────────────

  return { hexColors, queue };
}
