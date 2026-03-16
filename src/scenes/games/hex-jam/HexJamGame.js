import Phaser from '../../../lib/phaser.js';
import {
  GRID_COLS, GRID_ROWS, HEX_SIZE,
  QUEUE_ENABLED, QUEUE_COLS,
  COLORS, COLOR_KEYS, COLOR_HIDDEN,
  START_COL, START_ROW,
  GRID_ORIGIN_X, GRID_ORIGIN_Y,
  QUEUE_ORIGIN_Y, UNIT_RADIUS,
  SNAKE_ORIGIN_X, QUEUE_SNAKE_Y, SNAKE_SPACING_X, SNAKE_SPACING_Y,
  LEVEL_SEED,
} from './GameConfig.js';
import { hexToPixel, getNeighbors, getHexPoints, hexKey } from './HexGrid.js';
import { generateLevel } from './LevelGenerator.js';

// Cached hex vertex array — reused every draw call
const HEX_PTS = getHexPoints(HEX_SIZE);

export default class HexJamGame extends Phaser.Scene {
  constructor() {
    super({ key: 'HexJamGame' });
  }

  create() {
    this.cameras.main.setBackgroundColor('#0d1b2a');

    // Back button
    this.add.text(40, 28, '← Back', { fontSize: '20px', color: '#7a8fa0' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { window.location.href = 'index.html'; });

    // Title
    this.add.text(360, 28, 'HEX JAM', {
      fontSize: '30px', fontStyle: 'bold', color: '#f1c40f',
      stroke: '#8b6914', strokeThickness: 2,
    }).setOrigin(0.5, 0);

    // Generate level data
    const { hexColors, queue } = generateLevel(GRID_COLS, GRID_ROWS, COLOR_KEYS, START_COL, START_ROW, LEVEL_SEED);
    this.hexColors = hexColors;
    this.queueData = queue;

    // Game state
    this.hexes     = new Map();   // hexKey → { col, row, color, state }
    this.queueCircles = [];       // Phaser circle objects, one per queue unit
    this.usedSet   = new Set();   // indices of consumed queue units
    this.hoveredKey   = null;
    this.processing   = false;
    this.gameOver     = false;
    this.placedCount  = 0;
    this.totalHexes   = GRID_COLS * GRID_ROWS;

    // Rendering layers (lower depth = behind)
    this.hexGraphics  = this.add.graphics().setDepth(1);
    this.glowGraphics = this.add.graphics().setDepth(2);

    // Build scenes
    this.initHexData();
    this.setupGridInput();
    this.buildQueueSnake();

    // Score label — sits between grid bottom and the queue panel
    this.scoreText = this.add.text(360, 824, '', {
      fontSize: '17px', color: '#566e80',
    }).setOrigin(0.5);

    // Auto-activate starting hex by consuming one matching queue unit
    const startHex = this.hexes.get(hexKey(START_COL, START_ROW));
    const initIdx = this.findFirstColor(startHex.color);
    if (initIdx !== -1) {
      this.usedSet.add(initIdx);
      this.queueCircles[initIdx].setAlpha(0);
    }
    this.activateHex(START_COL, START_ROW);
    this.setQueueCompactPositions();  // instant compaction — no animation at start
    this.updateEnabledVisuals();
    this.updateScoreText();
  }

  update() {
    if (!this.gameOver) this.drawGlowLayer();
  }

  // ── Hex grid data ──────────────────────────────────────────────────────────

  initHexData() {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const key = hexKey(c, r);
        this.hexes.set(key, {
          col: c, row: r,
          color: this.hexColors.get(key),
          state: 'hidden',
        });
      }
    }
    this.drawHexGrid();
  }

  // ── Pointer input ──────────────────────────────────────────────────────────

  setupGridInput() {
    const zone = this.add.zone(0, 0, 720, 1280).setOrigin(0).setDepth(5);
    zone.setInteractive();
    zone.on('pointerdown',  (ptr) => this.onGridDown(ptr.x, ptr.y));
    zone.on('pointermove',  (ptr) => this.onGridMove(ptr.x, ptr.y));
    zone.on('pointerout',   ()    => { this.hoveredKey = null; });
  }

  /** Return the interactable hex under pixel (px, py), or null. */
  hexAtPoint(px, py) {
    let best = null;
    let bestDist = HEX_SIZE * 0.9; // only accept clicks within 90% of circumradius
    for (const hex of this.hexes.values()) {
      if (hex.state !== 'interactable') continue;
      const { x, y } = hexToPixel(hex.col, hex.row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);
      const d = Math.hypot(px - x, py - y);
      if (d < bestDist) { best = hex; bestDist = d; }
    }
    return best;
  }

  onGridDown(px, py) {
    if (this.processing || this.gameOver) return;
    const hex = this.hexAtPoint(px, py);
    if (hex) this.onHexClick(hex.col, hex.row);
  }

  onGridMove(px, py) {
    const hex = this.hexAtPoint(px, py);
    this.hoveredKey = hex ? hexKey(hex.col, hex.row) : null;
  }

  // ── Queue snake ────────────────────────────────────────────────────────────

  buildQueueSnake() {
    const slotW   = 720 / QUEUE_ENABLED;   // 144px per slot
    const slotH   = UNIT_RADIUS * 2 + 24;  // 116px tall
    const slotMidY = QUEUE_ORIGIN_Y;

    // ── Slot zone: 5 bordered compartments with clear contrast ───────────────
    this.add.rectangle(360, slotMidY, 720, slotH, 0x0e2236, 1)
      .setStrokeStyle(2, 0x3d7ca8)
      .setDepth(0);

    // Dividing lines between slots
    const dividers = this.add.graphics().setDepth(1);
    dividers.lineStyle(2, 0x3d7ca8, 0.7);
    for (let i = 1; i < QUEUE_ENABLED; i++) {
      const lx = Math.round(slotW * i);
      dividers.lineBetween(lx, slotMidY - slotH / 2, lx, slotMidY + slotH / 2);
    }

    // Label above slots
    this.add.text(360, slotMidY - slotH / 2 - 16, 'QUEUE', {
      fontSize: '13px', color: '#5a9ac0', letterSpacing: 4,
    }).setOrigin(0.5);

    // ── Gap + Snake zone: tight chain, extends off-screen ────────────────────
    const slotBottom  = slotMidY + slotH / 2;
    const snakeTop    = slotBottom + 18;          // 18px visible gap after slots
    const snakePanelH = 1280 - snakeTop;
    this.add.rectangle(360, snakeTop + snakePanelH / 2, 720, snakePanelH, 0x1a2a36, 1)
      .setDepth(0);

    // ── Snake path guide lines ────────────────────────────────────────────────
    this.drawSnakePath();

    // ── Circles ───────────────────────────────────────────────────────────────
    for (let i = 0; i < this.queueData.length; i++) {
      const { x, y } = this.getQueueUnitPos(i);
      const circle = this.add.circle(x, y, UNIT_RADIUS, COLORS[this.queueData[i]]).setDepth(3);
      circle.setAlpha(1.0);
      this.queueCircles.push(circle);
    }
  }

  /**
   * Draw the snake trajectory lines (the "track" the snake travels through).
   * For each gap between consecutive rows: two horizontal rails + one vertical
   * connector at the turning edge.  Drawn at depth 2 (above panel, below circles).
   */
  /**
   * Draw the snake trajectory lines.
   * Only short "cap" segments are drawn at each turning corner so the lines
   * never cut through the circles in the middle of a row.
   *
   *   right turn:          left turn:
   *        ────|                |────
   *            |                |
   *        ────|                |────
   */
  drawSnakePath() {
    const totalSnake = this.queueData.length - QUEUE_ENABLED;
    if (totalSnake <= 0) return;
    const numRows = Math.ceil(totalSnake / (QUEUE_COLS + 1));

    // Drawn at depth 4 (above circles) so caps are always visible even when
    // the circles fill the full canvas width.
    const g   = this.add.graphics().setDepth(4);
    const pad = 4;
    const lx  = SNAKE_ORIGIN_X - UNIT_RADIUS - pad;
    const rx  = SNAKE_ORIGIN_X + (QUEUE_COLS - 1) * SNAKE_SPACING_X + UNIT_RADIUS + pad;

    const gap    = UNIT_RADIUS * 2;                          // horizontal gap at the turning corner
    let wallH  = SNAKE_SPACING_Y - UNIT_RADIUS * 2 - pad * 2; // full height of the wall rect
    wallH /= 2;
    // Single full-height rect covering the whole gap between two rows,
    // with a horizontal opening on the turning side for the corner circle.
    const drawWall = (botEdge, gapOnLeft) => {
      const rectY = botEdge + 8*pad;
      if (gapOnLeft) {
        g.fillRect(lx + gap, rectY, rx - lx - gap, wallH);
      } else {
        g.fillRect(lx, rectY, rx - lx - gap, wallH);
      }
    };

    g.fillStyle(0x2a3d4e, 1);

    for (let row = 0; row < numRows - 1; row++) {
      const cy      = QUEUE_SNAKE_Y + row * SNAKE_SPACING_Y;
      drawWall(cy + UNIT_RADIUS, row % 2 === 0);
      // Corner circles are real queue units — no fake fill needed here
    }
  }

  /**
   * Map a compact queue index to a pixel position.
   *   0 – QUEUE_ENABLED-1 → slot zone  (5 wide compartments, full canvas width)
   *   QUEUE_ENABLED+      → snake zone (4px gap between circles, tight chain)
   */
  getQueueUnitPos(compactIdx) {
    if (compactIdx < QUEUE_ENABLED) {
      const slotW = 720 / QUEUE_ENABLED;
      return { x: slotW * compactIdx + slotW / 2, y: QUEUE_ORIGIN_Y };
    }

    // Each snake "segment" = QUEUE_COLS row circles + 1 corner circle
    const segLen = QUEUE_COLS + 1;
    const si     = compactIdx - QUEUE_ENABLED;
    const seg    = Math.floor(si / segLen);
    const pos    = si % segLen;
    const cy     = QUEUE_SNAKE_Y + seg * SNAKE_SPACING_Y;

    if (pos < QUEUE_COLS) {
      // Regular row circle: even segments go R→L, odd go L→R
      const effectiveCol = (seg % 2 === 0) ? (QUEUE_COLS - 1 - pos) : pos;
      return {
        x: SNAKE_ORIGIN_X + effectiveCol * SNAKE_SPACING_X,
        y: cy,
      };
    } else {
      // Corner circle: sits in the wall gap on the turning side
      const pad      = 4;
      const gapLeft  = (seg % 2 === 0); // even segs turn LEFT
      return {
        x: gapLeft
          ? SNAKE_ORIGIN_X - pad                                          // left corner
          : SNAKE_ORIGIN_X + (QUEUE_COLS - 1) * SNAKE_SPACING_X + pad,   // right corner
        y: cy + SNAKE_SPACING_Y / 2,
      };
    }
  }

  /**
   * Immediately teleport all non-used circles to their compact snake positions.
   * Used at game start after the initial hex is auto-activated.
   */
  setQueueCompactPositions() {
    let slot = 0;
    for (let i = 0; i < this.queueData.length; i++) {
      if (this.usedSet.has(i)) continue;
      const { x, y } = this.getQueueUnitPos(slot++);
      this.queueCircles[i].setPosition(x, y);
    }
  }

  /**
   * Slide all non-used circles to their new compact positions after a removal.
   * Only circles that actually need to move receive a tween.
   */
  animateQueueCompaction() {
    let slot = 0;
    for (let i = 0; i < this.queueData.length; i++) {
      if (this.usedSet.has(i)) continue;
      const { x, y } = this.getQueueUnitPos(slot++);
      const circle = this.queueCircles[i];
      if (Math.abs(circle.x - x) > 0.5 || Math.abs(circle.y - y) > 0.5) {
        this.tweens.add({
          targets: circle,
          x, y,
          duration: 220,
          ease: 'Quad.Out',
        });
      }
    }
  }

  // ── Hex rendering (static layer) ──────────────────────────────────────────

  drawHexGrid() {
    this.hexGraphics.clear();

    for (const hex of this.hexes.values()) {
      const { x, y } = hexToPixel(hex.col, hex.row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);

      let fillColor, fillAlpha, strokeColor, strokeAlpha, strokeW;
      switch (hex.state) {
        case 'hidden':
          fillColor = COLOR_HIDDEN; fillAlpha = 1;
          strokeColor = 0x1a3a4a; strokeAlpha = 1; strokeW = 1.5;
          break;
        case 'interactable':
          fillColor = COLORS[hex.color]; fillAlpha = 0.5;
          strokeColor = 0x90aabb; strokeAlpha = 0.5; strokeW = 1.5;
          break;
        default: // 'active'
          fillColor = COLORS[hex.color]; fillAlpha = 1;
          strokeColor = 0xffffff; strokeAlpha = 0.55; strokeW = 2;
          break;
      }

      this.hexGraphics.fillStyle(fillColor, fillAlpha);
      this.hexGraphics.lineStyle(strokeW, strokeColor, strokeAlpha);
      this.drawHexPath(this.hexGraphics, x, y);
      this.hexGraphics.fillPath();
      this.hexGraphics.strokePath();

      // Marker dot in center of active hexes
      if (hex.state === 'active') {
        this.hexGraphics.fillStyle(0xffffff, 0.7);
        this.hexGraphics.fillCircle(x, y, 8);
      }
    }
  }

  // ── Glow layer (updated every frame) ──────────────────────────────────────

  drawGlowLayer() {
    this.glowGraphics.clear();

    const pulse = 0.35 + 0.35 * Math.sin(this.time.now * 0.0025);

    // Pulsing outlines for all interactable hexes
    this.glowGraphics.lineStyle(2.5, 0xffffff, pulse);
    for (const hex of this.hexes.values()) {
      if (hex.state !== 'interactable') continue;
      const { x, y } = hexToPixel(hex.col, hex.row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);
      this.drawHexPath(this.glowGraphics, x, y);
      this.glowGraphics.strokePath();
    }

    // Bright hover highlight on the hex under the cursor
    if (this.hoveredKey) {
      const hex = this.hexes.get(this.hoveredKey);
      if (hex && hex.state === 'interactable') {
        const { x, y } = hexToPixel(hex.col, hex.row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);
        this.glowGraphics.lineStyle(3.5, 0xffffff, 1.0);
        this.drawHexPath(this.glowGraphics, x, y);
        this.glowGraphics.strokePath();
      }
    }
  }

  /** Write a closed hex path at (cx, cy) into a Graphics object. */
  drawHexPath(gfx, cx, cy) {
    gfx.beginPath();
    for (let i = 0; i < HEX_PTS.length; i += 2) {
      if (i === 0) gfx.moveTo(cx + HEX_PTS[i], cy + HEX_PTS[i + 1]);
      else          gfx.lineTo(cx + HEX_PTS[i], cy + HEX_PTS[i + 1]);
    }
    gfx.closePath();
  }

  // ── Game logic ─────────────────────────────────────────────────────────────

  activateHex(col, row) {
    const key = hexKey(col, row);
    const hex = this.hexes.get(key);
    if (!hex || hex.state === 'active') return;

    hex.state = 'active';
    this.placedCount++;
    this.revealNeighbors(col, row);
    this.drawHexGrid();

    // Pop-in animation for the center dot
    const { x, y } = hexToPixel(col, row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);
    const dot = this.add.circle(x, y, 14, 0xffffff, 0.7).setDepth(4).setScale(0);
    this.tweens.add({
      targets: dot,
      scaleX: 1, scaleY: 1,
      duration: 240,
      ease: 'Back.Out',
      onComplete: () => dot.destroy(),
    });
  }

  revealNeighbors(col, row) {
    for (const { col: nc, row: nr } of getNeighbors(col, row, GRID_COLS, GRID_ROWS)) {
      const hex = this.hexes.get(hexKey(nc, nr));
      if (hex && hex.state === 'hidden') hex.state = 'interactable';
    }
  }

  onHexClick(col, row) {
    const hex = this.hexes.get(hexKey(col, row));
    if (!hex || hex.state !== 'interactable') return;

    // Click feedback: white overlay that pops outward and fades
    const { x, y } = hexToPixel(col, row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);
    const flash = this.add.graphics().setPosition(x, y).setDepth(6);
    flash.fillStyle(0xffffff, 0.4);
    flash.beginPath();
    for (let i = 0; i < HEX_PTS.length; i += 2) {
      if (i === 0) flash.moveTo(HEX_PTS[i], HEX_PTS[i + 1]);
      else          flash.lineTo(HEX_PTS[i], HEX_PTS[i + 1]);
    }
    flash.closePath();
    flash.fillPath();
    this.tweens.add({
      targets: flash,
      scaleX: 1.35, scaleY: 1.35,
      alpha: 0,
      duration: 210,
      ease: 'Quad.Out',
      onComplete: () => flash.destroy(),
    });

    const matchIdx = this.findMatchInEnabled(hex.color);
    if (matchIdx === -1) {
      this.cameras.main.shake(120, 0.005);
      return;
    }

    this.processing = true;
    this.placeUnit(matchIdx, col, row);
  }

  // ── Queue helpers ──────────────────────────────────────────────────────────

  getEnabledIndices() {
    const result = [];
    for (let i = 0; i < this.queueData.length && result.length < QUEUE_ENABLED; i++) {
      if (!this.usedSet.has(i)) result.push(i);
    }
    return result;
  }

  findMatchInEnabled(color) {
    for (const idx of this.getEnabledIndices()) {
      if (this.queueData[idx] === color) return idx;
    }
    return -1;
  }

  findFirstColor(color) {
    for (let i = 0; i < this.queueData.length; i++) {
      if (this.queueData[i] === color) return i;
    }
    return -1;
  }

  // ── Placement animation ────────────────────────────────────────────────────

  placeUnit(unitIdx, col, row) {
    const src = this.queueCircles[unitIdx];
    const { x: hx, y: hy } = hexToPixel(col, row, HEX_SIZE, GRID_ORIGIN_X, GRID_ORIGIN_Y);

    // Animate a temporary clone; hide the original
    const anim = this.add
      .circle(src.x, src.y, UNIT_RADIUS, COLORS[this.queueData[unitIdx]])
      .setDepth(10);
    src.setAlpha(0);

    this.tweens.add({
      targets: anim,
      x: hx, y: hy,
      scaleX: 0.25, scaleY: 0.25,
      duration: 310,
      ease: 'Back.In',
      onComplete: () => {
        anim.destroy();
        this.usedSet.add(unitIdx);
        this.activateHex(col, row);
        this.updateEnabledVisuals();
        this.animateQueueCompaction();  // slide remaining circles to fill the gap
        this.updateScoreText();
        this.processing = false;

        if (this.placedCount >= this.totalHexes) {
          this.time.delayedCall(400, () => this.showWin());
        } else {
          this.time.delayedCall(100, () => this.checkLoseCondition());
        }
      },
    });
  }

  updateEnabledVisuals() {
    const enabledIndices = this.getEnabledIndices();
    const enabledSet = new Set(enabledIndices);

    for (let i = 0; i < this.queueCircles.length; i++) {
      const c = this.queueCircles[i];
      if (this.usedSet.has(i)) {
        c.setAlpha(0);
      } else {
        c.setAlpha(1.0);
      }
    }
  }

  checkLoseCondition() {
    // Collect colors of all currently interactable hexes
    const interactableColors = new Set();
    for (const hex of this.hexes.values()) {
      if (hex.state === 'interactable') interactableColors.add(hex.color);
    }
    if (interactableColors.size === 0) return;

    // Check whether any enabled queue unit matches an interactable hex
    const enabledColors = new Set(this.getEnabledIndices().map(i => this.queueData[i]));
    for (const c of interactableColors) {
      if (enabledColors.has(c)) return; // at least one match — not lost yet
    }

    this.time.delayedCall(300, () => this.showLose());
  }

  updateScoreText() {
    const remaining = this.totalHexes - this.placedCount;
    this.scoreText.setText(`${this.placedCount} / ${this.totalHexes}  •  ${remaining} left`);
  }

  // ── End screens ────────────────────────────────────────────────────────────

  showWin() {
    this.gameOver = true;
    this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.82).setDepth(20);
    this.add.text(360, 540, 'YOU WIN!', {
      fontSize: '66px', fontStyle: 'bold', color: '#f1c40f',
      stroke: '#7a5500', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(21);
    this.add.text(360, 640, 'All hexes activated!', {
      fontSize: '28px', color: '#aaddcc',
    }).setOrigin(0.5).setDepth(21);
    this.add.text(360, 740, 'Play Again', {
      fontSize: '32px', color: '#ffffff',
      backgroundColor: '#1a5c3a', padding: { x: 28, y: 14 },
    }).setOrigin(0.5).setDepth(21)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.restart());
  }

  showLose() {
    this.gameOver = true;
    this.add.rectangle(360, 640, 720, 1280, 0x000000, 0.82).setDepth(20);
    this.add.text(360, 540, 'STUCK!', {
      fontSize: '66px', fontStyle: 'bold', color: '#e74c3c',
      stroke: '#6a0000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(21);
    this.add.text(360, 640, 'No queue matches\nfor revealed hexes.', {
      fontSize: '26px', color: '#ddaaaa', align: 'center',
    }).setOrigin(0.5).setDepth(21);
    this.add.text(360, 760, 'Try Again', {
      fontSize: '32px', color: '#ffffff',
      backgroundColor: '#5c1a1a', padding: { x: 28, y: 14 },
    }).setOrigin(0.5).setDepth(21)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.restart());
  }
}
