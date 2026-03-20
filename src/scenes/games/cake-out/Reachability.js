/**
 * @param {Array<Array<{ type: 'cake', color: string } | null>>} grid
 * @param {string} plateColor
 * @param {Array<[number, number]>} seedCells [r,c] starting footprint (e.g. 4×4 placeholder)
 * @param {number} rows
 * @param {number} cols
 * @returns {Array<[number, number]>} reachable cells that hold same-color cake (order BFS)
 */
export function findReachableCakeCells(grid, plateColor, seedCells, rows, cols) {
  const visited = new Set();
  const q = [];
  for (const [r, c] of seedCells) {
    const key = `${r},${c}`;
    if (!visited.has(key)) {
      visited.add(key);
      q.push([r, c]);
    }
  }

  const cakeCells = [];

  let head = 0;
  while (head < q.length) {
    const [r, c] = q[head++];
    const cell = grid[r][c];
    if (cell && cell.type === 'cake' && cell.color === plateColor) {
      cakeCells.push([r, c]);
    }

    const neighbors = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      const ncell = grid[nr][nc];
      if (ncell && ncell.type === 'cake' && ncell.color !== plateColor) {
        continue;
      }
      visited.add(key);
      q.push([nr, nc]);
    }
  }

  return cakeCells;
}

/**
 * Shortest path (orthogonally) from a cake cell to any cell in the placeholder footprint.
 * Same walkability as gather: blocked only by other-color cake.
 *
 * @returns {Array<[number, number]> | null} path from start (inclusive) to first footprint cell reached, or null
 */
export function findPathFromCakeToFootprint(
  grid,
  plateColor,
  startR,
  startC,
  seedCells,
  rows,
  cols
) {
  const key = (r, c) => `${r},${c}`;
  const seedSet = new Set(seedCells.map(([r, c]) => key(r, c)));

  if (seedSet.has(key(startR, startC))) {
    return [[startR, startC]];
  }

  const prev = new Map();
  const q = [[startR, startC]];
  const visited = new Set([key(startR, startC)]);
  let goal = null;

  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let head = 0; head < q.length && !goal; head++) {
    const [r, c] = q[head];
    for (const [dr, dc] of deltas) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const k = key(nr, nc);
      if (visited.has(k)) continue;
      const ncell = grid[nr][nc];
      if (ncell && ncell.type === 'cake' && ncell.color !== plateColor) continue;
      visited.add(k);
      prev.set(k, [r, c]);
      q.push([nr, nc]);
      if (seedSet.has(k)) {
        goal = [nr, nc];
        break;
      }
    }
  }

  if (!goal) return null;

  const path = [];
  let cur = goal;
  for (;;) {
    path.push(cur);
    if (cur[0] === startR && cur[1] === startC) break;
    const p = prev.get(key(cur[0], cur[1]));
    if (!p) return null;
    cur = p;
  }
  path.reverse();
  return path;
}
