const ideas = {
  "tilt-tray": {
    title: "Tilt Tray Pearls",
    tag: "Physics maze + bead tray ASMR",
    color: "#7dd3fc",
    mode: "tilt",
    goal: "Roll all pearls into the soft pads, but every tilt moves every pearl. Pearls can’t pass through each other.",
    win: "All pearls are seated.",
    lose: "A pearl falls into a black drain.",
    familiar: "Players know tilt mazes, marble runs, and bead sorting trays.",
    pay: "Losing one pearl after a near-perfect route creates a strong retry/booster moment.",
    woman35: "Yes: clean objects, low violence, satisfying bead movement, short sessions.",
    twist: "Instead of one marble, several pearls move together, so every tilt solves one pearl while endangering another.",
    setup: { balls: [[1, 1], [4, 1], [1, 4]], goals: [[4, 4], [2, 3], [5, 1]], holes: [[3, 2], [0, 5]], walls: [[2, 2], [3, 3], [4, 2]] }
  },
  "pin-sand": {
    title: "Pin Sand Bento",
    tag: "Pull-the-pin + kinetic sand",
    color: "#fbbf24",
    mode: "pins",
    goal: "Pull pins in the right order so colored sand hits the right cups. Deeper, angled baffles and staggered chutes add routes.",
    win: "Every cup gets enough matching sand.",
    lose: "Wrong-color sand contaminates a cup.",
    familiar: "Pull-the-pin, sand videos, and real kinetic-sand pouring are proven.",
    pay: "One bad pin ruins a cup, making undo, extra cup, or retry valuable.",
    woman35: "Likely: it is readable, tactile, and has an obvious satisfying payoff.",
    twist: "Angled baffles and stacked wells force planning order and timing, not a flat three-bar layout.",
    setup: {
      bins: [
        { x: 60, c: "Y" },
        { x: 180, c: "R" },
        { x: 300, c: "B" }
      ],
      pins: [
        { x: 40, y: 128, w: 100, h: 12, ang: 0, slide: 85 },
        { x: 220, y: 128, w: 100, h: 12, ang: 0, slide: 85 },
        { x: 20, y: 198, w: 130, h: 12, ang: -0.45, slide: 90 },
        { x: 210, y: 198, w: 130, h: 12, ang: 0.42, slide: 90 },
        { x: 50, y: 268, w: 100, h: 12, ang: 0.2, slide: 80 },
        { x: 210, y: 268, w: 100, h: 12, ang: -0.18, slide: 80 },
        { x: 85, y: 328, w: 190, h: 12, ang: 0, slide: 95 }
      ],
      emitters: [
        { x: 70, c: "Y" },
        { x: 180, c: "R" },
        { x: 290, c: "B" }
      ]
    }
  }
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const params = new URLSearchParams(location.search);
const slug = (params.get("game") in ideas) ? params.get("game") : "tilt-tray";
const idea = ideas[slug] || ideas["tilt-tray"];
const colors = { R: "#fb7185", Y: "#fde047", B: "#60a5fa", G: "#4ade80", P: "#c084fc", O: "#fb923c" };
const S = { img: {} };
const SPRITE_SRC = {
  pearl: "assets/sprites/pearl.png",
  sand: "assets/sprites/sand-particle.png"
};

function loadSprites() {
  return Promise.all(
    Object.entries(SPRITE_SRC).map(
      ([key, src]) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => { S.img[key] = im; resolve(); };
          im.onerror = () => { S.img[key] = null; resolve(); };
          im.src = src;
        })
    )
  );
}

function hasSprite(name) {
  const im = S.img[name];
  return im && im.complete && im.naturalWidth > 0;
}

function drawTintedDiscSprite(name, x, y, r, color) {
  if (!hasSprite(name)) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const d = r * 2;
  const img = S.img[name];
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x - r, y - r, d, d);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r, d, d);
  ctx.restore();
}

function drawSpriteRaw(name, x, y, w, h, alpha = 1) {
  if (!hasSprite(name)) return false;
  const img = S.img[name];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();
  return true;
}

const state = { won: false, lost: false, tick: 0, audio: null, particles: [] };
const grid = { x: 30, y: 175, s: 50, n: 6 };

document.getElementById("title").textContent = idea.title;
document.getElementById("tag").textContent = idea.tag;
document.getElementById("goal").textContent = idea.goal;
document.getElementById("twist").textContent = idea.twist;
document.getElementById("win").textContent = idea.win;
document.getElementById("lose").textContent = idea.lose;
document.getElementById("familiar").textContent = idea.familiar;
document.getElementById("pay").textContent = idea.pay;
document.getElementById("audience").textContent = idea.woman35;
document.documentElement.style.setProperty("--accent", idea.color);

function init() {
  if (idea.mode === "tilt") {
    state.balls = idea.setup.balls.map(([r, c]) => ({ r, c, ar: r, ac: c, ok: false }));
    state.goals = idea.setup.goals;
    state.holes = idea.setup.holes;
    state.walls = idea.setup.walls;
  }
  if (idea.mode === "pins") {
    state.pins = idea.setup.pins.map((pin) => ({
      ...pin,
      h: pin.h || 12,
      ang: pin.ang == null ? 0 : pin.ang,
      slide: pin.slide == null ? 90 : pin.slide,
      pulled: false,
      pull: 0
    }));
    state.grains = idea.setup.emitters.flatMap((emitter) =>
      Array.from({ length: 16 }, (_, i) => ({ x: emitter.x + (Math.random() - 0.5) * 12, y: 78 - i * 4, vy: 0, c: emitter.c, settled: false }))
    );
    state.bins = idea.setup.bins.map((bin) => ({ ...bin, good: 0, bad: 0 }));
  }
}

function audio(type = "tap") {
  state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
  const osc = state.audio.createOscillator();
  const gain = state.audio.createGain();
  osc.type = type === "move" ? "sine" : "triangle";
  osc.frequency.value = { tap: 330, move: 220, good: 620, bad: 120, win: 820 }[type] || 330;
  gain.gain.setValueAtTime(0.05, state.audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, state.audio.currentTime + 0.15);
  osc.connect(gain).connect(state.audio.destination);
  osc.start();
  osc.stop(state.audio.currentTime + 0.18);
}

function cellCenter(r, c) {
  return [grid.x + c * grid.s + grid.s / 2, grid.y + r * grid.s + grid.s / 2];
}

function pos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H };
}

function cellFromPos(p) {
  const c = Math.floor((p.x - grid.x) / grid.s);
  const r = Math.floor((p.y - grid.y) / grid.s);
  return r >= 0 && c >= 0 && r < 6 && c < 6 ? { r, c } : null;
}

function blocked(r, c) {
  return r < 0 || c < 0 || r >= 6 || c >= 6 || (state.walls || []).some(([wr, wc]) => wr === r && wc === c);
}

function ballAt(r, c, exclude) {
  return state.balls.some((o) => !o.ok && o !== exclude && o.r === r && o.c === c);
}

function rect(x, y, w, h, r = 12, fill = "#111827", stroke = "rgba(255,255,255,.14)") {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}

function text(t, x, y, size = 14, color = "#e2e8f0", align = "center", weight = 500) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(t, x, y);
}

function drawBase() {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#111827");
  g.addColorStop(1, "#020617");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  text(idea.title, W / 2, 38, 25, "#f8fafc", "center", 800);
  text(idea.tag, W / 2, 62, 13, idea.color);
  rect(20, 82, 320, 68, 16, "rgba(15,23,42,.78)");
  wrap(idea.goal, 36, 109, 288, 16);
}

function wrap(t, x, y, max, lineH) {
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  let line = "";
  for (const word of t.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > max) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else line = test;
  }
  ctx.fillText(line, x, y);
}

function drawBoard() {
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) rect(grid.x + c * grid.s + 3, grid.y + r * grid.s + 3, 44, 44, 10, "rgba(30,41,59,.82)");
}

function drawButtons(labels) {
  labels.forEach((label, i) => {
    rect(28 + i * 78, 510, 68, 52, 15, "rgba(15,23,42,.9)", idea.color);
    text(label, 62 + i * 78, 542, 14, "#f8fafc");
  });
}

function particle(x, y, color, n = 14) {
  for (let i = 0; i < n; i++) state.particles.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.8) * 3, life: 28, color });
}

function drawParticles() {
  state.particles = state.particles.filter((p) => {
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--;
    ctx.globalAlpha = Math.max(0, p.life / 28);
    if (hasSprite("sand")) drawTintedDiscSprite("sand", p.x, p.y, 3, p.color);
    else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    return p.life > 0;
  });
}

function animateValue(obj, prop, target, speed = 0.18) {
  obj[prop] += (target - obj[prop]) * speed;
  if (Math.abs(obj[prop] - target) < 0.01) obj[prop] = target;
}

function finish(ok) {
  if (state.won || state.lost) return;
  state.won = ok;
  state.lost = !ok;
  audio(ok ? "win" : "bad");
}

function drawTilt() {
  drawBoard();
  state.goals.forEach(([r, c]) => { const [x, y] = cellCenter(r, c); ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke(); });
  state.holes.forEach(([r, c]) => { const [x, y] = cellCenter(r, c); ctx.fillStyle = "#020617"; ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fill(); });
  state.walls.forEach(([r, c]) => rect(grid.x + c * grid.s + 8, grid.y + r * grid.s + 8, 34, 34, 8, "#475569"));
  state.balls.forEach((b) => {
    animateValue(b, "ar", b.r, 0.16);
    animateValue(b, "ac", b.c, 0.16);
    const [x, y] = cellCenter(b.ar, b.ac);
    if (drawSpriteRaw("pearl", x, y, 32, 32)) {
      if (b.ok) { ctx.save(); ctx.fillStyle = "rgba(134,239,172,0.45)"; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill(); ctx.restore(); }
    } else {
      ctx.fillStyle = b.ok ? "#86efac" : idea.color;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.38)";
      ctx.beginPath();
      ctx.arc(x - 5, y - 5, 5, 0, 7);
      ctx.fill();
    }
  });
  drawButtons(["up", "left", "right", "down"]);
}

/** One move each along dr,dc; order so the front-most ball in that direction may enter a cell if it is free (no double occupancy). */
function moveBallsOneStep(dr, dc) {
  const act = state.balls.filter((b) => !b.ok);
  if (dr === 1) act.sort((a, b) => b.r - a.r);
  else if (dr === -1) act.sort((a, b) => a.r - b.r);
  else if (dc === 1) act.sort((a, b) => b.c - a.c);
  else if (dc === -1) act.sort((a, b) => a.c - b.c);
  let any = false;
  for (const b of act) {
    const nr = b.r + dr, nc = b.c + dc;
    if (blocked(nr, nc)) continue;
    if (ballAt(nr, nc, b)) continue;
    b.r = nr;
    b.c = nc;
    any = true;
  }
  return any;
}

function tilt(dr, dc) {
  for (let i = 0; i < 40; i++) {
    if (!moveBallsOneStep(dr, dc)) break;
  }
  state.balls.forEach((b) => {
    if (state.holes.some(([r, c]) => r === b.r && c === b.c)) finish(false);
    if (state.goals.some(([r, c]) => r === b.r && c === b.c)) b.ok = true;
  });
  if (state.balls.every((b) => b.ok)) finish(true);
  audio("move");
}

function pinCenter(pin) {
  return { cx: pin.x + pin.w / 2, cy: pin.y + (pin.h || 12) / 2 };
}

/** Grains (gx,gy) are blocked by this pin until pulled, when the solid moves away along +X. */
function pinBlocksGrain(pin, gx, gy) {
  if (pin.pulled) return false;
  const shift = (pin.pull || 0) * (pin.slide || 90);
  const c = pinCenter(pin);
  c.cx += shift;
  const cos = Math.cos(-pin.ang);
  const sin = Math.sin(-pin.ang);
  const dx = gx - c.cx, dy = gy - c.cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const halfW = pin.w / 2 + 4;
  const halfH = (pin.h || 12) / 2 + 5;
  return Math.abs(lx) <= halfW && Math.abs(ly) <= halfH;
}

function drawPinShape(pin) {
  const shift = (pin.pull || 0) * (pin.slide || 90);
  const c = pinCenter(pin);
  c.cx += shift;
  ctx.save();
  ctx.globalAlpha = 1 - (pin.pull || 0) * 0.75;
  ctx.translate(c.cx, c.cy);
  ctx.rotate(pin.ang);
  roundRectPath(-pin.w / 2, -((pin.h || 12) / 2), pin.w, pin.h || 12, 6);
  ctx.fillStyle = "#e5e7eb";
  ctx.strokeStyle = "rgba(15,23,42,.3)";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawChuteBackground() {
  ctx.save();
  ctx.strokeStyle = "rgba(100,116,139,.4)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const y0 = 100 + i * 55;
    ctx.beginPath();
    ctx.moveTo(20, y0);
    ctx.lineTo(140, y0 + 12);
    ctx.lineTo(320, y0);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPins() {
  drawChuteBackground();
  state.bins.forEach((bin) => { rect(bin.x - 32, 428, 64, 68, 12, colors[bin.c]); text(`${bin.good}/16`, bin.x, 520, 12); });
  state.pins.forEach((pin, i) => {
    if (pin.pulled) pin.pull = Math.min(1, (pin.pull || 0) + 0.07);
    if ((pin.pull || 0) < 1) drawPinShape(pin);
    text(`pin ${i + 1}`, pin.x + pin.w / 2, pin.y - 8, 11);
  });
  const blockedByPins = (g) => state.pins.some((pin) => pinBlocksGrain(pin, g.x, g.y));
  state.grains.forEach((g) => {
    if (!g.settled && !blockedByPins(g)) { g.vy += 0.1; g.y += g.vy; }
    if (!g.settled && g.y > 428) {
      const bin = state.bins.find((b) => Math.abs(b.x - g.x) < 40);
      if (bin) { bin[bin.c === g.c ? "good" : "bad"]++; g.settled = true; }
    }
    drawTintedDiscSprite("sand", g.x, g.y, 3, colors[g.c]);
  });
  if (state.bins.some((b) => b.bad > 0)) finish(false);
  if (state.grains.every((g) => g.settled) && state.bins.every((b) => b.good >= 14)) finish(true);
}

function drawEnd() {
  if (!state.won && !state.lost) return;
  ctx.fillStyle = "rgba(2,6,23,.78)";
  ctx.fillRect(0, 0, W, H);
  text(state.won ? "SOLVED" : "FAILED", W / 2, 292, 38, state.won ? "#86efac" : "#f87171", "center", 900);
  text("tap to restart", W / 2, 330, 15);
}

function loop() {
  state.tick++;
  drawBase();
  if (idea.mode === "tilt") drawTilt();
  if (idea.mode === "pins") drawPins();
  drawParticles();
  drawEnd();
  requestAnimationFrame(loop);
}

canvas.addEventListener("pointerdown", (e) => {
  const p = pos(e);
  if (state.won || state.lost) location.reload();
  if (idea.mode === "tilt") {
    const labels = [[-1, 0], [0, -1], [0, 1], [1, 0]];
    labels.forEach((d, i) => { if (p.x > 28 + i * 78 && p.x < 96 + i * 78 && p.y > 510 && p.y < 562) tilt(...d); });
  } else if (idea.mode === "pins") {
    state.pins.forEach((pin) => {
      if (pin.pulled) return;
      const shift = (pin.pull || 0) * (pin.slide || 90);
      const c = pinCenter(pin);
      c.cx += shift;
      const co = Math.cos(-pin.ang);
      const si = Math.sin(-pin.ang);
      const dx = p.x - c.cx, dy = p.y - c.cy;
      const lx = dx * co - dy * si;
      const ly = dx * si + dy * co;
      const halfW = pin.w / 2 + 20;
      const halfH = (pin.h || 12) / 2 + 16;
      if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) { pin.pulled = true; audio("good"); }
    });
  }
});

loadSprites().then(() => { init(); loop(); });
