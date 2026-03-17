// Thread Out - Level generation
// Balls: random capacity (10-40), random color. Queues: total reel capacity per color = total ball capacity per color.

import {
  BALL_CAPACITY_MIN,
  BALL_CAPACITY_MAX,
  REEL_CAPACITY,
  COLOR_KEYS,
  BALL_COUNT,
  QUEUE_COUNT,
  FIELD_X,
  FIELD_Y,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  CAPACITY_TO_RADIUS,
} from './GameConfig.js';

function makePRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rand) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generate level: balls + queue sequences.
 * Total reel capacity per color = total ball capacity per color.
 * @param {number} seed
 * @returns {{ balls: Array<{ capacity, color, x, y }>, queues: Array<Array<{ color, remainingCapacity }>> }}
 */
export function generateLevel(seed) {
  const rand = makePRNG(seed);

  const balls = [];
  const totalBallCapacityByColor = {};
  for (const c of COLOR_KEYS) totalBallCapacityByColor[c] = 0;

  const paddingX = 80;
  const maxRadius = BALL_CAPACITY_MAX * CAPACITY_TO_RADIUS;
  const spawnTopY = -150;  // above viewport/container - balls fall down into container
  // 2.2 * maxRadius = diameter + gap — prevents ball intersection when falling
  const verticalSpacing = maxRadius * 2.2;

  for (let i = 0; i < BALL_COUNT; i++) {
    const capacity = Math.floor(
      rand() * (BALL_CAPACITY_MAX - BALL_CAPACITY_MIN + 1)
    ) + BALL_CAPACITY_MIN;
    const color = COLOR_KEYS[Math.floor(rand() * COLOR_KEYS.length)];
    const radius = capacity * CAPACITY_TO_RADIUS;
    const x = FIELD_X + paddingX + rand() * (FIELD_WIDTH - 2 * paddingX);
    const y = spawnTopY - i * verticalSpacing;

    balls.push({ capacity, color, x, y });
    totalBallCapacityByColor[color] = (totalBallCapacityByColor[color] || 0) + capacity;
  }

  const reelsByColor = {};
  for (const c of COLOR_KEYS) {
    const total = totalBallCapacityByColor[c] || 0;
    const count = Math.ceil(total / REEL_CAPACITY);
    reelsByColor[c] = Array(count).fill(null).map(() => ({ color: c, remainingCapacity: REEL_CAPACITY }));
  }

  const allReels = [];
  for (const c of COLOR_KEYS) allReels.push(...reelsByColor[c]);

  shuffle(allReels, rand);

  const queues = [[], [], []];
  for (let i = 0; i < allReels.length; i++) {
    queues[i % QUEUE_COUNT].push(allReels[i]);
  }

  return { balls, queues };
}
