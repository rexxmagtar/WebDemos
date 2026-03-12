// Bus Jam - Game configuration
// 5 colors: green, red, blue, white, purple
export const COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  blue: 0x3498db,
  white: 0xecf0f1,
  purple: 0x9b59b6,
};

export const COLOR_KEYS = ['green', 'red', 'blue', 'white', 'purple'];

export const BUS_COUNT = 20;
export const MIN_CAPACITY = 4;
export const MAX_CAPACITY = 8;
export const MAX_BUSES_ON_ROAD = 5;
export const QUEUE_COUNT = 5;

// Layout (720x1280 canvas)
export const ROAD_LOOP_WIDTH = 520;
export const ROAD_LOOP_HEIGHT = 680;
export const ROAD_WIDTH = 48; // thickness of road track
export const ROAD_CORNER_RADIUS = 80;

export const BUS_WIDTH = 64;
export const BUS_HEIGHT = 32;
export const BUS_CAPACITY_DOT_RADIUS = 5;
export const BUS_CAPACITY_DOT_GAP = 4;

export const PASSENGER_RADIUS = 10;
export const PASSENGER_QUEUE_GAP = 6;
export const PICKUP_GATE_HEIGHT = 8;

export const EXIT_PATH_WIDTH = 120;
export const EXIT_PATH_HEIGHT = 80;
