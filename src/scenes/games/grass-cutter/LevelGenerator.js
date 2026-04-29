import {
  GRID_ROWS,
  GRID_COLS,
  COLOR_KEYS,
  QUEUE_COUNT,
  SAW_CAPACITY_MIN,
  SAW_CAPACITY_MAX,
} from './GameConfig.js';

function makePRNG(seed) {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function splitColorCapacity(total, rand) {
  if (total <= 0) return [];
  const parts = [];
  let remaining = total;
  let lastCap = -1;

  while (remaining > 0) {
    const minCap = Math.min(SAW_CAPACITY_MIN, remaining);
    const maxCap = Math.min(SAW_CAPACITY_MAX, remaining);
    let cap = randInt(rand, minCap, maxCap);

    if (cap === lastCap && remaining > minCap) {
      const alt = cap - 1 >= minCap ? cap - 1 : cap + 1 <= maxCap ? cap + 1 : cap;
      cap = alt;
    }

    // Keep the tail feasible when a remainder would be too small.
    const tail = remaining - cap;
    if (tail > 0 && tail < SAW_CAPACITY_MIN) {
      cap -= SAW_CAPACITY_MIN - tail;
    }
    if (cap < minCap) cap = minCap;
    if (cap > maxCap) cap = maxCap;

    parts.push(cap);
    remaining -= cap;
    lastCap = cap;
  }

  return parts;
}

export function generateLevel(seed) {
  const rand = makePRNG(seed);
  const centerR0 = Math.floor(GRID_ROWS / 2) - 1;
  const centerC0 = Math.floor(GRID_COLS / 2) - 1;
  const centerR1 = centerR0 + 1;
  const centerC1 = centerC0 + 1;

  const grid = [];
  const colorCounts = Object.fromEntries(COLOR_KEYS.map((k) => [k, 0]));

  for (let r = 0; r < GRID_ROWS; r++) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) {
      const inCenter = r >= centerR0 && r <= centerR1 && c >= centerC0 && c <= centerC1;
      if (inCenter) {
        row.push(null);
      } else {
        const color = COLOR_KEYS[randInt(rand, 0, COLOR_KEYS.length - 1)];
        row.push(color);
        colorCounts[color] += 1;
      }
    }
    grid.push(row);
  }

  const saws = [];
  for (const color of COLOR_KEYS) {
    const caps = splitColorCapacity(colorCounts[color], rand);
    for (const cap of caps) {
      saws.push({ color, capacity: cap });
    }
  }

  for (let i = saws.length - 1; i > 0; i--) {
    const j = randInt(rand, 0, i);
    [saws[i], saws[j]] = [saws[j], saws[i]];
  }

  const queues = Array.from({ length: QUEUE_COUNT }, () => []);
  for (let i = 0; i < saws.length; i++) {
    queues[i % QUEUE_COUNT].push(saws[i]);
  }

  return { grid, queues };
}
