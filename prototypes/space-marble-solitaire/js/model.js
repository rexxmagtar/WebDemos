const EMPTY = -1;
const TYPES = 5;
const RING_MAX = 8;

const NAMES = ["Earth", "Mars", "Venus", "Sun", "Moon"];

function makeEmptyBoard(rows, cols) {
  const g = [];
  for (let r = 0; r < rows; r++) {
    g[r] = [];
    for (let c = 0; c < cols; c++) g[r][c] = EMPTY;
  }
  return g;
}

/**
 * Same row or column only. Destination must be empty. Empty cells on the segment are allowed;
 * every occupied cell strictly between source and destination is collected (in order).
 * At least one such planet is required (no adjacent-only slides with nothing absorbed).
 * @returns {{ r0: number, c0: number, r1: number, c1: number, between: {r: number, c: number}[], mover: number } | null }
 */
function findMovePath(board, r0, c0, r1, c1) {
  const rows = board.length,
    cols = board[0].length;
  if (r0 < 0 || c0 < 0 || r1 < 0 || c1 < 0 || r0 >= rows || c0 >= cols || r1 >= rows || c1 >= cols) return null;
  if (r0 === r1 && c0 === c1) return null;
  const s = board[r0][c0];
  if (s === EMPTY) return null;
  if (board[r1][c1] !== EMPTY) return null;
  if (r0 === r1) {
    const step = c1 > c0 ? 1 : -1;
    const between = [];
    for (let c = c0 + step; c !== c1; c += step) {
      const cell = board[r0][c];
      if (cell !== EMPTY) between.push({ r: r0, c });
    }
    if (between.length < 1) return null;
    return { r0, c0, r1, c1, between, mover: s };
  }
  if (c0 === c1) {
    const step = r1 > r0 ? 1 : -1;
    const between = [];
    for (let r = r0 + step; r !== r1; r += step) {
      const cell = board[r][c0];
      if (cell !== EMPTY) between.push({ r, c: c0 });
    }
    if (between.length < 1) return null;
    return { r0, c0, r1, c1, between, mover: s };
  }
  return null;
}

function hasLegalMove(board) {
  const rows = board.length,
    cols = board[0].length;
  for (let r0 = 0; r0 < rows; r0++) {
    for (let c0 = 0; c0 < cols; c0++) {
      if (board[r0][c0] === EMPTY) continue;
      for (let r1 = 0; r1 < rows; r1++) {
        for (let c1 = 0; c1 < cols; c1++) {
          if (findMovePath(board, r0, c0, r1, c1)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * @param {number[][]} board
 */
function createState(board) {
  return {
    board,
    ring: [],
    sucked: 0,
    won: false,
    lost: false,
    reason: null,
    selection: null
  };
}

/**
 * One merge step: if any planet type appears at least 3 times on the ring, remove the
 * leftmost three of the lowest such type. Optionally records `{ type, indices }` for UI.
 * @param {number[]} ring
 * @param {Array<{ type: number, indices: number[] }> | null} [mergeLog]
 */
function tryMergeOnce(ring, mergeLog) {
  if (ring.length < 3) return false;
  for (let t = 0; t < TYPES; t++) {
    let cnt = 0;
    for (let j = 0; j < ring.length; j++) {
      if (ring[j] === t) cnt++;
    }
    if (cnt < 3) continue;
    const indices = [];
    for (let i = 0; i < ring.length && indices.length < 3; i++) {
      if (ring[i] === t) indices.push(i);
    }
    for (let k = indices.length - 1; k >= 0; k--) {
      ring.splice(indices[k], 1);
    }
    if (mergeLog) mergeLog.push({ type: t, indices });
    return true;
  }
  return false;
}

/**
 * Append all captured types, then resolve triples. Overflow is checked only after merges so
 * a move can briefly exceed capacity before e.g. three new same-type planets merge away.
 * @param {number[]} ring0
 * @param {number[]} incomingTypes
 * @returns {{ ring: number[], ringAfterPush: number[], sucked: number, mergeSteps: { type: number, indices: number[] }[] } | null}
 */
function simulateRingDeposits(ring0, incomingTypes) {
  const ring = ring0.slice();
  for (const t of incomingTypes) {
    ring.push(t);
  }
  const ringAfterPush = ring.slice();
  let sucked = 0;
  const mergeSteps = [];
  while (tryMergeOnce(ring, mergeSteps)) {
    sucked += 3;
  }
  if (ring.length > RING_MAX) return null;
  return { ring, ringAfterPush, sucked, mergeSteps };
}

/**
 * @returns {{ mergeSteps: { type: number, indices: number[] }[], ringAfterPush: number[] } | null}
 */
function applyMove(state, path) {
  if (!path || state.won || state.lost) return null;
  const { r0, c0, r1, c1, between, mover } = path;
  const toProcess = [];
  for (const { r, c } of between) toProcess.push(state.board[r][c]);

  const sim = simulateRingDeposits(state.ring, toProcess);
  if (sim === null) {
    state.lost = true;
    state.reason = "overflow";
    return null;
  }
  state.ring = sim.ring;
  state.sucked += sim.sucked;

  for (const { r, c } of between) state.board[r][c] = EMPTY;
  state.board[r0][c0] = EMPTY;
  state.board[r1][c1] = mover;
  if (countMarbles(state.board) === 1) {
    state.won = true;
    state.reason = "one_left";
  } else if (!hasLegalMove(state.board)) {
    state.lost = true;
    state.reason = "stuck";
  }
  return { mergeSteps: sim.mergeSteps, ringAfterPush: sim.ringAfterPush };
}

function countMarbles(board) {
  let n = 0;
  for (const row of board) for (const cell of row) if (cell !== EMPTY) n++;
  return n;
}

function boardEmpty(board) {
  for (const row of board) for (const cell of row) if (cell !== EMPTY) return false;
  return true;
}

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function trySelectAndMove(state, r, c) {
  if (state.won || state.lost) return;
  const cell = state.board[r][c];
  if (state.selection == null) {
    if (cell !== EMPTY) state.selection = { r, c };
    return;
  }
  if (state.selection.r === r && state.selection.c === c) {
    state.selection = null;
    return;
  }
  const path = findMovePath(state.board, state.selection.r, state.selection.c, r, c);
  if (path) {
    state.selection = null;
    applyMove(state, path);
  } else {
    if (cell !== EMPTY) state.selection = { r, c };
    else state.selection = null;
  }
}

export {
  EMPTY,
  TYPES,
  RING_MAX,
  NAMES,
  makeEmptyBoard,
  findMovePath,
  hasLegalMove,
  createState,
  applyMove,
  boardEmpty,
  countMarbles,
  trySelectAndMove,
  cloneBoard,
  simulateRingDeposits
};
