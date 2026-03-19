// Queue overhaul: containers at top, consumer queues along borders
// Top bar ~100px, Hint bar ~80px. Play area below.
export const DOT_TYPES = {
  WATER: 'water',
  SEED: 'seed',
  CONSUMER: 'consumer',
};

export const COLORS = {
  red: 0xe74c3c,
  green: 0x2ecc71,
  blue: 0x3498db,
  yellow: 0xf1c40f,
  purple: 0x9b59b6,
};

export const COLOR_KEYS = ['red', 'green', 'blue', 'yellow', 'purple'];

// Play rect: all seeds and water must be inside; drawing enabled only within
// Queues sit at borders, extend perpendicular outward. Only first consumer connectable.
export const LEVEL_1 = {
  playRect: { left: 70, top: 30, width: 580, height: 920 },
  water: [
    { id: 'w1', x: 78, y: 292, type: DOT_TYPES.WATER },
    { id: 'w2', x: 208, y: 448, type: DOT_TYPES.WATER },
    { id: 'w3', x: 335, y: 285, type: DOT_TYPES.WATER },
    { id: 'w4', x: 458, y: 535, type: DOT_TYPES.WATER },
    { id: 'w5', x: 585, y: 298, type: DOT_TYPES.WATER },
  ],
  seeds: [
    { id: 's1', x: 118, y: 435, type: DOT_TYPES.SEED, color: 'blue' },
    { id: 's2', x: 218, y: 898, type: DOT_TYPES.SEED, color: 'green' },
    { id: 's3', x: 342, y: 408, type: DOT_TYPES.SEED, color: 'yellow' },
    { id: 's4', x: 455, y: 922, type: DOT_TYPES.SEED, color: 'red' },
    { id: 's5', x: 595, y: 462, type: DOT_TYPES.SEED, color: 'purple' },
  ],
  containers: [
    { id: 'cont1', requirement: { red: 1, green: 1, blue: 0, yellow: 0, purple: 0 } },
    { id: 'cont2', requirement: { red: 0, green: 1, blue: 2, yellow: 0, purple: 0 } },
    { id: 'cont3', requirement: { red: 1, green: 0, blue: 1, yellow: 1, purple: 0 } },
    { id: 'cont4', requirement: { red: 1, green: 1, blue: 1, yellow: 1, purple: 1 } },
    { id: 'cont5', requirement: { red: 2, green: 0, blue: 0, yellow: 1, purple: 1 } },
  ],
  consumerQueueConfig: {
    blue: { side: 'left', along: 350 },
    green: { side: 'left', along: 720 },
    yellow: { side: 'right', along: 360 },
    red: { side: 'right', along: 780 },
    purple: { side: 'bottom', along: 510 },
  },
};

// Consumer queues: mixed colors in each queue (bus-jam style). Each queue has varied colors.
export function getConsumerQueues(level) {
  const all = [];
  for (const cont of level.containers) {
    for (const c of COLOR_KEYS) {
      const n = cont.requirement[c] || 0;
      for (let i = 0; i < n; i++) all.push(c);
    }
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const queues = {};
  const queueIds = Object.keys(level.consumerQueueConfig || {});
  queueIds.forEach((id) => { queues[id] = []; });
  const ids = queueIds.length ? queueIds : COLOR_KEYS;
  all.forEach((color, i) => queues[ids[i % ids.length]].push(color));
  ids.forEach((id) => {
    while (queues[id].length < 5) queues[id].push(COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)]);
  });
  return queues;
}
