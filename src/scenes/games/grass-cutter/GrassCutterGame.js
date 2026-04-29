import Phaser from '../../../lib/phaser.js';
import { SPRITE_KEYS, ASSET_PATHS } from './SpriteKeys.js';
import {
  LEVEL_SEED,
  GRID_ROWS,
  GRID_COLS,
  CELL_SIZE,
  COLORS,
  TOP_GRID_Y,
  QUEUE_Y,
  RESERVE_Y,
  RESERVE_SLOT_COUNT,
  SAW_MOVE_MS,
  MAX_CONVEYOR_SAWS,
} from './GameConfig.js';
import { generateLevel } from './LevelGenerator.js';

const DIRS = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: -1, dc: 0 },
];
const DIR_PRIORITY = [
  { dr: 0, dc: -1 }, // left
  { dr: -1, dc: 0 }, // top
  { dr: 0, dc: 1 }, // right
  { dr: 1, dc: 0 }, // down
];
const ALL_NEIGHBOR_DIRS = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
];
function keyForPoint(x, y) {
  return `${x},${y}`;
}

export default class GrassCutterGame extends Phaser.Scene {
  constructor() {
    super({ key: 'GrassCutterGame' });
  }

  preload() {
    this.load.image(SPRITE_KEYS.GRASS, ASSET_PATHS.GRASS);
    this.load.image(SPRITE_KEYS.SAW, ASSET_PATHS.SAW);
    this.load.image(SPRITE_KEYS.SLOT, ASSET_PATHS.SLOT);
    this.load.image(SPRITE_KEYS.CONVEYOR, ASSET_PATHS.CONVEYOR);
  }

  create() {
    this.cameras.main.setBackgroundColor('#bde9ea');
    const seed = this.registry.get('levelSeed') ?? LEVEL_SEED;
    const { grid, queues } = generateLevel(seed);

    this.grid = grid;
    this.queues = queues.map((q) => [...q]);
    this.reserve = Array(RESERVE_SLOT_COUNT).fill(null);
    this.conveyorSaws = [];
    this.launchInProgress = false;
    this.processing = false;
    this.gameOver = false;
    this.won = false;

    this.boardX = (this.scale.width - GRID_COLS * CELL_SIZE) / 2;
    this.boardY = TOP_GRID_Y;

    this.buildBackButton();
    this.buildGarden();
    this.buildConveyorLayer();
    this.buildQueues();
    this.buildReserveSlots();
    this.rebuildConveyorPath();
    this.refreshQueueDisplay();
  }

  buildBackButton() {
    this.add
      .text(56, 26, 'Back', { fontSize: '18px', color: '#1f2937', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        window.location.href = 'index.html';
      });
  }

  buildGarden() {
    const w = GRID_COLS * CELL_SIZE;
    const h = GRID_ROWS * CELL_SIZE;
    this.add
      .rectangle(this.boardX + w / 2, this.boardY + h / 2, w + 24, h + 24, 0xe9f9ff, 1)
      .setStrokeStyle(4, 0x8aa7be);

    this.grassSprites = [];
    this.cellBacks = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      this.grassSprites[r] = [];
      this.cellBacks[r] = [];
      for (let c = 0; c < GRID_COLS; c++) {
        const pos = this.getCellCenter(r, c);
        const back = this.add
          .rectangle(pos.x, pos.y, CELL_SIZE - 2, CELL_SIZE - 2, 0xf8feff, 1)
          .setStrokeStyle(1, 0xbfd4e5);
        this.cellBacks[r][c] = back;
        this.grassSprites[r][c] = null;
      }
    }
    this.refreshGridSprites();
  }

  buildConveyorLayer() {
    this.conveyorGraphics = this.add.graphics().setDepth(3);
    this.conveyorNodes = this.add.group();
    this.boundaryDebugDots = this.add.group();
    this.conveyorStartMarker = this.add.circle(0, 0, 16, 0xffb703, 0.95).setDepth(4);
    this.conveyorStartMarker.setStrokeStyle(4, 0xfb8500);
    this.conveyorStartMarker.setVisible(false);
    this.conveyorCountText = this.add
      .text(this.scale.width / 2, this.boardY - 28, '', {
        fontSize: '22px',
        color: '#1f2937',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);
    this.refreshConveyorCount();
  }

  buildQueues() {
    this.queueSlots = [];
    this.queueSawSprites = [];
    const count = this.queues.length;
    const slotW = 118;
    const totalW = count * slotW;
    const startX = (this.scale.width - totalW) / 2;

    for (let q = 0; q < count; q++) {
      const x = startX + q * slotW + slotW / 2;
      this.queueSawSprites[q] = [];
      for (let row = 0; row < Math.max(4, this.queues[q].length); row++) {
        const y = QUEUE_Y + row * 66;
        const slot = this.add.image(x, y, SPRITE_KEYS.SLOT).setDisplaySize(58, 58).setTint(0xd7e3f0);
        if (row === 0) {
          slot.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.onQueueClick(q));
        }
        this.queueSlots.push(slot);
      }
    }
  }

  buildReserveSlots() {
    this.reserveSlotViews = [];
    const spacing = 118;
    const totalW = RESERVE_SLOT_COUNT * spacing;
    const startX = (this.scale.width - totalW) / 2 + spacing / 2;
    this.add
      .text(this.scale.width / 2, RESERVE_Y - 66, 'Reserve Slots', {
        fontSize: '24px',
        color: '#1f2937',
        fontFamily: 'sans-serif',
      })
      .setOrigin(0.5);

    for (let i = 0; i < RESERVE_SLOT_COUNT; i++) {
      const x = startX + i * spacing;
      const slot = this.add.image(x, RESERVE_Y, SPRITE_KEYS.SLOT).setDisplaySize(82, 82).setTint(0xc6d7ea);
      slot.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.onReserveClick(i));
      this.reserveSlotViews[i] = { slot, saw: null };
    }
  }

  getCellCenter(r, c) {
    return {
      x: this.boardX + c * CELL_SIZE + CELL_SIZE / 2,
      y: this.boardY + r * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  areAdjacentCells(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  refreshGridSprites() {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const color = this.grid[r][c];
        const old = this.grassSprites[r][c];
        if (!color) {
          if (old) {
            old.destroy();
            this.grassSprites[r][c] = null;
          }
          continue;
        }
        const pos = this.getCellCenter(r, c);
        if (!old) {
          const sprite = this.add.image(pos.x, pos.y, SPRITE_KEYS.GRASS).setDepth(2);
          sprite.setDisplaySize(CELL_SIZE - 8, CELL_SIZE - 8);
          sprite.setTint(COLORS[color]);
          this.grassSprites[r][c] = sprite;
        } else {
          old.setTint(COLORS[color]);
        }
      }
    }
  }

  refreshQueueDisplay() {
    for (let q = 0; q < this.queues.length; q++) {
      const old = this.queueSawSprites[q] || [];
      for (const token of old) token.container.destroy();
      this.queueSawSprites[q] = [];
      const list = this.queues[q];
      const slotW = 118;
      const startX = (this.scale.width - this.queues.length * slotW) / 2;
      const x = startX + q * slotW + slotW / 2;
      for (let row = 0; row < list.length; row++) {
        const saw = list[row];
        const y = QUEUE_Y + row * 66;
        const token = this.createSawToken(x, y, saw.color, saw.capacity, 54);
        token.container.setAlpha(row === 0 ? 1 : 0.45);
        this.queueSawSprites[q].push(token);
      }
    }
  }

  createSawToken(x, y, color, capacity, size = CELL_SIZE - 12) {
    const blade = this.add.image(0, 0, SPRITE_KEYS.SAW);
    blade.setDisplaySize(size, size);
    blade.setTint(COLORS[color]);
    const label = this.add.text(0, 0, String(capacity), {
      fontSize: `${Math.max(14, Math.floor(size * 0.32))}px`,
      color: '#ffffff',
      fontFamily: 'sans-serif',
      stroke: '#1f2937',
      strokeThickness: 3,
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [blade, label]).setDepth(6);
    return { container, blade, label };
  }

  refreshConveyorCount() {
    if (!this.conveyorCountText) return;
    this.conveyorCountText.setText(`Conveyor: ${this.conveyorSaws.length}/${MAX_CONVEYOR_SAWS}`);
  }

  onQueueClick(q) {
    if (this.processing || this.launchInProgress || this.gameOver || this.won) return;
    if (!this.queues[q]?.length) return;
    if (!this.conveyorPath.length) return;
    if (this.conveyorSaws.length >= MAX_CONVEYOR_SAWS) return;

    const saw = this.queues[q].shift();
    this.refreshQueueDisplay();
    const from = this.getQueueTopPos(q);
    this.launchSawToConveyor(saw, from);
  }

  getQueueTopPos(q) {
    const slotW = 118;
    const startX = (this.scale.width - this.queues.length * slotW) / 2;
    return { x: startX + q * slotW + slotW / 2, y: QUEUE_Y };
  }

  onReserveClick(slotIndex) {
    if (this.processing || this.launchInProgress || this.gameOver || this.won) return;
    if (!this.reserve[slotIndex]) return;
    if (!this.conveyorPath.length) return;
    if (this.conveyorSaws.length >= MAX_CONVEYOR_SAWS) return;

    const sawData = this.reserve[slotIndex];
    const slotView = this.reserveSlotViews[slotIndex];
    if (slotView.saw?.container) slotView.saw.container.destroy();
    slotView.saw = null;
    this.reserve[slotIndex] = null;

    this.launchSawToConveyor({ ...sawData }, { x: slotView.slot.x, y: slotView.slot.y });
  }

  launchSawToConveyor(saw, fromPos) {
    this.launchInProgress = true;
    const startPoint = this.conveyorPath[0];
    const to = this.getCellCenter(startPoint.r, startPoint.c);
    const token = this.createSawToken(fromPos.x, fromPos.y, saw.color, saw.capacity);
    token.container.setDepth(8);

    this.tweens.add({
      targets: token.container,
      x: to.x,
      y: to.y,
      duration: 220,
      ease: 'Back.Out',
      onComplete: () => {
        this.conveyorSaws.push({
          ...saw,
          token,
          pathIndex: 0,
          hasMoved: false,
          moving: false,
        });
        this.refreshConveyorCount();
        this.launchInProgress = false;
      },
    });
  }

  update() {
    if (this.gameOver || this.won) return;
    if (!this.conveyorSaws.length || !this.conveyorPath.length) return;

    const saws = [...this.conveyorSaws];
    for (const saw of saws) {
      if (!this.conveyorSaws.includes(saw)) continue;
      if (saw.moving) continue;
      this.advanceSaw(saw);
      if (this.gameOver || this.won) return;
    }
  }

  advanceSaw(saw) {
    if (!this.conveyorPath.length) return;
    const nextIndex = (saw.pathIndex + 1) % this.conveyorPath.length;
    const current = this.conveyorPath[saw.pathIndex];
    const next = this.conveyorPath[nextIndex];
    const start = this.conveyorPath[0];
    if (
      saw.hasMoved &&
      current &&
      start &&
      current.r === start.r &&
      current.c === start.c
    ) {
      this.finishSawRun(saw);
      return;
    }
    if (
      saw.hasMoved &&
      next &&
      start &&
      next.r === start.r &&
      next.c === start.c &&
      current &&
      current.r === next.r &&
      current.c === next.c
    ) {
      this.finishSawRun(saw);
      return;
    }
    if (!current || !next || !this.areAdjacentCells(current, next)) return;
    const pos = this.getCellCenter(next.r, next.c);
    saw.moving = true;
    this.tweens.add({
      targets: saw.token.container,
      x: pos.x,
      y: pos.y,
      duration: SAW_MOVE_MS,
      ease: 'Linear',
      onComplete: () => {
        if (!this.conveyorSaws.includes(saw) || this.gameOver || this.won) return;
        saw.pathIndex = nextIndex;
        saw.hasMoved = true;
        saw.token.blade.angle += 35;

        const didCut = this.tryCutAtPoint(saw, next);
        if (!this.conveyorSaws.includes(saw) || this.gameOver || this.won) return;

        if (saw.pathIndex === 0 && saw.hasMoved) {
          this.finishSawRun(saw);
          return;
        }
        saw.moving = false;
      },
    });
  }

  tryCutAtPoint(saw, point) {
    const targets = [];
    for (const dir of DIRS) {
      const nr = point.r + dir.dr;
      const nc = point.c + dir.dc;
      if (!this.inBounds(nr, nc)) continue;
      if (this.grid[nr][nc] !== null) targets.push({ r: nr, c: nc });
    }
    for (const target of targets) {
      if (!this.inBounds(target.r, target.c)) continue;
      if (this.grid[target.r][target.c] !== saw.color) continue;

      this.grid[target.r][target.c] = null;
      saw.capacity -= 1;
      saw.token.label.setText(String(saw.capacity));
      this.refreshGridSprites();
      this.rebuildConveyorPath({ r: point.r, c: point.c });
      this.checkWinCondition();

      if (saw.capacity <= 0) {
        saw.token.container.destroy();
        this.conveyorSaws = this.conveyorSaws.filter((s) => s !== saw);
        this.refreshConveyorCount();
      }
      return true;
    }
    return false;
  }

  finishSawRun(saw) {
    if (this.gameOver || this.won) return;
    if (!this.conveyorSaws.includes(saw)) return;
    const slotIndex = this.reserve.findIndex((s) => s === null);
    if (slotIndex < 0) {
      this.triggerGameOver('Game Over! Reserve full.');
      return;
    }

    const slotView = this.reserveSlotViews[slotIndex];
    const toX = slotView.slot.x;
    const toY = slotView.slot.y;
    this.conveyorSaws = this.conveyorSaws.filter((s) => s !== saw);
    this.refreshConveyorCount();
    saw.moving = true;
    saw.token.container.setDepth(9);
    this.tweens.add({
      targets: saw.token.container,
      x: toX,
      y: toY,
      duration: 280,
      ease: 'Back.Out',
      onComplete: () => {
        saw.token.blade.setDisplaySize(64, 64);
        saw.token.container.setDepth(4);
        this.reserve[slotIndex] = { color: saw.color, capacity: saw.capacity };
        slotView.saw = saw.token;
        saw.moving = false;
        this.checkNoProgressLose();
      },
    });
  }

  inBounds(r, c) {
    return r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS;
  }

  rebuildConveyorPath(anchor = null) {
    const previousPath = this.conveyorPath ? [...this.conveyorPath] : [];
    const isEmpty = (r, c) => this.inBounds(r, c) && this.grid[r][c] === null;
    const candidateSet = new Set();
    const candidates = [];

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (!isEmpty(r, c)) continue;
        let touchesGrass = false;
        for (const dir of ALL_NEIGHBOR_DIRS) {
          const nr = r + dir.dr;
          const nc = c + dir.dc;
          if (this.inBounds(nr, nc) && this.grid[nr][nc] !== null) {
            touchesGrass = true;
            break;
          }
        }
        if (touchesGrass) {
          candidateSet.add(keyForPoint(r, c));
          candidates.push({ r, c });
        }
      }
    }
    this.redrawBoundaryDebugDots(candidates);

    const path = [];
    if (candidates.length) {
      const sorted = candidates.slice().sort((a, b) => a.c - b.c || b.r - a.r);
      const start = sorted[0];

      // Connected component from the chosen start using the same priority neighbors.
      const compSet = new Set();
      const queue = [start];
      compSet.add(keyForPoint(start.r, start.c));
      while (queue.length) {
        const cur = queue.shift();
        for (const nb of this.getPriorityNeighbors(cur.r, cur.c)) {
          const nk = keyForPoint(nb.r, nb.c);
          if (!candidateSet.has(nk) || compSet.has(nk)) continue;
          compSet.add(nk);
          queue.push(nb);
        }
      }

      const startKey = keyForPoint(start.r, start.c);
      const visited = new Set([startKey]);
      const routeStack = [{ r: start.r, c: start.c }];
      path.push({ r: start.r, c: start.c });

      let guard = 0;
      while (routeStack.length && guard < compSet.size * 6 + 40) {
        guard += 1;
        const current = routeStack[routeStack.length - 1];

        const next = this.getPriorityNeighbors(current.r, current.c).find((nb) => {
          const nk = keyForPoint(nb.r, nb.c);
          return compSet.has(nk) && !visited.has(nk);
        });

        if (next) {
          visited.add(keyForPoint(next.r, next.c));
          routeStack.push({ r: next.r, c: next.c });
          path.push({ r: next.r, c: next.c });
          continue;
        }

        if (visited.size >= compSet.size && this.areAdjacentCells(current, start)) {
          path.push({ r: start.r, c: start.c });
          break;
        }

        // Only true dead ends emit a backtrack edge.
        routeStack.pop();
        const backTo = routeStack[routeStack.length - 1];
        if (backTo) path.push({ r: backTo.r, c: backTo.c });
      }
    }

    if (!path.length && anchor) {
      path.push(anchor);
    }

    // Never allow conveyor to disappear after a cut:
    // if rebuild fails to produce a usable path, keep previous valid loop/path.
    if (path.length < 2 && previousPath.length >= 2) {
      path.length = 0;
      path.push(...previousPath);
    }

    const oldPath = this.conveyorPath || [];
    const oldPositions = this.conveyorSaws.map((saw) => oldPath[saw.pathIndex] || null);

    this.conveyorPath = path;
    this.redrawConveyor(path);

    if (path.length && this.conveyorSaws.length) {
      this.conveyorSaws.forEach((saw, idx) => {
        const source = oldPositions[idx] || anchor;
        if (!source) return;
        let best = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < path.length; i++) {
          const d = Math.abs(path[i].r - source.r) + Math.abs(path[i].c - source.c);
          if (d < bestDist) {
            best = i;
            bestDist = d;
          }
        }
        saw.pathIndex = best;
        const p = this.getCellCenter(path[best].r, path[best].c);
        saw.token.container.setPosition(p.x, p.y);
      });
    }
  }

  redrawConveyor(path) {
    this.conveyorGraphics.clear();
    this.conveyorGraphics.lineStyle(10, 0x2e6ea5, 0.35);
    this.conveyorNodes.clear(true, true);
    if (!path.length) {
      this.conveyorStartMarker.setVisible(false);
      return;
    }

    for (let i = 0; i < path.length; i++) {
      const cur = this.getCellCenter(path[i].r, path[i].c);
      const n = this.add.image(cur.x, cur.y, SPRITE_KEYS.CONVEYOR).setDepth(3);
      n.setDisplaySize(22, 22);
      this.conveyorNodes.add(n);
    }

    const edgeCounts = new Map();
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (!this.areAdjacentCells(a, b)) continue;
      const ak = keyForPoint(a.r, a.c);
      const bk = keyForPoint(b.r, b.c);
      const ek = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
      edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);
    }

    for (const [edgeKey, count] of edgeCounts.entries()) {
      const [aKey, bKey] = edgeKey.split('|');
      const [ar, ac] = aKey.split(',').map(Number);
      const [br, bc] = bKey.split(',').map(Number);
      const p1 = this.getCellCenter(ar, ac);
      const p2 = this.getCellCenter(br, bc);

      if (count <= 1) {
        this.conveyorGraphics.lineBetween(p1.x, p1.y, p2.x, p2.y);
        continue;
      }

      // Back-and-forth on same edge: draw double parallel lines.
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const off = 4;
      this.conveyorGraphics.lineBetween(p1.x + nx * off, p1.y + ny * off, p2.x + nx * off, p2.y + ny * off);
      this.conveyorGraphics.lineBetween(p1.x - nx * off, p1.y - ny * off, p2.x - nx * off, p2.y - ny * off);
    }

    const start = this.getCellCenter(path[0].r, path[0].c);
    this.conveyorStartMarker.setPosition(start.x, start.y);
    this.conveyorStartMarker.setVisible(true);
  }

  redrawBoundaryDebugDots(cells) {
    if (!this.boundaryDebugDots) return;
    this.boundaryDebugDots.clear(true, true);
    for (const cell of cells) {
      const pos = this.getCellCenter(cell.r, cell.c);
      const dot = this.add.circle(pos.x, pos.y, 7, 0xff4fd8, 0.85).setDepth(3.4);
      dot.setStrokeStyle(2, 0xffffff, 0.9);
      this.boundaryDebugDots.add(dot);
    }
  }

  getPriorityNeighbors(r, c) {
    const out = [];
    for (const d of DIR_PRIORITY) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (!this.inBounds(nr, nc)) continue;
      out.push({ r: nr, c: nc });
    }
    return out;
  }

  checkWinCondition() {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.grid[r][c] !== null) return;
      }
    }
    this.won = true;
    this.showEndMessage('You Win! Garden is clear.');
  }

  checkNoProgressLose() {
    if (this.gameOver || this.won) return;
    const hasQueue = this.queues.some((q) => q.length > 0);
    if (!hasQueue) return;

    const hasFreeReserve = this.reserve.some((s) => s === null);
    if (!hasFreeReserve) {
      this.triggerGameOver('Game Over! Reserve full.');
    }
  }

  triggerGameOver(text) {
    this.gameOver = true;
    for (const saw of this.conveyorSaws) {
      if (saw.token?.container) saw.token.container.destroy();
    }
    this.conveyorSaws = [];
    this.refreshConveyorCount();
    this.showEndMessage(text);
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
}
