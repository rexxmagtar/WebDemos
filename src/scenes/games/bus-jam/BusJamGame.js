import Phaser from '../../../lib/phaser.js';
import {
  COLORS,
  COLOR_KEYS,
  BUS_COUNT,
  MIN_CAPACITY,
  MAX_CAPACITY,
  MAX_BUSES_ON_ROAD,
  ROAD_LOOP_WIDTH,
  ROAD_LOOP_HEIGHT,
  ROAD_WIDTH,
  ROAD_CORNER_RADIUS,
  BUS_WIDTH,
  BUS_HEIGHT,
  BUS_CAPACITY_DOT_RADIUS,
  BUS_CAPACITY_DOT_GAP,
  PASSENGER_RADIUS,
  PASSENGER_QUEUE_GAP,
  PICKUP_GATE_HEIGHT,
  EXIT_PATH_WIDTH,
  EXIT_PATH_HEIGHT,
} from './GameConfig.js';

// Generate level: 20 buses, capacities 4-8. Queues are mixed-color arrays per gate.
function generateLevel() {
  const buses = [];
  const capacityByColor = {};
  COLOR_KEYS.forEach((c) => { capacityByColor[c] = 0; });

  for (let i = 0; i < BUS_COUNT; i++) {
    const color = COLOR_KEYS[Phaser.Math.Between(0, COLOR_KEYS.length - 1)];
    const capacity = Phaser.Math.Between(MIN_CAPACITY, MAX_CAPACITY);
    const rotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    buses.push({
      id: i,
      color,
      capacity,
      currentPassengers: 0,
      rotation: rotations[Phaser.Math.Between(0, 3)],
      onRoad: false,
      roadProgress: 0,
      exiting: false,
      exitingInProgress: false,
      graphic: null,
      pickupCooldown: 0,
      lastPickupGate: -1,
      pickupAnimationInProgress: false,
    });
    capacityByColor[color] += capacity;
  }

  // 5 gates, each gets a mixed-color queue (array of color keys)
  const totalPassengers = Object.values(capacityByColor).reduce((a, b) => a + b, 0);
  const queueData = [[], [], [], [], []];
  for (let i = 0; i < totalPassengers; i++) {
    const color = COLOR_KEYS[Phaser.Math.Between(0, COLOR_KEYS.length - 1)];
    const gateIdx = i % queueData.length;
    queueData[gateIdx].push(color);
  }

  return { buses, queueData, capacityByColor };
}

// Get point on rounded rect midline. t in [0,1], clockwise from top-left.
// Arcs: center + r*(cos(a), sin(a)), angle sweeps correctly for each corner.
function getRoundedRectPoint(t, cx, cy, halfW, halfH, r) {
  const straightW = halfW * 2 - 2 * r;
  const straightH = halfH * 2 - 2 * r;
  const arcLen = (Math.PI / 2) * r;
  const perimeter = 2 * straightW + 2 * straightH + 4 * arcLen;
  let d = (t * perimeter) % perimeter;
  if (d < 0) d += perimeter;

  const segs = [
    { len: straightW, fn: (s) => ({ x: cx - halfW + r + s, y: cy - halfH }) },
    { len: arcLen, fn: (s) => { const a = 3 * Math.PI / 2 + (s / r); return { x: cx + halfW - r + r * Math.cos(a), y: cy - halfH + r + r * Math.sin(a) }; } },
    { len: straightH, fn: (s) => ({ x: cx + halfW, y: cy - halfH + r + s }) },
    { len: arcLen, fn: (s) => { const a = (s / r); return { x: cx + halfW - r + r * Math.cos(a), y: cy + halfH - r + r * Math.sin(a) }; } },
    { len: straightW, fn: (s) => ({ x: cx + halfW - r - s, y: cy + halfH }) },
    { len: arcLen, fn: (s) => { const a = Math.PI / 2 + (s / r); return { x: cx - halfW + r + r * Math.cos(a), y: cy + halfH - r + r * Math.sin(a) }; } },
    { len: straightH, fn: (s) => ({ x: cx - halfW, y: cy + halfH - r - s }) },
    { len: arcLen, fn: (s) => { const a = Math.PI + (s / r); return { x: cx - halfW + r + r * Math.cos(a), y: cy - halfH + r + r * Math.sin(a) }; } },
  ];
  for (const seg of segs) {
    if (d <= seg.len) {
      return seg.fn(d);
    }
    d -= seg.len;
  }
  return segs[0].fn(0);
}

// Tangent at t (direction of travel, clockwise). Returns normalized {x, y}.
function getPathTangent(t, cx, cy, halfW, halfH, r) {
  const dt = 0.001;
  const p0 = getRoundedRectPoint(t, cx, cy, halfW, halfH, r);
  const p1 = getRoundedRectPoint((t + dt) % 1, cx, cy, halfW, halfH, r);
  let dx = p1.x - p0.x;
  let dy = p1.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;
  return { x: dx, y: dy };
}

// Outward perpendicular (rotate tangent -90 deg for clockwise path: (dx,dy)->(dy,-dx))
function getPathOutwardPerp(t, cx, cy, halfW, halfH, r) {
  const tan = getPathTangent(t, cx, cy, halfW, halfH, r);
  return { x: tan.y, y: -tan.x };
}

export default class BusJamGame extends Phaser.Scene {
  constructor() {
    super({ key: 'BusJamGame' });
  }

  create() {
    const { width, height } = this.cameras.main;

    const topBarH = 48;
    const topBar = this.add.rectangle(width / 2, topBarH / 2, width, topBarH, 0x2c3e50, 0.92);
    topBar.setStrokeStyle(1, 0x34495e);
    topBar.setDepth(100);

    const backBtn = this.add
      .text(60, topBarH / 2, 'Back', { fontSize: '18px', color: '#ecf0f1', fontFamily: 'sans-serif' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(101);
    backBtn.on('pointerdown', () => { window.location.href = 'index.html'; });

    this.busesOnRoadText = this.add
      .text(width - 80, topBarH / 2, `Buses: 0 / ${MAX_BUSES_ON_ROAD}`, {
        fontSize: '18px', color: '#ecf0f1', fontFamily: 'sans-serif',
      })
      .setOrigin(1, 0.5)
      .setDepth(101);

    const { buses, queueData } = generateLevel();
    this.buses = buses;
    this.queueData = queueData; // queueData[gateIndex] = [color, color, ...]
    this.busesOnRoad = [];
    this.exitedBuses = 0;
    this.gameOver = false;
    this.won = false;
    this.totalPassengers = this.queueData.flat().length;
    this.transportedPassengers = 0;

    this.roadCenterX = width / 2;
    this.roadCenterY = height / 2;
    this.roadHalfW = ROAD_LOOP_WIDTH / 2;
    this.roadHalfH = ROAD_LOOP_HEIGHT / 2;
    this.roadR = Math.min(ROAD_CORNER_RADIUS, this.roadHalfW / 2, this.roadHalfH / 2);

    this.buildBackground();
    this.buildRoadLoop();
    this.buildParkingBuses();
    this.buildQueuesAndGates();
    this.buildExit();
    this.setupInput();
  }

  buildBackground() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x87ceeb);
  }

  buildRoadLoop() {
    const g = this.add.graphics();
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;
    const hw = this.roadHalfW;
    const hh = this.roadHalfH;
    const r = this.roadR;

    g.fillStyle(0x4a4a5a, 1);
    g.fillRoundedRect(cx - hw - ROAD_WIDTH / 2, cy - hh - ROAD_WIDTH / 2,
      ROAD_LOOP_WIDTH + ROAD_WIDTH, ROAD_LOOP_HEIGHT + ROAD_WIDTH, r + ROAD_WIDTH / 2);

    g.fillStyle(0x87ceeb, 1);
    g.fillRoundedRect(cx - hw + ROAD_WIDTH / 2, cy - hh + ROAD_WIDTH / 2,
      ROAD_LOOP_WIDTH - ROAD_WIDTH, ROAD_LOOP_HEIGHT - ROAD_WIDTH, r - ROAD_WIDTH / 2);

    g.fillStyle(0x4a4a5a, 1);
    const exitTop = cy + hh - ROAD_WIDTH;
    const exitLeft = cx + hw - ROAD_WIDTH;
    g.fillRect(exitLeft, exitTop, EXIT_PATH_WIDTH + ROAD_WIDTH * 2, EXIT_PATH_HEIGHT + 60);

    this.roadGraphics = g;
  }

  buildParkingBuses() {
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;
    const cols = 4;
    const rows = 5;
    const cellSize = Math.max(BUS_WIDTH, BUS_HEIGHT) + 8;
    const cellW = cellSize;
    const cellH = cellSize;
    const gridWidth = cols * cellW;
    const gridHeight = rows * cellH;
    const startX = cx - gridWidth / 2 + cellW / 2;
    const startY = cy - gridHeight / 2 + cellH / 2;

    for (let i = 0; i < this.buses.length; i++) {
      const bus = this.buses[i];
      if (bus.onRoad) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = startX + col * cellW;
      const py = startY + row * cellH;
      bus.gridCol = col;
      bus.gridRow = row;
      bus.facing = this.getBusFacingDirection(bus, cols, rows);
      bus.rotation = this.facingToAngle(bus.facing);

      const container = this.add.container(px, py);
      container.setAngle(Phaser.Math.RadToDeg(bus.rotation));
      container.setData('bus', bus);
      bus.graphic = container;

      const body = this.add.rectangle(0, 0, BUS_WIDTH, BUS_HEIGHT, COLORS[bus.color]);
      body.setStrokeStyle(2, 0x333333);
      container.add(body);

      const arrowSize = 8;
      const arrow = this.add.triangle(0, 0, arrowSize, 0, -arrowSize, -arrowSize * 0.8, -arrowSize, arrowSize * 0.8, 0x222222);
      arrow.setPosition(BUS_WIDTH / 2 + arrowSize, 0);
      container.add(arrow);

      const dotCount = bus.capacity;
      const dotsPerRow = Math.ceil(dotCount / 2);
      const rowSpacing = BUS_CAPACITY_DOT_RADIUS * 2 + BUS_CAPACITY_DOT_GAP;
      const totalRowWidth = dotsPerRow * rowSpacing - BUS_CAPACITY_DOT_GAP;
      const row1Y = -rowSpacing / 2;
      const row2Y = rowSpacing / 2;
      for (let d = 0; d < dotCount; d++) {
        const row = d < dotsPerRow ? 0 : 1;
        const col = d < dotsPerRow ? d : d - dotsPerRow;
        const rowLen = row === 0 ? dotsPerRow : dotCount - dotsPerRow;
        const rowW = rowLen * rowSpacing - BUS_CAPACITY_DOT_GAP;
        const ox = -rowW / 2 + BUS_CAPACITY_DOT_RADIUS + col * rowSpacing;
        const oy = row === 0 ? row1Y : row2Y;
        const dot = this.add.circle(ox, oy, BUS_CAPACITY_DOT_RADIUS, 0x111111);
        dot.setStrokeStyle(1, 0x333333);
        container.add(dot);
      }

      container.setInteractive(new Phaser.Geom.Rectangle(-BUS_WIDTH / 2 - 4, -BUS_HEIGHT / 2 - 4, BUS_WIDTH + 8, BUS_HEIGHT + 8), Phaser.Geom.Rectangle.Contains);
      container.setDepth(10);
      container.setData('bus', bus);
      container.on('pointerdown', () => this.onBusTapped(bus));
    }
    this.updateParkedBusesVisuals();
  }

  updateParkedBusesVisuals() {
    for (const bus of this.buses) {
      if (bus.onRoad || !bus.graphic) continue;
      bus.graphic.setAlpha(1);
    }
  }

  onBusTapped(bus) {
    if (this.gameOver || this.won) return;
    if (bus.onRoad) return;
    if (this.busesOnRoad.length >= MAX_BUSES_ON_ROAD) return;
    if (!this.isBusUnblocked(bus)) {
      this.playBlockedBusBump(bus);
      return;
    }
    this.sendBusToRoad(bus);
  }

  playBlockedBusBump(bus) {
    const bump = 12;
    const dir = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[bus.facing];
    if (!dir) return;
    const fromX = bus.graphic.x;
    const fromY = bus.graphic.y;
    const toX = fromX + dir.x * bump;
    const toY = fromY + dir.y * bump;
    this.tweens.add({
      targets: bus.graphic,
      x: toX,
      y: toY,
      duration: 80,
      ease: 'Power2.Out',
      yoyo: true,
    });
    this.cameras.main.shake(120, 0.006);
  }

  facingToAngle(facing) {
    if (facing === 'up') return (3 * Math.PI) / 2;
    if (facing === 'down') return Math.PI / 2;
    if (facing === 'left') return Math.PI;
    return 0;
  }

  getBusFacingDirection(bus, cols, rows) {
    const distUp = bus.gridRow;
    const distDown = rows - 1 - bus.gridRow;
    const distLeft = bus.gridCol;
    const distRight = cols - 1 - bus.gridCol;
    const min = Math.min(distUp, distDown, distLeft, distRight);
    if (distUp === min) return 'up';
    if (distDown === min) return 'down';
    if (distLeft === min) return 'left';
    return 'right';
  }

  isPathClearInDirection(bus, facing) {
    const cols = 4;
    const rows = 5;
    const occupied = new Set();
    for (const b of this.buses) {
      if (b.onRoad) continue;
      if (b === bus) continue;
      occupied.add(`${b.gridCol},${b.gridRow}`);
    }
    const { gridCol: col, gridRow: row } = bus;
    if (facing === 'up') return !Array.from({ length: row }, (_, i) => `${col},${i}`).some(k => occupied.has(k));
    if (facing === 'down') return !Array.from({ length: rows - row - 1 }, (_, i) => `${col},${row + 1 + i}`).some(k => occupied.has(k));
    if (facing === 'left') return !Array.from({ length: col }, (_, i) => `${i},${row}`).some(k => occupied.has(k));
    if (facing === 'right') return !Array.from({ length: cols - col - 1 }, (_, i) => `${col + 1 + i},${row}`).some(k => occupied.has(k));
    return false;
  }

  isBusUnblocked(bus) {
    return this.isPathClearInDirection(bus, bus.facing);
  }

  buildQueuesAndGates() {
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;
    const hw = this.roadHalfW;
    const hh = this.roadHalfH;
    const r = this.roadR;

    this.queueContainers = [];
    this.queuePerpendiculars = [];
    this.gateGraphics = [];

    const outsideOffset = ROAD_WIDTH + 18;
    const queuePositions = [
      { t: 0.08 },
      { t: 0.28 },
      { t: 0.35 },
      { t: 0.58 },
      { t: 0.88 },
    ];

    for (let i = 0; i < queuePositions.length; i++) {
      const pos = queuePositions[i];
      const pt = getRoundedRectPoint(pos.t, cx, cy, hw, hh, r);
      const perp = getPathOutwardPerp(pos.t, cx, cy, hw, hh, r);
      this.queuePerpendiculars[i] = perp;

      const qx = pt.x + perp.x * outsideOffset;
      const qy = pt.y + perp.y * outsideOffset;

      const container = this.add.container(qx, qy);
      this.queueContainers[i] = container;
      this.refreshQueueDisplay(i);

      const gateW = 70;
      const firstColor = this.queueData[i]?.[0];
      const gateColor = firstColor ? COLORS[firstColor] : 0x888888;
      const gate = this.add.rectangle(pt.x, pt.y, gateW, PICKUP_GATE_HEIGHT, gateColor);
      gate.setStrokeStyle(2, 0x333333);
      gate.setDepth(5);
      this.gateGraphics.push({ gate, t: pos.t, gateIndex: i });
    }
  }

  refreshQueueDisplay(gateIndex) {
    const container = this.queueContainers[gateIndex];
    if (!container) return;
    container.removeAll(true);
    const queue = this.queueData[gateIndex] || [];
    const perp = this.queuePerpendiculars[gateIndex] || { x: 0, y: -1 };
    const spacing = PASSENGER_RADIUS * 2 + PASSENGER_QUEUE_GAP;

    for (let i = 0; i < queue.length; i++) {
      const color = queue[i];
      const px = perp.x * i * spacing;
      const py = perp.y * i * spacing;
      const circle = this.add.circle(px, py, PASSENGER_RADIUS, COLORS[color] || 0x888888);
      circle.setStrokeStyle(1, 0x333333);
      container.add(circle);
    }
    container.setDepth(8);
    this.updateGateIndicator(gateIndex);
  }

  updateGateIndicator(gateIndex) {
    const g = this.gateGraphics[gateIndex];
    if (!g) return;
    const firstColor = this.queueData[gateIndex]?.[0];
    g.gate.setFillStyle(firstColor ? COLORS[firstColor] : 0x888888);
  }

  buildExit() {
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;
    const hw = this.roadHalfW;
    const hh = this.roadHalfH;

    const exitTop = cy + hh - ROAD_WIDTH;
    const exitCenterX = cx + hw;
    const exitCenterY = exitTop + (EXIT_PATH_HEIGHT + 60) / 2;

    this.exitX = exitCenterX;
    this.exitY = exitCenterY;

    this.add
      .text(exitCenterX, exitCenterY, 'Exit', {
        fontSize: '32px', color: '#ffffff', fontFamily: 'sans-serif',
      })
      .setOrigin(0.5)
      .setDepth(6);
  }

  setupInput() {
    // Bus tap is handled via container.on('pointerdown') in buildParkingBuses
  }

  getRoadPointFromRaycast(busX, busY, facing) {
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;
    const tol = 20;
    let bestT = 0.05;
    let bestRayDist = Infinity;

    for (let i = 0; i <= 300; i++) {
      const t = i / 300;
      const p = getRoundedRectPoint(t, cx, cy, this.roadHalfW, this.roadHalfH, this.roadR);
      let onRay = false;
      let rayDist = 0;
      if (facing === 'up') {
        onRay = Math.abs(p.x - busX) < tol && p.y < busY;
        rayDist = busY - p.y;
      } else if (facing === 'down') {
        onRay = Math.abs(p.x - busX) < tol && p.y > busY;
        rayDist = p.y - busY;
      } else if (facing === 'left') {
        onRay = Math.abs(p.y - busY) < tol && p.x < busX;
        rayDist = busX - p.x;
      } else {
        onRay = Math.abs(p.y - busY) < tol && p.x > busX;
        rayDist = p.x - busX;
      }
      if (onRay && rayDist > 0 && rayDist < bestRayDist) {
        bestRayDist = rayDist;
        bestT = t;
      }
    }
    return bestT;
  }

  sendBusToRoad(bus) {
    bus.onRoad = true;
    bus.entryComplete = false;
    this.busesOnRoad.push(bus);
    this.updateParkedBusesVisuals();
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;

    const entryT = this.getRoadPointFromRaycast(bus.graphic.x, bus.graphic.y, bus.facing);
    const pt = getRoundedRectPoint(entryT, cx, cy, this.roadHalfW, this.roadHalfH, this.roadR);
    const nextPt = getRoundedRectPoint((entryT + 0.002) % 1, cx, cy, this.roadHalfW, this.roadHalfH, this.roadR);
    const roadAngle = Phaser.Math.RadToDeg(Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x));

    this.tweens.add({
      targets: bus.graphic,
      x: pt.x,
      y: pt.y,
      duration: 650,
      ease: 'Power2.InOut',
      onComplete: () => {
        bus.graphic.setAngle(roadAngle);
        bus.roadProgress = entryT;
        bus.entryComplete = true;
      },
    });
  }

  update(time, delta) {
    if (this.gameOver || this.won) return;

    this.busesOnRoadText.setText(`Buses: ${this.busesOnRoad.length} / ${MAX_BUSES_ON_ROAD}`);

    const speed = 0.00015;
    const cx = this.roadCenterX;
    const cy = this.roadCenterY;

    for (const bus of this.busesOnRoad) {
      if (bus.exitingInProgress) continue;

      if (bus.exiting) {
        bus.exitingInProgress = true;
        this.tweens.add({
          targets: bus.graphic,
          x: this.exitX,
          y: this.exitY + 50,
          duration: 600,
          ease: 'Power2.In',
          onComplete: () => {
            bus.graphic.destroy();
            this.busesOnRoad = this.busesOnRoad.filter((b) => b !== bus);
            this.exitedBuses++;
            this.checkWin();
          },
        });
        continue;
      }

      if (!bus.entryComplete) continue;
      if (bus.pickupAnimationInProgress) continue;

      if (bus.pickupCooldown > 0) bus.pickupCooldown -= delta;

      const cappedDelta = Math.min(delta, 50);
      bus.roadProgress += speed * cappedDelta;
      bus.roadProgress = ((bus.roadProgress % 1) + 1) % 1;

      const t = bus.roadProgress;
      const exitT = 0.475;
      const distToExit = Math.min(
        Math.abs(t - exitT),
        Math.abs(t - exitT - 1),
        Math.abs(t - exitT + 1)
      );
      if (bus.currentPassengers >= bus.capacity && distToExit < 0.03) {
        bus.exiting = true;
        continue;
      }

      const pt = getRoundedRectPoint(t, cx, cy, this.roadHalfW, this.roadHalfH, this.roadR);
      const nextT = (t + 0.002) % 1;
      const nextPt = getRoundedRectPoint(nextT, cx, cy, this.roadHalfW, this.roadHalfH, this.roadR);
      bus.graphic.x = pt.x;
      bus.graphic.y = pt.y;
      const moveAngle = Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x);
      bus.graphic.setAngle(Phaser.Math.RadToDeg(moveAngle));

      for (let gi = 0; gi < this.gateGraphics.length; gi++) {
        const g = this.gateGraphics[gi];
        const dist = Math.min(
          Math.abs(bus.roadProgress - g.t),
          Math.abs(bus.roadProgress - g.t - 1),
          Math.abs(bus.roadProgress - g.t + 1)
        );
        if (dist < 0.025 && bus.pickupCooldown <= 0) {
          const queue = this.queueData[g.gateIndex] || [];
          const space = bus.capacity - bus.currentPassengers;
          const firstColor = queue[0];
          const canTake = firstColor === bus.color && space > 0 && queue.length > 0;
          if (canTake) {
            const takenColors = [{ index: 0, color: firstColor }];
            this.queueData[g.gateIndex].splice(0, 1);
            bus.currentPassengers += takenColors.length;
            this.transportedPassengers += takenColors.length;
            bus.pickupCooldown = 600;
            bus.pickupAnimationInProgress = true;
            this.playPassengerFlyToBus(bus, g.gateIndex, takenColors);
            if (bus.currentPassengers >= bus.capacity) {
              bus.readyToExit = true;
            }
          }
          break;
        }
      }

      if (bus.currentPassengers >= bus.capacity) {
        bus.readyToExit = true;
      }
    }

    this.checkLose();
  }

  playPassengerFlyToBus(bus, gateIndex, takenColors) {
    const qContainer = this.queueContainers[gateIndex];
    const perp = this.queuePerpendiculars[gateIndex] || { x: 0, y: -1 };
    const spacing = PASSENGER_RADIUS * 2 + PASSENGER_QUEUE_GAP;
    const take = takenColors.length;

    const dots = bus.graphic.list.slice(2);
    const startIdx = bus.currentPassengers - take;
    const busAngle = bus.graphic.angle * Math.PI / 180;

    const sortedTaken = [...takenColors].sort((a, b) => a.index - b.index);

    for (let i = 0; i < take; i++) {
      const t = sortedTaken[i];
      const srcX = qContainer.x + perp.x * t.index * spacing;
      const srcY = qContainer.y + perp.y * t.index * spacing;

      const dotIdx = startIdx + i;
      const dot = dots[dotIdx];
      const dotLx = dot ? dot.x : 0;
      const dotLy = dot ? dot.y : 0;
      const destX = bus.graphic.x + dotLx * Math.cos(busAngle) - dotLy * Math.sin(busAngle);
      const destY = bus.graphic.y + dotLx * Math.sin(busAngle) + dotLy * Math.cos(busAngle);

      const fly = this.add.circle(srcX, srcY, PASSENGER_RADIUS, COLORS[t.color]);
      fly.setStrokeStyle(1, 0x333333);
      fly.setDepth(20);

      const isLast = i === take - 1;
      this.tweens.add({
        targets: fly,
        x: destX,
        y: destY,
        duration: 280,
        delay: i * 120,
        ease: 'Power2.In',
        onComplete: () => {
          fly.destroy();
          this.animateSingleCapacityDot(bus, startIdx + i);
          if (isLast) bus.pickupAnimationInProgress = false;
        },
      });
    }

    const toRemoveObjs = sortedTaken
      .sort((a, b) => b.index - a.index)
      .map((t) => qContainer.list[t.index])
      .filter(Boolean);
    for (const c of toRemoveObjs) {
      qContainer.remove(c);
      c.destroy();
    }
    for (let j = 0; j < qContainer.list.length; j++) {
      const c = qContainer.list[j];
      const toX = perp.x * j * spacing;
      const toY = perp.y * j * spacing;
      this.tweens.add({
        targets: c,
        x: toX,
        y: toY,
        duration: 200,
        delay: 50,
        ease: 'Power2.Out',
      });
    }
    this.updateGateIndicator(gateIndex);
  }

  animateSingleCapacityDot(bus, dotIdx) {
    const dots = bus.graphic.list.slice(2);
    const dot = dots[dotIdx];
    if (!dot) return;
    dot.setFillStyle(COLORS[bus.color]);
    dot.setScale(0.3);
    this.tweens.add({
      targets: dot,
      scale: 1,
      duration: 200,
      ease: 'Back.Out',
    });
  }

  updateBusCapacityDots(bus) {
    const container = bus.graphic;
    const dots = container.list.slice(2);
    for (let i = 0; i < dots.length; i++) {
      dots[i].setFillStyle(i < bus.currentPassengers ? COLORS[bus.color] : 0x111111);
    }
  }

  animateCapacityDotsFill(bus, take) {
    const container = bus.graphic;
    const dots = container.list.slice(2);
    const startIdx = bus.currentPassengers - take;
    for (let i = 0; i < take; i++) {
      const dotIdx = startIdx + i;
      const dot = dots[dotIdx];
      if (!dot) continue;
      dot.setFillStyle(COLORS[bus.color]);
      dot.setScale(0.2);
      this.tweens.add({
        targets: dot,
        scale: 1,
        duration: 225,
        delay: i * 140,
        ease: 'Back.Out',
      });
    }
  }

  checkWin() {
    if (this.transportedPassengers >= this.totalPassengers && this.busesOnRoad.length === 0) {
      this.won = true;
      this.time.delayedCall(500, () => this.showWinScreen());
    }
  }

  checkLose() {
    if (this.busesOnRoad.length < MAX_BUSES_ON_ROAD) return;
    const canExit = this.busesOnRoad.some((b) => b.currentPassengers >= b.capacity);
    if (canExit) return;
    const anyQueueHasSpace = this.busesOnRoad.some((b) => {
      const firstInSomeQueueMatches = this.queueData.some((q) =>
        q.length > 0 && q[0] === b.color
      );
      return firstInSomeQueueMatches && b.currentPassengers < b.capacity;
    });
    if (anyQueueHasSpace) return;
    this.gameOver = true;
    this.time.delayedCall(400, () => this.showGameOverScreen());
  }

  showGameOverScreen() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    this.add.text(width / 2, height / 2 - 40, 'Bus Jam!', {
      fontSize: '48px', color: '#e74c3c', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 10, 'Road is full and no bus can leave.', {
      fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 80, 'Retry', {
      fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }

  showWinScreen() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    this.add.text(width / 2, height / 2 - 40, 'Success!', {
      fontSize: '48px', color: '#2ecc71', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.add.text(width / 2, height / 2 + 10, 'All passengers transported!', {
      fontSize: '20px', color: '#aaa', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    const btn = this.add.text(width / 2, height / 2 + 80, 'Play Again', {
      fontSize: '24px', color: '#4ecdc4', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => this.scene.restart());
  }
}
