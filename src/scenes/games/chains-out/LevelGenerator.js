import {
  BOARD_ROWS,
  BOARD_COLS,
  COLOR_KEYS,
  SIZE_UNITS,
  BOARD_CHAIN_COUNT,
  QUEUE_COUNT,
  CONTAINER_CAPACITY_MIN,
  CONTAINER_CAPACITY_MAX,
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

function shuffle(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(rand, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function orientation(a, b, c) {
  const val = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(val) < 1e-6) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function sizeFromRoll(roll) {
  if (roll < 0.4) return SIZE_UNITS.small;
  if (roll < 0.75) return SIZE_UNITS.medium;
  return SIZE_UNITS.large;
}

function splitIntoContainers(total, rand) {
  const parts = [];
  let remaining = total;
  while (remaining > 0) {
    const minCap = Math.min(CONTAINER_CAPACITY_MIN, remaining);
    const maxCap = Math.min(CONTAINER_CAPACITY_MAX, remaining);
    const cap = randInt(rand, minCap, maxCap);
    parts.push(cap);
    remaining -= cap;
  }
  return parts;
}

export function generateLevel(seed) {
  const rand = makePRNG(seed);
  const points = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      points.push({ id: `${r}_${c}`, r, c });
    }
  }

  const chains = [];
  const colorTotals = Object.fromEntries(COLOR_KEYS.map((k) => [k, 0]));
  const attemptsMax = BOARD_CHAIN_COUNT * 12;
  let attempts = 0;

  while (chains.length < BOARD_CHAIN_COUNT && attempts < attemptsMax) {
    attempts += 1;
    const a = points[randInt(rand, 0, points.length - 1)];
    const b = points[randInt(rand, 0, points.length - 1)];
    if (a.id === b.id) continue;
    const dr = Math.abs(a.r - b.r);
    const dc = Math.abs(a.c - b.c);
    if (dr + dc < 2) continue;
    const samePair = chains.some(
      (ch) =>
        (ch.endpointA.id === a.id && ch.endpointB.id === b.id) ||
        (ch.endpointA.id === b.id && ch.endpointB.id === a.id)
    );
    if (samePair) continue;
    const color = COLOR_KEYS[randInt(rand, 0, COLOR_KEYS.length - 1)];
    const sizeUnits = sizeFromRoll(rand());
    chains.push({
      id: `ch_${chains.length}`,
      color,
      sizeUnits,
      endpointA: a,
      endpointB: b,
      z: randInt(rand, 1, 1000),
      blockedByIds: [],
    });
    colorTotals[color] += sizeUnits;
  }

  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const a = chains[i];
      const b = chains[j];
      const intersect = segmentsIntersect(
        { x: a.endpointA.c, y: a.endpointA.r },
        { x: a.endpointB.c, y: a.endpointB.r },
        { x: b.endpointA.c, y: b.endpointA.r },
        { x: b.endpointB.c, y: b.endpointB.r }
      );
      if (!intersect) continue;
      if (a.z < b.z) {
        a.blockedByIds.push(b.id);
      } else if (b.z < a.z) {
        b.blockedByIds.push(a.id);
      }
    }
  }

  const containerTokens = [];
  for (const color of COLOR_KEYS) {
    const caps = splitIntoContainers(colorTotals[color], rand);
    for (const cap of caps) {
      containerTokens.push({
        color,
        capacityTotal: cap,
        capacityLeft: cap,
      });
    }
  }

  const shuffled = shuffle(containerTokens, rand);
  const queues = Array.from({ length: QUEUE_COUNT }, () => []);
  for (let i = 0; i < shuffled.length; i++) {
    queues[i % QUEUE_COUNT].push(shuffled[i]);
  }

  return { chains, queues, colorTotals };
}
