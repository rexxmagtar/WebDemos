import { TYPES } from './ItemTypes.js';

// Predefined level 1: 10 consumers (4 green, 3 yellow, 3 red)
// Queues have enough seeds + waters + crates to fulfill them
export const CONSUMERS = [
  'green', 'yellow', 'green', 'red', 'yellow',
  'green', 'red', 'yellow', 'green', 'red',
];

// Queue sequences: 10 consumers need 10 seeds + 10 waters + 10 crates
// Consumers: 4 green, 3 yellow, 3 red
export const QUEUE_SEQUENCES = [
  [
    { type: TYPES.SEED, color: 'green' },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'green' },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
    { type: TYPES.CRATE },
    { type: TYPES.SEED, color: 'yellow' },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'red' },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
    { type: TYPES.CRATE },
  ],
  [
    { type: TYPES.SEED, color: 'yellow' },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'red' },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'yellow' },
    { type: TYPES.CRATE },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'red' },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
    { type: TYPES.SEED, color: 'yellow' },
    { type: TYPES.CRATE },
  ],
  [
    { type: TYPES.SEED, color: 'red' },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
    { type: TYPES.SEED, color: 'green' },
    { type: TYPES.WATER },
    { type: TYPES.SEED, color: 'green' },
    { type: TYPES.CRATE },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
    { type: TYPES.SEED, color: 'red' },
    { type: TYPES.WATER },
    { type: TYPES.CRATE },
  ],
];
