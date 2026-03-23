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

/** Queue + reserve band vs original (0.7 ≈ 30% smaller plates/slots → larger field). */
const QUEUE_RESERVE_LAYOUT_SCALE = 0.7;

/** Reserve + scale ratio when moving field plate → reserve (layout size). */
const PLATE_RADIUS_QUEUE = 28 * QUEUE_RESERVE_LAYOUT_SCALE;
/** Queue column visuals only (2× larger; may extend past slot box). */
const PLATE_RADIUS_QUEUE_DISPLAY = PLATE_RADIUS_QUEUE * 2;
/** Queue grid cell (row step + slot rect); fits display diameter + margin. */
const QUEUE_SLOT_SIZE = Math.ceil(
  PLATE_RADIUS_QUEUE_DISPLAY * 2 + 20 * QUEUE_RESERVE_LAYOUT_SCALE
);
/** Horizontal gap between queue columns (also used between reserve slots). */
const QUEUE_COLUMN_GAP = Math.max(4, Math.round(28 * QUEUE_RESERVE_LAYOUT_SCALE));
/** Minimum reserve slot width when shrinking to fit screen (scales with band). */
const RESERVE_SLOT_MIN = Math.max(68, Math.round(96 * QUEUE_RESERVE_LAYOUT_SCALE));
const PLATE_RADIUS_FIELD = Math.min(36, PLACEHOLDER_SIZE * 8);
const DRAG_MIN_DIST = 20;

/** Flyer travel speed in pixels per second (all path segments and straight fallback) */
const CAKE_FLY_SPEED_PX_PER_SEC = 640;
/** Vertical settle after gather (sand); a bit slower than flight */
const CAKE_GRAVITY_SPEED_PX_PER_SEC = 420;
/** Floor so very short segments are still visible */
const CAKE_FLY_MIN_SEGMENT_MS = 26;
/** Pause after the last piece in a wave lands before next wave or plate exit */
const GATHER_BATCH_SETTLE_MS = 0;

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
const PLATE_PULSE_DURATION_MS = 200;
/** Yoyo pulse = scale up then back; must finish before full-plate exit tween. */
const PLATE_PULSE_FULL_CYCLE_MS = PLATE_PULSE_DURATION_MS * 2;

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
/** Pause on a full plate so the filled state reads before shrink/fade. */
const PLATE_FULL_HOLD_BEFORE_EXIT_MS = 0;
/** Full plate: slime slides in from screen edge, cake flies into the blob, exits up/down. */
const SLIME_ENTER_MS = 300;
const SLIME_EXIT_MS = 300;
/** Gap between field border and monster silhouette (px). */
const SLIME_FIELD_MARGIN = 22;
const SLIME_OFFSCREEN_PAD = 100;
/** Consume: overshoot then settle; monster stays at settle scale until exit. */
const SLIME_CONSUME_PEAK_SCALE = 1.25;
const SLIME_CONSUME_SETTLE_SCALE = 1.14;
const SLIME_CONSUME_BULGE_UP_MS = 220;
const SLIME_CONSUME_BULGE_DOWN_MS = 200;
/** Body scale (px); silhouette is built around this “unit”. */
const SLIME_DRAW_UNIT = 80;
/** Horizontal half-extent of silhouette for placement vs field (px). */
const SLIME_BOUNDS_HALF_W = Math.round(SLIME_DRAW_UNIT * 0.68);

/** Plate flies to monster container origin (blob center). */
function getSlimeAbsorbLocal() {
  return { x: 0, y: 0 };
}

function blendRgbHex(fromHex, toHex, t) {
  const ar = (fromHex >> 16) & 0xff;
  const ag = (fromHex >> 8) & 0xff;
  const ab = fromHex & 0xff;
  const br = (toHex >> 16) & 0xff;
  const bg = (toHex >> 8) & 0xff;
  const bb = toHex & 0xff;
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const b = Math.round(ab * (1 - t) + bb * t);
  return Phaser.Display.Color.GetColor(r, g, b);
}

function liftTowardWhite(hex, t) {
  return blendRgbHex(hex, 0xffffff, Phaser.Math.Clamp(t, 0, 1));
}

/** Green plates: blend from green jelly base. Others: blend from neutral + bright plate (avoids muddy brown). */
function isGreenishPlate(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return g > r + 12 && g > b + 12;
}

/** Jelly colors: green slime + plate tint, or vivid neutral-based tint for red/blue/purple/yellow. */
function slimePaletteFromPlate(plateHex) {
  if (isGreenishPlate(plateHex)) {
    return {
      limeHi: blendRgbHex(0x9fff95, plateHex, 0.52),
      limeTop: blendRgbHex(0x7bed7a, plateHex, 0.5),
      limeMid: blendRgbHex(0x52d868, plateHex, 0.58),
      limeDark: blendRgbHex(0x2a6040, plateHex, 0.52),
      iris: blendRgbHex(0x8ef4a0, plateHex, 0.48),
    };
  }

  const bright = liftTowardWhite(plateHex, 0.32);
  const vivid = liftTowardWhite(plateHex, 0.1);
  return {
    limeHi: blendRgbHex(0xffffff, bright, 0.78),
    limeTop: blendRgbHex(0xf3f3f5, bright, 0.74),
    limeMid: blendRgbHex(0xe4e4e8, vivid, 0.78),
    limeDark: blendRgbHex(0x2c2438, plateHex, 0.52),
    iris: blendRgbHex(0xf5f5ff, bright, 0.72),
  };
}

/**
 * Glossy teardrop slime tinted toward the plate color (wide base, drips, no mouth).
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} phase jelly wobble time
 * @param {number} facing +1 “front” toward +X, −1 toward −X
 * @param {number} plateHex plate color (0xRRGGBB)
 */
function drawSlimeMonster(g, phase, facing, plateHex) {
  g.clear();
  const S = SLIME_DRAW_UNIT;
  const fx = (x) => x * facing;

  const { limeHi, limeTop, limeMid, limeDark, iris } = slimePaletteFromPlate(plateHex);

  /**
   * Closed outline: firm base, soft top. `softTop` = 0 bottom → 1 top.
   * Top-originated pulse: phase + vert*spatial creates waves that run apex → downward.
   */
  const buildOutline = () => {
    const pts = [];
    const n = 68;
    const lean = 0.04 * S * Math.sin(phase * 0.55);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const vert = Math.sin(a);
      const horiz = Math.cos(a);
      const bulge = 0.5 + 0.32 * Math.max(0, vert) * 0.95;
      const softTop = Math.pow(Phaser.Math.Clamp((1 - vert) / 2, 0, 1), 0.82);
      const rawJelly =
        0.075 * Math.sin(a * 4 + phase) +
        0.045 * Math.cos(a * 7 + phase * 1.12) +
        0.028 * Math.sin(a * 11 + phase * 0.85);
      // Downward-traveling swell: vert shifts phase so motion reads from top first
      const downWave =
        0.04 * Math.sin(phase * 1.55 + vert * 2.95 + horiz * 0.55) +
        0.026 * Math.sin(phase * 2.05 - vert * 2.4 + a * 2.5);
      // Apex “breath” — strongest on crown, fades before base
      const apexPulse = 0.045 * Math.sin(phase * 1.28) * softTop * softTop;
      const pulsePack = (downWave + apexPulse) * softTop;
      const wobble = 1 + rawJelly * softTop + pulsePack;
      const asymSwing = 0.06 * Math.sin(phase * 0.65) * Math.sin(a * 2);
      const asym = 1 + asymSwing * (0.18 + 0.82 * softTop);
      const rx = S * bulge * wobble * asym * 0.9;
      const ry = S * 0.52 * wobble * (0.94 + 0.06 * Math.abs(horiz));
      const leanMix = 0.28 + 0.72 * softTop;
      let x = horiz * rx + lean * leanMix;
      const topBob = 0.045 * S * Math.sin(phase * 0.45) * softTop;
      const pulseBob = 0.018 * S * Math.sin(phase * 1.35 + vert * 1.8) * softTop * softTop;
      let y = vert * ry * 1.06 + topBob + pulseBob;
      pts.push({ x: fx(x), y });
    }
    return pts;
  };

  const outline = buildOutline();

  // Main gel body
  g.fillStyle(limeMid, 0.98);
  g.beginPath();
  g.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) g.lineTo(outline[i].x, outline[i].y);
  g.closePath();
  g.fillPath();

  // Lighter core: upper dome pulses from top (apex leads, lower core follows slightly)
  const coreJiggle = 0.012 * S * Math.sin(phase * 0.9);
  const topCorePulse = 0.02 * S * Math.sin(phase * 1.38);
  g.fillStyle(limeHi, 0.38);
  g.fillEllipse(fx(-0.06 * S), 0.02 * S + coreJiggle * 0.25 + topCorePulse * 0.2, S * 0.42, S * 0.48);
  g.fillStyle(limeTop, 0.32);
  g.fillEllipse(fx(0.08 * S), -0.18 * S + coreJiggle + topCorePulse, S * 0.38, S * 0.42);

  // Hanging drips — firm base: small motion only (heavy gel sitting on ground)
  const dripXs = [-0.38, -0.22, -0.05, 0.12, 0.28, 0.4];
  for (let i = 0; i < dripXs.length; i++) {
    const dx = dripXs[i] * S;
    const hang = 0.022 * S * Math.sin(phase * 1.3 + i * 0.9);
    const baseY = 0.38 * S + 0.008 * S * Math.sin(phase + i);
    g.fillStyle(limeTop, 0.55);
    g.fillEllipse(fx(dx), baseY + hang * 0.5, 11 + (i % 2) * 4, 14 + hang);
    g.fillStyle(limeHi, 0.45);
    g.fillEllipse(fx(dx * 0.96), baseY + hang * 0.6, 6, 10 + hang * 0.5);
  }

  // Speculars: tied to apex pulse (same phase family as topCorePulse)
  const glossY = 0.012 * S * Math.sin(phase * 1.38) + 0.006 * S * Math.sin(phase * 1.05);
  g.fillStyle(0xffffff, 0.62);
  g.fillEllipse(fx(-0.26 * S), -0.42 * S + glossY, S * 0.2, S * 0.12);
  g.fillStyle(0xffffff, 0.38);
  g.fillEllipse(fx(-0.18 * S), -0.28 * S + glossY * 1.2, S * 0.14, S * 0.22);
  g.fillStyle(0xffffff, 0.55);
  g.fillEllipse(fx(0.2 * S), -0.5 * S + glossY, S * 0.1, S * 0.06);
  g.fillStyle(0xffffff, 0.95);
  g.fillEllipse(fx(-0.32 * S), -0.55 * S + glossY, S * 0.06, S * 0.04);
  g.fillEllipse(fx(0.08 * S), -0.62 * S + glossY, S * 0.05, S * 0.035);

  // Contour stroke
  g.lineStyle(3, limeDark, 0.88);
  g.beginPath();
  g.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) g.lineTo(outline[i].x, outline[i].y);
  g.closePath();
  g.strokePath();

  // Eyes: large iris tinted toward plate (no mouth)
  const eyeX = 0.22 * S;
  const eyeY = -0.42 * S + 0.012 * S * Math.sin(phase * 1.4);
  const scl = S * 0.14;
  g.fillStyle(0xffffff, 1);
  g.fillCircle(fx(-eyeX), eyeY, scl);
  g.fillCircle(fx(eyeX), eyeY, scl);
  g.fillStyle(iris, 1);
  g.fillCircle(fx(-eyeX + 0.018 * S * facing), eyeY + 0.008 * S, scl * 0.62);
  g.fillCircle(fx(eyeX + 0.018 * S * facing), eyeY + 0.008 * S, scl * 0.62);
  g.fillStyle(0x0f1f14, 1);
  g.fillCircle(fx(-eyeX + 0.028 * S * facing), eyeY + 0.018 * S, scl * 0.32);
  g.fillCircle(fx(eyeX + 0.028 * S * facing), eyeY + 0.018 * S, scl * 0.32);
  g.fillStyle(0xffffff, 0.92);
  g.fillCircle(fx(-eyeX - 0.045 * S * facing), eyeY - 0.045 * S, scl * 0.14);
  g.fillCircle(fx(eyeX - 0.045 * S * facing), eyeY - 0.045 * S, scl * 0.14);
}

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
    /** Alternates which screen edge the full-plate slime enters from (see playFullPlateSlimeDevour). */
    this._slimeNextFromLeft = Math.random() < 0.5;

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

    /** Smaller queue/reserve pulls bottom band up so the field uses more height. */
    this.queueBaseY = height - Math.round(168 / QUEUE_RESERVE_LAYOUT_SCALE);
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
          RESERVE_SLOT_MIN,
          Math.floor(
            (maxBandW - (RESERVE_SLOT_COUNT - 1) * minGap) /
              RESERVE_SLOT_COUNT
          )
        );
        rg = minGap;
      }
      this.reserveGap = rg;
    }
    this.reserveY = this.queueBaseY - Math.max(
      Math.round(118 * QUEUE_RESERVE_LAYOUT_SCALE),
      this.queueSlotSize + Math.round(52 * QUEUE_RESERVE_LAYOUT_SCALE)
    );
    const fieldTopY = 72;
    const reserveRectH = this.reserveSlotSize - 6;
    const fieldReserveGap = Math.round(28 * QUEUE_RESERVE_LAYOUT_SCALE);
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
   * Full plate: slime enters from left/right (outside field), plate flies to center,
   * consume scale-up, then escapes straight up or down off-screen.
   */
  playFullPlateSlimeDevour(ph, plate) {
    const plateG = plate.graphic;
    if (!plateG || !plateG.scene) {
      ph.plate = null;
      this.processing = false;
      this.checkWin();
      return;
    }

    const wx = plateG.x;
    const wy = plateG.y;
    const cam = this.cameras.main;
    const fieldX = this.fieldX;
    const fieldW = this.fieldW;

    const fromLeft = this._slimeNextFromLeft;
    this._slimeNextFromLeft = !this._slimeNextFromLeft;
    const facing = fromLeft ? 1 : -1;
    const plateHex = COLORS[plate.color] ?? 0x888888;
    const restX = fromLeft
      ? fieldX - SLIME_FIELD_MARGIN - SLIME_BOUNDS_HALF_W
      : fieldX + fieldW + SLIME_FIELD_MARGIN + SLIME_BOUNDS_HALF_W;
    const startX = fromLeft
      ? -SLIME_BOUNDS_HALF_W - SLIME_OFFSCREEN_PAD
      : cam.width + SLIME_BOUNDS_HALF_W + SLIME_OFFSCREEN_PAD;

    this.tweens.killTweensOf(plateG);
    plateG.setScale(1);
    plateG.setAlpha(1);
    plateG.setDepth(141);

    const monster = this.add.container(startX, wy);
    monster.setDepth(140);

    const slimeG = this.add.graphics();
    drawSlimeMonster(slimeG, 0, facing, plateHex);
    /** Translucent jelly so the plate/cake stays visible underneath. */
    slimeG.setAlpha(0.58);
    monster.add(slimeG);

    const phase = { v: 0 };
    const onJelly = () => {
      if (!monster.active || !slimeG.active) return;
      phase.v += 0.048;
      drawSlimeMonster(slimeG, phase.v, facing, plateHex);
    };
    this.events.on('update', onJelly);
    monster.setData('slimeJellyUpdate', onJelly);

    const finish = () => {
      const fn = monster.getData('slimeJellyUpdate');
      if (fn) this.events.off('update', fn);
      if (monster.scene) monster.destroy();
      ph.plate = null;
      this.processing = false;
      this.checkWin();
    };

    const absorbLocal = getSlimeAbsorbLocal();
    const absorbWorldX = restX + absorbLocal.x;
    const absorbWorldY = wy + absorbLocal.y;

    const flyDist = Phaser.Math.Distance.Between(wx, wy, absorbWorldX, absorbWorldY);
    const flyMs = Phaser.Math.Clamp(
      (flyDist / CAKE_FLY_SPEED_PX_PER_SEC) * 1000,
      320,
      920
    )*0.7;

    const runExit = () => {
      if (!monster.scene) return;
      const exitUp = Phaser.Math.Between(0, 1) === 0;
      const exitY = exitUp
        ? -SLIME_DRAW_UNIT * 1.4 - SLIME_OFFSCREEN_PAD
        : cam.height + SLIME_DRAW_UNIT * 1.4 + SLIME_OFFSCREEN_PAD;

      this.tweens.add({
        targets: monster,
        y: exitY,
        x: monster.x + Phaser.Math.Between(-28, 28),
        alpha: 0,
        duration: SLIME_EXIT_MS,
        ease: 'Cubic.In',
        onComplete: finish,
      });
    };

    const afterPlateArrives = () => {
      if (!monster.scene || !plateG.scene) {
        finish();
        return;
      }
      monster.addAt(plateG, 0);
      plateG.setPosition(absorbLocal.x, absorbLocal.y);
      plateG.setScale(1);
      plateG.setAlpha(1);
      monster.setScale(1);
      this.tweens.add({
        targets: monster,
        scaleX: SLIME_CONSUME_PEAK_SCALE,
        scaleY: SLIME_CONSUME_PEAK_SCALE,
        duration: SLIME_CONSUME_BULGE_UP_MS,
        ease: 'Cubic.Out',
        onComplete: () => {
          if (!monster.scene) return;
          this.tweens.add({
            targets: monster,
            scaleX: SLIME_CONSUME_SETTLE_SCALE,
            scaleY: SLIME_CONSUME_SETTLE_SCALE,
            duration: SLIME_CONSUME_BULGE_DOWN_MS,
            ease: 'Quad.Out',
            onComplete: () => {
              if (!monster.scene) return;
              this.time.delayedCall(90, runExit);
            },
          });
        },
      });
    };

    this.tweens.add({
      targets: monster,
      x: restX,
      duration: SLIME_ENTER_MS,
      ease: 'Cubic.Out',
      onComplete: () => {
        if (!monster.scene || !plateG.scene) {
          finish();
          return;
        }
        this.tweens.add({
          targets: plateG,
          x: absorbWorldX,
          y: absorbWorldY,
          duration: flyMs,
          ease: 'Cubic.In',
          onComplete: afterPlateArrives,
        });
      },
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
      // Single completion pulse here (land() skips pulse when fill reaches capacity).
      // Order: full yoyo pulse → hold → slime monster engulfs and escapes.
      this.pulsePlateGraphic(plate.graphic);
      const waitMs = PLATE_PULSE_FULL_CYCLE_MS + PLATE_FULL_HOLD_BEFORE_EXIT_MS;
      this.time.delayedCall(waitMs, () => {
        if (!ph.plate || !plate.graphic?.scene) {
          this.processing = false;
          this.checkWin();
          return;
        }
        this.playFullPlateSlimeDevour(ph, plate);
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
        if (!ph.plate || this.gameOver || this.won) return;
        if (plate.fill >= plate.capacity) {
          // Sand updates grid + runs in parallel; full-plate exit does not wait for it.
          this.runSandGravitySettled(() => {});
          finishFull();
          return;
        }
        this.runSandGravitySettled(() => {
          if (!ph.plate || this.gameOver || this.won) return;
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
          if (plate.fill < plate.capacity) {
            this.pulsePlateGraphic(plate.graphic);
          }

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
