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
  BALLOON_COUNT,
  MAZE_SEED,
  CONVEYOR_SPEED,
  DEBUG_DRAW_10x10_GRID,
  ARROW_PROXIMITY_THRESHOLD,
} from './GameConfig.js';
import {
  generateSolvableMaze,
  generateInitialQueues,
  cellsToExitDir,
  buildCellToArrow,
} from './ArrowGenerator.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';

// Dir: 0=N, 1=E, 2=S, 3=W. Delta for raycast.
const DIR_DELTA = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
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

function cloneArrows(arrows) {
  return arrows.map((a) => ({ color: a.color, cells: a.cells.map((c) => [...c]) }));
}

export default class BalloonArrowsGame extends Phaser.Scene {
  constructor() {
    super({ key: 'BalloonArrowsGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.BALLOON, ASSET_PATHS.BALLOON);
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

    // State: generate queues and maze from seed
    const queues = generateInitialQueues(MAZE_SEED, BALLOON_COUNT, QUEUE_COUNT);
    this.queues = queues.map((arr) => [...arr]);
    const generated = generateSolvableMaze(MAZE_ROWS, MAZE_COLS, queues);
    this.arrows = generated ? cloneArrows(generated.arrows) : [];
    this.cellToArrow = buildCellToArrow(this.arrows, MAZE_ROWS, MAZE_COLS);
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

    if (DEBUG_DRAW_10x10_GRID) {
      this.drawDebugMazeGrid(startX, startY);
    }
    this.mazeStartX = startX;
    this.mazeStartY = startY;
    this.mazeGraphics = [];
    for (let i = 0; i < this.arrows.length; i++) {
      const g = this.drawArrowCells(this.arrows[i], startX, startY);
      this.mazeGraphics[i] = { graphic: g };
    }
  }

  getCellCenter(r, c) {
    return {
      x: this.mazeStartX + (c + 0.5) * MAZE_CELL_SIZE,
      y: this.mazeStartY + (r + 0.5) * MAZE_CELL_SIZE,
    };
  }

  /** Draw the 10x10 maze cell grid (once for the whole maze) */
  drawDebugMazeGrid(startX, startY) {
    const g = this.add.graphics();
    g.lineStyle(2, 0x000000);
    const w = MAZE_COLS * MAZE_CELL_SIZE;
    const h = MAZE_ROWS * MAZE_CELL_SIZE;
    for (let i = 0; i <= MAZE_ROWS; i++) {
      const y = startY + i * MAZE_CELL_SIZE;
      g.beginPath();
      g.moveTo(startX, y);
      g.lineTo(startX + w, y);
      g.strokePath();
    }
    for (let i = 0; i <= MAZE_COLS; i++) {
      const x = startX + i * MAZE_CELL_SIZE;
      g.beginPath();
      g.moveTo(x, startY);
      g.lineTo(x, startY + h);
      g.strokePath();
    }
  }

  /** Draw arrow as lines connecting cell centers (one segment per cell) */
  drawArrowCells(arrow, startX, startY) {
    const colorHex = COLORS[arrow.color] || 0x888888;
    const g = this.add.graphics();
    const centers = arrow.cells.map(([r, c]) => ({
      x: startX + (c + 0.5) * MAZE_CELL_SIZE,
      y: startY + (r + 0.5) * MAZE_CELL_SIZE,
    }));

    g.lineStyle(3, colorHex);
    g.beginPath();
    g.moveTo(centers[0].x, centers[0].y);
    for (let i = 1; i < centers.length; i++) g.lineTo(centers[i].x, centers[i].y);
    g.strokePath();

    if (centers.length >= 2) {
      const tip = centers[centers.length - 1];
      const prev = centers[centers.length - 2];
      const dx = tip.x - prev.x;
      const dy = tip.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = Math.min(10, len * 0.4);
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
    const fullLen = Math.hypot(toX - fromX, toY - fromY) || 1;
    const len = Math.min(fullLen, 48);
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const lineW = 3;
    const headLen = 10;
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

  createBalloonSprite(x, y, color, scale = 1) {
    const s = this.add.sprite(x, y, SPRITE_KEYS.BALLOON);
    s.setTint(COLORS[color] || 0x888888);
    const baseSize = (BALLOON_RADIUS * 2) * 2;
    s.setDisplaySize(baseSize * scale, baseSize * scale);
    s.setOrigin(0.5);
    return s;
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
          const g = this.createBalloonSprite(pos.x, pos.y, color, 0.9);
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

    // All balloons enter at a fixed point (bottom of conveyor, near queues) and are spaced 1 slot apart
    const ENTRANCE_PROGRESS = 0.5;
    const newProgress =
      this.conveyor.length === 0
        ? ENTRANCE_PROGRESS
        : (Math.min(...this.conveyor.map((b) => b.progress)) -
            1 / CONVEYOR_SLOT_COUNT +
            1) %
          1;

    const toPos = getRoundedRectPoint(
      newProgress,
      this.mazeCenterX,
      this.mazeCenterY,
      this.conveyorHalfW - CONVEYOR_TRACK_WIDTH / 2,
      this.conveyorHalfH - CONVEYOR_TRACK_WIDTH / 2,
      this.conveyorR - CONVEYOR_TRACK_WIDTH / 4
    );
    const balloon = {
      color,
      slotIndex: -1, // no longer used for placement
      progress: newProgress,
      arriving: true,
      graphic: this.createBalloonSprite(fromPos.x, fromPos.y, color),
    };
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

  hasArrowFreeExit(arrowIndex) {
    const arrow = this.arrows[arrowIndex];
    if (!arrow || arrow.cells.length < 2) return false;
    const dir = cellsToExitDir(arrow.cells);
    const { dr, dc } = DIR_DELTA[dir];
    const [lr, lc] = arrow.cells[arrow.cells.length - 1];
    let nr = lr + dr;
    let nc = lc + dc;
    while (nr >= 0 && nr < MAZE_ROWS && nc >= 0 && nc < MAZE_COLS) {
      const other = this.cellToArrow[nr][nc];
      if (other >= 0 && other !== arrowIndex) return false;
      nr += dr;
      nc += dc;
    }
    return true;
  }

  getArrowExitEdge(arrowIndex) {
    const arrow = this.arrows[arrowIndex];
    if (!arrow || arrow.cells.length < 2) return -1;
    const dir = cellsToExitDir(arrow.cells);
    const { dr, dc } = DIR_DELTA[dir];
    const [lr, lc] = arrow.cells[arrow.cells.length - 1];
    let nr = lr + dr;
    let nc = lc + dc;
    while (nr >= 0 && nr < MAZE_ROWS && nc >= 0 && nc < MAZE_COLS) {
      const other = this.cellToArrow[nr][nc];
      if (other >= 0 && other !== arrowIndex) return -1;
      nr += dr;
      nc += dc;
    }
    if (nr < 0) return 0;
    if (nc >= MAZE_COLS) return 1;
    if (nr >= MAZE_ROWS) return 2;
    if (nc < 0) return 3;
    return -1;
  }

  checkAndResolveExits() {
    const toRemove = [];

    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      if (!arrow) continue;
      const edge = this.getArrowExitEdge(i);
      if (edge < 0) continue;

      const [lr, lc] = arrow.cells[arrow.cells.length - 1];
      const headCenter = this.getCellCenter(lr, lc);
      const dir = cellsToExitDir(arrow.cells);
      
      let targetBalloon = null;
      for (const b of this.conveyor) {
        if (b.color !== arrow.color || b.arriving) continue;
        
        const bx = b.graphic.x;
        const by = b.graphic.y;
        
        let aligned = false;
        if (dir === 0) aligned = Math.abs(bx - headCenter.x) < ARROW_PROXIMITY_THRESHOLD && by < headCenter.y;
        else if (dir === 1) aligned = Math.abs(by - headCenter.y) < ARROW_PROXIMITY_THRESHOLD && bx > headCenter.x;
        else if (dir === 2) aligned = Math.abs(bx - headCenter.x) < ARROW_PROXIMITY_THRESHOLD && by > headCenter.y;
        else if (dir === 3) aligned = Math.abs(by - headCenter.y) < ARROW_PROXIMITY_THRESHOLD && bx < headCenter.x;
        
        if (aligned) {
          targetBalloon = b;
          break;
        }
      }
      
      if (targetBalloon) {
        toRemove.push({ arrowIndex: i, balloon: targetBalloon });
        // Process only one removal per frame for visual stability
        break;
      }
    }

    if (toRemove.length > 0) {
      this.processing = true;
      const { arrowIndex, balloon } = toRemove[0];
      const arrow = this.arrows[arrowIndex];
      const [lr, lc] = arrow.cells[arrow.cells.length - 1];
      const fromPos = this.getCellCenter(lr, lc);
      const toX = balloon.graphic.x;
      const toY = balloon.graphic.y;

      const flyingArrow = this.createStraightLineArrow(
        fromPos.x,
        fromPos.y,
        toX,
        toY,
        arrow.color
      );
      flyingArrow.setDepth(100);

      this.conveyor = this.conveyor.filter((b) => b !== balloon);
      this.refreshConveyorCount();

      const old = this.mazeGraphics[arrowIndex];
      if (old && old.graphic) old.graphic.destroy();
      for (const [r, c] of arrow.cells) {
        this.cellToArrow[r][c] = -1;
      }
      this.arrows[arrowIndex] = null;
      this.mazeGraphics[arrowIndex] = null;

      this.tweens.add({
        targets: flyingArrow,
        x: toX,
        y: toY,
        duration: 140,
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
