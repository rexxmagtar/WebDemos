import { makeEmptyBoard, TYPES, createState, hasLegalMove } from "./model.js";

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/**
 * @param {number} [seed] integer seed; default = time
 */
export function generateLevel(seed = Date.now() & 0xffffffff) {
  let s = seed | 0;
  let board;
  let counts;
  for (let attempt = 0; attempt < 120; attempt++) {
    s = (s * 0x9e3779b1 + attempt + 1) | 0;
    const res = buildOne(mulberry32(s));
    if (hasLegalMove(res.board)) {
      return { ...res, seed: s };
    }
  }
  const fallback = buildOne(mulberry32(seed | 0));
  return { ...fallback, seed: seed | 0 };
}

function buildOne(rng) {
  const rows = 7,
    cols = 7;
  const numEmpty = 6 + Math.floor(rng() * 4);
  const total = rows * cols - numEmpty;
  const removableTotal = Math.max(0, total - 1);
  const base = Math.floor(removableTotal / TYPES);
  let rem = removableTotal - base * TYPES;
  const counts = [base, base, base, base, base];
  while (rem > 0) {
    counts[Math.floor(rng() * TYPES)]++;
    rem--;
  }
  const survivor = Math.floor(rng() * TYPES);
  counts[survivor]++;

  const board = makeEmptyBoard(rows, cols);
  const flat = [];
  for (let t = 0; t < TYPES; t++) for (let k = 0; k < counts[t]; k++) flat.push(t);
  shuffle(flat, rng);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c]);
  shuffle(cells, rng);
  const emptySet = new Set();
  for (let i = 0; i < numEmpty; i++) {
    const [r, c] = cells[i];
    emptySet.add(r + "," + c);
  }
  let m = 0;
  for (const [r, c] of cells) {
    if (emptySet.has(r + "," + c)) continue;
    board[r][c] = flat[m++];
  }
  return { board, counts };
}

export function newGameFromSeed(seed) {
  const { board, counts, seed: s } = generateLevel(seed);
  const state = createState(board);
  return { state, counts, seed: s };
}
