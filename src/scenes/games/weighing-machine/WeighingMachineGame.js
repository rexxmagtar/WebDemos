import Phaser from '../../../lib/phaser.js';

// Scale layout - beam spans from left platform to right platform
const PLATFORM_W = 100;
const PLATFORM_H = 24;
const PLATFORM_SPAN = 360;  // distance between platform centers
const BEAM_LENGTH = PLATFORM_SPAN;  // beam connects both platforms
const BEAM_THICKNESS = 12;
const PIVOT_RADIUS = 16;

// Weight sizing: bigger weight = bigger circle (radius 14 to 32)
const MIN_WEIGHT = 2;
const MAX_WEIGHT = 25;
const WEIGHT_MIN_RADIUS = 14;
const WEIGHT_MAX_RADIUS = 32;

// Tilt
const TILT_SPEED = 0.8;
const CRITICAL_ANGLE = Phaser.Math.DegToRad(90); // ~38 degrees = crash

// Balance ball (visual feedback - slides toward heavier side, falls = game over)
const BALL_RADIUS = 14;
const BALL_SLIDE_SPEED = 3.5;

// After placing all weights, wait this long – ball can still fall!
const WIN_HOLD_SECONDS = 5;

// Queue: 3 vertical stacks, each with stacked blocks (reference layout)
const QUEUE_COUNT = 3;
const QUEUE_MOVE_UP_DURATION = 180;
const BLOCK_SIZE = 72;  // fits max weight circle (diameter 64)
const BLOCK_GAP = 6;

// Queue layout: fixed top slot - items slide up into freed slots
const QUEUE_TOP_SLOTS = 4;  // visible slots (top is takeable)
const FIRST_SLOT_EXTRA_GAP = 20;  // extra space between first (takeable) and rest
const DISABLED_WEIGHT_ALPHA = 0.45;  // non-first weights more transparent

// Level: 12 weights total across 3 queues (top=takeable, bottom can be off-screen)
const QUEUE_DATA = [
  [5, 12, 3, 8],   // left queue
  [15, 7, 20, 4],  // center queue
  [6, 10, 9, 2],   // right queue
];

function getWeightRadius(weight) {
  const t = Phaser.Math.Clamp((weight - MIN_WEIGHT) / (MAX_WEIGHT - MIN_WEIGHT), 0, 1);
  return WEIGHT_MIN_RADIUS + t * (WEIGHT_MAX_RADIUS - WEIGHT_MIN_RADIUS);
}

export default class WeighingMachineGame extends Phaser.Scene {
  constructor() {
    super({ key: 'WeighingMachineGame' });
  }

  create() {
    const { width, height } = this.cameras.main;

    // Back button
    const backBtn = this.add
      .text(50, 25, 'Back', { fontSize: '18px', color: '#ffffff', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      window.location.href = 'index.html';
    });

    // State: 3 queues, each is [top, ..., bottom] - take from index 0
    this.queues = QUEUE_DATA.map(arr => [...arr]);
    this.leftWeights = [];
    this.rightWeights = [];
    this.gameOver = false;
    this.won = false;
    this.allWeightsPlaced = false;
    this.currentAngle = 0;
    this.targetAngle = 0;
    this.draggingWeight = null;
    this.draggedQueueIndex = null;
    this.dragStartX = null;
    this.dragStartY = null;
    this.dragMinDistance = 20;  // must drag at least this far to place on platform

    // Scale at top (reference: scale prominent at top)
    this.pivotX = width / 2;
    this.pivotY = 220;

    // Fulcrum slightly left of center per reference
    this.fulcrumOffsetX = -8;

    this.buildScale();
    this.buildPlatformTotalLabels();
    this.buildQueue();
    this.buildDropZones();
    this.setupInput();
  }

  buildPlatformTotalLabels() {
    const { width } = this.cameras.main;
    const labelW = 52;
    const labelH = 28;
    const labelY = this.pivotY + PLATFORM_H / 2 + BEAM_THICKNESS / 2 + 40;
    const edgePadding = 90;

    this.leftTotalText = this.add.text(0, 0, 'Σ 0', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.leftTotalBg = this.add.rectangle(0, 0, labelW, labelH, 0x2a2a3a)
      .setStrokeStyle(2, 0x555555);
    this.leftTotalContainer = this.add.container(
      edgePadding + labelW / 2,
      labelY
    );
    this.leftTotalContainer.add([this.leftTotalBg, this.leftTotalText]);

    this.rightTotalText = this.add.text(0, 0, 'Σ 0', {
      fontSize: '22px', color: '#ffffff', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.rightTotalBg = this.add.rectangle(0, 0, labelW, labelH, 0x2a2a3a)
      .setStrokeStyle(2, 0x555555);
    this.rightTotalContainer = this.add.container(
      width - edgePadding - labelW / 2,
      labelY
    );
    this.rightTotalContainer.add([this.rightTotalBg, this.rightTotalText]);
  }

  buildScale() {
    const { pivotX, pivotY, fulcrumOffsetX } = this;

    // Scale assembly - rotates around fulcrum (slightly left of center per reference)
    this.scaleContainer = this.add.container(pivotX + fulcrumOffsetX, pivotY);

    // Fulcrum: vertical pole from beam down to base (full length, not cut off)
    const fulcrumH = 48;
    const fulcrumLine = this.add.rectangle(
      pivotX + fulcrumOffsetX,
      pivotY + fulcrumH / 2,
      4,
      fulcrumH,
      0x3a3a3a
    );
    fulcrumLine.setStrokeStyle(1, 0x2a2a2a);
    const fulcrumDot = this.add.circle(pivotX + fulcrumOffsetX, pivotY + fulcrumH, 8, 0x2a2a2a);
    fulcrumDot.setStrokeStyle(2, 0x1a1a1a);

    // Beam: single gray bar spanning from left platform to right platform
    const leftPlatformX = -PLATFORM_SPAN / 2;
    const rightPlatformX = PLATFORM_SPAN / 2;

    const beam = this.add.rectangle(
      0,
      0,
      BEAM_LENGTH,
      BEAM_THICKNESS,
      0x5a5a5a
    );
    beam.setStrokeStyle(2, 0x444444);

    // Rods: connect beam to each platform (beam → platform)
    const rodH = PLATFORM_H / 2 + BEAM_THICKNESS / 2;
    const leftRod = this.add.rectangle(leftPlatformX, rodH / 2, 4, rodH, 0x5a5a5a);
    const rightRod = this.add.rectangle(rightPlatformX, rodH / 2, 4, rodH, 0x5a5a5a);

    // Left platform (at left end of beam)
    const leftPlatform = this.add.rectangle(
      leftPlatformX,
      PLATFORM_H / 2 + BEAM_THICKNESS / 2,
      PLATFORM_W,
      PLATFORM_H,
      0x8b7355
    );
    leftPlatform.setStrokeStyle(2, 0x5c4033);
    const leftInner = this.add.rectangle(
      leftPlatformX,
      PLATFORM_H / 2 + BEAM_THICKNESS / 2,
      PLATFORM_W - 10,
      PLATFORM_H - 8,
      0x6b5344,
      0.5
    );
    leftInner.setStrokeStyle(1, 0x5c4033);

    // Right platform (at right end of beam)
    const rightPlatform = this.add.rectangle(
      rightPlatformX,
      PLATFORM_H / 2 + BEAM_THICKNESS / 2,
      PLATFORM_W,
      PLATFORM_H,
      0x8b7355
    );
    rightPlatform.setStrokeStyle(2, 0x5c4033);

    this.scaleContainer.add([beam, leftRod, rightRod, leftPlatform, leftInner, rightPlatform]);

    // Containers for weights ON the platforms
    this.leftWeightsContainer = this.add.container(
      leftPlatformX,
      PLATFORM_H / 2 + BEAM_THICKNESS / 2
    );
    this.rightWeightsContainer = this.add.container(
      rightPlatformX,
      PLATFORM_H / 2 + BEAM_THICKNESS / 2
    );

    // Invisible hit areas for drop detection (move with scale, so drops on platform work)
    const hitW = PLATFORM_W + 30;
    const hitH = PLATFORM_H + 50;
    const leftHit = this.add.rectangle(0, 0, hitW, hitH, 0x0000ff, 0);
    const rightHit = this.add.rectangle(0, 0, hitW, hitH, 0x0000ff, 0);
    this.leftWeightsContainer.add(leftHit);
    this.rightWeightsContainer.add(rightHit);

    this.scaleContainer.add([this.leftWeightsContainer, this.rightWeightsContainer]);

    // Balance ball: spawns at center of beam, slides toward heavier side
    this.ball = this.add.circle(0, -BEAM_THICKNESS / 2 - BALL_RADIUS, BALL_RADIUS, 0xe74c3c);
    this.ball.setStrokeStyle(2, 0xc0392b);
    this.ball.setDepth(10);
    this.scaleContainer.add(this.ball);
  }

  buildQueue() {
    const { width, height } = this.cameras.main;

    // Three vertical stacks - reference layout
    const stackSpacing = 28;
    const totalW = QUEUE_COUNT * BLOCK_SIZE + (QUEUE_COUNT - 1) * stackSpacing;
    const startX = (width - totalW) / 2 + BLOCK_SIZE / 2;

    // "queues" label above left stack (reference: gray, above left stack)
    const labelY = height - 280;
    this.add
      .text(startX, labelY, 'queues', {
        fontSize: '16px',
        color: '#888888',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0, 0.5);

    this.queueGraphics = []; // [queueIndex][stackIndex] -> container
    this.queueBaseY = height - 200;

    // Horizontal divider: first (takeable) vs rest - makes it clear you can only grab the top
    const dividerY = this.getQueueSlotY(0) + (this.getQueueSlotY(1) - this.getQueueSlotY(0)) / 2;
    const dividerW = BLOCK_SIZE + 16;

    for (let q = 0; q < QUEUE_COUNT; q++) {
      const qx = startX + q * (BLOCK_SIZE + stackSpacing);
      const divider = this.add.rectangle(qx, dividerY, dividerW, 2, 0x555555);
      this.queueGraphics[q] = [];
      this.refreshQueueStack(q, qx);
    }
  }

  getQueueSlotY(index) {
    const baseY = this.queueBaseY;
    const blockHeight = BLOCK_SIZE + BLOCK_GAP;
    const firstSlotY = baseY - (QUEUE_TOP_SLOTS - 1) * blockHeight - FIRST_SLOT_EXTRA_GAP;
    if (index === 0) return firstSlotY;
    return firstSlotY + FIRST_SLOT_EXTRA_GAP + index * blockHeight;
  }

  refreshQueueStack(queueIndex, centerX, animateMoveUp = false) {
    const queue = this.queues[queueIndex];
    const baseY = this.queueBaseY;
    const blockHeight = BLOCK_SIZE + BLOCK_GAP;

    if (animateMoveUp && this.queueGraphics[queueIndex].length > 1 && queue.length > 0) {
      // Keep existing items, remove the taken one, tween rest UP into the freed slot
      const oldGraphics = this.queueGraphics[queueIndex];
      const removed = oldGraphics.shift();
      if (removed) removed.destroy();

      for (let i = 0; i < oldGraphics.length; i++) {
        const container = oldGraphics[i];
        const targetY = this.getQueueSlotY(i);
        this.tweens.add({
          targets: container,
          y: targetY,
          duration: QUEUE_MOVE_UP_DURATION,
          ease: 'Power2.Out',
        });
        container.setAlpha(i === 0 ? 1 : DISABLED_WEIGHT_ALPHA);
        container.setData('weight', queue[i]);
        container.setData('stackIndex', i);
        const label = container.list[1];
        if (label && label.setText) label.setText(String(queue[i]));
      }
      this.queueGraphics[queueIndex] = oldGraphics;
      return;
    }

    // Full rebuild (initial or no animate)
    for (const g of this.queueGraphics[queueIndex]) {
      if (g) g.destroy();
    }
    this.queueGraphics[queueIndex] = [];

    for (let i = 0; i < queue.length; i++) {
      const weight = queue[i];
      const radius = getWeightRadius(weight);
      const targetY = this.getQueueSlotY(i);

      const circle = this.add.circle(0, 0, radius, 0x1a1a1a);
      circle.setStrokeStyle(2, 0x333333);

      const label = this.add.text(0, 0, String(weight), {
        fontSize: Math.max(12, Math.min(18, radius)) + 'px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5);

      const container = this.add.container(centerX, targetY);
      container.add([circle, label]);
      container.setAlpha(i === 0 ? 1 : DISABLED_WEIGHT_ALPHA);
      container.setData('weight', weight);
      container.setData('queueIndex', queueIndex);
      container.setData('stackIndex', i);

      this.queueGraphics[queueIndex].push(container);
    }
  }

  refreshAllQueues(animateQueueIndex = -1) {
    const { width } = this.cameras.main;
    const stackSpacing = 28;
    const totalW = QUEUE_COUNT * BLOCK_SIZE + (QUEUE_COUNT - 1) * stackSpacing;
    const startX = (width - totalW) / 2 + BLOCK_SIZE / 2;

    for (let q = 0; q < QUEUE_COUNT; q++) {
      const animateMoveUp = q === animateQueueIndex;
      this.refreshQueueStack(q, startX + q * (BLOCK_SIZE + stackSpacing), animateMoveUp);
    }
  }

  buildDropZones() {
    const { width, height } = this.cameras.main;
    const { pivotY } = this;

    // Drop zones: full left/right halves from below scale to above queues
    // Makes it easy to drop - anywhere left of center = left platform, right = right
    const zoneTop = pivotY + 60;
    const zoneBottom = this.queueBaseY - 80;
    const zoneHeight = zoneBottom - zoneTop;
    const zoneWidth = width / 2;

    this.leftDropZone = this.add.rectangle(
      zoneWidth / 2,
      zoneTop + zoneHeight / 2,
      zoneWidth,
      zoneHeight,
      0x00ff00,
      0
    );
    this.leftDropZone.setInteractive({ useHandCursor: true });

    this.rightDropZone = this.add.rectangle(
      width - zoneWidth / 2,
      zoneTop + zoneHeight / 2,
      zoneWidth,
      zoneHeight,
      0x00ff00,
      0
    );
    this.rightDropZone.setInteractive({ useHandCursor: true });
  }

  setupInput() {
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
  }

  getTotalLeftWeight() {
    return this.leftWeights.reduce((s, w) => s + w, 0);
  }

  getTotalRightWeight() {
    return this.rightWeights.reduce((s, w) => s + w, 0);
  }

  computeTargetAngle() {
    const left = this.getTotalLeftWeight();
    const right = this.getTotalRightWeight();
    const diff = right - left;

    if (diff === 0) return 0;

    const maxDiff = 50;
    const clamped = Phaser.Math.Clamp(diff, -maxDiff, maxDiff);
    return (clamped / maxDiff) * CRITICAL_ANGLE * 0.95;
  }

  createWeightGraphic(weight, offX, offY) {
    // Scale down for platform so multiple fit (min 10, max 20 radius)
    const r = getWeightRadius(weight);
    const radius = 10 + (r - WEIGHT_MIN_RADIUS) / (WEIGHT_MAX_RADIUS - WEIGHT_MIN_RADIUS) * 10;

    const circle = this.add.circle(offX, offY, radius, 0x1a1a1a);
    circle.setStrokeStyle(2, 0x333333);

    const label = this.add.text(offX, offY, String(weight), {
      fontSize: Math.max(10, Math.min(14, radius)) + 'px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5);

    const container = this.add.container(0, 0);
    container.add([circle, label]);
    return container;
  }

  addWeightToPlatform(side, weight) {
    const arr = side === 'left' ? this.leftWeights : this.rightWeights;
    const container = side === 'left' ? this.leftWeightsContainer : this.rightWeightsContainer;

    arr.push(weight);
    const count = arr.length;

    // Stack weights vertically on top of each other (centered)
    const stackSpacing = 22;
    const offX = 0;
    const offY = -(count - 1) * stackSpacing;

    const g = this.createWeightGraphic(weight, offX, offY);
    g.setData('weight', weight);
    container.add(g);

    this.refreshPlatformTotals();
  }

  refreshPlatformTotals() {
    const leftTotal = this.getTotalLeftWeight();
    const rightTotal = this.getTotalRightWeight();
    this.leftTotalText.setText(`Σ ${leftTotal}`);
    this.rightTotalText.setText(`Σ ${rightTotal}`);
  }

  onPointerDown(pointer) {
    if (this.gameOver || this.won) return;

    // Check if pointer is over top item of any queue (only top is grabbable)
    for (let q = 0; q < QUEUE_COUNT; q++) {
      if (this.queues[q].length === 0) continue;
      const g = this.queueGraphics[q][0];
      if (!g) continue;
      const radius = getWeightRadius(this.queues[q][0]);
      const dx = pointer.x - g.x;
      const dy = pointer.y - g.y;
      if (dx * dx + dy * dy <= (radius + 12) * (radius + 12)) {
        this.draggingWeight = this.queues[q][0];
        this.draggedQueueIndex = q;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        g.setAlpha(0.5);
        g.setDepth(100);
        break;
      }
    }
  }

  onPointerMove(pointer) {
    if (!this.draggingWeight || this.draggedQueueIndex === null) return;

    const g = this.queueGraphics[this.draggedQueueIndex][0];
    if (g) {
      g.x = pointer.x;
      g.y = pointer.y;
    }
  }

  onPointerUp(pointer) {
    if (!this.draggingWeight || this.draggedQueueIndex === null) return;

    const q = this.draggedQueueIndex;
    const g = this.queueGraphics[q][0];
    if (g) {
      g.setAlpha(1);
      g.setDepth(0);
    }

    // Only place if user actually dragged (not just clicked) onto a spot
    const dragDist = (this.dragStartX != null && this.dragStartY != null)
      ? Phaser.Math.Distance.Between(this.dragStartX, this.dragStartY, pointer.x, pointer.y)
      : 0;
    if (dragDist < this.dragMinDistance) {
      this.refreshAllQueues();
      this.draggingWeight = null;
      this.draggedQueueIndex = null;
      return;
    }

    // Drop detection: prefer platform hit areas (move with scale tilt), fallback to screen halves
    const { width } = this.cameras.main;
    const inScaleArea = pointer.y > this.pivotY - 30 && pointer.y < this.queueBaseY - 30;

    let inLeft = false;
    let inRight = false;

    // Check platform bounds (they rotate with scale, so this catches drops on platforms)
    const leftBounds = this.leftWeightsContainer.getBounds();
    const rightBounds = this.rightWeightsContainer.getBounds();
    if (Phaser.Geom.Rectangle.Contains(leftBounds, pointer.x, pointer.y)) inLeft = true;
    if (Phaser.Geom.Rectangle.Contains(rightBounds, pointer.x, pointer.y)) inRight = true;

    // Fallback: screen halves when not over a platform
    if (!inLeft && !inRight && inScaleArea) {
      inLeft = pointer.x < width / 2;
      inRight = pointer.x >= width / 2;
    }

    if (inLeft) {
      this.queues[q].shift();
      this.addWeightToPlatform('left', this.draggingWeight);
      this.refreshAllQueues(q);  // animate weights moving up in that queue
    } else if (inRight) {
      this.queues[q].shift();
      this.addWeightToPlatform('right', this.draggingWeight);
      this.refreshAllQueues(q);
    } else {
      this.refreshAllQueues();
    }

    this.draggingWeight = null;
    this.draggedQueueIndex = null;

    this.checkWin();
  }

  checkWin() {
    const allEmpty = this.queues.every(q => q.length === 0);
    if (allEmpty && !this.gameOver && !this.allWeightsPlaced) {
      this.allWeightsPlaced = true;
      this.showWinHoldCountdown();
      this.time.delayedCall(WIN_HOLD_SECONDS * 1000, () => {
        if (!this.gameOver) this.showWinScreen();
      });
    }
  }

  showWinHoldCountdown() {
    const { width } = this.cameras.main;
    this.holdCountdownText = this.add.text(width / 2, 80, `Hold on... ${WIN_HOLD_SECONDS}`, {
      fontSize: '24px',
      color: '#f1c40f',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5);

    let remaining = WIN_HOLD_SECONDS;
    const timer = this.time.addEvent({
      delay: 1000,
      repeat: WIN_HOLD_SECONDS - 1,
      callback: () => {
        if (this.gameOver) timer.remove();
        else {
          remaining--;
          this.holdCountdownText.setText(remaining > 0 ? `Hold on... ${remaining}` : 'Safe!');
        }
      },
    });
  }

  update(time, delta) {
    if (this.gameOver) return;

    this.targetAngle = this.computeTargetAngle();
    this.currentAngle = Phaser.Math.Linear(this.currentAngle, this.targetAngle, TILT_SPEED * 0.02);
    this.scaleContainer.rotation = this.currentAngle;

    // Ball slides toward heavier side (positive angle = right heavier = ball rolls right)
    const slide = this.currentAngle * BALL_SLIDE_SPEED;
    this.ball.x += slide;

    const beamLeft = -BEAM_LENGTH / 2 + BALL_RADIUS;
    const beamRight = BEAM_LENGTH / 2 - BALL_RADIUS;

    if (this.ball.x < beamLeft || this.ball.x > beamRight) {
      this.triggerBallFall();
    } else if (Math.abs(this.currentAngle) >= CRITICAL_ANGLE) {
      this.triggerCrash();
    }
  }

  triggerCrash() {
    this.gameOver = true;
    if (this.holdCountdownText) this.holdCountdownText.destroy();
    this.cameras.main.shake(400, 0.02);
    this.time.delayedCall(500, () => {
      this.showGameOverScreen('The scale tipped too far!');
    });
  }

  triggerBallFall() {
    this.gameOver = true;
    if (this.holdCountdownText) this.holdCountdownText.destroy();
    this.cameras.main.shake(300, 0.015);
    this.time.delayedCall(400, () => {
      this.showGameOverScreen('The ball fell off!');
    });
  }

  showGameOverScreen(subMessage = 'The scale tipped too far!') {
    const { width, height } = this.cameras.main;
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    const text = this.add
      .text(width / 2, height / 2 - 40, 'CRASH!', {
        fontSize: '48px',
        color: '#e74c3c',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(width / 2, height / 2 + 10, subMessage, {
        fontSize: '20px',
        color: '#aaa',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);
    const btn = this.add
      .text(width / 2, height / 2 + 80, 'Retry', {
        fontSize: '24px',
        color: '#4ecdc4',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }

  showWinScreen() {
    this.won = true;
    if (this.holdCountdownText) this.holdCountdownText.destroy();
    const { width, height } = this.cameras.main;
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    const text = this.add
      .text(width / 2, height / 2 - 40, 'Balance achieved!', {
        fontSize: '36px',
        color: '#2ecc71',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(width / 2, height / 2 + 10, 'All weights placed without tipping!', {
        fontSize: '18px',
        color: '#aaa',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);
    const btn = this.add
      .text(width / 2, height / 2 + 80, 'Play Again', {
        fontSize: '24px',
        color: '#4ecdc4',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }
}
