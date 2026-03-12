/**
 * Arrow generator using 10x10 sub-grid per cell.
 * Each arrow: 4 points on 0-9 grid, 90-degree segments.
 * Generates solvable mazes.
 */

import { COLOR_KEYS } from './GameConfig.js';

const ARROW_GRID = 10;
const ARROW_POINTS = 4;

const DIR_DELTA = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
];

/** Derive exit direction (0=N,1=E,2=S,3=W) from path's last segment */
export function pathToDir(path) {
  if (!path || path.length < 2) return 0;
  const [px, py] = path[path.length - 1];
  const [qx, qy] = path[path.length - 2];
  const dx = px - qx;
  const dy = py - qy;
  if (dy < 0) return 0;
  if (dx > 0) return 1;
  if (dy > 0) return 2;
  return 3;
}

/** Generate a random 4-point path on 10x10 grid with 90-degree turns.
 *  Paths span 0-9 to fill the cell. lastDir: 0-3 forces last segment (for edge cells). */
function generateArrowPath(lastDir = -1) {
  const path = [];
  // Start near an edge to ensure path spans the cell (0-1 or 8-9 on one axis)
  const side = Math.floor(Math.random() * 4); // 0=left,1=right,2=top,3=bottom
  let x, y;
  if (side === 0) {
    x = Math.floor(Math.random() * 2);
    y = Math.floor(Math.random() * (ARROW_GRID - 2)) + 1;
  } else if (side === 1) {
    x = ARROW_GRID - 1 - Math.floor(Math.random() * 2);
    y = Math.floor(Math.random() * (ARROW_GRID - 2)) + 1;
  } else if (side === 2) {
    x = Math.floor(Math.random() * (ARROW_GRID - 2)) + 1;
    y = Math.floor(Math.random() * 2);
  } else {
    x = Math.floor(Math.random() * (ARROW_GRID - 2)) + 1;
    y = ARROW_GRID - 1 - Math.floor(Math.random() * 2);
  }
  path.push([x, y]);

  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let usedDir = -1;

  for (let i = 0; i < ARROW_POINTS - 1; i++) {
    const isLast = i === ARROW_POINTS - 2 && lastDir >= 0 && lastDir < 4;
    const forcedDir = isLast ? lastDir : -1;
    // Use longer steps (3-5) so path spans the cell
    const minStep = 3;
    const maxStep = 5;
    let candidates = dirs
      .map((d, idx) => ({ d, idx }))
      .filter(({ idx }) => idx !== usedDir)
      .filter(({ d }) => {
        const [dx, dy] = d;
        for (let step = minStep; step <= maxStep; step++) {
          const nx = x + dx * step;
          const ny = y + dy * step;
          if (nx >= 0 && nx < ARROW_GRID && ny >= 0 && ny < ARROW_GRID) return true;
        }
        return false;
      });
    if (forcedDir >= 0) {
      candidates = candidates.filter(({ idx }) => idx === forcedDir);
    }
    if (candidates.length === 0) break;
    const { d, idx } = candidates[Math.floor(Math.random() * candidates.length)];
    const [dx, dy] = d;
    const step = minStep + Math.floor(Math.random() * (maxStep - minStep + 1));
    x += dx * step;
    y += dy * step;
    path.push([x, y]);
    usedDir = (idx + 2) % 4;
  }

  while (path.length < 2) {
    path.push([path[0][0], Math.max(0, path[0][1] - 1)]);
  }
  return path;
}

/** Check if arrow at (r,c) has free path to maze edge */
function hasFreeExit(maze, r, c, rows, cols) {
  const cell = maze[r]?.[c];
  if (!cell) return false;
  const dir = pathToDir(cell.path);
  const { dr, dc } = DIR_DELTA[dir];
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
    if (maze[nr][nc]) return false;
    nr += dr;
    nc += dc;
  }
  return true;
}

/** Count balloons by color from queues */
function countBalloonsByColor(queues) {
  const counts = {};
  COLOR_KEYS.forEach((c) => (counts[c] = 0));
  for (const q of queues) {
    for (const color of q) {
      if (counts[color] !== undefined) counts[color]++;
    }
  }
  return counts;
}

/** Check maze is solvable: enough exiting arrows per color to match balloons */
function isSolvable(maze, queues, rows, cols) {
  const balloonCounts = countBalloonsByColor(queues);
  const exitCounts = {};
  COLOR_KEYS.forEach((c) => (exitCounts[c] = 0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (maze[r][c] && hasFreeExit(maze, r, c, rows, cols)) {
        const color = maze[r][c].color;
        exitCounts[color] = (exitCounts[color] || 0) + 1;
      }
    }
  }

  for (const color of COLOR_KEYS) {
    if ((exitCounts[color] || 0) < (balloonCounts[color] || 0)) {
      return false;
    }
  }
  const totalBalloons = Object.values(balloonCounts).reduce((a, b) => a + b, 0);
  const totalExits = Object.values(exitCounts).reduce((a, b) => a + b, 0);
  return totalExits >= totalBalloons;
}

/** Generate a solvable arrow maze - all cells filled with arrows */
export function generateSolvableMaze(rows, cols, queues, maxAttempts = 600) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const maze = [];
    for (let r = 0; r < rows; r++) {
      maze[r] = [];
      for (let c = 0; c < cols; c++) {
        const color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
        let lastDir = -1;
        if (r === 0) lastDir = 0;
        else if (c === cols - 1) lastDir = 1;
        else if (r === rows - 1) lastDir = 2;
        else if (c === 0) lastDir = 3;
        const path = generateArrowPath(lastDir);
        maze[r][c] = { color, path };
      }
    }

    if (isSolvable(maze, queues, rows, cols)) {
      return maze;
    }
  }
  return null;
}
