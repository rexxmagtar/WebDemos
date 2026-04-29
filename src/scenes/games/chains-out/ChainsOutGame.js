import Phaser from '../../../lib/phaser.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';
import {
  LEVEL_SEED,
  COLORS,
  BOARD_ROWS,
  BOARD_COLS,
  CELL_SIZE,
  BOARD_Y,
  QUEUE_Y,
  QUEUE_ROW_STEP,
  QUEUE_COUNT,
  CONVEYOR_Y,
  CONVEYOR_MAX_ITEMS,
  CONVEYOR_STEP_X,
  CHAIN_ROWS_BY_SIZE,
} from './GameConfig.js';
import { generateLevel } from './LevelGenerator.js';

export default class ChainsOutGame extends Phaser.Scene {
  constructor() {
    super({ key: 'ChainsOutGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.CHAIN, ASSET_PATHS.CHAIN);
    this.load.image(SPRITE_KEYS.PIN, ASSET_PATHS.PIN);
    this.load.image(SPRITE_KEYS.CONTAINER, ASSET_PATHS.CONTAINER);
    this.load.image(SPRITE_KEYS.CONVEYOR, ASSET_PATHS.CONVEYOR);
    this.load.image(SPRITE_KEYS.PIPE, ASSET_PATHS.PIPE);
  }

  create() {
    this.cameras.main.setBackgroundColor('#b6bdd7');
    const seed = this.registry.get('levelSeed') ?? LEVEL_SEED;
    const { chains, queues } = generateLevel(seed);

    this.chainById = new Map();
    this.chains = chains.map((ch) => ({ ...ch, state: 'board' }));
    for (const ch of this.chains) this.chainById.set(ch.id, ch);

    this.queues = queues.map((q) => q.map((t) => ({ ...t })));
    this.conveyor = [];
    this.chainViews = new Map();
    this.processing = false;
    this.gameOver = false;
    this.won = false;
    this.consumeCooldown = 0;

    this.boardX = (this.scale.width - BOARD_COLS * CELL_SIZE) / 2;
    this.conveyorStart = { x: this.scale.width / 2 - 86, y: CONVEYOR_Y };
    this.pipeBottomEntry = {
      x: this.scale.width - 92,
      y: BOARD_Y + BOARD_ROWS * CELL_SIZE + 56,
    };
    this.pipeTopExit = {
      x: this.conveyorStart.x - 76,
      y: CONVEYOR_Y + 62,
    };
    // Conveyor token loop follows the inner capsule lane of the conveyor art.
    this.conveyorLoopCenter = { x: this.scale.width / 2, y: CONVEYOR_Y };
    this.conveyorLoopHalfStraight = 132;
    this.conveyorLoopRadius = 12;
    this.pipeRoute = [
      { x: this.pipeBottomEntry.x, y: this.pipeBottomEntry.y },
      { x: this.pipeBottomEntry.x, y: this.pipeBottomEntry.y - 84 },
      { x: 62, y: this.pipeBottomEntry.y - 84 },
      { x: 62, y: this.pipeTopExit.y + 46 },
      { x: this.pipeTopExit.x, y: this.pipeTopExit.y + 46 },
      { x: this.pipeTopExit.x, y: this.pipeTopExit.y },
    ];

    this.buildBackButton();
    this.buildQueueArea();
    this.buildConveyor();
    this.buildPipe();
    this.buildBoard();
    this.refreshQueues();
    this.refreshConveyor();
  }

  buildBackButton() {
    this.add
      .text(56, 26, 'Back', { fontSize: '18px', color: '#1f2937', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setDepth(20)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        window.location.href = 'index.html';
      });
  }

  buildQueueArea() {
    this.queueViews = [];
    const spacing = 120;
    const totalW = QUEUE_COUNT * spacing;
    const startX = (this.scale.width - totalW) / 2 + spacing / 2;
    for (let q = 0; q < QUEUE_COUNT; q++) {
      this.queueViews[q] = [];
      const x = startX + q * spacing;
      for (let row = 0; row < 4; row++) {
        const y = QUEUE_Y + row * QUEUE_ROW_STEP;
        const slot = this.add.image(x, y, SPRITE_KEYS.CONTAINER).setDisplaySize(74, 74).setTint(0xb9c8e5);
        slot.setAlpha(0.45);
        this.queueViews[q].push({ slot, token: null, capText: null, fillBar: null });
      }
    }
  }

  buildConveyor() {
    this.add
      .image(this.scale.width / 2, CONVEYOR_Y, SPRITE_KEYS.CONVEYOR)
      .setDisplaySize(500, 96)
      .setTint(0x7b7f8f)
      .setDepth(1);
    this.conveyorItemsGroup = this.add.group();
  }

  buildPipe() {
    const g = this.add.graphics().setDepth(1.5);
    g.lineStyle(13, 0xdce3ef, 0.98);
    for (let i = 0; i < this.pipeRoute.length - 1; i++) {
      const a = this.pipeRoute[i];
      const b = this.pipeRoute[i + 1];
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    this.add
      .image(this.pipeBottomEntry.x, this.pipeBottomEntry.y, SPRITE_KEYS.PIPE)
      .setDisplaySize(50, 50)
      .setDepth(2)
      .setTint(0xe8edf5);
    this.add
      .image(this.pipeTopExit.x, this.pipeTopExit.y, SPRITE_KEYS.PIPE)
      .setDisplaySize(44, 44)
      .setDepth(2)
      .setTint(0xe8edf5);
  }

  buildBoard() {
    const boardW = BOARD_COLS * CELL_SIZE;
    const boardH = BOARD_ROWS * CELL_SIZE;
    this.add
      .rectangle(this.scale.width / 2, BOARD_Y + boardH / 2, boardW + 28, boardH + 28, 0xaeb6d3)
      .setStrokeStyle(6, 0xd7deee)
      .setDepth(0);

    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const p = this.getBoardPoint(r, c);
        this.add.image(p.x, p.y, SPRITE_KEYS.PIN).setDisplaySize(30, 30).setDepth(2.5);
      }
    }

    const sorted = [...this.chains].sort((a, b) => a.z - b.z);
    for (const chain of sorted) {
      this.createChainView(chain);
    }
    this.refreshChainInteractivity();
  }

  getBoardPoint(r, c) {
    return {
      x: this.boardX + c * CELL_SIZE + CELL_SIZE / 2,
      y: BOARD_Y + r * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  createChainView(chain) {
    const p1 = this.getBoardPoint(chain.endpointA.r, chain.endpointA.c);
    const p2 = this.getBoardPoint(chain.endpointB.r, chain.endpointB.c);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const len = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
    const angle = Phaser.Math.Angle.Between(p1.x, p1.y, p2.x, p2.y);
    const cont = this.add.container(mx, my).setDepth(3 + chain.z / 1000);
    const thickness = 12 + chain.sizeUnits * 3;
    const tileStep = 14;
    const tileCount = Math.max(2, Math.floor(len / tileStep));
    const tileWidth = tileStep + 4;
    const tint = COLORS[chain.color];
    const link = this.add.container(0, 0);
    link.rotation = angle;
    for (let i = 0; i < tileCount; i++) {
      const t = tileCount <= 1 ? 0 : i / (tileCount - 1);
      const x = (t - 0.5) * len;
      const piece = this.add.image(x, 0, SPRITE_KEYS.CHAIN);
      piece.setDisplaySize(tileWidth, thickness);
      piece.setTint(tint);
      link.add(piece);
    }
    cont.add(link);

    const hit = this.add.rectangle(0, 0, len, 30, 0x000000, 0);
    hit.rotation = angle;
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.onChainTapped(chain.id));
    cont.add(hit);

    this.chainViews.set(chain.id, { cont, link, hit, p1, p2, angle, len });
  }

  refreshChainInteractivity() {
    for (const ch of this.chains) {
      const view = this.chainViews.get(ch.id);
      if (!view || ch.state !== 'board') continue;
      const blocked = this.isBlocked(ch);
      view.link.setAlpha(blocked ? 0.35 : 1);
      view.hit.disableInteractive();
      if (!blocked && !this.processing && !this.gameOver && !this.won) {
        view.hit.setInteractive({ useHandCursor: true });
      }
    }
  }

  isBlocked(chain) {
    for (const blockerId of chain.blockedByIds) {
      const blocker = this.chainById.get(blockerId);
      if (blocker && blocker.state === 'board') return true;
    }
    return false;
  }

  onChainTapped(chainId) {
    if (this.processing || this.gameOver || this.won) return;
    const chain = this.chainById.get(chainId);
    const view = this.chainViews.get(chainId);
    if (!chain || !view) return;
    if (chain.state !== 'board' || this.isBlocked(chain)) return;
    if (this.conveyor.length >= CONVEYOR_MAX_ITEMS) return;

    this.processing = true;
    chain.state = 'movingToPipe';
    view.hit.disableInteractive();
    this.refreshChainInteractivity();

    const start = { x: view.cont.x, y: view.cont.y };
    const toBottom = [
      start,
      { x: start.x + 26, y: start.y + 60 },
      { x: this.pipeBottomEntry.x - 20, y: this.pipeBottomEntry.y - 24 },
      { x: this.pipeBottomEntry.x, y: this.pipeBottomEntry.y },
    ];

    this.animateAlongPoints(view.cont, toBottom, 440, 9, () => {
      view.cont.setScale(0.55);
      this.animateAlongPoints(view.cont, this.pipeRoute, 1100, 7, () => {
        view.cont.destroy();
        this.chainViews.delete(chain.id);
        const fly = this.createConveyorToken(this.pipeTopExit.x, this.pipeTopExit.y, chain);
        fly.setDepth(8);
        const entry = this.getConveyorPoint(0);
        this.tweens.add({
          targets: fly,
          x: entry.x,
          y: entry.y,
          scaleX: 0.92,
          scaleY: 0.92,
          duration: 340,
          ease: 'Sine.Out',
          onComplete: () => {
            fly.destroy();
            chain.state = 'onConveyor';
            this.conveyor.push({ id: chain.id, color: chain.color, sizeUnits: chain.sizeUnits, view: null });
            this.refreshConveyor();
            this.processing = false;
            this.refreshChainInteractivity();
          },
        });
      });
    });
  }

  getConveyorPoint(t) {
    const cx = this.conveyorLoopCenter.x;
    const cy = this.conveyorLoopCenter.y;
    const hs = this.conveyorLoopHalfStraight;
    const r = this.conveyorLoopRadius;
    const perimeter = 2 * hs + 2 * Math.PI * r;
    let d = ((t % 1) + 1) % 1;
    d *= perimeter;

    // top straight: left -> right
    if (d < 2 * hs) {
      return { x: cx - hs + d, y: cy - r };
    }
    d -= 2 * hs;

    // right semicircle: top -> bottom
    if (d < Math.PI * r) {
      const a = -Math.PI / 2 + d / r;
      return { x: cx + hs + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    }
    d -= Math.PI * r;

    // bottom straight: right -> left
    if (d < 2 * hs) {
      return { x: cx + hs - d, y: cy + r };
    }
    d -= 2 * hs;

    // left semicircle: bottom -> top
    const a = Math.PI / 2 + d / r;
    return { x: cx - hs + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }

  animateAlongPoints(target, points, duration, snakeAmp, onComplete) {
    if (!target || !points || points.length < 2) {
      if (onComplete) onComplete();
      return;
    }
    const segLens = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      segLens.push(len);
      total += len;
    }
    const counter = { t: 0 };
    this.tweens.add({
      targets: counter,
      t: 1,
      duration,
      ease: 'Sine.InOut',
      onUpdate: () => {
        let dist = counter.t * total;
        let seg = 0;
        while (seg < segLens.length - 1 && dist > segLens[seg]) {
          dist -= segLens[seg];
          seg += 1;
        }
        const a = points[seg];
        const b = points[seg + 1];
        const len = Math.max(1e-6, segLens[seg]);
        const u = Phaser.Math.Clamp(dist / len, 0, 1);
        const x = Phaser.Math.Linear(a.x, b.x, u);
        const y = Phaser.Math.Linear(a.y, b.y, u);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const norm = Math.hypot(dx, dy) || 1;
        const nx = -dy / norm;
        const ny = dx / norm;
        const wave = Math.sin(counter.t * Math.PI * 10) * snakeAmp;
        target.x = x + nx * wave;
        target.y = y + ny * wave;
        target.rotation = Math.atan2(dy, dx) + Math.sin(counter.t * Math.PI * 8) * 0.15;
      },
      onComplete: () => {
        target.rotation = 0;
        if (onComplete) onComplete();
      },
    });
  }

  createConveyorToken(x, y, chain) {
    const rows = CHAIN_ROWS_BY_SIZE[chain.remainingUnits ?? chain.sizeUnits] ?? 2;
    const items = [];
    const step = 7;
    for (let i = 0; i < rows; i++) {
      const stripe = this.add.image((i - (rows - 1) / 2) * step, 0, SPRITE_KEYS.CHAIN);
      stripe.setDisplaySize(6, 32);
      stripe.setTint(COLORS[chain.color]);
      items.push(stripe);
    }
    const c = this.add.container(x, y, items).setDepth(4);
    return c;
  }

  refreshConveyor() {
    this.conveyorItemsGroup.clear(true, true);
    for (let i = 0; i < this.conveyor.length; i++) {
      const t = this.conveyor.length > 0 ? i / this.conveyor.length : 0;
      const p = this.getConveyorPoint(t);
      const x = p.x;
      const y = p.y;
      const token = this.createConveyorToken(x, y, this.conveyor[i]);
      token.loopOffset = t;
      this.conveyor[i].view = token;
      this.conveyorItemsGroup.add(token);
    }
  }

  refreshQueues() {
    for (let q = 0; q < QUEUE_COUNT; q++) {
      const queue = this.queues[q] || [];
      for (let row = 0; row < this.queueViews[q].length; row++) {
        const cell = this.queueViews[q][row];
        if (cell.token) cell.token.destroy();
        if (cell.capText) cell.capText.destroy();
        if (cell.fillBar) cell.fillBar.destroy();
        cell.token = null;
        cell.capText = null;
        cell.fillBar = null;

        const queueIndexForRow = this.queueViews[q].length - 1 - row;
        const item = queue[queueIndexForRow];
        const active = queueIndexForRow === 0;
        cell.slot.setAlpha(active ? 0.95 : 0.45);
        if (!item) continue;
        cell.token = this.add
          .image(cell.slot.x, cell.slot.y, SPRITE_KEYS.CONTAINER)
          .setDisplaySize(74, 74)
          .setTint(COLORS[item.color])
          .setAlpha(active ? 1 : 0.55)
          .setDepth(5);
        cell.capText = this.add
          .text(cell.slot.x, cell.slot.y, String(item.capacityLeft), {
            fontSize: '22px',
            color: '#ffffff',
            fontFamily: 'sans-serif',
            stroke: '#1f2937',
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(6);
        const filledRatio = Phaser.Math.Clamp(
          (item.capacityTotal - item.capacityLeft) / Math.max(1, item.capacityTotal),
          0,
          1
        );
        const fillMaxW = 44;
        const fillW = Math.max(0, fillMaxW * filledRatio);
        cell.fillBar = this.add
          .rectangle(cell.slot.x - fillMaxW / 2 + fillW / 2, cell.slot.y + 18, fillW, 6, COLORS[item.color], 0.95)
          .setDepth(6.2);
      }
    }
  }

  tryConsumeFromConveyor() {
    if (!this.conveyor.length) return false;
    for (let i = 0; i < this.conveyor.length; i++) {
      const chain = this.conveyor[i];
      let matchQ = -1;
      for (let q = 0; q < QUEUE_COUNT; q++) {
        const active = this.queues[q]?.[0];
        if (!active) continue;
        if (active.color === chain.color && active.capacityLeft > 0) {
          matchQ = q;
          break;
        }
      }
      if (matchQ < 0) continue;
      this.consumeChain(i, matchQ);
      return true;
    }
    return false;
  }

  consumeChain(conveyorIdx, queueIdx) {
    const chain = this.conveyor[conveyorIdx];
    const active = this.queues[queueIdx][0];
    if (!chain || !active) return;
    const chainData = this.chainById.get(chain.id);
    if (!chainData || !chain.view) return;
    const remainingUnits = chain.remainingUnits ?? chain.sizeUnits;
    const consumeUnits = Math.min(remainingUnits, active.capacityLeft);
    if (consumeUnits <= 0) return;

    this.processing = true;
    const activeRow = this.queueViews[queueIdx].length - 1;
    const target = this.queueViews[queueIdx][activeRow].slot;
    const tokenView = chain.view;
    const spoolFx = this.add.graphics().setDepth(8);
    this.tweens.add({
      targets: tokenView,
      x: target.x,
      y: target.y,
      scaleX: 0.25,
      scaleY: 0.25,
      alpha: 0.25,
      duration: 460,
      ease: 'Sine.Out',
      onUpdate: () => {
        spoolFx.clear();
        spoolFx.lineStyle(3, COLORS[chain.color], 0.85);
        const midX = (tokenView.x + target.x) / 2;
        const bend = Math.sin(this.time.now * 0.03) * 8;
        const curve = new Phaser.Curves.QuadraticBezier(
          new Phaser.Math.Vector2(tokenView.x, tokenView.y),
          new Phaser.Math.Vector2(midX, tokenView.y - 24 + bend),
          new Phaser.Math.Vector2(target.x, target.y)
        );
        const pts = curve.getPoints(14);
        for (let i = 0; i < pts.length - 1; i++) {
          spoolFx.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        }
      },
      onComplete: () => {
        spoolFx.destroy();
        tokenView.destroy();
        active.capacityLeft -= consumeUnits;
        chain.remainingUnits = remainingUnits - consumeUnits;
        if (chain.remainingUnits <= 0) {
          this.conveyor.splice(conveyorIdx, 1);
          chainData.state = 'consumed';
        } else {
          chainData.state = 'onConveyor';
        }
        if (active.capacityLeft <= 0) {
          this.queues[queueIdx].shift();
        }
        this.processing = false;
        this.refreshConveyor();
        this.refreshQueues();
        this.refreshChainInteractivity();
        this.checkEndState();
      },
    });
  }

  hasSpoolingInProgress() {
    for (const ch of this.chains) {
      if (ch.state === 'movingToPipe') return true;
    }
    return this.processing;
  }

  canConsumeAny() {
    for (const ch of this.conveyor) {
      for (let q = 0; q < QUEUE_COUNT; q++) {
        const active = this.queues[q]?.[0];
        if (!active) continue;
        if (active.color === ch.color && active.capacityLeft >= ch.sizeUnits) return true;
      }
    }
    return false;
  }

  checkEndState() {
    if (this.gameOver || this.won) return;
    const leftOnBoard = this.chains.some((ch) => ch.state === 'board');
    const leftMoving = this.chains.some((ch) => ch.state === 'movingToPipe');
    const leftOnConveyor = this.chains.some((ch) => ch.state === 'onConveyor');
    if (!leftOnBoard && !leftMoving && !leftOnConveyor) {
      this.won = true;
      this.showEndMessage('You Win! All chains spooled.');
      return;
    }

    const conveyorFull = this.conveyor.length >= CONVEYOR_MAX_ITEMS;
    if (conveyorFull && !this.hasSpoolingInProgress() && !this.canConsumeAny()) {
      this.gameOver = true;
      this.showEndMessage('Game Over! Conveyor is stuck.');
    }
  }

  showEndMessage(text) {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, 430, 180, 0x000000, 0.72).setDepth(100);
    this.add
      .text(width / 2, height / 2 - 18, text, {
        fontSize: '28px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(101);
    this.add
      .text(width / 2, height / 2 + 42, 'Play Again', {
        fontSize: '24px',
        color: '#7dd3fc',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(101)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.restart());
  }

  update(_, delta) {
    if (this.gameOver || this.won) return;
    this.updateConveyorMotion(delta);
    this.consumeCooldown -= delta;
    if (this.consumeCooldown <= 0 && !this.processing) {
      this.consumeCooldown = 180;
      this.tryConsumeFromConveyor();
      this.checkEndState();
    }
  }

  updateConveyorMotion(delta) {
    if (!this.conveyor.length) return;
    const speed = 0.000075 * delta;
    for (let i = 0; i < this.conveyor.length; i++) {
      const chain = this.conveyor[i];
      const token = chain.view;
      if (!token || !token.active) continue;
      token.loopOffset = (token.loopOffset + speed) % 1;
      const p = this.getConveyorPoint(token.loopOffset);
      token.x = p.x;
      token.y = p.y;
    }
  }
}
