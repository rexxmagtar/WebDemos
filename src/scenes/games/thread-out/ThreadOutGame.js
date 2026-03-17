import Phaser from '../../../lib/phaser.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';
import {
  COLORS,
  LEVEL_SEED,
  QUEUE_COUNT,
  SLOT_LAYOUT,
  QUEUE_ORIGIN_Y,
  FIELD_X,
  FIELD_Y,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  REEL_CAPACITY,
  CAPACITY_TO_RADIUS,
  PHYSICS_WALL_THICKNESS,
  PHYSICS_BALL_BOUNCE,
  PHYSICS_FLOOR_FRICTION,
  KNIT_RATE,
  SETTLE_DELAY_MS,
} from './GameConfig.js';
import { generateLevel } from './LevelGenerator.js';

export default class ThreadOutGame extends Phaser.Scene {
  constructor() {
    super({ key: 'ThreadOutGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.REEL, ASSET_PATHS.REEL);
    this.load.image(SPRITE_KEYS.BALL, ASSET_PATHS.BALL);
  }

  create() {
    this.cameras.main.setBackgroundColor('#e8f4f8');

    // Reduce redundant collision checks when balls stack (avoids slow fall from overlap fighting)
    // this.physics.world.checkCollision.up = false;
    

    const levelSeed = this.registry.get('levelSeed') ?? LEVEL_SEED;
    const { balls, queues } = generateLevel(levelSeed);

    this.queues = queues.map((q) => [...q]);
    this.slots = Array(SLOT_LAYOUT.length).fill(null);
    this.processing = false;
    this.gameOver = false;
    this.won = false;
    this.knittingEnabled = false;
    this.settleTimer = 0;

    this.knitLineGraphics = this.add.graphics().setDepth(2.2);
    this.buildBackButton();
    this.buildMainField();
    this.buildBalls(balls);
    // Clamp scaled balls after physics so they never pass through walls
    this.physics.world.on('worldstep', () => this.clampScaledBalls());
    this.buildQueues();
    this.buildSlotAreas();
    this.setupInput();
  }

  buildBackButton() {
    const backRect = this.add
      .rectangle(50, 25, 80, 36, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { window.location.href = 'index.html'; });
    backRect.setDepth(10);
    this.add
      .text(50, 25, 'Back', { fontSize: '18px', color: '#333', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setDepth(10);
  }

  buildMainField() {
    this.fieldBg = this.add
      .rectangle(
        FIELD_X + FIELD_WIDTH / 2,
        FIELD_Y + FIELD_HEIGHT / 2,
        FIELD_WIDTH,
        FIELD_HEIGHT,
        0xc5d9e8,
        1
      )
      .setStrokeStyle(2, 0x8ba8b8)
      .setDepth(0);

    this.containerBounds = this.physics.add.staticGroup();
    const wt = PHYSICS_WALL_THICKNESS;
    const leftWall = this.add.rectangle(FIELD_X - wt / 2, FIELD_Y + FIELD_HEIGHT / 2, wt, FIELD_HEIGHT + wt * 2, 0x000000, 0);
    this.physics.add.existing(leftWall, true);
    this.containerBounds.add(leftWall);
    const rightWall = this.add.rectangle(FIELD_X + FIELD_WIDTH + wt / 2, FIELD_Y + FIELD_HEIGHT / 2, wt, FIELD_HEIGHT + wt * 2, 0x000000, 0);
    this.physics.add.existing(rightWall, true);
    this.containerBounds.add(rightWall);
    const bottomWall = this.add.rectangle(FIELD_X + FIELD_WIDTH / 2, FIELD_Y + FIELD_HEIGHT + wt / 2, FIELD_WIDTH + wt * 2, wt, 0x000000, 0);
    this.physics.add.existing(bottomWall, true);
    this.containerBounds.add(bottomWall);
  }

  buildBalls(balls) {
    this.ballsGroup = this.physics.add.group();
    for (const b of balls) {
      const radius = b.capacity * CAPACITY_TO_RADIUS;
      const color = COLORS[b.color];
      const circle = this.add.circle(b.x, b.y, radius, color).setDepth(2);
      circle.setAlpha(0); // invisible - sprite shows visuals
      this.physics.add.existing(circle);
      circle.body.setCircle(radius);
      circle.body.setFriction(0, 0);
      circle.body.setBounce(1, 1);
      circle.setDataEnabled();
      circle.data.set('capacity', b.capacity);
      circle.data.set('radius', radius);
      circle.data.set('knitProgress', 0);
      circle.data.set('color', b.color);
      this.ballsGroup.add(circle);
      const ballSprite = this.add.image(b.x, b.y, SPRITE_KEYS.BALL).setDepth(2);
      ballSprite.setTint(color);
      ballSprite.setDisplaySize(radius * 2, radius * 2);
      circle.ballSprite = ballSprite;
      const capText = this.add.text(b.x, b.y, String(b.capacity), {
        fontSize: Math.min(16, Math.max(10, radius * 0.5)),
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setDepth(2.5);
      circle.capacityText = capText;
    }
    this.physics.add.collider(this.ballsGroup, this.containerBounds);
    this.physics.add.collider(this.ballsGroup, this.ballsGroup);
  }

  /** Custom circle-circle separation; avoids Arcade's default velocity damping that causes slow fall when balls stack. */
  separateBalls(ball1, ball2) {
    // const b1 = ball1.body;
    // const b2 = ball2.body;
    // const r1 = ball1.data.get('radius') ?? b1.halfWidth;
    // const r2 = ball2.data.get('radius') ?? b2.halfWidth;
    // const dx = b2.x - b1.x;
    // const dy = b2.y - b1.y;
    // const distSq = dx * dx + dy * dy;
    // if (distSq < 1e-6) return;
    // const dist = Math.sqrt(distSq);
    // const overlap = r1 + r2 - dist;
    // if (overlap <= 0) return;
    // const nx = dx / dist;
    // const ny = dy / dist;
    // const m1 = b1.mass;
    // const m2 = b2.mass;
    // const total = m1 + m2;
    // b1.x -= nx * overlap * (m2 / total);
    // b1.y -= ny * overlap * (m2 / total);
    // b2.x += nx * overlap * (m1 / total);
    // b2.y += ny * overlap * (m1 / total);
    // // Zero approach velocity along the normal only—prevents sinking without over-damping
    // const v1n = b1.velocity.x * nx + b1.velocity.y * ny;
    // const v2n = b2.velocity.x * nx + b2.velocity.y * ny;
    // const approach = v1n - v2n;
    // if (approach > 0) {
    //   b1.velocity.x -= nx * approach * (m2 / total);
    //   b1.velocity.y -= ny * approach * (m2 / total);
    //   b2.velocity.x += nx * approach * (m1 / total);
    //   b2.velocity.y += ny * approach * (m1 / total);
    // }
  }

  getQueueSlotPosition(q, row) {
    const slotW = 720 / QUEUE_COUNT;
    const cx = (q + 0.5) * slotW;
    const rowH = 56;
    const y = QUEUE_ORIGIN_Y + row * rowH;
    return { x: cx, y };
  }

  createReelSprite(x, y, color, size = 96) {
    const sprite = this.add.image(x, y, SPRITE_KEYS.REEL);
    sprite.setTint(COLORS[color] ?? 0x95a5a6);
    sprite.setDisplaySize(size, size * 0.8);
    return sprite;
  }

  buildQueues() {
    this.queueReelGraphics = [];
    this.queueClickRects = [];
    const slotW = 720 / QUEUE_COUNT;
    const slotSize = 64;

    for (let q = 0; q < QUEUE_COUNT; q++) {
      const cx = (q + 0.5) * slotW;
      const firstReelPos = this.getQueueSlotPosition(q, 0);
      const clickRect = this.add
        .rectangle(firstReelPos.x, firstReelPos.y, slotSize, slotSize, 0x000000, 0)
        .setInteractive({ useHandCursor: true })
        .setDepth(4);
      clickRect.on('pointerdown', () => {
        if (this.processing || this.gameOver || this.won) return;
        if (this.queues[q].length > 0) this.onQueueReelClicked(q);
      });
      this.queueClickRects[q] = clickRect;
    }
    this.refreshAllQueueDisplays();
  }

  refreshAllQueueDisplays() {
    for (let q = 0; q < QUEUE_COUNT; q++) {
      this.refreshQueueDisplay(q);
    }
  }

  refreshQueueDisplay(q) {
    const old = this.queueReelGraphics[q] || [];
    for (const o of old) {
      if (o && o.destroy) o.destroy();
    }
    this.queueReelGraphics[q] = [];

    const slotW = 720 / QUEUE_COUNT;
    const cx = (q + 0.5) * slotW;
    const rowH = 56;

    for (let row = 0; row < this.queues[q].length; row++) {
      const reel = this.queues[q][row];
      const pos = this.getQueueSlotPosition(q, row);
      const reelG = this.createReelSprite(pos.x, pos.y, reel.color);
      reelG.setAlpha(row === 0 ? 1 : 0.45);
      reelG.setDepth(3);

      const capText = this.add.text(pos.x, pos.y, String(Math.round(reel.remainingCapacity)), {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setDepth(3);
      this.queueReelGraphics[q].push(capText);
      this.queueReelGraphics[q].push(reelG);
    }
  }

  onQueueReelClicked(q) {
    const freeIdx = this.slots.findIndex((s) => s === null);
    if (freeIdx === -1) return;
    if (this.processing || this.gameOver || this.won) return;
    if (this.queues[q].length === 0) return;

    this.processing = true;
    const reel = this.queues[q].shift();
    const fromPos = this.getQueueSlotPosition(q, 0);
    this.refreshAllQueueDisplays();

    const flyingReel = this.createReelSprite(fromPos.x, fromPos.y, reel.color);
    flyingReel.setDepth(5);

    const toPos = SLOT_LAYOUT[freeIdx];
    this.tweens.add({
      targets: flyingReel,
      x: toPos.x,
      y: toPos.y,
      duration: 250,
      ease: 'Back.Out',
      onComplete: () => {
        flyingReel.destroy();
        this.slots[freeIdx] = { ...reel, slotIndex: freeIdx };
        this.updateSlotDisplay(freeIdx);
        this.processing = false;
      },
    });
  }

  buildSlotAreas() {
    this.slotGraphics = [];
    const slotW = 88;
    const slotH = 64;
    for (let i = 0; i < SLOT_LAYOUT.length; i++) {
      const pos = SLOT_LAYOUT[i];
      const slotBg = this.add
        .rectangle(pos.x, pos.y, slotW, slotH, 0xd0dce4, 0.8)
        .setStrokeStyle(2, 0x8ba8b8)
        .setDepth(2);
      this.slotGraphics[i] = { bg: slotBg, reel: null };
    }
    this.updateAllSlotDisplays();
  }

  updateSlotDisplay(slotIndex) {
    const slot = this.slotGraphics[slotIndex];
    if (!slot) return;
    const reelData = this.slots[slotIndex];

    if (!reelData) {
      if (slot.reel) { slot.reel.destroy(); slot.reel = null; }
      if (slot.reelPct) { slot.reelPct.destroy(); slot.reelPct = null; }
      return;
    }

    const pos = SLOT_LAYOUT[slotIndex];
    const cap = Math.round(reelData.remainingCapacity);

    if (!slot.reel) {
      slot.reel = this.createReelSprite(pos.x, pos.y, reelData.color);
      slot.reel.setDepth(3);
    }
    if (!slot.reelPct) {
      slot.reelPct = this.add.text(pos.x, pos.y, String(cap), {
        fontSize: '12px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }).setOrigin(0.5).setDepth(3);
    } else {
      slot.reelPct.setText(String(cap));
    }
  }

  updateAllSlotDisplays() {
    for (let i = 0; i < SLOT_LAYOUT.length; i++) {
      this.updateSlotDisplay(i);
    }
  }

  setupInput() {}

  update(time, delta) {
    if (this.gameOver || this.won) return;

    this.ballsGroup.getChildren().forEach((ball) => {
      if (ball.active) {
        if (ball.ballSprite) {
          ball.ballSprite.setPosition(ball.x, ball.y);
          ball.ballSprite.setScale(ball.scaleX);
        }
        if (ball.capacityText) {
          ball.capacityText.setPosition(ball.x, ball.y);
        }
        const capacity = ball.data.get('capacity');
        const knitProgress = ball.data.get('knitProgress') ?? 0;
        const remaining = Math.round(capacity - knitProgress);
        if (ball.capacityText) ball.capacityText.setText(String(remaining));
      }
    });

    if (!this.knittingEnabled) {
      this.settleTimer += delta;
      if (this.settleTimer >= SETTLE_DELAY_MS) this.knittingEnabled = true;
      return;
    }

    this.processKnitting();
    this.checkWinCondition();
    this.checkLoseCondition();
  }

  /** Clamp balls with knitProgress > 0 so they cannot pass through walls (runs after physics step). */
  clampScaledBalls() {
    if (!this.ballsGroup) return;
    const floorY = FIELD_Y + FIELD_HEIGHT;
    this.ballsGroup.getChildren().forEach((ball) => {
      if (!ball.active || !ball.body) return;
      const knitProgress = ball.data.get('knitProgress') ?? 0;
      if (knitProgress <= 0) return;
      const capacity = ball.data.get('capacity');
      const baseRadius = ball.data.get('radius');
      const scale = Math.max(0.05, 1 - knitProgress / capacity);
      const r = baseRadius * scale;
      if (ball.body.y + r > floorY) {
        ball.body.y = floorY - r;
        ball.body.velocity.y = 0;
      }
      ball.body.x = Phaser.Math.Clamp(ball.body.x, FIELD_X + r, FIELD_X + FIELD_WIDTH - r);
    });
  }

  getBallsTouchingFloor() {
    const floorY = FIELD_Y + FIELD_HEIGHT;
    const threshold = 20;
    const result = [];
    this.ballsGroup.getChildren().forEach((ball) => {
      if (!ball.active) return;
      const r = ball.data.get('radius');
      if (ball.y + r >= floorY - threshold) result.push(ball);
    });
    return result;
  }

  findMatchingBall(reel) {
    const floorBalls = this.getBallsTouchingFloor();
    for (const ball of floorBalls) {
      if (!ball.active) continue;
      if (ball.data.get('color') === reel.color) return ball;
    }
    return null;
  }

  processKnitting() {
    const toRemoveSlots = [];
    const toRemoveBalls = [];
    this.knitLineGraphics.clear();

    for (let i = 0; i < this.slots.length; i++) {
      const reel = this.slots[i];
      if (!reel || reel.remainingCapacity <= 0) continue;

      const ball = this.findMatchingBall(reel);
      if (!ball) continue;

      const slotPos = SLOT_LAYOUT[i];
      const reelColor = COLORS[reel.color] ?? COLOR_WILDCARD;
      this.knitLineGraphics.lineStyle(3, reelColor, 0.8);
      this.knitLineGraphics.lineBetween(slotPos.x, slotPos.y, ball.x, ball.y);

      const capacity = ball.data.get('capacity');
      const knitProgress = ball.data.get('knitProgress');
      const remaining = capacity - knitProgress;
      const knitAmount = Math.min(KNIT_RATE, reel.remainingCapacity, remaining);

      reel.remainingCapacity -= knitAmount;
      ball.data.set('knitProgress', knitProgress + knitAmount);

      const newProgress = knitProgress + knitAmount;
      const scale = Math.max(0.05, 1 - newProgress / capacity);
      const newRadius = ball.data.get('radius') * scale;
      ball.setScale(scale);
      ball.body.setCircle(newRadius);
      // Clamp position so scaled ball cannot pass through walls
      const floorY = FIELD_Y + FIELD_HEIGHT;
      if (ball.body.y + newRadius > floorY) {
        ball.body.y = floorY - newRadius;
        ball.body.velocity.y = 0;
      }
      ball.body.x = Phaser.Math.Clamp(
        ball.body.x,
        FIELD_X + newRadius,
        FIELD_X + FIELD_WIDTH - newRadius
      );
      if (ball.capacityText) {
        ball.capacityText.setPosition(ball.x, ball.y);
        ball.capacityText.setText(String(Math.round(capacity - newProgress)));
      }
      if (ball.ballSprite) {
        ball.ballSprite.setPosition(ball.x, ball.y);
        ball.ballSprite.setScale(scale);
      }

      if (newProgress >= capacity) {
        toRemoveBalls.push(ball);
      }
      if (reel.remainingCapacity <= 0) {
        toRemoveSlots.push(i);
      }
    }

    for (const ball of toRemoveBalls) {
      if (ball.ballSprite) ball.ballSprite.destroy();
      if (ball.capacityText) ball.capacityText.destroy();
      ball.destroy();
    }
    for (const i of toRemoveSlots) {
      this.slots[i] = null;
    }
    this.updateAllSlotDisplays();
  }

  checkWinCondition() {
    const alive = this.ballsGroup.getChildren().filter((b) => b.active).length;
    if (alive === 0 && !this.won && !this.gameOver) {
      this.won = true;
      this.showEndMessage('You Win! All balls knit!');
    }
  }

  checkLoseCondition() {
    if (this.won || this.gameOver) return;
    const freeSlots = this.slots.filter((s) => s === null).length;
    if (freeSlots > 0) return;

    let canKnit = false;
    const floorBalls = this.getBallsTouchingFloor();
    for (const reel of this.slots) {
      if (!reel || reel.remainingCapacity <= 0) continue;
      for (const ball of floorBalls) {
        if (!ball.active) continue;
        if (ball.data.get('color') === reel.color) {
          canKnit = true;
          break;
        }
      }
      if (canKnit) break;
    }
    if (!canKnit && floorBalls.length > 0) {
      this.gameOver = true;
      this.showEndMessage('Game Over! No moves left.');
    }
  }

  showEndMessage(text) {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, 400, 120, 0x000000, 0.8).setDepth(100);
    this.add.text(width / 2, height / 2, text, {
      fontSize: '28px',
      color: '#ffffff',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5).setDepth(101);
    const againRect = this.add.rectangle(width / 2, height / 2 + 50, 160, 40, 0x000000, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(101);
    againRect.on('pointerdown', () => this.scene.restart());
    this.add.text(width / 2, height / 2 + 50, 'Play Again', {
      fontSize: '20px',
      color: '#4ecdc4',
      fontFamily: 'sans-serif',
    }).setOrigin(0.5).setDepth(102);
  }
}
