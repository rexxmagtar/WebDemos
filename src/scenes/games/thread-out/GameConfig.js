// Thread Out - Game configuration

export const LEVEL_SEED = 12345;

// Physics
export const PHYSICS_GRAVITY_Y = 800;
export const PHYSICS_WALL_THICKNESS = 20;
export const PHYSICS_BALL_BOUNCE = 0.00;      // restitution (0=no bounce, 1=full bounce)
export const PHYSICS_FLOOR_FRICTION = 0.0;   // ball friction when on floor (0=slidy, 1=sticky)
export const KNIT_RATE = 0.25;
export const SETTLE_DELAY_MS = 500;

export const REEL_CAPACITY = 20;
export const BALL_CAPACITY_MIN = 10;
export const BALL_CAPACITY_MAX = 20;
export const CAPACITY_TO_RADIUS = 2.5;  // radius = capacity * 2.5 (20 capacity = radius 50)

export const QUEUE_COUNT = 3;

export const COLORS = {
  red: 0xe74c3c,
  orange: 0xe67e22,
  green: 0x2ecc71,
  blue: 0x3498db,
};

export const COLOR_KEYS = ['red', 'orange', 'green', 'blue'];

// Main field container (light blue-grey) - TOP section
export const FIELD_X = 60;
export const FIELD_Y = 120;
export const FIELD_WIDTH = 600;
export const FIELD_HEIGHT = 440;

// Active reel slots - MIDDLE section (between ball container and queues)
const SLOT_W = 88;
const SLOT_H = 64;
const SLOTS_ROW_Y = 615;  // ball container ends 560, gap, slots 583-647, gap, queues from 670
const GRID_CX = 360;
export const SLOT_LAYOUT = [
  { x: GRID_CX - 176, y: SLOTS_ROW_Y },
  { x: GRID_CX - 88, y: SLOTS_ROW_Y },
  { x: GRID_CX, y: SLOTS_ROW_Y },
  { x: GRID_CX + 88, y: SLOTS_ROW_Y },
  { x: GRID_CX + 176, y: SLOTS_ROW_Y },
];

// Queue area - BOTTOM section
export const QUEUE_ORIGIN_Y = 750;

// Ball count for level generation
export const BALL_COUNT = 16;
