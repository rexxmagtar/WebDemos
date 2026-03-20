import { COLOR_KEYS, CAPACITY_MIN, CAPACITY_MAX } from './GameConfig.js';

export function createSeededRandom(seed) {
  let s = seed || Math.floor(Math.random() * 0xffffffff);
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffleArray(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Count cake cells per color key (only keys present in `colorKeys` are counted).
 */
export function countCakeCellsByColor(grid, colorKeys = COLOR_KEYS) {
  const counts = Object.fromEntries(colorKeys.map((k) => [k, 0]));
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell && cell.type === 'cake' && counts[cell.color] !== undefined) {
        counts[cell.color]++;
      }
    }
  }
  return counts;
}

/**
 * Split `total` into positive integers in [minC, maxC] that sum to `total`.
 * If `total` is in (0, minC), returns `[total]` (one undersized plate).
 */
export function capacitiesForExactTotal(total, minC, maxC, rng) {
  if (total <= 0) return [];
  if (total < minC) {
    return [total];
  }

  const out = [];
  let r = total;

  while (r > maxC) {
    const hi = Math.min(maxC, r - minC);
    const lo = minC;
    if (hi < lo) {
      out.push(r);
      return out;
    }
    const c = lo + Math.floor(rng() * (hi - lo + 1));
    out.push(c);
    r -= c;
  }

  if (r >= minC) {
    out.push(r);
    return out;
  }

  if (out.length === 0) {
    return [total];
  }

  const last = out[out.length - 1];
  const deficit = minC - r;
  if (last - deficit >= minC) {
    out[out.length - 1] = last - deficit;
    out.push(minC);
    return out;
  }

  out[out.length - 1] = last + r;
  return out;
}

/**
 * Plate queues: for each color, sum of plate capacities equals cake cell count on `grid`.
 * @returns {Array<Array<{ color: string, capacity: number }>>}
 */
export function generateBalancedPlateQueues(grid, queueCount, seed) {
  const rng = createSeededRandom(seed);
  const counts = countCakeCellsByColor(grid, COLOR_KEYS);
  const pool = [];

  for (const color of COLOR_KEYS) {
    const n = counts[color] || 0;
    const caps = capacitiesForExactTotal(n, CAPACITY_MIN, CAPACITY_MAX, rng);
    shuffleArray(caps, rng);
    for (const capacity of caps) {
      pool.push({ color, capacity });
    }
  }

  shuffleArray(pool, rng);

  const queues = Array.from({ length: queueCount }, () => []);
  pool.forEach((plate, i) => {
    queues[i % queueCount].push(plate);
  });
  return queues;
}

/**
 * @deprecated Use {@link generateBalancedPlateQueues} so capacities match the grid.
 * @returns {Array<Array<{ color: string, capacity: number }>>}
 */
export function generatePlateQueues(seed, totalPlates, queueCount) {
  const rng = createSeededRandom(seed);
  const pool = [];
  const perColor = Math.ceil(totalPlates / COLOR_KEYS.length);
  for (const c of COLOR_KEYS) {
    for (let i = 0; i < perColor && pool.length < totalPlates; i++) {
      const cap =
        CAPACITY_MIN +
        Math.floor(rng() * (CAPACITY_MAX - CAPACITY_MIN + 1));
      pool.push({ color: c, capacity: cap });
    }
  }
  while (pool.length < totalPlates) {
    const c = COLOR_KEYS[Math.floor(rng() * COLOR_KEYS.length)];
    const cap =
      CAPACITY_MIN +
      Math.floor(rng() * (CAPACITY_MAX - CAPACITY_MIN + 1));
    pool.push({ color: c, capacity: cap });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const queues = Array.from({ length: queueCount }, () => []);
  pool.forEach((plate, i) => queues[i % queueCount].push(plate));
  return queues;
}
