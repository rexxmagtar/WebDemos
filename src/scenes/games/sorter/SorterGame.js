import Phaser from '../../../lib/phaser.js';
import { TYPES, COLORS, COLOR_KEYS, WATER_COLOR, CRATE_COLOR } from './ItemTypes.js';
import { CONSUMERS, QUEUE_SEQUENCES } from './LevelData.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';

const FIELD_ROWS = 16;
const FIELD_COLS = 16;
const SEED_BLOCK_SIZE = 3; // each seed occupies 3x3 cells
const CONSUMER_SLOTS = 5;
const RESERVE_SLOTS = 5;
const QUEUE_COUNT = 3;
const QUEUE_DEPTH = 4;
const QUEUE_SLOT_SIZE = 96; // square slots (64 * 1.5)

export default class SorterGame extends Phaser.Scene {
  constructor() {
    super({ key: 'SorterGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.SEED, ASSET_PATHS.SEED);
    this.load.image(SPRITE_KEYS.FLOWER, ASSET_PATHS.FLOWER);
    this.load.image(SPRITE_KEYS.CRATE, ASSET_PATHS.CRATE);
    this.load.image(SPRITE_KEYS.WATER, ASSET_PATHS.WATER);
    this.load.image(SPRITE_KEYS.CONSUMER, ASSET_PATHS.CONSUMER);
  }

  create() {
    const { width, height } = this.cameras.main;

    // Layout constants
    const padding = 12;
    const consumerH = 50;
    const reserveH = 50;
    const queuesHeight = QUEUE_SLOT_SIZE * QUEUE_DEPTH + padding * 2;
    const fieldHeight = height - consumerH - reserveH - queuesHeight - padding * 4;
    const cellSize = Math.min((width - padding * 4) / FIELD_COLS, fieldHeight / FIELD_ROWS);
    const fieldW = cellSize * FIELD_COLS;
    const fieldH = cellSize * FIELD_ROWS;
    const fieldX = (width - fieldW) / 2;
    const fieldY = consumerH + padding + (fieldHeight - fieldH) / 2;

    this.layout = { width, height, padding, fieldX, fieldY, cellSize, fieldW, fieldH, consumerH, reserveH, queuesHeight };

    // Back button
    const backBtn = this.add.text(50, 25, 'Back', { fontSize: '18px', color: '#ffffff', fontFamily: 'sans-serif' })
      .setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => { window.location.href = 'index.html'; });

    // State
    this.field = []; // 2D: { state: 'empty'|'seed'|'plant', color?, graphic? }
    this.queues = QUEUE_SEQUENCES.map(arr => [...arr]);
    this.consumerPool = [...CONSUMERS];
    this.activeConsumers = []; // max 5
    this.reserve = [];
    this.fulfilledCount = 0;
    this.gameOver = false;
    this.won = false;
    this.processing = false;

    this.initField();
    this.initConsumers();
    this.createFieldGraphics();
    this.createConsumerSlots();
    this.createReserveSlots();
    this.createQueueSlots();
    this.refreshQueueDisplay();
    this.refreshConsumerDisplay();
  }

  initField() {
    for (let r = 0; r < FIELD_ROWS; r++) {
      this.field[r] = [];
      for (let c = 0; c < FIELD_COLS; c++) {
        this.field[r][c] = { state: 'empty', color: null, graphic: null, blockLead: null, plantGraphic: null };
      }
    }
  }

  initConsumers() {
    for (let i = 0; i < CONSUMER_SLOTS && this.consumerPool.length > 0; i++) {
      this.activeConsumers.push(this.consumerPool.shift());
    }
  }

  createFieldGraphics() {
    const { fieldX, fieldY, cellSize } = this.layout;
    const border = this.add.rectangle(
      fieldX + (FIELD_COLS * cellSize) / 2,
      fieldY + (FIELD_ROWS * cellSize) / 2,
      FIELD_COLS * cellSize + 4,
      FIELD_ROWS * cellSize + 4,
      0x333333
    ).setStrokeStyle(2, 0x666666).setOrigin(0.5);

    for (let r = 0; r < FIELD_ROWS; r++) {
      for (let c = 0; c < FIELD_COLS; c++) {
        const x = fieldX + c * cellSize + cellSize / 2 + 2;
        const y = fieldY + r * cellSize + cellSize / 2 + 2;
        const rect = this.add.rectangle(x, y, cellSize - 2, cellSize - 2, 0x2a2a3a);
        rect.setStrokeStyle(1, 0x444444);
        this.field[r][c].graphic = rect;
      }
    }
  }

  createConsumerSlots() {
    const slotW = (this.layout.width - this.layout.padding * 6) / CONSUMER_SLOTS;
    const startX = this.layout.padding * 2 + slotW / 2;
    const y = 25;

    this.consumerSlotRects = [];
    this.consumerGraphics = [];
    for (let i = 0; i < CONSUMER_SLOTS; i++) {
      const x = startX + i * (slotW + this.layout.padding);
      const rect = this.add.rectangle(x, y, slotW - 4, 36, 0x1a1a2a).setStrokeStyle(2, 0x555555);
      this.consumerSlotRects.push(rect);
      this.consumerGraphics.push(null);
    }

    this.add.text(this.layout.width / 2, 8, 'Consumers', { fontSize: '14px', color: '#888', fontFamily: 'sans-serif' }).setOrigin(0.5);
  }

  createReserveSlots() {
    const slotW = (this.layout.width - this.layout.padding * 6) / RESERVE_SLOTS;
    const startX = this.layout.padding * 2 + slotW / 2;
    const y = this.layout.fieldY + this.layout.fieldH + this.layout.padding + 25;

    this.reserveSlotRects = [];
    for (let i = 0; i < RESERVE_SLOTS; i++) {
      const x = startX + i * (slotW + this.layout.padding);
      const rect = this.add.rectangle(x, y, slotW - 4, 36, 0x2a1a1a).setStrokeStyle(2, 0x662222);
      this.reserveSlotRects.push(rect);
    }

    this.add.text(this.layout.width / 2, y - 30, 'Reserve', { fontSize: '14px', color: '#888', fontFamily: 'sans-serif' }).setOrigin(0.5);
  }

  createQueueSlots() {
    const totalQueueW = QUEUE_COUNT * QUEUE_SLOT_SIZE + (QUEUE_COUNT - 1) * this.layout.padding;
    const startX = (this.layout.width - totalQueueW) / 2 + QUEUE_SLOT_SIZE / 2;
    const baseY = this.layout.height - this.layout.queuesHeight + this.layout.padding + QUEUE_SLOT_SIZE / 2;

    this.queueSlotRects = [];
    this.queueItemGraphics = [];

    for (let q = 0; q < QUEUE_COUNT; q++) {
      const qx = startX + q * (QUEUE_SLOT_SIZE + this.layout.padding);
      this.queueItemGraphics[q] = [];
      for (let row = 0; row < QUEUE_DEPTH; row++) {
        const qy = baseY + row * QUEUE_SLOT_SIZE;
        const rect = this.add.rectangle(qx, qy, QUEUE_SLOT_SIZE - 6, QUEUE_SLOT_SIZE - 6, 0x2a2a3a)
          .setStrokeStyle(2, 0x555555)
          .setInteractive({ useHandCursor: true });
        this.queueSlotRects.push({ q, row, rect });
        this.queueItemGraphics[q].push(null);

        const isFirst = row === 0;
        rect.on('pointerdown', () => {
          if (this.processing || this.gameOver || this.won) return;
          if (isFirst && this.queues[q].length > 0) this.processQueueItem(q);
        });
      }
    }

    this.add.text(this.layout.width / 2, baseY - 20, 'Queues', { fontSize: '14px', color: '#888', fontFamily: 'sans-serif' }).setOrigin(0.5);
  }

  getQueueSlotPosition(q, row) {
    const totalQueueW = QUEUE_COUNT * QUEUE_SLOT_SIZE + (QUEUE_COUNT - 1) * this.layout.padding;
    const startX = (this.layout.width - totalQueueW) / 2 + QUEUE_SLOT_SIZE / 2;
    const baseY = this.layout.height - this.layout.queuesHeight + this.layout.padding + QUEUE_SLOT_SIZE / 2;
    return {
      x: startX + q * (QUEUE_SLOT_SIZE + this.layout.padding),
      y: baseY + row * QUEUE_SLOT_SIZE,
    };
  }

  refreshQueueDisplay() {
    for (let q = 0; q < QUEUE_COUNT; q++) {
      for (let row = 0; row < QUEUE_DEPTH; row++) {
        const pos = this.getQueueSlotPosition(q, row);
        const old = this.queueItemGraphics[q][row];
        if (old) old.destroy();

        const item = this.queues[q][row] || null;
        if (item) {
          const g = this.drawItemGraphic(pos.x, pos.y, QUEUE_SLOT_SIZE - 12, QUEUE_SLOT_SIZE - 12, item);
          this.queueItemGraphics[q][row] = g;
        } else {
          this.queueItemGraphics[q][row] = null;
        }
      }
    }
  }

  drawItemGraphic(x, y, w, h, item) {
    const size = Math.min(w, h) * 0.85;
    if (this.textures.exists(SPRITE_KEYS.SEED) && item.type === TYPES.SEED) {
      const sprite = this.add.image(x, y, SPRITE_KEYS.SEED).setDisplaySize(size, size);
      const color = COLORS[item.color] || 0x888888;
      sprite.setTint(color);
      return sprite;
    }
    if (this.textures.exists(SPRITE_KEYS.WATER) && item.type === TYPES.WATER) {
      return this.add.image(x, y, SPRITE_KEYS.WATER).setDisplaySize(size * 0.9, size);
    }
    if (this.textures.exists(SPRITE_KEYS.CRATE) && item.type === TYPES.CRATE) {
      return this.add.image(x, y, SPRITE_KEYS.CRATE).setDisplaySize(size * 1.1, size * 0.9);
    }
    // Fallback: shapes when sprites not loaded
    if (item.type === TYPES.SEED) {
      const color = COLORS[item.color] || 0x888888;
      return this.add.circle(x, y, size / 2, color);
    }
    if (item.type === TYPES.WATER) {
      return this.add.rectangle(x, y, w * 0.6, h * 0.8, WATER_COLOR);
    }
    return this.add.rectangle(x, y, w * 0.8, h * 0.7, CRATE_COLOR);
  }

  refreshConsumerDisplay() {
    const slotW = (this.layout.width - this.layout.padding * 6) / CONSUMER_SLOTS;
    const startX = this.layout.padding * 2 + slotW / 2;
    const y = 25;
    const size = 28;

    for (let i = 0; i < CONSUMER_SLOTS; i++) {
      const old = this.consumerGraphics[i];
      if (old) old.destroy();
      this.consumerGraphics[i] = null;

      const consumer = this.activeConsumers[i];
      if (consumer) {
        const x = startX + i * (slotW + this.layout.padding);
        const color = COLORS[consumer];
        let g;
        if (this.textures.exists(SPRITE_KEYS.CONSUMER)) {
          g = this.add.image(x, y, SPRITE_KEYS.CONSUMER).setDisplaySize(size, size);
          g.setTint(color);
        } else {
          g = this.add.circle(x, y, 14, color);
        }
        this.consumerGraphics[i] = g;
      }
    }
  }

  refreshReserveDisplay() {
    const slotW = (this.layout.width - this.layout.padding * 6) / RESERVE_SLOTS;
    const startX = this.layout.padding * 2 + slotW / 2;
    const y = this.layout.fieldY + this.layout.fieldH + this.layout.padding + 25;

    if (!this.reserveGraphics) this.reserveGraphics = [];
    for (let i = 0; i < RESERVE_SLOTS; i++) {
      if (this.reserveGraphics[i]) {
        this.reserveGraphics[i].destroy();
        this.reserveGraphics[i] = null;
      }
      const item = this.reserve[i];
      if (item) {
        const x = startX + i * (slotW + this.layout.padding);
        this.reserveGraphics[i] = this.drawItemGraphic(x, y, slotW - 16, 28, item);
      }
    }
  }

  refreshFieldDisplay() {
    const { fieldX, fieldY, cellSize } = this.layout;
    const blockPixelSize = SEED_BLOCK_SIZE * cellSize;
    const spriteSize = blockPixelSize * 0.85;
    for (const { r, c } of this.getBlockPositions()) {
      const cell = this.field[r][c];
      const x = fieldX + c * cellSize + blockPixelSize / 2 + 2;
      const y = fieldY + r * cellSize + blockPixelSize / 2 + 2;
      if (cell.plantGraphic) {
        cell.plantGraphic.destroy();
        cell.plantGraphic = null;
      }
      if (cell.state === 'seed' || cell.state === 'plant') {
        const color = COLORS[cell.color] || 0x888888;
        const isSeed = cell.state === 'seed';
        const key = isSeed ? SPRITE_KEYS.SEED : SPRITE_KEYS.FLOWER;
        if (this.textures.exists(key)) {
          const sprite = this.add.image(x, y, key).setDisplaySize(spriteSize * (isSeed ? 0.9 : 1), spriteSize);
          sprite.setTint(color);
          cell.plantGraphic = sprite;
        } else {
          const radius = blockPixelSize / 3;
          cell.plantGraphic = this.add.circle(x, y, radius, color);
        }
      }
    }
  }

  // 4x4 block helpers - blocks at (0,0), (0,4), (4,0), (4,4)
  getBlockPositions() {
    const list = [];
    for (let r = 0; r <= FIELD_ROWS - SEED_BLOCK_SIZE; r += SEED_BLOCK_SIZE) {
      for (let c = 0; c <= FIELD_COLS - SEED_BLOCK_SIZE; c += SEED_BLOCK_SIZE) {
        list.push({ r, c });
      }
    }
    return list;
  }

  isBlockFree(r, c) {
    for (let dr = 0; dr < SEED_BLOCK_SIZE; dr++) {
      for (let dc = 0; dc < SEED_BLOCK_SIZE; dc++) {
        if (this.field[r + dr][c + dc].state !== 'empty') return false;
      }
    }
    return true;
  }

  getFree4x4BlockSpiral() {
    const blocks = this.getBlockPositions();
    const centerR = (FIELD_ROWS - 1) / 2;
    const centerC = (FIELD_COLS - 1) / 2;
    blocks.sort((a, b) => {
      const ax = a.c + SEED_BLOCK_SIZE / 2 - 0.5;
      const ay = a.r + SEED_BLOCK_SIZE / 2 - 0.5;
      const bx = b.c + SEED_BLOCK_SIZE / 2 - 0.5;
      const by = b.r + SEED_BLOCK_SIZE / 2 - 0.5;
      const distA = (ay - centerR) ** 2 + (ax - centerC) ** 2;
      const distB = (by - centerR) ** 2 + (bx - centerC) ** 2;
      return distA - distB;
    });
    for (const b of blocks) {
      if (this.isBlockFree(b.r, b.c)) return b;
    }
    return null;
  }

  getSeedBlocks() {
    const list = [];
    for (const { r, c } of this.getBlockPositions()) {
      if (this.field[r][c].state === 'seed') list.push({ r, c });
    }
    return list;
  }

  getPlantBlocks() {
    const list = [];
    for (const { r, c } of this.getBlockPositions()) {
      if (this.field[r][c].state === 'plant') list.push({ r, c });
    }
    return list;
  }

  placeSeedBlock(r, c, color) {
    for (let dr = 0; dr < SEED_BLOCK_SIZE; dr++) {
      for (let dc = 0; dc < SEED_BLOCK_SIZE; dc++) {
        this.field[r + dr][c + dc].state = dr === 0 && dc === 0 ? 'seed' : 'block';
        this.field[r + dr][c + dc].color = color;
        this.field[r + dr][c + dc].blockLead = { r, c };
      }
    }
  }

  setBlockState(r, c, state) {
    for (let dr = 0; dr < SEED_BLOCK_SIZE; dr++) {
      for (let dc = 0; dc < SEED_BLOCK_SIZE; dc++) {
        this.field[r + dr][c + dc].state = dr === 0 && dc === 0 ? state : 'block';
      }
    }
  }

  getBlockColor(r, c) {
    return this.field[r][c].color;
  }

  clearBlock(r, c) {
    if (this.field[r][c].plantGraphic) {
      this.field[r][c].plantGraphic.destroy();
      this.field[r][c].plantGraphic = null;
    }
    for (let dr = 0; dr < SEED_BLOCK_SIZE; dr++) {
      for (let dc = 0; dc < SEED_BLOCK_SIZE; dc++) {
        this.field[r + dr][c + dc].state = 'empty';
        this.field[r + dr][c + dc].color = null;
        this.field[r + dr][c + dc].blockLead = null;
      }
    }
  }

  processQueueItem(queueIndex) {
    if (this.queues[queueIndex].length === 0) return;
    this.processing = true;
    const item = this.queues[queueIndex].shift();
    this.refreshQueueDisplay();
    const fromPos = this.getQueueSlotPosition(queueIndex, 0);
    this.processItem(item, queueIndex, fromPos);
  }

  processItem(item, queueIndex, fromPos) {
    if (item.type === TYPES.SEED) {
      const freeBlock = this.getFree4x4BlockSpiral();
      if (!freeBlock) {
        this.sendToReserve(item);
        this.processing = false;
        return;
      }
      const color = item.color || COLOR_KEYS[Phaser.Math.Between(0, COLOR_KEYS.length - 1)];
      const { fieldX, fieldY, cellSize } = this.layout;
      const tx = fieldX + freeBlock.c * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;
      const ty = fieldY + freeBlock.r * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;

      let flyingSeed;
      if (this.textures.exists(SPRITE_KEYS.SEED)) {
        flyingSeed = this.add.image(fromPos.x, fromPos.y, SPRITE_KEYS.SEED).setDisplaySize(48, 48);
        flyingSeed.setTint(COLORS[color]);
      } else {
        flyingSeed = this.add.circle(fromPos.x, fromPos.y, 20, COLORS[color]);
      }
      this.tweens.add({
        targets: flyingSeed,
        x: tx,
        y: ty,
        duration: 350,
        onComplete: () => {
          flyingSeed.destroy();
          this.placeSeedBlock(freeBlock.r, freeBlock.c, color);
          this.refreshFieldDisplay();
          this.processing = false;
        },
      });
      return;
    }

    if (item.type === TYPES.WATER) {
      const seeds = this.getSeedBlocks();
      if (seeds.length === 0) {
        this.sendToReserve(item);
        this.processing = false;
        return;
      }
      const pick = seeds[Phaser.Math.Between(0, seeds.length - 1)];
      const { fieldX, fieldY, cellSize } = this.layout;
      const tx = fieldX + pick.c * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;
      const ty = fieldY + pick.r * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;
      let drop;
      if (this.textures.exists(SPRITE_KEYS.WATER)) {
        drop = this.add.image(fromPos.x, fromPos.y, SPRITE_KEYS.WATER).setDisplaySize(28, 32);
      } else {
        drop = this.add.rectangle(fromPos.x, fromPos.y, 20, 24, WATER_COLOR);
      }
      this.tweens.add({
        targets: drop,
        x: tx,
        y: ty,
        duration: 300,
        onComplete: () => {
          drop.destroy();
          this.setBlockState(pick.r, pick.c, 'plant');
          this.refreshFieldDisplay();
          this.processing = false;
        },
      });
      return;
    }

    if (item.type === TYPES.CRATE) {
      const plants = this.getPlantBlocks();
      const matching = plants.filter(p => this.activeConsumers.includes(this.getBlockColor(p.r, p.c)));
      if (matching.length === 0) {
        this.sendToReserve(item);
        this.processing = false;
        return;
      }
      const plantPick = matching[Phaser.Math.Between(0, matching.length - 1)];
      const plantColor = this.getBlockColor(plantPick.r, plantPick.c);
      const idx = this.activeConsumers.indexOf(plantColor);
      this.fulfillConsumer(idx, plantPick, fromPos);
    }
  }

  fulfillConsumer(idx, plantCell, fromPos) {
    const slotW = (this.layout.width - this.layout.padding * 6) / CONSUMER_SLOTS;
    const startX = this.layout.padding * 2 + slotW / 2;
    const consumerX = startX + idx * (slotW + this.layout.padding);
    const consumerY = 25;
    const { fieldX, fieldY, cellSize } = this.layout;
    const plantX = fieldX + plantCell.c * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;
    const plantY = fieldY + plantCell.r * cellSize + (SEED_BLOCK_SIZE * cellSize) / 2 + 2;
    let crate;
    if (this.textures.exists(SPRITE_KEYS.CRATE)) {
      crate = this.add.image(fromPos.x, fromPos.y, SPRITE_KEYS.CRATE).setDisplaySize(32, 28);
    } else {
      crate = this.add.rectangle(fromPos.x, fromPos.y, 24, 20, CRATE_COLOR);
    }

    // Animate: queue -> plant -> pause 0.2s -> consumer
    this.tweens.add({
      targets: crate,
      x: plantX,
      y: plantY,
      duration: 200,
      onComplete: () => {
        this.clearBlock(plantCell.r, plantCell.c);
        this.refreshFieldDisplay();
        this.time.delayedCall(200, () => {
          this.tweens.add({
            targets: crate,
            x: consumerX,
            y: consumerY,
            duration: 250,
            onComplete: () => {
              crate.destroy();
              this.activeConsumers.splice(idx, 1);
              if (this.consumerPool.length > 0) {
                this.activeConsumers.push(this.consumerPool.shift());
              }
              this.refreshConsumerDisplay();
              this.fulfilledCount++;
              if (this.fulfilledCount >= 10) {
                this.won = true;
                this.showWinScreen();
              }
              this.processing = false;
            },
          });
        });
      },
    });
  }

  sendToReserve(item) {
    if (this.reserve.length >= RESERVE_SLOTS) {
      this.gameOver = true;
      this.showGameOverScreen();
      this.processing = false;
      return;
    }
    this.reserve.push(item);
    this.refreshReserveDisplay();
    this.processing = false;
  }

  showGameOverScreen() {
    const { width, height } = this.cameras.main;
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);
    const text = this.add.text(width / 2, height / 2 - 30, 'Game Over', { fontSize: '36px', color: '#e74c3c', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const sub = this.add.text(width / 2, height / 2 + 20, 'Reserve full!', { fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 70, 'Retry', { fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }

  showWinScreen() {
    const { width, height } = this.cameras.main;
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);
    const text = this.add.text(width / 2, height / 2 - 30, 'Level Complete!', { fontSize: '36px', color: '#2ecc71', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const sub = this.add.text(width / 2, height / 2 + 20, 'All 10 consumers fulfilled', { fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 70, 'Play Again', { fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }

}
