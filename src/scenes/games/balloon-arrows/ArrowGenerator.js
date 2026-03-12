/**
 * Simple Arrow Generator for "Balloon Arrows"
 * 
 * STRAIGHTFORWARD ALGORITHM:
 * 1. Determine the sequence of balloon removals (S1...Sn).
 * 2. Place arrows in REVERSE ORDER (Sn...S1).
 * 3. For each arrow, find a "solvable" spot for its head (ray to edge clear of placed arrows).
 * 4. Generate a random line of length 2-10 from that head.
 */

import { COLOR_KEYS, HEART_MASK, MAZE_SEED, DEBUG_GENERATOR, MAX_ARROW_SEGMENTS, MAZE_ROWS, MAZE_COLS } from './GameConfig.js';

/** Seeded RNG */
export function createSeededRandom(seed) {
  let s = seed || Math.floor(Math.random() * 0xffffffff);
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const DIRS = [
  { dr: -1, dc: 0 }, // 0: North
  { dr: 0, dc: 1 },  // 1: East
  { dr: 1, dc: 0 },  // 2: South
  { dr: 0, dc: -1 }, // 3: West
];

export function isInHeart(r, c, rows, cols) {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
  return HEART_MASK[r][c] === 1;
}

/** Derive exit direction from arrow's last two cells */
export function cellsToExitDir(cells) {
  if (!cells || cells.length < 2) return 0;
  const [lr, lc] = cells[cells.length - 1];
  const [pr, pc] = cells[cells.length - 2];
  const dr = lr - pr;
  const dc = lc - pc;
  if (dr < 0) return 0;
  if (dc > 0) return 1;
  if (dr > 0) return 2;
  return 3;
}

export function buildCellToArrow(arrows, rows, cols) {
  const cellToArrow = Array.from({ length: rows }, () => Array(cols).fill(-1));
  for (let i = 0; i < arrows.length; i++) {
    if (!arrows[i]) continue;
    for (const [r, c] of arrows[i].cells) {
      cellToArrow[r][c] = i;
    }
  }
  return cellToArrow;
}

function getHeartCells(rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isInHeart(r, c, rows, cols)) cells.push([r, c]);
    }
  }
  return cells;
}

/** Get the order in which balloons will be picked from the queues */
function getRemovalSequence(queues, rng) {
  const q = queues.map(arr => [...arr]);
  const seq = [];
  while (true) {
    const available = q.map((arr, i) => arr.length > 0 ? i : -1).filter(i => i !== -1);
    if (available.length === 0) break;
    seq.push(q[available[Math.floor(rng() * available.length)]].shift());
  }
  return seq;
}

/** Check if a ray from (r,c) in dir is blocked by ANY existing arrows in the grid */
function isRayBlocked(r, c, dir, grid, rows, cols) {
  const { dr, dc } = DIRS[dir];
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
    if (grid[nr][nc] !== -1) return true;
    nr += dr;
    nc += dc;
  }
  return false;
}

export function generateSolvableMaze(rows, cols, queues) {
  const startSeed = MAZE_SEED != null ? MAZE_SEED : Math.floor(Math.random() * 1000000);

  for (let attempt = 0; attempt < 100; attempt++) {
    const rng = createSeededRandom(startSeed + attempt);
    const removalSeq = getRemovalSequence(queues, rng);
    if (removalSeq.length === 0) return { arrows: [], cellToArrow: buildCellToArrow([], rows, cols) };

    const grid = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const allHeartCells = getHeartCells(rows, cols);
    const arrows = [];

    let success = true;
    // PLACE IN REVERSE ORDER (last balloon removed gets placed first)
    for (let i = removalSeq.length - 1; i >= 0; i--) {
      const color = removalSeq[i];
      let foundSpot = false;

      // Shuffle heart cells to find a random head position
      const headCandidates = [...allHeartCells];
      for (let j = headCandidates.length - 1; j > 0; j--) {
        const k = Math.floor(rng() * (j + 1));
        [headCandidates[j], headCandidates[k]] = [headCandidates[k], headCandidates[j]];
      }

      for (const [r, c] of headCandidates) {
        if (grid[r][c] !== -1) continue;

        // Try all 4 directions for the head
        const directions = [0, 1, 2, 3];
        for (let j = directions.length - 1; j > 0; j--) {
          const k = Math.floor(rng() * (j + 1));
          [directions[j], directions[k]] = [directions[k], directions[j]];
        }

        for (const dir of directions) {
          // 1. Ray from head must be clear of ALREADY PLACED arrows
          if (isRayBlocked(r, c, dir, grid, rows, cols)) continue;

          // 2. We need at least one neighbor for the "prev" cell to define the head's direction
          const { dr, dc } = DIRS[dir];
          const pr = r - dr;
          const pc = c - dc;
          if (!isInHeart(pr, pc, rows, cols) || grid[pr][pc] !== -1) continue;

          // FOUND A SOLVABLE HEAD! Now grow it backwards randomly
          const arrowCells = [[pr, pc], [r, c]];
          grid[r][c] = i;
          grid[pr][pc] = i;

          // Target length from 2 to 5
          const targetLen = 2 + Math.floor(rng() * 4);
          let currentTail = [pr, pc];

          while (arrowCells.length < targetLen) {
            const [tr, tc] = currentTail;
            const growthDirs = [0, 1, 2, 3];
            let growthFound = false;
            
            // Randomly try directions to grow the tail
            for (let k = growthDirs.length - 1; k > 0; k--) {
              const m = Math.floor(rng() * (k + 1));
              [growthDirs[k], growthDirs[m]] = [growthDirs[m], growthDirs[k]];
            }

            for (const gd of growthDirs) {
              const nr = tr + DIRS[gd].dr;
              const nc = tc + DIRS[gd].dc;
              if (isInHeart(nr, nc, rows, cols) && grid[nr][nc] === -1) {
                arrowCells.unshift([nr, nc]);
                grid[nr][nc] = i;
                currentTail = [nr, nc];
                growthFound = true;
                break;
              }
            }
            if (!growthFound) break;
          }

          arrows.push({ color, cells: arrowCells });
          foundSpot = true;
          break;
        }
        if (foundSpot) break;
      }

      if (!foundSpot) {
        success = false;
        break;
      }
    }

    if (success) {
      if (DEBUG_GENERATOR) console.log(`[ArrowGenerator] Success! Generated ${arrows.length} arrows.`);
      // The game expects the arrows in removal order (S1...Sn)
      // We placed them in reverse order (Sn...S1), so we reverse the result.
      return { arrows: arrows.reverse(), cellToArrow: buildCellToArrow(arrows, rows, cols) };
    }
  }

  console.error('[ArrowGenerator] Failed to generate maze');
  return null;
}

export function generateInitialQueues(seed, totalCount, queueCount) {
  const perColor = Math.floor(totalCount / COLOR_KEYS.length);
  const pool = [];
  for (const c of COLOR_KEYS) {
    for (let i = 0; i < perColor; i++) pool.push(c);
  }
  while (pool.length < totalCount) pool.push(COLOR_KEYS[0]);

  const rng = createSeededRandom(seed);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const queues = Array.from({ length: queueCount }, () => []);
  pool.forEach((color, i) => queues[i % queueCount].push(color));
  return queues;
}
