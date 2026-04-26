import { EMPTY, NAMES, RING_MAX, findMovePath, applyMove, cloneBoard } from "./model.js";
import { newGameFromSeed } from "./levelGen.js";

const DEFAULT_SEED = 1337;
const SEED_STORAGE_KEY = "spaceMarbleSolitaire.seed";

const SLIDE_MS = 400;
const HOLE_FLIGHT_MS = 520;
const HOLE_STAGGER_MS = 90;
const MERGE_SUCK_MS = 640;
const MERGE_GROUP_GAP_MS = 90;
/** After capture flights land, show full ring (pre-merge) this long before suck-in. */
const PLACED_HOLD_MS = 320;

/** @type {{ path: object, t0: number, snap: number[][], slideMs: number, totalMs: number, applied: boolean, ringBefore?: number[], ringAfterPush?: number[], depositEndT?: number, placedHoldEndT?: number, pendingMergeSteps?: { type: number, indices: number[] }[] | null, mergeQueued?: boolean } | null} */
let moveAnim = null;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = (canvas.width = 360);
const H = (canvas.height = 640);

function el(id) {
  return document.getElementById(id);
}

const PLANET_PATHS = ["earth", "mars", "venus", "sun", "moon"].map((f) => `assets/planets/${f}.png`);
const planetImgs = [];
let loaded = 0;
const ui = { status: el("status") };

const layout = { rows: 7, cols: 7, x0: 20, y0: 100, cell: 44, gap: 2 };

let game = null;
let lastSeed = 0;

const TYPE_TANK = ["#1e3a5f", "#7f1d1d", "#713f12", "#a16207", "#1e293b"];
/** One black hole + 8 slots on a ring. Center and radius in canvas px. */
const VORTEX = { cx: 180, cy: 518, ringR: 76, hubR: 36, yTop: 428 };
/** @type {Array<{ type: number, x0: number, y0: number, x1: number, y1: number, t0: number, duration: number }>} */
let depositFlights = [];
/** @type {Array<{ type: number, x0: number, y0: number, x1: number, y1: number, t0: number, duration: number }>} */
let mergeSuckParticles = [];

function parseSeedString(str) {
  const n = parseInt(String(str).trim(), 10);
  return Number.isFinite(n) ? n | 0 : DEFAULT_SEED;
}

function getInitialSeedFromPage() {
  return DEFAULT_SEED;
}

function persistCurrentSeed(usedSeed) {
  lastSeed = usedSeed;
  try {
    localStorage.setItem(SEED_STORAGE_KEY, String(usedSeed));
  } catch {
    // ignore
  }
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("seed", String(usedSeed));
    history.replaceState({}, "", u);
  } catch {
    // ignore
  }
  const input = el("seed-input");
  if (input) input.value = String(usedSeed);
}

function loadImages() {
  return Promise.all(
    PLANET_PATHS.map(
      (path, t) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            loaded++;
            resolve();
          };
          img.onerror = () => {
            console.warn("missing", path);
            resolve();
          };
          img.src = path;
          planetImgs[t] = img;
        })
    )
  );
}

function startGame(seed) {
  moveAnim = null;
  depositFlights = [];
  mergeSuckParticles = [];
  const g = newGameFromSeed(seed);
  game = g.state;
  persistCurrentSeed(g.seed);
  if (el("hud-caps")) {
    const rows = [0, 1, 2, 3, 4].map((i) => `${NAMES[i]}: ${g.counts[i]}`).join("  ·  ");
    el("hud-caps").textContent = rows;
  }
  updateStatus();
}

function updateStatus() {
  if (!game) return;
  if (ui.status) {
    if (moveAnim) ui.status.textContent = "Moving…";
    else if (game.won) ui.status.textContent = "Win: one planet left on the board.";
    else if (game.lost) {
      if (game.reason === "overflow") ui.status.textContent = "Lost: black hole ring full (8).";
      else if (game.reason === "stuck") ui.status.textContent = "Lost: no moves left.";
      else ui.status.textContent = "Lost.";
    } else
      ui.status.textContent = `Ring ${game.ring.length}/${RING_MAX} · Line moves add planets; 3+ of one type on the ring merge into the hole.`;
  }
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInQuad(t) {
  return t * t;
}

/** Fading trail along the path already traveled (behind the sliding planet). */
function drawSlideTrail(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx * dx + dy * dy < 9) return;
  const grd = ctx.createLinearGradient(x0, y0, x1, y1);
  grd.addColorStop(0, "rgba(34, 211, 238, 0)");
  grd.addColorStop(0.25, "rgba(34, 211, 238, 0.08)");
  grd.addColorStop(0.65, "rgba(34, 211, 238, 0.28)");
  grd.addColorStop(1, "rgba(224, 242, 254, 0.45)");
  ctx.save();
  ctx.strokeStyle = grd;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function cellCenter(r, c) {
  const { x0, y0, cell, gap } = layout;
  const step = cell + gap;
  return { x: x0 + c * step + cell / 2, y: y0 + r * step + cell / 2 };
}

/**
 * @param {number[][]} board
 * @param {number} r0
 * @param {number} c0
 * @returns {{ r: number, c: number }[]}
 */
function collectLegalDestinations(board, r0, c0) {
  const rows = board.length;
  const cols = board[0].length;
  const out = [];
  for (let r1 = 0; r1 < rows; r1++) {
    for (let c1 = 0; c1 < cols; c1++) {
      if (findMovePath(board, r0, c0, r1, c1)) out.push({ r: r1, c: c1 });
    }
  }
  return out;
}

function drawMoveHints() {
  if (!game || moveAnim || game.won || game.lost) return;
  const sel = game.selection;
  if (!sel) return;
  const type = game.board[sel.r][sel.c];
  if (type === EMPTY) return;
  const dests = collectLegalDestinations(game.board, sel.r, sel.c);
  if (!dests.length) return;
  const base = TYPE_TANK[type] || "#38bdf8";
  const t = performance.now() * 0.0025;
  ctx.save();
  for (const d of dests) {
    const { x, y } = cellCenter(d.r, d.c);
    const phase = t * 1.2 + d.r * 0.4 + d.c * 0.31;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const r = 4 + pulse * 4;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.globalAlpha = 0.4 + 0.45 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
  }
  ctx.restore();
}

/** Draw `im` centered at (cx, cy), uniform scale to fit inside a `size`×`size` square (no non-uniform stretch). */
function drawImageUniformInSquare(im, cx, cy, size) {
  const nw = im.naturalWidth;
  const nh = im.naturalHeight;
  if (!nw || !nh) return;
  const scale = Math.min(size / nw, size / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  ctx.drawImage(im, cx - dw / 2, cy - dh / 2, dw, dh);
}

function drawPlanetAt(cx, cy, type, s, alpha = 1) {
  const im = planetImgs[type];
  ctx.save();
  ctx.globalAlpha = alpha;
  if (im && im.complete && im.naturalWidth) {
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.clip();
    drawImageUniformInSquare(im, cx, cy, s);
  } else {
    const cs = ["#1d4ed8", "#c2410c", "#ca8a04", "#eab308", "#64748b"];
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fillStyle = cs[type];
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function startMoveAnim(path) {
  if (!game) return;
  const n = path.between.length;
  const holeTail = n > 0 ? HOLE_FLIGHT_MS + (n - 1) * HOLE_STAGGER_MS + 50 : 0;
  moveAnim = {
    path,
    t0: performance.now(),
    snap: cloneBoard(game.board),
    slideMs: SLIDE_MS,
    totalMs: SLIDE_MS + holeTail,
    applied: false
  };
  game.selection = null;
  updateStatus();
}

function vortexCenter() {
  return { x: VORTEX.cx, y: VORTEX.cy };
}

function tickMoveAnim() {
  if (!moveAnim || !game) return;
  const el = performance.now() - moveAnim.t0;
  const path = moveAnim.path;

  if (!moveAnim.applied && el >= moveAnim.slideMs) {
    moveAnim.applied = true;
    const snap = moveAnim.snap;
    const interTypes = path.between.map(({ r, c }) => snap[r][c]);
    const now = performance.now();
    const ringLenBefore = game.ring.length;
    const ringBefore = game.ring.slice();
    const animPack = applyMove(game, path);
    let latestEnd = now;
    if (interTypes.length) {
      for (let idx = 0; idx < interTypes.length; idx++) {
        const from = path.between[idx];
        const p0 = cellCenter(from.r, from.c);
        const dest = ringSlotTarget(ringLenBefore + idx);
        depositFlights.push({
          type: interTypes[idx],
          x0: p0.x,
          y0: p0.y,
          x1: dest.x,
          y1: dest.y,
          t0: now + idx * HOLE_STAGGER_MS,
          duration: HOLE_FLIGHT_MS
        });
      }
      latestEnd = now + (interTypes.length - 1) * HOLE_STAGGER_MS + HOLE_FLIGHT_MS;
    }
    moveAnim.ringBefore = ringBefore;
    moveAnim.ringAfterPush = animPack ? animPack.ringAfterPush : game.ring.slice();
    moveAnim.depositEndT = latestEnd;
    const mergeSteps = animPack && animPack.mergeSteps;
    const hasMerge = mergeSteps && mergeSteps.length > 0;
    moveAnim.placedHoldEndT = latestEnd + (hasMerge ? PLACED_HOLD_MS : 0);
    moveAnim.pendingMergeSteps = hasMerge ? mergeSteps : null;
    moveAnim.mergeQueued = false;
    if (hasMerge) {
      latestEnd =
        moveAnim.placedHoldEndT +
        (mergeSteps.length - 1) * (MERGE_SUCK_MS + MERGE_GROUP_GAP_MS) +
        MERGE_SUCK_MS;
    }
    moveAnim.totalMs = Math.max(moveAnim.totalMs, latestEnd - moveAnim.t0 + 100);
    updateStatus();
  }

  if (
    moveAnim.applied &&
    moveAnim.pendingMergeSteps &&
    !moveAnim.mergeQueued &&
    performance.now() >= moveAnim.placedHoldEndT
  ) {
    moveAnim.mergeQueued = true;
    queueMergeSuckAnimations(moveAnim.pendingMergeSteps, performance.now());
    moveAnim.pendingMergeSteps = null;
  }

  if (el >= moveAnim.totalMs) {
    moveAnim = null;
    updateStatus();
  }
}

/** Slide only: mover travels along the line; jumped planets stay put until apply + hole flights. */
function drawPlanetsAnimated() {
  if (!moveAnim || !game || moveAnim.applied) return;
  const { path, snap } = moveAnim;
  const { r0, c0, r1, c1, mover } = path;
  const el = performance.now() - moveAnim.t0;
  if (el >= moveAnim.slideMs) return;
  const { x0, y0, cell, gap } = layout;
  const step = cell + gap;
  const s = cell - 4;
  const slideT = Math.min(1, el / SLIDE_MS);
  const u = easeOutCubic(slideT);
  const p0 = cellCenter(r0, c0);
  const p1 = cellCenter(r1, c1);
  const mx = p0.x + (p1.x - p0.x) * u;
  const my = p0.y + (p1.y - p0.y) * u;

  for (let r = 0; r < snap.length; r++) {
    for (let c = 0; c < snap[0].length; c++) {
      const t = snap[r][c];
      if (t === EMPTY) continue;
      if (r === r0 && c === c0) continue;
      const px = x0 + c * step + 2;
      const py = y0 + r * step + 2;
      const im = planetImgs[t];
      if (im && im.complete && im.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2);
        ctx.clip();
        drawImageUniformInSquare(im, px + s / 2, py + s / 2, s);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const cs = ["#1d4ed8", "#c2410c", "#ca8a04", "#eab308", "#64748b"];
        ctx.fillStyle = cs[t];
        ctx.beginPath();
        ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (u > 0.02) drawSlideTrail(p0.x, p0.y, mx, my);
  ctx.save();
  ctx.strokeStyle = "rgba(34, 211, 238, 0.2)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.restore();
  drawPlanetAt(mx, my, mover, s, 1);
}

function cellFromPointer(px, py) {
  const { x0, y0, cell, gap, rows, cols } = layout;
  const step = cell + gap;
  const c = Math.floor((px - x0) / step);
  const r = Math.floor((py - y0) / step);
  if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
  return { r, c };
}

function drawStarfield() {
  ctx.fillStyle = "#020617";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    const x = ((i * 97) % W) + ((i * 7) % 20);
    const y = ((i * 41) % (layout.y0 + 200)) + 20;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x, y, 1 + (i % 2), 1);
  }
}

function drawGrid() {
  const { x0, y0, cell, gap, rows, cols } = layout;
  const step = cell + gap;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * step;
      const y = y0 + r * step;
      ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, cell, cell, 8);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawPlanets() {
  if (!game) return;
  const { x0, y0, cell, gap } = layout;
  const step = cell + gap;
  const b = game.board;
  for (let r = 0; r < b.length; r++) {
    for (let c = 0; c < b[0].length; c++) {
      const t = b[r][c];
      if (t === EMPTY) continue;
      const x = x0 + c * step + 2;
      const y = y0 + r * step + 2;
      const s = cell - 4;
      const im = planetImgs[t];
      if (im && im.complete && im.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
        ctx.clip();
        drawImageUniformInSquare(im, x + s / 2, y + s / 2, s);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const cs = ["#1d4ed8", "#c2410c", "#ca8a04", "#eab308", "#64748b"];
        ctx.fillStyle = cs[t];
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (game.selection) {
    const { r, c } = game.selection;
    const x = x0 + c * step - 1;
    const y = y0 + r * step - 1;
    ctx.strokeStyle = "rgba(34, 211, 238, 0.95)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, cell + 2, cell + 2, 9);
    ctx.stroke();
  }
}

function ringSlotAngle(slotIndex) {
  const spin = performance.now() * 0.00015;
  return -Math.PI / 2 + (2 * Math.PI * slotIndex) / RING_MAX + spin;
}

function ringSlotPos(slotIndex) {
  const { cx, cy, ringR } = VORTEX;
  const a = ringSlotAngle(slotIndex);
  return { x: cx + ringR * Math.cos(a), y: cy + ringR * Math.sin(a) };
}

/** Ring arc slot matching on-screen vortex (spin included); overflow uses hole center. */
function ringSlotTarget(slotIndex) {
  if (slotIndex < 0 || slotIndex >= RING_MAX) return vortexCenter();
  return ringSlotPos(slotIndex);
}

/**
 * @param {{ type: number, indices: number[] }[]} mergeSteps
 * @param {number} firstT0
 */
function queueMergeSuckAnimations(mergeSteps, firstT0) {
  const { x: cx, y: cy } = vortexCenter();
  let t = firstT0;
  for (const step of mergeSteps) {
    const t0 = t;
    for (const idx of step.indices) {
      if (idx >= RING_MAX) continue;
      const pos = ringSlotPos(idx);
      mergeSuckParticles.push({
        type: step.type,
        x0: pos.x,
        y0: pos.y,
        x1: cx,
        y1: cy,
        t0,
        duration: MERGE_SUCK_MS
      });
    }
    t = t0 + MERGE_SUCK_MS + MERGE_GROUP_GAP_MS;
  }
}

function drawDepositFlights() {
  const now = performance.now();
  const baseS = 30;
  for (const f of depositFlights) {
    const u0 = (now - f.t0) / f.duration;
    if (u0 >= 1) continue;
    const u = easeOutCubic(u0);
    const x = f.x0 + (f.x1 - f.x0) * u;
    const y = f.y0 + (f.y1 - f.y0) * u;
    const shrink = 1 - easeInQuad(u);
    const s = Math.max(4, baseS * shrink);
    const alpha = u0 > 0.82 ? 1 - (u0 - 0.82) / 0.18 : 1;
    drawPlanetAt(x, y, f.type, s, alpha);
  }
  depositFlights = depositFlights.filter((f) => now < f.t0 + f.duration);
}

function drawMergeSuckParticles() {
  const now = performance.now();
  const baseS = 30;
  for (const p of mergeSuckParticles) {
    const u0 = (now - p.t0) / p.duration;
    if (u0 >= 1) continue;
    const u = easeOutCubic(u0);
    const x = p.x0 + (p.x1 - p.x0) * u;
    const y = p.y0 + (p.y1 - p.y0) * u;
    const shrink = 1 - easeInQuad(u);
    const s = Math.max(2, baseS * shrink);
    const alpha = u0 > 0.7 ? 1 - (u0 - 0.7) / 0.3 : 1;
    drawPlanetAt(x, y, p.type, s, alpha);
  }
  mergeSuckParticles = mergeSuckParticles.filter((p) => now < p.t0 + p.duration);
}

function getRingForVortexDraw() {
  if (!game) return [];
  if (!moveAnim || !moveAnim.applied) return game.ring;
  const t = performance.now();
  if (moveAnim.depositEndT != null && t < moveAnim.depositEndT) return moveAnim.ringBefore || game.ring;
  if (moveAnim.placedHoldEndT != null && t < moveAnim.placedHoldEndT) return moveAnim.ringAfterPush || game.ring;
  return game.ring;
}

function drawVortexRing() {
  if (!game) return;
  const ringData = getRingForVortexDraw();
  const { cx, cy, ringR, hubR } = VORTEX;
  const panelY = VORTEX.yTop - 6;
  ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(8, panelY, W - 16, H - panelY - 10, 14);
  ctx.fill();
  ctx.stroke();

  const grd = ctx.createRadialGradient(cx, cy, 4, cx, cy, hubR + 28);
  grd.addColorStop(0, "#020617");
  grd.addColorStop(0.45, "#0f172a");
  grd.addColorStop(1, "rgba(15, 23, 42, 0.2)");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(cx, cy, hubR + 26, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#020617";
  ctx.beginPath();
  ctx.arc(cx, cy, hubR - 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText("Black hole", cx, cy + 4);

  const marbleR = 15;
  for (let s = 0; s < RING_MAX; s++) {
    const { x: sx, y: sy } = ringSlotPos(s);
    ctx.beginPath();
    ctx.arc(sx, sy, marbleR + 2, 0, Math.PI * 2);
    ctx.strokeStyle = s < ringData.length ? "rgba(255,255,255,0.18)" : "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (s < ringData.length) {
      drawPlanetAt(sx, sy, ringData[s], marbleR * 2, 1);
    }
  }
  ctx.textAlign = "left";
}

function drawHeader() {
  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 20px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Space Marble Solitaire", W / 2, 32);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("Line moves · ring of 8 · 3+ of one planet type on the ring merge into the hole.", W / 2, 50);
  ctx.textAlign = "left";
}

function render() {
  drawStarfield();
  drawHeader();
  if (!game) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.fillRect(0, 70, W, 200);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(loaded < 5 ? "Loading…" : "Ready", W / 2, 160);
    ctx.textAlign = "left";
    requestAnimationFrame(render);
    return;
  }
  tickMoveAnim();
  drawGrid();
  if (moveAnim && !moveAnim.applied) {
    drawPlanetsAnimated();
  } else {
    drawPlanets();
    if (!moveAnim) drawMoveHints();
  }
  drawVortexRing();
  drawDepositFlights();
  drawMergeSuckParticles();
  if (game.won || game.lost) {
    ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = game.won ? "#86efac" : "#f87171";
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(game.won ? "One planet remains" : "Game over", W / 2, H / 2 - 8);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("New game", W / 2, H / 2 + 24);
  }
  requestAnimationFrame(render);
}

function onPointer(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const p = (e.touches && e.touches[0]) || e;
  const x = ((p.clientX - r.left) / r.width) * W;
  const y = ((p.clientY - r.top) / r.height) * H;
  if (game && (game.won || game.lost)) {
    startGame(((Date.now() & 0xffffffff) ^ lastSeed) | 0);
    return;
  }
  if (!game) return;
  if (moveAnim) return;
  const cell = cellFromPointer(x, y);
  if (!cell) return;
  const b = game.board;
  if (game.selection == null) {
    if (b[cell.r][cell.c] !== EMPTY) {
      game.selection = { r: cell.r, c: cell.c };
    }
  } else {
    if (game.selection.r === cell.r && game.selection.c === cell.c) {
      game.selection = null;
    } else {
      const path = findMovePath(b, game.selection.r, game.selection.c, cell.r, cell.c);
      if (path) startMoveAnim(path);
      else {
        if (b[cell.r][cell.c] !== EMPTY) game.selection = { r: cell.r, c: cell.c };
        else game.selection = null;
      }
    }
  }
  updateStatus();
}

canvas.addEventListener("pointerdown", onPointer, { passive: false });

el("btn-apply")?.addEventListener("click", () => {
  const input = el("seed-input");
  const s = input ? parseSeedString(input.value) : DEFAULT_SEED;
  startGame(s);
});

el("seed-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    startGame(parseSeedString(el("seed-input").value));
  }
});

el("btn-new")?.addEventListener("click", () => {
  startGame((Date.now() & 0xffffffff) | 0);
});

const defLabel = el("default-seed-label");
if (defLabel) defLabel.textContent = String(DEFAULT_SEED);

loadImages().then(() => {
  startGame(getInitialSeedFromPage());
});
requestAnimationFrame(render);
