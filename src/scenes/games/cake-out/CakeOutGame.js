import Phaser from '../../../lib/phaser.js';
import {
  COLORS,
  GRID_ROWS,
  GRID_COLS,
  PLACEHOLDER_SIZE,
  QUEUE_COUNT,
  QUEUE_DEPTH,
  RESERVE_SLOT_COUNT,
  FIELD_PADDING_X,
  DEBUG_DRAW_GRID,
  LEVEL_SEED,
} from './GameConfig.js';
import {
  buildInitialGrid,
  PLACEHOLDER_ANCHORS,
  getPlaceholderFootprint,
  cellInAnyPlaceholder,
} from './LevelData.js';
import { generateBalancedPlateQueues } from './PlateGenerator.js';
import { findReachableCakeCells, findPathFromCakeToFootprint } from './Reachability.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';

/** Reserve + scale ratio when moving field plate → reserve (layout size). */
const PLATE_RADIUS_QUEUE = 28;
/** Queue column visuals only (2× larger; may extend past slot box). */
const PLATE_RADIUS_QUEUE_DISPLAY = PLATE_RADIUS_QUEUE * 2;
/** Queue grid cell (row step + slot rect); fits display diameter + margin. */
const QUEUE_SLOT_SIZE = Math.ceil(PLATE_RADIUS_QUEUE_DISPLAY * 2 + 20);
/** Horizontal gap between queue columns (also used between reserve slots). */
const QUEUE_COLUMN_GAP = 28;
const PLATE_RADIUS_FIELD = Math.min(36, PLACEHOLDER_SIZE * 8);
const DRAG_MIN_DIST = 20;

/** Flyer travel speed in pixels per second (all path segments and straight fallback) */
const CAKE_FLY_SPEED_PX_PER_SEC = 640;
/** Vertical settle after gather (sand); a bit slower than flight */
const CAKE_GRAVITY_SPEED_PX_PER_SEC = 420;
/** Floor so very short segments are still visible */
const CAKE_FLY_MIN_SEGMENT_MS = 26;
/** Pause after the last piece in a wave lands before next wave or plate exit */
const GATHER_BATCH_SETTLE_MS = 260;

function durationForDistancePx(distPx) {
  const ms = (distPx / CAKE_FLY_SPEED_PX_PER_SEC) * 1000;
  return Math.max(CAKE_FLY_MIN_SEGMENT_MS, Math.round(ms));
}

function gravityDurationForDistancePx(distPx) {
  const ms = (distPx / CAKE_GRAVITY_SPEED_PX_PER_SEC) * 1000;
  return Math.max(CAKE_FLY_MIN_SEGMENT_MS, Math.round(ms));
}

function cloneGridRows(grid) {
  return grid.map((row) => [...row]);
}

function gridsCellRefEqual(a, b) {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

/** Run sand passes until stable; does not mutate `source`. */
function simulateSandToFinalGrid(source) {
  const g = cloneGridRows(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = GRID_ROWS - 2; r >= 0; r--) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (cellInAnyPlaceholder(r, c) || cellInAnyPlaceholder(r + 1, c)) continue;
        const cell = g[r][c];
        if (!cell || cell.type !== 'cake') continue;
        if (g[r + 1][c] != null) continue;
        g[r][c] = null;
        g[r + 1][c] = cell;
        changed = true;
      }
    }
  }
  return g;
}

function findCellWithRef(grid, ref) {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (grid[r][c] === ref) return [r, c];
    }
  }
  return null;
}
const PLATE_PULSE_SCALE = 1.14;
const PLATE_PULSE_DURATION_MS = 500;

/** Outer rect + inner (gridCells × gridCells) cell lines for empty placeholder slots. */
function drawPlaceholderSlotFrame(scene, fieldX, fieldY, anchorR, anchorC, cellSize, gridCells) {
  const left = fieldX + anchorC * cellSize;
  const top = fieldY + anchorR * cellSize;
  const w = gridCells * cellSize;
  const h = gridCells * cellSize;
  const g = scene.add.graphics();
  g.fillStyle(0xd8e2ea, 0.28);
  g.fillRect(left, top, w, h);
  g.lineStyle(2, 0x6b7c8c, 0.95);
  g.strokeRect(left + 1, top + 1, w - 2, h - 2);
  g.lineStyle(1, 0x98a8b8, 0.72);
  for (let i = 1; i < gridCells; i++) {
    const x = left + i * cellSize;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, top + h);
    g.strokePath();
    const y = top + i * cellSize;
    g.beginPath();
    g.moveTo(left, y);
    g.lineTo(left + w, y);
    g.strokePath();
  }
  return g;
}
const RESERVE_MOVE_DURATION_MS = 480;
const PLATE_FULL_EXIT_DURATION_MS = 280;

function makePlateGraphic(scene, x, y, radius, plateState, depth = 10) {
  const container = scene.add.container(x, y);
  container.setDepth(depth);
  const g = scene.add.graphics();
  container.add(g);

  const redraw = () => {
    g.clear();
    const p = plateState;
    const hex = COLORS[p.color] ?? 0x888888;
    const f = Math.max(0, p.fill ?? 0);
    const cap = Math.max(1, p.capacity ?? 1);
    const innerR = Math.max(4, radius - 7);
    const wedgeR = innerR - 2;

    // Plate identity: strong colored ring (visible even when empty)
    g.lineStyle(5, hex, 1);
    g.strokeCircle(0, 0, radius - 2.5);

    // Inner base: white + light tint of plate color
    g.lineStyle(2, hex, 0.65);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(0, 0, innerR);
    g.fillStyle(hex, 0.38);
    g.fillCircle(0, 0, innerR);
    g.strokeCircle(0, 0, innerR);

    // Gather progress: filled slices from top, clockwise (one sector per capacity unit)
    const frac = Math.min(1, f / cap);
    if (frac > 0.004) {
      g.fillStyle(hex, 1);
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * frac;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, wedgeR, start, end, false);
      g.closePath();
      g.fillPath();
    }

    // Capacity: radial sector dividers (one boundary per slice, like pie marks)
    if (cap >= 2) {
      const lineW = cap > 16 ? 1 : 1.35;
      g.lineStyle(lineW, 0x353535, 0.92);
      for (let j = 0; j < cap; j++) {
        const a = -Math.PI / 2 + (2 * Math.PI * j) / cap;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(cx * wedgeR, cy * wedgeR);
        g.strokePath();
      }
    }
  };
  redraw();
  container.setData('redraw', redraw);
  return container;
}

export default class CakeOutGame extends Phaser.Scene {
  constructor() {
    super({ key: 'CakeOutGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.CAKE_PIECE, ASSET_PATHS.CAKE_PIECE);
  }

  create() {
    const { width, height } = this.cameras.main;

    this.add
      .text(50, 25, 'Back', {
        fontSize: '18px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(250)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        window.location.href = 'index.html';
      });

    this.gameOver = false;
    this.won = false;
    this.processing = false;

    this.grid = buildInitialGrid(LEVEL_SEED);
    this.queues = generateBalancedPlateQueues(
      this.grid,
      QUEUE_COUNT,
      LEVEL_SEED + 333
    );

    this.placeholders = PLACEHOLDER_ANCHORS.map(([anchorR, anchorC]) => ({
      anchorR,
      anchorC,
      plate: null,
    }));

    this.reserve = Array.from({ length: RESERVE_SLOT_COUNT }, () => null);

    this.queueBaseY = height - 175;
    this.queueSlotSize = QUEUE_SLOT_SIZE;
    this.queueColumnGap = QUEUE_COLUMN_GAP;
    /** Same cell size as queue; gap may shrink so five slots fit the screen width. */
    this.reserveSlotSize = this.queueSlotSize;
    {
      const maxBandW = width - FIELD_PADDING_X * 2;
      const minGap = 6;
      let rg = this.queueColumnGap;
      while (
        RESERVE_SLOT_COUNT * this.reserveSlotSize +
          (RESERVE_SLOT_COUNT - 1) * rg >
        maxBandW &&
        rg > minGap
      ) {
        rg -= 1;
      }
      if (
        RESERVE_SLOT_COUNT * this.reserveSlotSize +
          (RESERVE_SLOT_COUNT - 1) * rg >
        maxBandW
      ) {
        this.reserveSlotSize = Math.max(
          96,
          Math.floor(
            (maxBandW - (RESERVE_SLOT_COUNT - 1) * minGap) /
              RESERVE_SLOT_COUNT
          )
        );
        rg = minGap;
      }
      this.reserveGap = rg;
    }
    this.reserveY = this.queueBaseY - Math.max(118, this.queueSlotSize + 52);
    const fieldTopY = 72;
    const reserveRectH = this.reserveSlotSize - 6;
    const fieldReserveGap = 28;
    const fieldBottomY = this.reserveY - reserveRectH / 2 - fieldReserveGap;
    const availH = fieldBottomY - fieldTopY;
    const availW = width - FIELD_PADDING_X * 2;
    this.cellSize = Math.floor(Math.min(availW / GRID_COLS, availH / GRID_ROWS));
    this.fieldW = this.cellSize * GRID_COLS;
    this.fieldH = this.cellSize * GRID_ROWS;
    this.fieldX = (width - this.fieldW) / 2;
    this.fieldY = fieldTopY + Math.max(0, (availH - this.fieldH) / 2);

    this.add.rectangle(width / 2, height / 2, width, height, 0xd8e0e8).setDepth(0);

    this.fieldBg = this.add
      .rectangle(
        this.fieldX + this.fieldW / 2,
        this.fieldY + this.fieldH / 2,
        this.fieldW + 8,
        this.fieldH + 8,
        0xe8eef2
      )
      .setStrokeStyle(2, 0x9aa8b0)
      .setDepth(1);

    this.drawFieldCellGrid();

    this.cakeCellPx = Math.max(2, this.cellSize - 2);
    this.cellDisplays = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      this.cellDisplays[r] = [];
      for (let c = 0; c < GRID_COLS; c++) {
        const cx = this.fieldX + (c + 0.5) * this.cellSize;
        const cy = this.fieldY + (r + 0.5) * this.cellSize;
        const sprite = this.add
          .sprite(cx, cy, SPRITE_KEYS.CAKE_PIECE)
          .setDisplaySize(this.cakeCellPx, this.cakeCellPx)
          .setDepth(2)
          .setVisible(false);
        this.cellDisplays[r][c] = sprite;
      }
    }

    this.refreshAllCakes();

    if (DEBUG_DRAW_GRID) this.drawDebugGrid();

    this.placeholderDecor = [];
    for (const ph of this.placeholders) {
      const cx =
        this.fieldX + (ph.anchorC + PLACEHOLDER_SIZE / 2) * this.cellSize;
      const cy =
        this.fieldY + (ph.anchorR + PLACEHOLDER_SIZE / 2) * this.cellSize;
      const w = PLACEHOLDER_SIZE * this.cellSize;
      const h = PLACEHOLDER_SIZE * this.cellSize;
      const slotFrame = drawPlaceholderSlotFrame(
        this,
        this.fieldX,
        this.fieldY,
        ph.anchorR,
        ph.anchorC,
        this.cellSize,
        PLACEHOLDER_SIZE
      );
      slotFrame.setDepth(2);
      // Same soft ellipse as before — plate drop target; sits above grid lines.
      const inner = PLACEHOLDER_SIZE * this.cellSize - 4;
      const slotEllipse = this.add
        .ellipse(cx, cy, inner * 0.92, inner * 0.92, 0xd0d8dc, 0.55)
        .setStrokeStyle(2, 0xa8b4bc);
      slotEllipse.setDepth(3);
      this.placeholderDecor.push({
        ph,
        cx,
        cy,
        w,
        h,
        slotFrame,
        slotEllipse,
        hitRect: new Phaser.Geom.Rectangle(
          this.fieldX + ph.anchorC * this.cellSize,
          this.fieldY + ph.anchorR * this.cellSize,
          w,
          h
        ),
      });
    }

    this.reserveSlotRects = [];
    const resTotalW =
      RESERVE_SLOT_COUNT * this.reserveSlotSize +
      (RESERVE_SLOT_COUNT - 1) * this.reserveGap;
    const resStartX = (width - resTotalW) / 2 + this.reserveSlotSize / 2;
    for (let i = 0; i < RESERVE_SLOT_COUNT; i++) {
      const rx = resStartX + i * (this.reserveSlotSize + this.reserveGap);
      const rect = this.add
        .rectangle(
          rx,
          this.reserveY,
          this.reserveSlotSize - 6,
          this.reserveSlotSize - 6,
          0xe2e8ee
        )
        .setStrokeStyle(2, 0x6a7580)
        .setDepth(3);
      this.reserveSlotRects.push({ index: i, x: rx, y: this.reserveY, rect, graphic: null });
    }
    this.add
      .text(width / 2, this.reserveY - 36, 'Reserve', {
        fontSize: '14px',
        color: '#333',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(5);

    this.queueSlotRects = [];
    this.queueItemGraphics = [];
    const qTotalW =
      QUEUE_COUNT * this.queueSlotSize + (QUEUE_COUNT - 1) * this.queueColumnGap;
    const qStartX = (width - qTotalW) / 2 + this.queueSlotSize / 2;
    for (let q = 0; q < QUEUE_COUNT; q++) {
      this.queueItemGraphics[q] = [];
      const qx = qStartX + q * (this.queueSlotSize + this.queueColumnGap);
      for (let row = 0; row < QUEUE_DEPTH; row++) {
        const qy = this.queueBaseY + row * this.queueSlotSize;
        const slot = this.add
          .rectangle(
            qx,
            qy,
            this.queueSlotSize - 6,
            this.queueSlotSize - 6,
            0xffffff
          )
          .setStrokeStyle(2, 0x555555)
          .setDepth(3);
        this.queueSlotRects.push({ q, row, x: qx, y: qy, rect: slot });
        this.queueItemGraphics[q][row] = null;
      }
    }
    this.add
      .text(width / 2, this.queueBaseY - 40, 'Queues', {
        fontSize: '14px',
        color: '#333',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);

    this.refreshQueueDisplay();
    this.refreshReserveDisplay();

    this.draggingPlate = null;
    this.dragSource = null;
    this.dragQueueIndex = null;
    this.dragReserveIndex = null;
    this.dragGraphic = null;
    this.dragStartX = null;
    this.dragStartY = null;

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
  }

  /** Full playfield layout: one line per cell edge (same style family as field border). */
  drawFieldCellGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, 0x9aa8b0, 0.42);
    for (let i = 0; i <= GRID_ROWS; i++) {
      const y = this.fieldY + i * this.cellSize;
      g.lineBetween(this.fieldX, y, this.fieldX + this.fieldW, y);
    }
    for (let j = 0; j <= GRID_COLS; j++) {
      const x = this.fieldX + j * this.cellSize;
      g.lineBetween(x, this.fieldY, x, this.fieldY + this.fieldH);
    }
    g.setDepth(1);
  }

  drawDebugGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, 0x888888, 0.4);
    for (let i = 0; i <= GRID_ROWS; i++) {
      const y = this.fieldY + i * this.cellSize;
      g.lineBetween(this.fieldX, y, this.fieldX + this.fieldW, y);
    }
    for (let j = 0; j <= GRID_COLS; j++) {
      const x = this.fieldX + j * this.cellSize;
      g.lineBetween(x, this.fieldY, x, this.fieldY + this.fieldH);
    }
    g.setDepth(1);
  }

  refreshAllCakes() {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        this.refreshCakeCell(r, c);
      }
    }
  }

  refreshCakeCell(r, c) {
    const disp = this.cellDisplays[r][c];
    const cell = this.grid[r][c];
    if (!cell || cell.type !== 'cake') {
      disp.setVisible(false);
    } else {
      const hex = COLORS[cell.color] ?? 0x888888;
      disp.setTint(hex);
      disp.setVisible(true);
    }
  }

  /**
   * Sand: compute final grid in one shot, commit `this.grid`, then tween each sprite
   * straight to its resting cell and rebuild `cellDisplays` once (avoids desync).
   */
  runSandGravitySettled(onComplete) {
    const before = cloneGridRows(this.grid);
    const after = simulateSandToFinalGrid(before);

    if (gridsCellRefEqual(before, after)) {
      onComplete();
      return;
    }

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        this.grid[r][c] = after[r][c];
      }
    }

    const assign = [];
    for (let r = 0; r < GRID_ROWS; r++) assign[r] = [];

    const used = new Set();
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.type === 'cake') {
          const start = findCellWithRef(before, cell);
          if (!start) continue;
          const [sr, sc] = start;
          assign[r][c] = this.cellDisplays[sr][sc];
          used.add(this.cellDisplays[sr][sc]);
        }
      }
    }

    const emptyTargets = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.grid[r][c] == null) emptyTargets.push([r, c]);
      }
    }

    const pool = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const spr = this.cellDisplays[r][c];
        if (!used.has(spr)) pool.push({ spr, r, c });
      }
    }
    pool.sort((a, b) => a.r - b.r || a.c - b.c);
    emptyTargets.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i < emptyTargets.length; i++) {
      const [er, ec] = emptyTargets[i];
      assign[er][ec] = pool[i].spr;
    }

    const finalize = () => {
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          const spr = assign[r][c];
          const tx = this.fieldX + (c + 0.5) * this.cellSize;
          const ty = this.fieldY + (r + 0.5) * this.cellSize;
          this.cellDisplays[r][c] = spr;
          spr.setPosition(tx, ty);
          this.refreshCakeCell(r, c);
        }
      }
      onComplete();
    };

    let pending = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const spr = assign[r][c];
        const tx = this.fieldX + (c + 0.5) * this.cellSize;
        const ty = this.fieldY + (r + 0.5) * this.cellSize;
        const dist = Phaser.Math.Distance.Between(spr.x, spr.y, tx, ty);
        if (dist < 0.5) continue;
        pending += 1;
        this.tweens.killTweensOf(spr);
        const duration = gravityDurationForDistancePx(dist);
        this.tweens.add({
          targets: spr,
          x: tx,
          y: ty,
          duration,
          ease: 'Quad.In',
          onComplete: () => {
            pending -= 1;
            if (pending === 0) finalize();
          },
        });
      }
    }

    if (pending === 0) finalize();
  }

  /** Flying cake sprite (same art as grid cells). */
  createCakeFlyerGraphic(r, c, colorKey) {
    const cx = this.fieldX + (c + 0.5) * this.cellSize;
    const cy = this.fieldY + (r + 0.5) * this.cellSize;
    const px = this.cakeCellPx;
    const s = this.add
      .sprite(cx, cy, SPRITE_KEYS.CAKE_PIECE)
      .setDisplaySize(px, px)
      .setScale(1, 1)
      .setTint(COLORS[colorKey] ?? 0x888888)
      .setDepth(120);
    return s;
  }

  /** Keep flyer same on-screen size as grid cells (Phaser x/y tweens can skew display size). */
  lockCakeFlyerVisual(flyer) {
    if (!flyer || !flyer.scene) return;
    flyer.setScale(1, 1);
    flyer.setDisplaySize(this.cakeCellPx, this.cakeCellPx);
  }

  pulsePlateGraphic(container) {
    if (!container || !container.scene) return;
    this.tweens.killTweensOf(container);
    container.setScale(1);
    this.tweens.add({
      targets: container,
      scaleX: PLATE_PULSE_SCALE,
      scaleY: PLATE_PULSE_SCALE,
      duration: PLATE_PULSE_DURATION_MS,
      yoyo: true,
      ease: 'Quad.Out',
    });
  }

  /**
   * Animate flyer along grid cell centers, then into the plate.
   * @param {Phaser.GameObjects.Sprite} flyer
   * @param {Array<[number, number]>} pathRowCol from findPathFromCakeToFootprint (inclusive)
   */
  tweenFlyerAlongPath(flyer, pathRowCol, targetX, targetY, onLand) {
    this.tweens.killTweensOf(flyer);
    this.lockCakeFlyerVisual(flyer);

    const pts = pathRowCol.map(([r, c]) => ({
      x: this.fieldX + (c + 0.5) * this.cellSize,
      y: this.fieldY + (r + 0.5) * this.cellSize,
    }));
    pts.push({ x: targetX, y: targetY });

    let seg = 0;
    const step = () => {
      if (seg >= pts.length - 1) {
        onLand();
        return;
      }
      const p0 = pts[seg];
      const p1 = pts[seg + 1];
      const lastSeg = seg === pts.length - 2;
      seg += 1;
      const duration = durationForDistancePx(
        Phaser.Math.Distance.Between(p0.x, p0.y, p1.x, p1.y)
      );
      const prog = { u: 0 };
      this.tweens.add({
        targets: prog,
        u: 1,
        duration,
        ease: lastSeg ? 'Cubic.In' : 'Linear',
        onUpdate: () => {
          flyer.setPosition(
            p0.x + (p1.x - p0.x) * prog.u,
            p0.y + (p1.y - p0.y) * prog.u
          );
          this.lockCakeFlyerVisual(flyer);
        },
        onComplete: step,
      });
    };
    step();
  }

  countCakePieces() {
    let n = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cell = this.grid[r][c];
        if (cell && cell.type === 'cake') n++;
      }
    }
    return n;
  }

  getQueueSlotPosition(q, row) {
    const qTotalW =
      QUEUE_COUNT * this.queueSlotSize + (QUEUE_COUNT - 1) * this.queueColumnGap;
    const qStartX = (this.cameras.main.width - qTotalW) / 2 + this.queueSlotSize / 2;
    return {
      x: qStartX + q * (this.queueSlotSize + this.queueColumnGap),
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

        const plate = this.queues[q][row];
        if (plate) {
          const g = makePlateGraphic(this, pos.x, pos.y, PLATE_RADIUS_QUEUE_DISPLAY, {
            ...plate,
            fill: 0,
          });
          g.setAlpha(row === 0 ? 1 : 0.48);
          g.setDepth(8);
          this.queueItemGraphics[q][row] = g;
        }
      }
    }
  }

  refreshReserveDisplay() {
    for (const slot of this.reserveSlotRects) {
      const existing = slot.graphic;
      if (existing) {
        existing.destroy();
        slot.graphic = null;
      }
      const plate = this.reserve[slot.index];
      if (plate) {
        const g = makePlateGraphic(this, slot.x, slot.y, PLATE_RADIUS_QUEUE_DISPLAY, plate, 9);
        slot.graphic = g;
      }
    }
  }

  hitTestQueueFront(pointer) {
    for (let q = 0; q < QUEUE_COUNT; q++) {
      if (this.queues[q].length === 0) continue;
      const pos = this.getQueueSlotPosition(q, 0);
      const dx = pointer.x - pos.x;
      const dy = pointer.y - pos.y;
      if (dx * dx + dy * dy <= (PLATE_RADIUS_QUEUE_DISPLAY + 18) ** 2) {
        return q;
      }
    }
    return -1;
  }

  hitTestReserve(pointer) {
    for (const slot of this.reserveSlotRects) {
      if (!this.reserve[slot.index]) continue;
      const dx = pointer.x - slot.x;
      const dy = pointer.y - slot.y;
      if (dx * dx + dy * dy <= (PLATE_RADIUS_QUEUE_DISPLAY + 18) ** 2) {
        return slot.index;
      }
    }
    return -1;
  }

  findPlaceholderUnderPointer(pointer) {
    for (let i = 0; i < this.placeholderDecor.length; i++) {
      const { hitRect, ph } = this.placeholderDecor[i];
      if (ph.plate) continue;
      if (Phaser.Geom.Rectangle.Contains(hitRect, pointer.x, pointer.y)) {
        return i;
      }
    }
    return -1;
  }

  onPointerDown(pointer) {
    if (this.gameOver || this.won || this.processing) return;

    const rq = this.hitTestReserve(pointer);
    if (rq >= 0) {
      const plate = this.reserve[rq];
      if (!plate) return;
      this.draggingPlate = { ...plate };
      this.dragSource = 'reserve';
      this.dragReserveIndex = rq;
      this.dragQueueIndex = null;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      const slot = this.reserveSlotRects[rq];
      if (slot.graphic) {
        slot.graphic.setAlpha(0.35);
        this.dragGraphic = slot.graphic;
        this.dragGraphic.setDepth(100);
      }
      return;
    }

    const q = this.hitTestQueueFront(pointer);
    if (q >= 0) {
      const front = this.queues[q][0];
      if (!front) return;
      this.draggingPlate = { ...front, fill: 0 };
      this.dragSource = 'queue';
      this.dragQueueIndex = q;
      this.dragReserveIndex = null;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      const g = this.queueItemGraphics[q][0];
      if (g) {
        g.setAlpha(0.55);
        g.setDepth(100);
        this.dragGraphic = g;
      }
    }
  }

  onPointerMove(pointer) {
    if (!this.draggingPlate || !this.dragGraphic) return;
    this.dragGraphic.x = pointer.x;
    this.dragGraphic.y = pointer.y;
  }

  onPointerUp(pointer) {
    if (!this.draggingPlate || this.gameOver || this.won) {
      this.cancelDragVisual();
      return;
    }

    const dragDist =
      this.dragStartX != null && this.dragStartY != null
        ? Phaser.Math.Distance.Between(
            this.dragStartX,
            this.dragStartY,
            pointer.x,
            pointer.y
          )
        : 0;

    if (dragDist < DRAG_MIN_DIST) {
      this.cancelDragRestore();
      return;
    }

    const phIndex = this.findPlaceholderUnderPointer(pointer);
    if (phIndex < 0) {
      this.cancelDragRestore();
      return;
    }

    let committedPlate = null;
    if (this.dragSource === 'queue') {
      committedPlate = this.queues[this.dragQueueIndex].shift();
    } else if (this.dragSource === 'reserve') {
      committedPlate = this.reserve[this.dragReserveIndex];
      this.reserve[this.dragReserveIndex] = null;
    }

    if (!committedPlate) {
      this.refreshQueueDisplay();
      this.refreshReserveDisplay();
      this.draggingPlate = null;
      this.dragSource = null;
      return;
    }

    if (this.dragGraphic) {
      this.dragGraphic.destroy();
      this.dragGraphic = null;
    }
    this.refreshQueueDisplay();
    this.refreshReserveDisplay();

    const ph = this.placeholders[phIndex];
    ph.plate = {
      color: committedPlate.color,
      capacity: committedPlate.capacity,
      fill: committedPlate.fill ?? 0,
      graphic: null,
    };

    const decor = this.placeholderDecor[phIndex];
    const g = makePlateGraphic(
      this,
      decor.cx,
      decor.cy,
      PLATE_RADIUS_FIELD,
      ph.plate,
      15
    );
    ph.plate.graphic = g;

    this.draggingPlate = null;
    this.dragSource = null;
    this.dragQueueIndex = null;
    this.dragReserveIndex = null;
    this.dragStartX = null;
    this.dragStartY = null;

    this.resolvePlateGathering(phIndex);
  }

  cancelDragVisual() {
    this.draggingPlate = null;
    this.dragSource = null;
    this.dragQueueIndex = null;
    this.dragReserveIndex = null;
    this.dragStartX = null;
    this.dragStartY = null;
    if (this.dragGraphic) {
      this.dragGraphic = null;
    }
  }

  cancelDragRestore() {
    if (this.dragGraphic) {
      if (this.dragSource === 'queue' && this.dragQueueIndex != null) {
        const pos = this.getQueueSlotPosition(this.dragQueueIndex, 0);
        this.dragGraphic.setPosition(pos.x, pos.y);
        this.dragGraphic.setAlpha(1);
        this.dragGraphic.setDepth(8);
      } else if (this.dragSource === 'reserve' && this.dragReserveIndex != null) {
        const slot = this.reserveSlotRects[this.dragReserveIndex];
        this.dragGraphic.setPosition(slot.x, slot.y);
        this.dragGraphic.setAlpha(1);
        this.dragGraphic.setDepth(9);
      }
    }
    this.refreshQueueDisplay();
    this.refreshReserveDisplay();
    this.draggingPlate = null;
    this.dragSource = null;
    this.dragQueueIndex = null;
    this.dragReserveIndex = null;
    this.dragStartX = null;
    this.dragStartY = null;
    this.dragGraphic = null;
  }

  redrawPlaceholderPlate(plate) {
    const redraw = plate.graphic?.getData('redraw');
    if (redraw) {
      plate.graphic.setData('plateRef', plate);
      redraw();
    }
  }

  resolvePlateGathering(phIndex) {
    const ph = this.placeholders[phIndex];
    const plate = ph.plate;
    if (!plate) return;

    this.processing = true;

    const decor = this.placeholderDecor[phIndex];
    const targetX = decor.cx;
    const targetY = decor.cy;

    const finishFull = () => {
      if (!plate.graphic) {
        ph.plate = null;
        this.processing = false;
        this.checkWin();
        return;
      }
      this.tweens.killTweensOf(plate.graphic);
      plate.graphic.setScale(1);
      this.tweens.add({
        targets: plate.graphic,
        scaleX: 0.06,
        scaleY: 0.06,
        alpha: 0,
        duration: PLATE_FULL_EXIT_DURATION_MS,
        ease: 'Power2.In',
        onComplete: () => {
          plate.graphic.destroy();
          ph.plate = null;
          this.processing = false;
          this.checkWin();
        },
      });
    };

    const finishReserve = () => {
      const emptyReserve = this.reserve.findIndex((s) => s === null);
      if (emptyReserve < 0) {
        this.processing = false;
        this.showGameOver('Reserve full!');
        return;
      }
      const saved = {
        color: plate.color,
        capacity: plate.capacity,
        fill: plate.fill,
      };
      const slot = this.reserveSlotRects[emptyReserve];
      const scaleTo = PLATE_RADIUS_QUEUE_DISPLAY / PLATE_RADIUS_FIELD;

      if (!plate.graphic) {
        ph.plate = null;
        this.reserve[emptyReserve] = saved;
        this.refreshReserveDisplay();
        this.processing = false;
        this.checkWin();
        return;
      }

      this.tweens.killTweensOf(plate.graphic);
      plate.graphic.setScale(1);
      this.tweens.add({
        targets: plate.graphic,
        x: slot.x,
        y: slot.y,
        scaleX: scaleTo,
        scaleY: scaleTo,
        duration: RESERVE_MOVE_DURATION_MS,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.reserve[emptyReserve] = saved;
          ph.plate = null;
          if (slot.graphic && slot.graphic !== plate.graphic) slot.graphic.destroy();
          slot.graphic = plate.graphic;
          plate.graphic.setAlpha(1);
          plate.graphic.setDepth(9);
          this.processing = false;
          this.checkWin();
        },
      });
    };

    const runGatherWave = () => {
      if (plate.fill >= plate.capacity) {
        finishFull();
        return;
      }

      const footprint = getPlaceholderFootprint(ph.anchorR, ph.anchorC);
      const reachable = findReachableCakeCells(
        this.grid,
        plate.color,
        footprint,
        GRID_ROWS,
        GRID_COLS
      );
      if (reachable.length === 0) {
        finishReserve();
        return;
      }

      const need = plate.capacity - plate.fill;
      const cellsToTake = reachable.slice(0, need);

      const valid = [];
      for (const [r, c] of cellsToTake) {
        const cell = this.grid[r][c];
        if (cell && cell.type === 'cake' && cell.color === plate.color) {
          valid.push([r, c]);
        }
      }

      if (valid.length === 0) {
        runGatherWave();
        return;
      }

      let pending = valid.length;

      const onWaveFinished = () => {
        this.runSandGravitySettled(() => {
          this.time.delayedCall(GATHER_BATCH_SETTLE_MS, () => {
            if (!ph.plate || this.gameOver || this.won) return;
            if (plate.fill >= plate.capacity) {
              finishFull();
            } else {
              runGatherWave();
            }
          });
        });
      };

      for (const [r, c] of valid) {
        const cell = this.grid[r][c];
        this.cellDisplays[r][c].setVisible(false);
        const flyer = this.createCakeFlyerGraphic(r, c, cell.color);

        const land = () => {
          flyer.destroy();
          this.grid[r][c] = null;
          this.refreshCakeCell(r, c);
          plate.fill += 1;
          this.redrawPlaceholderPlate(plate);
          this.pulsePlateGraphic(plate.graphic);

          pending -= 1;
          if (pending !== 0) return;
          onWaveFinished();
        };

        const path = findPathFromCakeToFootprint(
          this.grid,
          plate.color,
          r,
          c,
          footprint,
          GRID_ROWS,
          GRID_COLS
        );

        if (path && path.length >= 1) {
          this.tweenFlyerAlongPath(flyer, path, targetX, targetY, land);
        } else {
          this.tweens.killTweensOf(flyer);
          this.lockCakeFlyerVisual(flyer);
          const fx = flyer.x;
          const fy = flyer.y;
          const dist = Phaser.Math.Distance.Between(fx, fy, targetX, targetY);
          const duration = durationForDistancePx(dist);
          const prog = { u: 0 };
          this.tweens.add({
            targets: prog,
            u: 1,
            duration,
            ease: 'Cubic.Out',
            onUpdate: () => {
              flyer.setPosition(
                fx + (targetX - fx) * prog.u,
                fy + (targetY - fy) * prog.u
              );
              this.lockCakeFlyerVisual(flyer);
            },
            onComplete: land,
          });
        }
      }
    };

    runGatherWave();
  }

  checkWin() {
    if (this.gameOver || this.won) return;
    if (this.countCakePieces() === 0) {
      this.won = true;
      const { width, height } = this.cameras.main;
      this.add
        .rectangle(width / 2, height / 2, width, height, 0x000000, 0.55)
        .setScrollFactor(0)
        .setDepth(200);
      this.add
        .text(width / 2, height / 2, 'You Win!\nAll cake cleared.', {
          fontSize: '36px',
          color: '#ffffff',
          fontFamily: 'sans-serif',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(201);
    }
  }

  showGameOver(msg) {
    if (this.gameOver) return;
    this.gameOver = true;
    const { width, height } = this.cameras.main;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x000000, 0.6)
      .setScrollFactor(0)
      .setDepth(200);
    this.add
      .text(width / 2, height / 2, `Game Over\n${msg}`, {
        fontSize: '32px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
  }
}
