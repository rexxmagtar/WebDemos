/**
 * Procedural planet textures → PNG. Run: node scripts/gen-planet-pngs.mjs
 * Writes assets/planets/{earth,mars,venus,sun,moon}.png
 */
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../assets/planets");
const SIZE = 256;
const cx = SIZE / 2;
const cy = SIZE / 2;
const R = 118;

function n2(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function n3(x, y, s) {
  return n2(x * s, y * s);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function setRgba(png, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  png.data[i] = r | 0;
  png.data[i + 1] = g | 0;
  png.data[i + 2] = b | 0;
  png.data[i + 3] = a | 0;
}

function sphereMask(dx, dy) {
  const d2 = dx * dx + dy * dy;
  const t = 1 - d2 / (R * R);
  if (t <= 0) return 0;
  // limb darkening
  return Math.sqrt(t) * (0.55 + 0.45 * t);
}

function makePng() {
  return new PNG({ width: SIZE, height: SIZE });
}

function writePng(png, name) {
  const buf = PNG.sync.write(png);
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, buf);
  console.log("wrote", file);
}

// --- per-planet ---

function renderEarth(png) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const m = sphereMask(dx, dy);
      if (m <= 0) {
        setRgba(png, x, y, 0, 0, 0, 0);
        continue;
      }
      const u = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const v = Math.hypot(dx, dy) / R;
      const n = n3(u * 8, v * 6, 3.1);
      const n2b = n3(u * 14 + 1, v * 8 + 2, 5.7);
      // land mask
      const land = n2b * 0.6 + n * 0.4;
      const isLand = land > 0.52;
      const coast = 1 - Math.min(1, Math.abs(land - 0.52) * 20);
      let r, g, b;
      if (isLand) {
        const gsh = 0.75 + 0.25 * n2(u * 20, v * 20);
        r = 22 * gsh;
        g = 110 * gsh;
        b = 45 * gsh;
      } else {
        r = 30 + 60 * n;
        g = 90 + 80 * n;
        b = 160 + 40 * n2(u * 9, v * 9);
      }
      if (coast < 1 && isLand) {
        r = lerp(r, 30, 1 - coast);
        g = lerp(g, 100, 1 - coast);
        b = lerp(b, 150, 1 - coast);
      }
      // clouds
      const cld = n3(u * 22 + 4, v * 12, 2.2);
      if (cld > 0.72) {
        const a = (cld - 0.72) / 0.28;
        r = lerp(r, 240, 0.4 * a);
        g = lerp(g, 240, 0.4 * a);
        b = lerp(b, 245, 0.4 * a);
      }
      const a = m * 255;
      setRgba(png, x, y, r, g, b, a);
    }
  }
}

function renderMars(png) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const m = sphereMask(dx, dy);
      if (m <= 0) {
        setRgba(png, x, y, 0, 0, 0, 0);
        continue;
      }
      const u = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const d = Math.hypot(dx, dy) / R;
      const dust = n3(u * 11, d * 7, 4.2);
      const r0 = 140 + 40 * dust;
      const g0 = 50 + 25 * n2(u * 7, d * 9);
      const b0 = 30 + 15 * n2(u * 5 + 1, d * 5);
      // rust patches
      let r = r0;
      let g = g0;
      let b = b0;
      if (n3(u * 6, 2, 1.5) < 0.18) {
        r *= 0.6;
        g *= 0.6;
        b *= 0.65;
      }
      const a = m * 255;
      setRgba(png, x, y, r, g, b, a);
    }
  }
}

function renderVenus(png) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const m = sphereMask(dx, dy);
      if (m <= 0) {
        setRgba(png, x, y, 0, 0, 0, 0);
        continue;
      }
      const u = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const band = Math.sin(u * Math.PI * 6 + n2(y * 0.2, 0) * 2) * 0.5 + 0.5;
      const w = 0.55 + 0.45 * band;
      const d = Math.hypot(dx, dy) / R;
      const soft = 0.85 + 0.15 * n3(u * 3, d * 4, 2.8);
      const r = 220 * w * soft;
      const g = 180 * w * soft;
      const b = 90 * w * 0.95;
      const a = m * 255;
      setRgba(png, x, y, r, g, b, a);
    }
  }
}

function renderSun(png) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const m = sphereMask(dx, dy);
      if (m <= 0) {
        setRgba(png, x, y, 0, 0, 0, 0);
        continue;
      }
      const d = Math.hypot(dx, dy) / R;
      const t = 1 - d;
      const cor = t * t;
      const gran = 0.9 + 0.1 * n2(x * 0.8, y * 0.8);
      const r = lerp(255, 200, 1 - cor) * gran;
      const g = lerp(220, 100, 1 - cor) * gran;
      const b = lerp(50, 12, 1 - cor) * gran;
      const a = m * 255;
      setRgba(png, x, y, r, g, b, a);
    }
  }
}

function renderMoon(png) {
  const craters = [
    { u: 0.35, v: 0.42, rad: 0.12 },
    { u: 0.68, v: 0.55, rad: 0.08 },
    { u: 0.5, v: 0.28, rad: 0.06 },
    { u: 0.2, v: 0.65, rad: 0.05 }
  ];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const m = sphereMask(dx, dy);
      if (m <= 0) {
        setRgba(png, x, y, 0, 0, 0, 0);
        continue;
      }
      const d = Math.hypot(dx, dy) / R;
      const u = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
      const v = d;
      let shade = 0.78 + 0.22 * n3(u * 9, v * 7, 3.4);
      for (const c of craters) {
        const du = u - c.u;
        const dv = (v * 0.9 + 0.05) - c.v;
        if (du * du + dv * dv < c.rad * c.rad) {
          const di = 1 - Math.hypot(du, dv) / c.rad;
          shade = lerp(shade, 0.35, di * 0.85);
        }
      }
      const r = 120 * shade;
      const g = 128 * shade;
      const b = 140 * shade;
      const a = m * 255;
      setRgba(png, x, y, r, g, b, a);
    }
  }
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const list = [
  ["earth", renderEarth],
  ["mars", renderMars],
  ["venus", renderVenus],
  ["sun", renderSun],
  ["moon", renderMoon]
];

for (const [name, fn] of list) {
  const png = makePng();
  fn(png);
  writePng(png, name);
}
