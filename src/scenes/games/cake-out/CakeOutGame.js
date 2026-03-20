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
import { buildInitialGrid, PLACEHOLDER_ANCHORS, getPlaceholderFootprint } from './LevelData.js';
import { generateBalancedPlateQueues } from './PlateGenerator.js';
import { findReachableCakeCells, findPathFromCakeToFootprint } from './Reachability.js';

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
/** Floor so very short segments are still visible */
const CAKE_FLY_MIN_SEGMENT_MS = 26;
/** Pause after the last piece in a wave lands before next wave or plate exit */
const GATHER_BATCH_SETTLE_MS = 260;

function durationForDistancePx(distPx) {
  const ms = (distPx / CAKE_FLY_SPEED_PX_PER_SEC) * 1000;
  return Math.max(CAKE_FLY_MIN_SEGMENT_MS, Math.round(ms));
}
const PLATE_PULSE_SCALE = 1.14;
const PLATE_PULSE_DURATION_MS = 500;
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

  preload() {}

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

    this.cellDisplays = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      this.cellDisplays[r] = [];
      for (let c = 0; c < GRID_COLS; c++) {
        const cx = this.fieldX + (c + 0.5) * this.cellSize;
        const cy = this.fieldY + (r + 0.5) * this.cellSize;
        const rect = this.add
          .rectangle(cx, cy, this.cellSize - 1, this.cellSize - 1, 0xcccccc, 0)
          .setStrokeStyle(0, 0x000000, 0)
          .setDepth(2);
        this.cellDisplays[r][c] = rect;
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
      const w = PLACEHOLDER_SIZE * this.cellSize - 4;
      const h = PLACEHOLDER_SIZE * this.cellSize - 4;
      const decor = this.add
        .ellipse(cx, cy, w * 0.92, h * 0.92, 0xd0d8dc, 0.55)
        .setStrokeStyle(2, 0xa8b4bc);
      decor.setDepth(2);
      this.placeholderDecor.push({
        ph,
        cx,
        cy,
        w,
        h,
        hitRect: new Phaser.Geom.Rectangle(
          this.fieldX + ph.anchorC * this.cellSize,
          this.fieldY + ph.anchorR * this.cellSize,
          PLACEHOLDER_SIZE * this.cellSize,
          PLACEHOLDER_SIZE * this.cellSize
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
    disp.setVisible(true);
    const cell = this.grid[r][c];
    if (!cell || cell.type !== 'cake') {
      disp.setFillStyle(0xcccccc, 0);
      disp.setStrokeStyle(0, 0x000000, 0);
    } else {
      const hex = COLORS[cell.color] ?? 0x888888;
      disp.setFillStyle(hex, 1);
      disp.setStrokeStyle(1, 0x333333, 0.35);
    }
  }

  /** Single wedge-shaped flyer for gather animation (world space). */
  createCakeFlyerGraphic(r, c, colorKey) {
    const cx = this.fieldX + (c + 0.5) * this.cellSize;
    const cy = this.fieldY + (r + 0.5) * this.cellSize;
    const hex = COLORS[colorKey] ?? 0x888888;
    const g = this.add.graphics();
    g.setPosition(cx, cy);
    const s = this.cellSize * 0.4;
    g.fillStyle(hex, 1);
    g.lineStyle(1, 0x222222, 0.45);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.9, s * 0.75);
    g.lineTo(-s * 0.9, s * 0.75);
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.setDepth(120);
    g.setScale(1);
    return g;
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
   * @param {Phaser.GameObjects.Graphics} flyer
   * @param {Array<[number, number]>} pathRowCol from findPathFromCakeToFootprint (inclusive)
   */
  tweenFlyerAlongPath(flyer, pathRowCol, targetX, targetY, onLand) {
    const pts = pathRowCol.map(([r, c]) => ({
      x: this.fieldX + (c + 0.5) * this.cellSize,
      y: this.fieldY + (r + 0.5) * this.cellSize,
    }));
    pts.push({ x: targetX, y: targetY });

    const step = (i) => {
      if (i >= pts.length - 1) {
        onLand();
        return;
      }
      const lastSeg = i === pts.length - 2;
      const from = pts[i];
      const to = pts[i + 1];
      const dist = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
      const duration = durationForDistancePx(dist);
      this.tweens.add({
        targets: flyer,
        x: to.x,
        y: to.y,
        ...(lastSeg
          ? { scale: 0.28, alpha: 0.2 }
          : { scale: 1, alpha: 1 }),
        duration,
        ease: lastSeg ? 'Cubic.In' : 'Linear',
        onComplete: () => step(i + 1),
      });
    };
    step(0);
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
        this.time.delayedCall(GATHER_BATCH_SETTLE_MS, () => {
          if (!ph.plate || this.gameOver || this.won) return;
          if (plate.fill >= plate.capacity) {
            finishFull();
          } else {
            runGatherWave();
          }
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
          const dist = Phaser.Math.Distance.Between(flyer.x, flyer.y, targetX, targetY);
          const duration = durationForDistancePx(dist);
          this.tweens.add({
            targets: flyer,
            x: targetX,
            y: targetY,
            scale: 0.28,
            alpha: 0.2,
            duration,
            ease: 'Cubic.Out',
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
