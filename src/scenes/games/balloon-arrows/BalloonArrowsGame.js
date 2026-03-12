import Phaser from '../../../lib/phaser.js';
import {
  COLORS,
  COLOR_KEYS,
  MAX_CONVEYOR_BALLOONS,
  QUEUE_COUNT,
  QUEUE_DEPTH,
  MAZE_ROWS,
  MAZE_COLS,
  MAZE_CELL_SIZE,
  CONVEYOR_SLOT_COUNT,
  CONVEYOR_TRACK_WIDTH,
  CONVEYOR_CORNER_RADIUS,
  BALLOON_RADIUS,
  INITIAL_QUEUES,
  FALLBACK_MAZE,
  CONVEYOR_SPEED,
  DEBUG_DRAW_10x10_GRID,
  ARROW_PROXIMITY_THRESHOLD,
} from './GameConfig.js';
import { generateSolvableMaze, pathToDir } from './ArrowGenerator.js';

// Dir: 0=N, 1=E, 2=S, 3=W. Delta for raycast.
const DIR_DELTA = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
];

// Map maze exit edge (0=N,1=E,2=S,3=W) to conveyor slot indices (segments on that edge).
const SLOTS_PER_EDGE = CONVEYOR_SLOT_COUNT / 4;
const EDGE_SLOT_RANGES = [
  [0, SLOTS_PER_EDGE],
  [SLOTS_PER_EDGE, SLOTS_PER_EDGE * 2],
  [SLOTS_PER_EDGE * 2, SLOTS_PER_EDGE * 3],
  [SLOTS_PER_EDGE * 3, CONVEYOR_SLOT_COUNT],
];

// Get point on rounded rect midline. t in [0,1], clockwise from top-left.
function getRoundedRectPoint(t, cx, cy, halfW, halfH, r) {
  const perimeter =
    2 * (halfW * 2 - 2 * r) + 2 * (halfH * 2 - 2 * r) + 2 * Math.PI * r;
  const targetDist = t * perimeter;
  let d = 0;
  const segs = [
    { len: halfW * 2 - 2 * r, fn: (s) => ({ x: cx - halfW + r + s, y: cy - halfH }) },
    {
      len: (Math.PI * r) / 2,
      fn: (s) => ({
        x: cx + halfW - r + Math.cos(Math.PI - s / r) * r,
        y: cy - halfH + r - Math.sin(Math.PI - s / r) * r,
      }),
    },
    { len: halfH * 2 - 2 * r, fn: (s) => ({ x: cx + halfW, y: cy - halfH + r + s }) },
    {
      len: (Math.PI * r) / 2,
      fn: (s) => ({
        x: cx + halfW - r + Math.cos(-s / r) * r,
        y: cy + halfH - r + Math.sin(-s / r) * r,
      }),
    },
    { len: halfW * 2 - 2 * r, fn: (s) => ({ x: cx + halfW - r - s, y: cy + halfH }) },
    {
      len: (Math.PI * r) / 2,
      fn: (s) => ({
        x: cx - halfW + r + Math.cos(Math.PI / 2 + s / r) * r,
        y: cy + halfH - r + Math.sin(Math.PI / 2 + s / r) * r,
      }),
    },
    { len: halfH * 2 - 2 * r, fn: (s) => ({ x: cx - halfW, y: cy + halfH - r - s }) },
    {
      len: (Math.PI * r) / 2,
      fn: (s) => ({
        x: cx - halfW + r + Math.cos(Math.PI + s / r) * r,
        y: cy - halfH + r + Math.sin(Math.PI + s / r) * r,
      }),
    },
  ];
  for (const seg of segs) {
    if (d + seg.len >= targetDist - 0.001) {
      const s = Math.min(targetDist - d, seg.len);
      return seg.fn(s);
    }
    d += seg.len;
  }
  return segs[0].fn(0);
}

function cloneMaze(maze) {
  return maze.map((row) =>
    row.map((cell) =>
      cell ? { color: cell.color, path: cell.path.map((p) => [...p]) } : null
    )
  );
}

/** Get world position of arrow path tip for cell at (r,c) */
function getArrowTipPosition(mazeCenterX, mazeCenterY, r, c, path) {
  const mazeW = MAZE_COLS * MAZE_CELL_SIZE;
  const mazeH = MAZE_ROWS * MAZE_CELL_SIZE;
  const startX = mazeCenterX - mazeW / 2;
  const startY = mazeCenterY - mazeH / 2;
  const cellLeft = startX + c * MAZE_CELL_SIZE;
  const cellTop = startY + r * MAZE_CELL_SIZE;
  const scale = MAZE_CELL_SIZE / 9;
  const tip = path[path.length - 1];
  return {
    x: cellLeft + tip[0] * scale,
    y: cellTop + tip[1] * scale,
  };
}

export default class BalloonArrowsGame extends Phaser.Scene {
  constructor() {
    super({ key: 'BalloonArrowsGame' });
  }

  create() {
    const { width, height } = this.cameras.main;

    // Back button
    const backBtn = this.add
      .text(50, 25, 'Back', {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      window.location.href = 'index.html';
    });

    // State
    this.queues = INITIAL_QUEUES.map((arr) => [...arr]);
    const generated = generateSolvableMaze(MAZE_ROWS, MAZE_COLS, INITIAL_QUEUES);
    this.maze = generated ? cloneMaze(generated) : cloneMaze(FALLBACK_MAZE);
    this.conveyor = []; // Array of { color, slotIndex, graphic }
    this.gameOver = false;
    this.won = false;
    this.processing = false;

    // Layout: maze center, conveyor around it
    const mazeHalfW = (MAZE_COLS * MAZE_CELL_SIZE) / 2;
    const mazeHalfH = (MAZE_ROWS * MAZE_CELL_SIZE) / 2;
    this.mazeCenterX = width / 2;
    this.mazeCenterY = 380;
    this.conveyorHalfW = mazeHalfW + CONVEYOR_TRACK_WIDTH + 28;
    this.conveyorHalfH = mazeHalfH + CONVEYOR_TRACK_WIDTH + 28;
    this.conveyorR = Math.min(
      CONVEYOR_CORNER_RADIUS,
      this.conveyorHalfW / 2,
      this.conveyorHalfH / 2
    );

    // Queue layout
    this.queueSlotSize = 72;
    this.queueBaseY = height - 180;
    this.queuePadding = 12;

    this.buildBackground();
    this.buildConveyorTrack();
    this.buildConveyorCountLabel();
    this.buildMaze();
    this.buildQueues();
    this.buildConveyorSlots();
    this.refreshQueueDisplay();
  }

  update(_, delta) {
    if (this.gameOver || this.won) return;
    const dt = delta / 1000;
    for (const b of this.conveyor) {
      if (b.arriving) continue;
      b.progress = (b.progress + CONVEYOR_SPEED * dt) % 1;
      const pos = getRoundedRectPoint(
        b.progress,
        this.mazeCenterX,
        this.mazeCenterY,
        this.conveyorHalfW - CONVEYOR_TRACK_WIDTH / 2,
        this.conveyorHalfH - CONVEYOR_TRACK_WIDTH / 2,
        this.conveyorR - CONVEYOR_TRACK_WIDTH / 4
      );
      b.graphic.setPosition(pos.x, pos.y);
    }
    // Check for arrow+balloon matches as balloons move (only when not already animating)
    if (!this.processing && this.conveyor.length > 0) {
      this.checkAndResolveExits();
    }
  }

  buildConveyorCountLabel() {
    this.conveyorCountText = this.add
      .text(
        this.mazeCenterX,
        this.mazeCenterY - this.conveyorHalfH - 30,
        `Conveyor: 0 / ${MAX_CONVEYOR_BALLOONS}`,
        { fontSize: '16px', color: '#333', fontFamily: 'sans-serif' }
      )
      .setOrigin(0.5);
  }

  refreshConveyorCount() {
    if (this.conveyorCountText) {
      this.conveyorCountText.setText(
        `Conveyor: ${this.conveyor.length} / ${MAX_CONVEYOR_BALLOONS}`
      );
    }
  }

  buildBackground() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0xa8d4e6);
  }

  buildConveyorTrack() {
    const cx = this.mazeCenterX;
    const cy = this.mazeCenterY;
    const hw = this.conveyorHalfW;
    const hh = this.conveyorHalfH;
    const r = this.conveyorR;

    const g = this.add.graphics();
    g.fillStyle(0x4a4a5a, 1);
    g.fillRoundedRect(
      cx - hw - CONVEYOR_TRACK_WIDTH / 2,
      cy - hh - CONVEYOR_TRACK_WIDTH / 2,
      hw * 2 + CONVEYOR_TRACK_WIDTH,
      hh * 2 + CONVEYOR_TRACK_WIDTH,
      r + CONVEYOR_TRACK_WIDTH / 2
    );
    g.fillStyle(0xa8d4e6, 1);
    g.fillRoundedRect(
      cx - hw + CONVEYOR_TRACK_WIDTH / 2,
      cy - hh + CONVEYOR_TRACK_WIDTH / 2,
      hw * 2 - CONVEYOR_TRACK_WIDTH,
      hh * 2 - CONVEYOR_TRACK_WIDTH,
      r - CONVEYOR_TRACK_WIDTH / 2
    );
    this.conveyorGraphics = g;
  }

  getConveyorSlotPosition(slotIndex) {
    const t = slotIndex / CONVEYOR_SLOT_COUNT;
    return getRoundedRectPoint(
      t,
      this.mazeCenterX,
      this.mazeCenterY,
      this.conveyorHalfW - CONVEYOR_TRACK_WIDTH / 2,
      this.conveyorHalfH - CONVEYOR_TRACK_WIDTH / 2,
      this.conveyorR - CONVEYOR_TRACK_WIDTH / 4
    );
  }

  buildConveyorSlots() {
    this.conveyorBalloonGraphics = [];
    for (let i = 0; i < CONVEYOR_SLOT_COUNT; i++) {
      this.conveyorBalloonGraphics.push(null);
    }
  }

  buildMaze() {
    const mazeW = MAZE_COLS * MAZE_CELL_SIZE;
    const mazeH = MAZE_ROWS * MAZE_CELL_SIZE;
    const startX = this.mazeCenterX - mazeW / 2;
    const startY = this.mazeCenterY - mazeH / 2;

    // Maze panel background
    this.add
      .rectangle(
        this.mazeCenterX,
        this.mazeCenterY,
        mazeW + 8,
        mazeH + 8,
        0xb8dce8
      )
      .setStrokeStyle(3, 0x4a4a5a);

    this.mazeGraphics = [];
    for (let r = 0; r < MAZE_ROWS; r++) {
      this.mazeGraphics[r] = [];
      for (let c = 0; c < MAZE_COLS; c++) {
        const cellLeft = startX + c * MAZE_CELL_SIZE;
        const cellTop = startY + r * MAZE_CELL_SIZE;
        const cellCenterX = cellLeft + MAZE_CELL_SIZE / 2;
        const cellCenterY = cellTop + MAZE_CELL_SIZE / 2;
        const cell = this.maze[r][c];

        if (DEBUG_DRAW_10x10_GRID) {
          this.drawDebug10x10Grid(cellLeft, cellTop);
        }
        if (cell) {
          const g = this.drawArrow(cellCenterX, cellCenterY, cell.color, cell.path, false, cellLeft, cellTop);
          this.mazeGraphics[r][c] = { graphic: g };
        } else {
          this.mazeGraphics[r][c] = null;
        }
      }
    }
  }

  drawDebug10x10Grid(cellLeft, cellTop) {
    const g = this.add.graphics();
    g.lineStyle(1, 0x000000);
    const subSize = MAZE_CELL_SIZE / 10;
    for (let i = 0; i <= 10; i++) {
      const offset = i * subSize;
      g.beginPath();
      g.moveTo(cellLeft + offset, cellTop);
      g.lineTo(cellLeft + offset, cellTop + MAZE_CELL_SIZE);
      g.strokePath();
      g.beginPath();
      g.moveTo(cellLeft, cellTop + offset);
      g.lineTo(cellLeft + MAZE_CELL_SIZE, cellTop + offset);
      g.strokePath();
    }
  }

  drawArrow(x, y, color, path, atOrigin = false, cellLeft, cellTop) {
    const ARROW_GRID = 10;
    const colorHex = COLORS[color] || 0x888888;
    const g = this.add.graphics();
    if (atOrigin) g.setPosition(x, y);

    // Map 10x10 grid (0–9) to cell bounds so arrows fill the cell
    let ox, oy, scaleX, scaleY;
    if (cellLeft != null && cellTop != null) {
      ox = cellLeft;
      oy = cellTop;
      scaleX = MAZE_CELL_SIZE / 9; // 0→left edge, 9→right edge
      scaleY = MAZE_CELL_SIZE / 9;
    } else {
      ox = atOrigin ? 0 : x;
      oy = atOrigin ? 0 : y;
      const scale = MAZE_CELL_SIZE / ARROW_GRID;
      scaleX = scaleY = scale;
    }

    const world = path.map(([px, py]) => {
      if (cellLeft != null && cellTop != null) {
        return { x: ox + px * scaleX, y: oy + py * scaleY };
      }
      return {
        x: ox + (px - ARROW_GRID / 2) * scaleX,
        y: oy + (py - ARROW_GRID / 2) * scaleY,
      };
    });

    g.lineStyle(3, colorHex);
    g.beginPath();
    g.moveTo(world[0].x, world[0].y);
    for (let i = 1; i < world.length; i++) g.lineTo(world[i].x, world[i].y);
    g.strokePath();

    if (world.length >= 2) {
      const tip = world[world.length - 1];
      const prev = world[world.length - 2];
      const dx = tip.x - prev.x;
      const dy = tip.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = Math.min(8, len * 0.5);
      g.lineStyle(3, colorHex);
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x - ux * headLen + uy * headLen * 0.5, tip.y - uy * headLen - ux * headLen * 0.5);
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x - ux * headLen - uy * headLen * 0.5, tip.y - uy * headLen + ux * headLen * 0.5);
      g.strokePath();
    }

    return g;
  }

  createStraightLineArrow(fromX, fromY, toX, toY, color) {
    const colorHex = COLORS[color] || 0x888888;
    const len = Math.hypot(toX - fromX, toY - fromY) || 1;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const lineW = 4;
    const headLen = 14;
    const g = this.add.graphics();
    g.setPosition(fromX, fromY);
    g.setAngle(angle * (180 / Math.PI));
    g.lineStyle(lineW, colorHex);
    g.beginPath();
    g.moveTo(-len, 0);  // tail
    g.lineTo(-headLen, 0);  // shaft end
    g.strokePath();
    g.lineStyle(lineW, colorHex);
    g.beginPath();
    g.moveTo(0, 0);  // tip at front
    g.lineTo(-headLen, -headLen * 0.5);
    g.moveTo(0, 0);
    g.lineTo(-headLen, headLen * 0.5);
    g.strokePath();
    return g;
  }

  buildQueues() {
    const totalW =
      QUEUE_COUNT * this.queueSlotSize + (QUEUE_COUNT - 1) * this.queuePadding;
    const startX = (this.cameras.main.width - totalW) / 2 + this.queueSlotSize / 2;
    const baseY = this.queueBaseY;

    this.queueSlotRects = [];
    this.queueItemGraphics = [];

    for (let q = 0; q < QUEUE_COUNT; q++) {
      const qx = startX + q * (this.queueSlotSize + this.queuePadding);
      this.queueItemGraphics[q] = [];
      for (let row = 0; row < QUEUE_DEPTH; row++) {
        const qy = baseY + row * this.queueSlotSize;
        const rect = this.add
          .rectangle(
            qx,
            qy,
            this.queueSlotSize - 6,
            this.queueSlotSize - 6,
            0xffffff
          )
          .setStrokeStyle(2, 0x555555)
          .setInteractive({ useHandCursor: true });
        this.queueSlotRects.push({ q, row, rect });
        this.queueItemGraphics[q].push(null);

        const isFirst = row === 0;
        rect.on('pointerdown', () => {
          if (this.processing || this.gameOver || this.won) return;
          if (isFirst && this.queues[q].length > 0) this.onQueueItemClicked(q);
        });
      }
    }

    this.add
      .text(
        this.cameras.main.width / 2,
        baseY - 24,
        'Queues',
        { fontSize: '14px', color: '#333', fontFamily: 'sans-serif' }
      )
      .setOrigin(0.5);
  }

  getQueueSlotPosition(q, row) {
    const totalW =
      QUEUE_COUNT * this.queueSlotSize + (QUEUE_COUNT - 1) * this.queuePadding;
    const startX = (this.cameras.main.width - totalW) / 2 + this.queueSlotSize / 2;
    return {
      x: startX + q * (this.queueSlotSize + this.queuePadding),
      y: this.queueBaseY + row * this.queueSlotSize,
    };
  }

  refreshQueueDisplay() {
    for (let q = 0; q < QUEUE_COUNT; q++) {
      for (let row = 0; row < QUEUE_DEPTH; row++) {
        const pos = this.getQueueSlotPosition(q, row);
        const old = this.queueItemGraphics[q][row];
        if (old) old.destroy();
        this.queueItemGraphics[q][row] = null;

        const color = this.queues[q][row];
        if (color) {
          const g = this.add.circle(
            pos.x,
            pos.y,
            BALLOON_RADIUS - 2,
            COLORS[color] || 0x888888
          );
          g.setStrokeStyle(2, 0x333333);
          g.setAlpha(row === 0 ? 1 : 0.5);
          this.queueItemGraphics[q][row] = g;
        }
      }
    }
  }

  onQueueItemClicked(q) {
    if (this.conveyor.length >= MAX_CONVEYOR_BALLOONS) {
      this.triggerGameOver();
      return;
    }
    if (this.queues[q].length === 0) return;

    this.processing = true;
    const color = this.queues[q].shift();
    const fromPos = this.getQueueSlotPosition(q, 0);
    this.refreshQueueDisplay();

    const usedSlots = new Set(this.conveyor.map((b) => b.slotIndex));
    let slotIndex = 0;
    for (let i = 0; i < CONVEYOR_SLOT_COUNT; i++) {
      if (!usedSlots.has(i)) {
        slotIndex = i;
        break;
      }
    }

    const toPos = this.getConveyorSlotPosition(slotIndex);
    const balloon = {
      color,
      slotIndex,
      progress: slotIndex / CONVEYOR_SLOT_COUNT,
      arriving: true,
      graphic: this.add.circle(fromPos.x, fromPos.y, BALLOON_RADIUS, COLORS[color] || 0x888888),
    };
    balloon.graphic.setStrokeStyle(2, 0x333333);
    this.tweens.add({
      targets: balloon.graphic,
      x: toPos.x,
      y: toPos.y,
      duration: 250,
      ease: 'Back.Out',
      onComplete: () => {
        balloon.arriving = false;
        this.processing = false;
        this.checkAndResolveExits();
        this.checkWinCondition();
      },
    });
    this.conveyor.push(balloon);
    this.refreshConveyorCount();
  }

  isArrowBlocked(r, c) {
    const cell = this.maze[r][c];
    if (!cell) return true;
    const dir = pathToDir(cell.path);
    const { dr, dc } = DIR_DELTA[dir];
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < MAZE_ROWS && nc >= 0 && nc < MAZE_COLS) {
      if (this.maze[nr][nc]) return true;
      nr += dr;
      nc += dc;
    }
    return false;
  }

  getArrowExitEdge(r, c) {
    const cell = this.maze[r][c];
    if (!cell) return -1;
    const dir = pathToDir(cell.path);
    const { dr, dc } = DIR_DELTA[dir];
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < MAZE_ROWS && nc >= 0 && nc < MAZE_COLS) {
      if (this.maze[nr][nc]) return -1;
      nr += dr;
      nc += dc;
    }
    if (nr < 0) return 0;
    if (nc >= MAZE_COLS) return 1;
    if (nr >= MAZE_ROWS) return 2;
    if (nc < 0) return 3;
    return -1;
  }

  /** Conveyor t (0-1) where arrow at (r,c) would hit the conveyor on given edge */
  getArrowPreferredConveyorT(r, c, edge) {
    const q = 0.25; // each edge spans 1/4 of perimeter
    switch (edge) {
      case 0: return ((c + 0.5) / MAZE_COLS) * q;
      case 1: return q + ((r + 0.5) / MAZE_ROWS) * q;
      case 2: return 2 * q + (1 - (c + 0.5) / MAZE_COLS) * q;
      case 3: return 3 * q + (1 - (r + 0.5) / MAZE_ROWS) * q;
      default: return 0;
    }
  }

  checkAndResolveExits() {
    const toRemove = [];

    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        const cell = this.maze[r][c];
        if (!cell) continue;
        const edge = this.getArrowExitEdge(r, c);
        if (edge < 0) continue;

        const [lo, hi] = EDGE_SLOT_RANGES[edge];
        const preferredT = this.getArrowPreferredConveyorT(r, c, edge);
        let targetBalloon = null;
        for (const b of this.conveyor) {
          if (b.color !== cell.color) continue;
          const segment = Math.floor(((b.progress + 0.001) % 1) * CONVEYOR_SLOT_COUNT);
          if (segment < lo || segment >= hi) continue;
          let dist = Math.abs((b.progress % 1) - preferredT);
          if (dist > 0.5) dist = 1 - dist;
          if (dist <= ARROW_PROXIMITY_THRESHOLD) {
            targetBalloon = b;
            break;
          }
        }
        if (targetBalloon) {
          toRemove.push({ arrow: { r, c }, balloon: targetBalloon });
        }
      }
    }

    if (toRemove.length > 0) {
      this.processing = true;
      const { arrow, balloon } = toRemove[0];
      const cell = this.maze[arrow.r][arrow.c];

      const fromPos = getArrowTipPosition(
        this.mazeCenterX,
        this.mazeCenterY,
        arrow.r,
        arrow.c,
        cell.path
      );
      const toX = balloon.graphic.x;
      const toY = balloon.graphic.y;

      const flyingArrow = this.createStraightLineArrow(
        fromPos.x,
        fromPos.y,
        toX,
        toY,
        cell.color
      );
      flyingArrow.setDepth(100);

      this.conveyor = this.conveyor.filter((b) => b !== balloon);
      this.refreshConveyorCount();

      const old = this.mazeGraphics[arrow.r][arrow.c];
      if (old && old.graphic) old.graphic.destroy();
      this.maze[arrow.r][arrow.c] = null;
      this.mazeGraphics[arrow.r][arrow.c] = null;

      this.tweens.add({
        targets: flyingArrow,
        x: toX,
        y: toY,
        duration: 280,
        ease: 'Power2.In',
        onComplete: () => {
          flyingArrow.destroy();
          if (balloon.graphic) {
            this.tweens.add({
              targets: balloon.graphic,
              scale: 0.01,
              duration: 120,
              ease: 'Power2.In',
              onComplete: () => {
                balloon.graphic.destroy();
                this.processing = false;
                this.checkWinCondition();
                this.checkAndResolveExits();
              },
            });
          } else {
            this.processing = false;
            this.checkWinCondition();
            this.checkAndResolveExits();
          }
        },
      });
    }
  }

  triggerGameOver() {
    this.gameOver = true;
    const { width, height } = this.cameras.main;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
      .setScrollFactor(0);
    this.add
      .text(width / 2, height / 2, 'Game Over\nConveyor full!', {
        fontSize: '36px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
  }

  checkWinCondition() {
    const allQueuesEmpty = this.queues.every((q) => q.length === 0);
    const conveyorEmpty = this.conveyor.length === 0;
    if (allQueuesEmpty && conveyorEmpty && !this.gameOver) {
      this.won = true;
      const { width, height } = this.cameras.main;
      this.add
        .rectangle(width / 2, height / 2, width, height, 0x000000, 0.5)
        .setScrollFactor(0);
      this.add
        .text(width / 2, height / 2, 'You Win!\nAll balloons exploded!', {
          fontSize: '36px',
          color: '#ffffff',
          fontFamily: 'sans-serif',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
    }
  }
}
