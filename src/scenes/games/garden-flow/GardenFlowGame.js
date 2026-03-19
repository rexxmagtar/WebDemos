import Phaser from '../../../lib/phaser.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';
import { DOT_TYPES, COLORS, COLOR_KEYS, LEVEL_1, getConsumerQueues } from './LevelData.js';

const TOP_BAR_HEIGHT = 100;
const HINT_BAR_HEIGHT = 36;
const HEADER_OFFSET = TOP_BAR_HEIGHT + HINT_BAR_HEIGHT;
const DOT_RADIUS = 36;
const CONSUMER_RADIUS = 14;
const LINE_WIDTH = 6;
const HINT_ICON_SIZE = 14;
const PATH_POINT_SPACING = 12;
const ACTIVE_CONTAINERS = 5;
const CONSUMER_QUEUE_GAP = 8;

function getPlayRectScreen(playRect, headerOffset) {
  return {
    left: playRect.left,
    top: headerOffset + playRect.top,
    right: playRect.left + playRect.width,
    bottom: headerOffset + playRect.top + playRect.height,
    width: playRect.width,
    height: playRect.height,
  };
}

function segmentsIntersect(p1, p2, p3, p4) {
  const { x: x1, y: y1 } = p1;
  const { x: x2, y: y2 } = p2;
  const { x: x3, y: y3 } = p3;
  const { x: x4, y: y4 } = p4;

  // Same segment
  if ((x1 === x3 && y1 === y3 && x2 === x4 && y2 === y4) ||
      (x1 === x4 && y1 === y4 && x2 === x3 && y2 === y3)) return false;

  // Shared endpoint (allowed - lines can meet at dots)
  if ((x1 === x3 && y1 === y3) || (x1 === x4 && y1 === y4) ||
      (x2 === x3 && y2 === y3) || (x2 === x4 && y2 === y4)) return false;

  const d1 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
  const d2 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
  const d3 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d4 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);

  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return false;
}

export default class GardenFlowGame extends Phaser.Scene {
  constructor() {
    super({ key: 'GardenFlowGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.SEED, ASSET_PATHS.SEED);
    this.load.image(SPRITE_KEYS.FLOWER, ASSET_PATHS.FLOWER);
    this.load.image(SPRITE_KEYS.WATER, ASSET_PATHS.WATER);
    this.load.image(SPRITE_KEYS.CONSUMER, ASSET_PATHS.CONSUMER);
  }

  create() {
    const { width, height } = this.cameras.main;
    this.gameOver = false;
    this.won = false;
    this.connections = []; // { from, to, path, type: 'water-seed'|'seed-consumer' }
    this.dots = [];
    this.consumerSlots = []; // Rebuilt in refreshQueueDisplay: { color, queueIndex, x, y, connection?, sprite }
    this.consumerQueueData = getConsumerQueues(LEVEL_1); // { color: [color, color, ...] }
    this.consumerQueueContainers = {};
    this.selectedDot = null;
    this.drawingPath = [];
    this.balance = {};
    this.contributions = []; // { color, conn, slot }
    this.containerQueue = [...LEVEL_1.containers];
    this.cutPath = [];
    this.pointerDownOnDot = false;
    this.playRect = getPlayRectScreen(LEVEL_1.playRect, HEADER_OFFSET);

    for (const c of COLOR_KEYS) this.balance[c] = 0;

    // Build dots: water + seeds only
    const allDots = [...LEVEL_1.water, ...LEVEL_1.seeds];
    for (const d of allDots) {
      this.dots.push({
        ...d,
        hasFlower: false,
        sprite: null,
      });
    }

    // Build consumer queues (bus-jam style)
    this.buildConsumerQueues();

    // Back button
    this.add.text(50, 25, 'Back', { fontSize: '18px', color: '#ffffff', fontFamily: 'sans-serif' })
      .setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(100)
      .on('pointerdown', () => { window.location.href = 'index.html'; });

    // Top bar: balance + container queue
    this.createTopBar(width);

    // Hint bar
    this.createHintBar(width);

    // Create water and seed dots
    for (const dot of this.dots) {
      this.createDot(dot);
    }

    // Initial queue display
    for (const color of COLOR_KEYS) {
      if (this.consumerQueueData[color]) this.refreshQueueDisplay(color);
    }

    this.linesGraphics = this.add.graphics();
    this.linesGraphics.setDepth(-1);
    this.playRectGraphics = this.add.graphics();
    this.playRectGraphics.setDepth(-2);
    this.drawPlayRectBorder();
    this.previewGraphics = this.add.graphics();
    this.previewGraphics.setDepth(10);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointermove', this.onPointerMove, this);
  }

  drawPlayRectBorder() {
    const r = this.playRect;
    this.playRectGraphics.clear();
    this.playRectGraphics.lineStyle(2, 0x4ecdc4, 0.4);
    this.playRectGraphics.strokeRect(r.left, r.top, r.width, r.height);
  }

  buildConsumerQueues() {
    const cfg = LEVEL_1.consumerQueueConfig;
    const r = this.playRect;
    this.consumerSlots = [];
    for (const color of COLOR_KEYS) {
      const c = cfg[color];
      if (!c) continue;
      let anchorX, anchorY;
      let perpX, perpY;
      if (c.side === 'left') {
        anchorX = r.left;
        anchorY = HEADER_OFFSET + c.along;
        perpX = -1;
        perpY = 0;
      } else if (c.side === 'right') {
        anchorX = r.right;
        anchorY = HEADER_OFFSET + c.along;
        perpX = 1;
        perpY = 0;
      } else if (c.side === 'top') {
        anchorX = r.left + c.along;
        anchorY = r.top;
        perpX = 0;
        perpY = -1;
      } else {
        anchorX = r.left + c.along;
        anchorY = r.bottom;
        perpX = 0;
        perpY = 1;
      }
      const container = this.add.container(anchorX, anchorY);
      container.setData('perp', { x: perpX, y: perpY });
      this.consumerQueueContainers[color] = container;
      container.setDepth(5);
    }
  }

  refreshQueueDisplay(queueKey) {
    const container = this.consumerQueueContainers[queueKey];
    const queue = this.consumerQueueData[queueKey];
    const cfg = LEVEL_1.consumerQueueConfig?.[queueKey];
    if (!container || !queue || !cfg) return;
    container.removeAll(true);
    this.consumerSlots = this.consumerSlots.filter(s => s.queueKey !== queueKey);
    const spacing = CONSUMER_RADIUS * 2 + CONSUMER_QUEUE_GAP;
    const perp = container.getData('perp') || { x: -1, y: 0 };
    const maxVisible = Math.min(5, queue.length);
    for (let i = 0; i < maxVisible; i++) {
      const consumerColor = queue[i];
      const lx = perp.x * i * spacing;
      const ly = perp.y * i * spacing;
      const sprite = this.add.image(lx, ly, SPRITE_KEYS.CONSUMER)
        .setDisplaySize(CONSUMER_RADIUS * 2, CONSUMER_RADIUS * 2);
      sprite.setTint(COLORS[consumerColor] || 0x888888);
      container.add(sprite);
      const worldX = container.x + lx;
      const worldY = container.y + ly;
      const slot = {
        color: consumerColor,
        queueKey,
        queueIndex: i,
        x: worldX,
        y: worldY,
        connection: null,
        sprite,
        isFirst: i === 0,
      };
      if (i === 0) {
        sprite.setInteractive({ useHandCursor: true });
        sprite.setData('slot', slot);
        sprite.on('pointerdown', (ptr) => this.onConsumerSlotDown(slot, ptr));
      }
      this.consumerSlots.push(slot);
    }
  }

  createTopBar(width) {
    this.add.rectangle(width / 2, TOP_BAR_HEIGHT / 2, width, TOP_BAR_HEIGHT - 2, 0x1a1a2e, 0.98).setStrokeStyle(2, 0x2d2d44);

    // Row 1: Flower balance
    const balanceY = 32;
    const balanceStartX = 90;
    const balanceItemWidth = 46;
    let bx = balanceStartX;
    for (const color of COLOR_KEYS) {
      const val = this.balance[color] || 0;
      if (this.textures.exists(SPRITE_KEYS.FLOWER)) {
        this.add.image(bx, balanceY, SPRITE_KEYS.FLOWER).setDisplaySize(18, 18).setTint(COLORS[color]);
      }
      this.balanceTexts = this.balanceTexts || {};
      this.balanceTexts[color] = this.add.text(bx + 16, balanceY, '' + val, { fontSize: '14px', color: '#e8e8e8' }).setOrigin(0, 0.5);
      bx += balanceItemWidth;
    }

    // Row 2: Container queue (below balance) - all containers, inactive ones darker
    const containerY = 68;
    const containerW = 108;
    const containerStartX = 90;
    for (let i = 0; i < this.containerQueue.length; i++) {
      const cx = containerStartX + i * (containerW + 8);
      this.createContainerCard(cx, containerY, i, i < ACTIVE_CONTAINERS);
    }
  }

  createContainerCard(x, y, index, isActive) {
    const container = this.containerQueue[index];
    const objs = [];
    if (!container) return objs;
    const req = container.requirement || {};
    const parts = [];
    for (const c of COLOR_KEYS) {
      const n = req[c] || 0;
      if (n > 0) parts.push({ color: c, count: n });
    }
    const cardW = 108;
    const cardH = 50;
    const bgColor = isActive ? 0x2a2a3e : 0x1a1a24;
    const strokeColor = isActive ? 0x555566 : 0x333344;
    const textColor = isActive ? '#e8e8e8' : '#555566';
    const alpha = isActive ? 1 : 0.5;
    const bg = this.add.rectangle(x, y, cardW, cardH, bgColor, 0.98).setStrokeStyle(2, strokeColor);
    if (!isActive) bg.setAlpha(0.6);
    objs.push(bg);
    const partW = parts.length > 0 ? Math.floor((cardW - 16) / parts.length) : 30;
    let px = x - cardW / 2 + 10;
    for (const p of parts) {
      const cx = px + partW / 2;
      const txt = this.add.text(cx, y - 12, '' + p.count, { fontSize: '15px', color: textColor }).setOrigin(0.5);
      if (!isActive) txt.setAlpha(0.6);
      objs.push(txt);
      if (this.textures.exists(SPRITE_KEYS.FLOWER)) {
        const icon = this.add.image(cx, y + 8, SPRITE_KEYS.FLOWER).setDisplaySize(20, 20).setTint(COLORS[p.color]);
        if (!isActive) icon.setAlpha(0.5);
        objs.push(icon);
      }
      px += partW;
    }
    this.containerCardObjs = this.containerCardObjs || [];
    this.containerCardObjs[index] = objs;
    return objs;
  }

  refreshBalanceDisplay() {
    if (!this.balanceTexts) return;
    for (const color of COLOR_KEYS) {
      const val = this.balance[color] || 0;
      if (this.balanceTexts[color]) this.balanceTexts[color].setText('' + val);
    }
  }

  refreshContainerCards() {
    const containerY = 68;
    const containerStartX = 90;
    const containerW = 108;
    if (this.containerCardObjs) {
      for (const objs of this.containerCardObjs) {
        if (objs && objs.length) for (const o of objs) o.destroy();
      }
    }
    this.containerCardObjs = [];
    for (let i = 0; i < this.containerQueue.length; i++) {
      const cx = containerStartX + i * (containerW + 8);
      this.createContainerCard(cx, containerY, i, i < ACTIVE_CONTAINERS);
    }
  }

  tryFulfillContainer() {
    if (this.containerQueue.length === 0) return;
    const container = this.containerQueue[0];
    const req = container.requirement || {};
    for (const c of COLOR_KEYS) {
      if ((this.balance[c] || 0) < (req[c] || 0)) return;
    }
    // Deduct balance
    for (const c of COLOR_KEYS) {
      const need = req[c] || 0;
      if (need > 0) this.balance[c] = (this.balance[c] || 0) - need;
    }
    // Pop from contributions FIFO (take earliest req[c] of each color)
    const toRemove = [];
    const taken = {};
    for (const c of COLOR_KEYS) taken[c] = 0;
    for (const ct of this.contributions) {
      const need = req[ct.color] || 0;
      if (taken[ct.color] < need) {
        toRemove.push(ct);
        taken[ct.color]++;
        if (Object.values(taken).every((v, i) => v >= (req[COLOR_KEYS[i]] || 0))) break;
      }
    }
    for (const ct of toRemove) {
      this.contributions = this.contributions.filter(c => c !== ct);
    }
    // Remove connections
    for (const ct of toRemove) {
      if (ct.conn) this.connections = this.connections.filter(c => c !== ct.conn);
    }
    // Splice consumed consumers from their queues (each contribution = one consumer from one queue)
    const affectedQueues = new Set();
    for (const ct of toRemove) {
      if (ct.slot?.queueKey && this.consumerQueueData[ct.slot.queueKey]?.length > 0) {
        this.consumerQueueData[ct.slot.queueKey].splice(0, 1);
        affectedQueues.add(ct.slot.queueKey);
      }
    }
    for (const qk of affectedQueues) this.refreshQueueDisplay(qk);
    this.containerQueue.shift();
    this.refreshBalanceDisplay();
    this.refreshContainerCards();
    this.redrawLines();
    this.checkWin();
  }

  tryCutLine() {
    if (!this.cutPath || this.cutPath.length < 2) return;
    for (const conn of this.connections) {
      if (this.pathIntersectsConnection(this.cutPath, conn)) {
        const type = conn.type || 'water-seed';
        if (type === 'seed-consumer') {
          this.balance[conn.from.color] = Math.max(0, (this.balance[conn.from.color] || 0) - 1);
          this.contributions = this.contributions.filter(ct => ct.conn !== conn);
          if (conn.to && conn.to.connection === conn) conn.to.connection = null;
        } else {
          conn.to.hasFlower = false;
          if (conn.to.sprite) {
            conn.to.sprite.setTexture(SPRITE_KEYS.SEED);
            if (conn.to.color) conn.to.sprite.setTint(COLORS[conn.to.color]);
          }
        }
        this.connections = this.connections.filter(c => c !== conn);
        this.refreshBalanceDisplay();
        this.redrawLines();
        break;
      }
    }
  }

  createHintBar(width) {
    const centerY = TOP_BAR_HEIGHT + HINT_BAR_HEIGHT / 2;
    const neutralTint = 0xbbbbbb;
    const textColor = '#e8e8e8';
    const accentColor = '#4ecdc4';
    const iconGap = 6;
    const fs = 11;

    this.add.rectangle(width / 2, centerY, width, HINT_BAR_HEIGHT - 4, 0x1a1a2e, 0.95).setStrokeStyle(2, 0x2d2d44);

    const step1CenterX = width * 0.28;
    const waterX = step1CenterX - 55;
    const seedX = step1CenterX - 20;
    const flowerX = step1CenterX + 15;

    this.add.text(step1CenterX - 75, centerY, '1', { fontSize: fs, color: accentColor, fontFamily: 'sans-serif', fontStyle: 'bold' }).setOrigin(0.5);
    if (this.textures.exists(SPRITE_KEYS.WATER)) {
      this.add.image(waterX, centerY, SPRITE_KEYS.WATER).setDisplaySize(HINT_ICON_SIZE, HINT_ICON_SIZE);
    }
    this.add.text(waterX + HINT_ICON_SIZE / 2 + iconGap, centerY, '+', { fontSize: fs + 2, color: textColor }).setOrigin(0.5);
    if (this.textures.exists(SPRITE_KEYS.SEED)) {
      this.add.image(seedX, centerY, SPRITE_KEYS.SEED).setDisplaySize(HINT_ICON_SIZE, HINT_ICON_SIZE).setTint(neutralTint);
    }
    this.add.text(seedX + HINT_ICON_SIZE / 2 + iconGap, centerY, '=', { fontSize: fs + 2, color: textColor }).setOrigin(0.5);
    if (this.textures.exists(SPRITE_KEYS.FLOWER)) {
      this.add.image(flowerX, centerY, SPRITE_KEYS.FLOWER).setDisplaySize(HINT_ICON_SIZE, HINT_ICON_SIZE).setTint(neutralTint);
    }
    this.add.text(flowerX + HINT_ICON_SIZE / 2 + 4, centerY, '\u2713', { fontSize: fs, color: accentColor }).setOrigin(0.5);

    const step2CenterX = width * 0.72;
    const flower2X = step2CenterX - 35;
    const consumerX = step2CenterX + 10;

    this.add.text(step2CenterX - 75, centerY, '2', { fontSize: fs, color: accentColor, fontFamily: 'sans-serif', fontStyle: 'bold' }).setOrigin(0.5);
    if (this.textures.exists(SPRITE_KEYS.FLOWER)) {
      this.add.image(flower2X, centerY, SPRITE_KEYS.FLOWER).setDisplaySize(HINT_ICON_SIZE, HINT_ICON_SIZE).setTint(neutralTint);
    }
    this.add.text(step2CenterX - 12, centerY, '\u2192', { fontSize: fs + 4, color: accentColor }).setOrigin(0.5);
    if (this.textures.exists(SPRITE_KEYS.CONSUMER)) {
      this.add.image(consumerX, centerY, SPRITE_KEYS.CONSUMER).setDisplaySize(HINT_ICON_SIZE, HINT_ICON_SIZE).setTint(neutralTint);
    }
    this.add.text(consumerX + HINT_ICON_SIZE / 2 + 4, centerY, '\u2713', { fontSize: fs, color: accentColor }).setOrigin(0.5);

    this.add.text(width - 8, centerY, 'No cross \u2717', { fontSize: 9, color: '#e74c3c' }).setOrigin(1, 0.5);
  }

  createDot(dot) {
    const { x, y, type, color, id } = dot;
    let key;
    let size;
    if (type === DOT_TYPES.WATER) {
      key = SPRITE_KEYS.WATER;
      size = DOT_RADIUS * 2;
    } else {
      key = SPRITE_KEYS.SEED;
      size = DOT_RADIUS * 2;
    }
    const sprite = this.add.image(x, y + HEADER_OFFSET, key)
      .setDisplaySize(size, size)
      .setInteractive({ useHandCursor: true });
    if (color && type !== DOT_TYPES.WATER) {
      sprite.setTint(COLORS[color] || 0x888888);
    }
    dot.sprite = sprite;
    dot.displayY = y + HEADER_OFFSET;
    sprite.setData('dot', dot);
    sprite.on('pointerdown', (ptr) => this.onDotDown(dot, ptr));
  }

  onConsumerSlotDown(slot, ptr) {
    if (this.gameOver || this.won) return;
    if (this.selectedDot && this.selectedDot.type === DOT_TYPES.SEED && this.selectedDot.hasFlower && this.selectedDot.color === slot.color && !slot.connection) {
      const startY = this.selectedDot.displayY ?? this.selectedDot.y + HEADER_OFFSET;
      const path = [...this.drawingPath, { x: slot.x, y: slot.y }];
      this.tryConnect(this.selectedDot, slot, path);
      this.selectedDot = null;
      this.drawingPath = [];
      this.clearPreview();
      return;
    }
  }

  onPointerDown(ptr) {
    const hitDot = this.getDotAt(ptr.x, ptr.y);
    const hitSlot = this.getSlotAt(ptr.x, ptr.y);
    if (hitDot) {
      this.pointerDownOnDot = true;
      this.onDotDown(hitDot, ptr);
    } else if (!hitSlot) {
      this.pointerDownOnDot = false;
      this.cutPath = [{ x: ptr.x, y: ptr.y }];
    }
  }

  onDotDown(dot, ptr) {
    if (this.gameOver || this.won) return;
    if (this.hasOutgoingConnection(dot)) return;
    this.selectedDot = dot;
    const startY = dot.displayY ?? dot.y + HEADER_OFFSET;
    this.drawingPath = [{ x: dot.x, y: startY }];
  }

  getSlotAt(x, y) {
    for (const slot of this.consumerSlots) {
      if (!slot.isFirst) continue;
      const dx = x - slot.x;
      const dy = y - slot.y;
      if (dx * dx + dy * dy <= CONSUMER_RADIUS * CONSUMER_RADIUS) return slot;
    }
    return null;
  }

  onPointerUp(ptr) {
    const hitDot = this.getDotAt(ptr.x, ptr.y);
    const hitSlot = this.getSlotAt(ptr.x, ptr.y);
    if (this.selectedDot) {
      if (this.selectedDot.type === DOT_TYPES.WATER && hitDot && hitDot.type === DOT_TYPES.SEED) {
        const path = [...this.drawingPath, { x: hitDot.x, y: hitDot.displayY ?? hitDot.y + HEADER_OFFSET }];
        this.tryConnect(this.selectedDot, hitDot, path);
      } else if (this.selectedDot.type === DOT_TYPES.SEED && hitSlot && this.selectedDot.color === hitSlot.color && !hitSlot.connection) {
        const path = [...this.drawingPath, { x: hitSlot.x, y: hitSlot.y }];
        this.tryConnect(this.selectedDot, hitSlot, path);
      }
    } else if (!this.pointerDownOnDot && this.cutPath && this.cutPath.length > 1) {
      this.tryCutLine();
    }
    if (this.selectedDot) {
      this.selectedDot = null;
      this.drawingPath = [];
    }
    this.clearPreview();
    this.cutPath = [];
  }

  onPointerMove(ptr) {
    if (this.gameOver || this.won) return;
    if (this.selectedDot) {
      const last = this.drawingPath[this.drawingPath.length - 1];
      if (last) {
        const dx = ptr.x - last.x;
        const dy = ptr.y - last.y;
        if (dx * dx + dy * dy >= PATH_POINT_SPACING * PATH_POINT_SPACING) {
          this.drawingPath.push({ x: ptr.x, y: ptr.y });
        }
      }
      this.drawPreview(this.drawingPath);
    } else if (this.cutPath.length > 0) {
      const last = this.cutPath[this.cutPath.length - 1];
      const dx = ptr.x - last.x;
      const dy = ptr.y - last.y;
      if (dx * dx + dy * dy >= PATH_POINT_SPACING * PATH_POINT_SPACING) {
        this.cutPath.push({ x: ptr.x, y: ptr.y });
      }
    }
  }

  getDotAt(x, y) {
    for (const dot of this.dots) {
      const dx = x - dot.x;
      const dy = y - (dot.displayY ?? dot.y + HEADER_OFFSET);
      if (dx * dx + dy * dy <= DOT_RADIUS * DOT_RADIUS) return dot;
    }
    return null;
  }

  clearPreview() {
    this.previewGraphics.clear();
  }

  drawPreview(path) {
    this.previewGraphics.clear();
    if (path.length < 2) return;
    this.previewGraphics.lineStyle(LINE_WIDTH, 0x88ff88, 0.7);
    this.previewGraphics.beginPath();
    this.previewGraphics.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      this.previewGraphics.lineTo(path[i].x, path[i].y);
    }
    this.previewGraphics.strokePath();
  }

  hasOutgoingConnection(dot) {
    return this.connections.some(c => c.from === dot);
  }

  hasIncomingConnection(dot) {
    return this.connections.some(c => c.to === dot);
  }

  slotHasConnection(slot) {
    return this.connections.some(c => c.to === slot);
  }

  tryConnect(from, to, path) {
    if (this.hasOutgoingConnection(from)) return;
    const fromType = from.type;
    const isSlot = to.x !== undefined && to.color !== undefined && (to.queueIndex !== undefined || to.slotIndex !== undefined);
    if (isSlot) {
      if (this.slotHasConnection(to)) return;
    } else if (this.hasIncomingConnection(to)) return;

    // Water -> Seed
    if (fromType === DOT_TYPES.WATER && !isSlot && to.type === DOT_TYPES.SEED) {
      if (!this.addConnection(from, to, path, 'water-seed')) return;
      to.hasFlower = true;
      if (to.sprite) {
        to.sprite.setTexture(SPRITE_KEYS.FLOWER);
        if (to.color) to.sprite.setTint(COLORS[to.color]);
      }
      return;
    }

    // Seed (with flower) -> Consumer slot
    if (fromType === DOT_TYPES.SEED && isSlot) {
      if (!from.hasFlower || from.color !== to.color) return;
      if (!this.addConnection(from, to, path, 'seed-consumer')) return;
      const conn = this.connections[this.connections.length - 1];
      to.connection = conn;
      this.balance[from.color] = (this.balance[from.color] || 0) + 1;
      this.contributions.push({ color: from.color, conn, slot: to });
      this.refreshBalanceDisplay();
      this.tryFulfillContainer();
      this.checkWin();
      return;
    }
  }

  pathIntersectsConnection(path, conn) {
    if (!conn.path || conn.path.length < 2) return false;
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      for (let j = 0; j < conn.path.length - 1; j++) {
        if (segmentsIntersect(p1, p2, conn.path[j], conn.path[j + 1])) return true;
      }
    }
    return false;
  }

  pathIntersectsAny(path, excludeConn) {
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      for (const conn of this.connections) {
        if (conn === excludeConn) continue;
        const connPath = conn.path;
        for (let j = 0; j < connPath.length - 1; j++) {
          if (segmentsIntersect(p1, p2, connPath[j], connPath[j + 1])) return true;
        }
      }
    }
    return false;
  }

  pathSelfIntersects(path) {
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 2; j < path.length - 1; j++) {
        if (segmentsIntersect(path[i], path[i + 1], path[j], path[j + 1])) return true;
      }
    }
    return false;
  }

  addConnection(from, to, path, connType) {
    if (path.length < 2) return false;
    if (this.pathSelfIntersects(path)) {
      this.gameOver = true;
      this.showLoseScreen();
      return false;
    }
    if (this.pathIntersectsAny(path, null)) {
      this.gameOver = true;
      this.showLoseScreen();
      return false;
    }
    this.connections.push({ from, to, path, type: connType || 'water-seed' });
    this.redrawLines();
    return true;
  }

  redrawLines() {
    this.linesGraphics.clear();
    this.linesGraphics.lineStyle(LINE_WIDTH, 0x4ecdc4, 1);
    for (const conn of this.connections) {
      const path = conn.path;
      if (path.length < 2) continue;
      this.linesGraphics.beginPath();
      this.linesGraphics.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        this.linesGraphics.lineTo(path[i].x, path[i].y);
      }
      this.linesGraphics.strokePath();
    }
  }

  checkWin() {
    if (this.containerQueue.length === 0) {
      this.won = true;
      this.showWinScreen();
    }
  }

  showLoseScreen() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);
    this.add.text(width / 2, height / 2 - 30, 'Game Over', { fontSize: '36px', color: '#e74c3c', fontFamily: 'sans-serif' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 20, 'Lines intersected!', { fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 70, 'Retry', { fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }

  showWinScreen() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);
    this.add.text(width / 2, height / 2 - 30, 'Level Complete!', { fontSize: '36px', color: '#2ecc71', fontFamily: 'sans-serif' }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 20, 'All containers fulfilled!', { fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif' }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 70, 'Play Again', { fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }
}
